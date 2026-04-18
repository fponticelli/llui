import type { LluiDebugAPI } from '@llui/dom'
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Server as HttpServer } from 'node:http'
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { ToolRegistry, type ToolContext, type ToolDefinition } from './tool-registry.js'
import { registerDebugApiTools } from './tools/index.js'
import { WebSocketRelayTransport, RelayUnavailableError } from './transports/index.js'

/**
 * Version advertised in the MCP `initialize` handshake. Read once from
 * our own `package.json` so it stays in sync with the publish bump,
 * instead of a hardcoded literal that silently drifts each release.
 *
 * Falls back to `'unknown'` on read failure — SDK initialization still
 * succeeds; only the cosmetic serverInfo.version is affected.
 */
const PACKAGE_VERSION: string = (() => {
  try {
    // dist layout: `dist/index.js` → `package.json` is two levels up
    // from the module file at runtime.
    const here = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8')) as {
      version?: string
    }
    return typeof pkg.version === 'string' ? pkg.version : 'unknown'
  } catch {
    return 'unknown'
  }
})()

/**
 * Walk up from `start` until we find a workspace root marker. Used by
 * both the MCP server (writing the active marker) and the Vite plugin
 * (watching it) so they agree on a single shared location regardless of
 * which subdirectory each process happens to be running in.
 *
 * Strong markers (workspace root): pnpm-workspace.yaml, .git directory.
 * If neither is found anywhere up the chain, falls back to the highest
 * package.json above `start`. For pnpm monorepos this finds the workspace
 * root from any subpackage; for single-package projects it finds the
 * package root.
 */
export function findWorkspaceRoot(start: string = process.cwd()): string {
  let dir = resolve(start)
  let lastPackageJson: string | null = null
  while (true) {
    // Strong markers — return immediately
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir
    if (existsSync(resolve(dir, '.git'))) return dir
    // Track the highest package.json as a fallback
    if (existsSync(resolve(dir, 'package.json'))) lastPackageJson = dir
    const parent = dirname(dir)
    if (parent === dir) {
      // Reached filesystem root — return the highest package.json we saw
      return lastPackageJson ?? start
    }
    dir = parent
  }
}

/**
 * Path where the MCP server writes its active port marker. Vite plugins
 * watch this file to auto-trigger browser-side `__lluiConnect()` whenever
 * the MCP server starts, regardless of whether Vite or MCP started first.
 *
 * Resolved relative to the workspace root (not the immediate cwd) so the
 * MCP server and the Vite plugin always agree on a single location even
 * when one runs from the repo root and the other from a subpackage.
 */
export function mcpActiveFilePath(cwd: string = process.cwd()): string {
  return resolve(findWorkspaceRoot(cwd), 'node_modules/.cache/llui-mcp/active.json')
}

// ── MCP Server ──────────────────────────────────────────────────

export interface LluiMcpServerOptions {
  /**
   * Port for the browser-relay WebSocket bridge. When the MCP transport
   * is stdio (the CLI default), the relay stands up its own server on
   * this port. When the MCP transport is HTTP, the relay attaches to
   * that HTTP server and the MCP protocol + bridge share a single port.
   */
  bridgePort?: number
  /**
   * Optional pre-existing `http.Server` to share with the bridge. When
   * provided, the bridge attaches to it via upgrade routing on
   * `/bridge`; `bridgePort` is ignored for server-creation purposes
   * (but still written into the marker file so consumers know where to
   * connect).
   */
  attachTo?: HttpServer
}

export class LluiMcpServer {
  private readonly registry: ToolRegistry
  private readonly relay: WebSocketRelayTransport
  private readonly bridgePort: number
  private readonly mcp: McpServer
  private devUrl: string | null = null

  /**
   * @param optsOrPort options object (preferred) or bridge port (legacy).
   *   The numeric-port form is kept for one release cycle of back-compat;
   *   new code should always pass an options object. The options form
   *   supports `attachTo` for HTTP-transport deployments that share a
   *   single port between MCP and the browser bridge — the numeric form
   *   can't express that.
   * @deprecated numeric `optsOrPort` — pass `{ bridgePort }` instead.
   *   This overload will be removed in a future breaking release.
   */
  constructor(optsOrPort: LluiMcpServerOptions | number = 5200) {
    const opts: LluiMcpServerOptions =
      typeof optsOrPort === 'number' ? { bridgePort: optsOrPort } : optsOrPort
    this.bridgePort = opts.bridgePort ?? 5200
    this.registry = new ToolRegistry()
    // Pass bridgePort even in attachTo mode — the relay's diagnose()
    // needs it for the port field of BridgeDiagnostic. The `start()`
    // path is gated on `attachTo` first so a standalone listener
    // never gets created twice.
    this.relay = new WebSocketRelayTransport({
      port: this.bridgePort,
      attachTo: opts.attachTo,
      markerPath: mcpActiveFilePath(),
    })
    registerDebugApiTools(this.registry)

    // SDK-managed MCP server — owns the JSON-RPC protocol, handshake,
    // session lifecycle. Transport is plugged in later via `connect()`.
    this.mcp = this.buildMcpServer()
  }

  /**
   * Build a fresh SDK `McpServer` wired to THIS instance's tool
   * registry and browser relay. The primary `this.mcp` uses one.
   * `createSessionMcp()` returns additional ones for HTTP-transport
   * deployments where every session needs its own SDK Server — each
   * routes tool calls through the shared relay, so the single
   * bridgeHost owns all the browser-facing state.
   */
  private buildMcpServer(): McpServer {
    const mcp = new McpServer(
      { name: '@llui/mcp', version: PACKAGE_VERSION },
      { capabilities: { tools: {} } },
    )
    mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    }))
    mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params
      try {
        const result = await this.handleToolCall(name, args ?? {})
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        }
      } catch (err) {
        // Bridge-unavailable errors carry a structured diagnostic — surface
        // it as an isError tool result so the caller (typically Claude) sees
        // WHY the browser isn't reachable, not just that it failed.
        if (err instanceof RelayUnavailableError) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ error: 'bridge-unavailable', ...err.diagnostic }, null, 2),
              },
            ],
          }
        }
        throw err
      }
    })
    return mcp
  }

  /**
   * Build a new SDK MCP server sharing this instance's registry + relay,
   * for HTTP-transport deployments where each session needs its own
   * `Server` (SDK requirement). Call-site pattern:
   *
   *   const bridgeHost = new LluiMcpServer({ bridgePort, attachTo: httpServer })
   *   bridgeHost.startBridge()
   *   // Per session:
   *   const sessionMcp = bridgeHost.createSessionMcp()
   *   await sessionMcp.connect(transport)
   */
  createSessionMcp(): McpServer {
    return this.buildMcpServer()
  }

  /**
   * Connect the SDK MCP server to a transport (stdio, HTTP, etc).
   * The CLI builds the transport based on command-line flags and
   * hands it in here.
   */
  async connect(transport: Transport): Promise<void> {
    await this.mcp.connect(transport)
  }

  /** Connect to a debug API instance directly (for in-process usage). */
  connectDirect(api: LluiDebugAPI): void {
    this.relay.connectDirect(api)
  }

  /**
   * Set the dev-server URL that Phase 2's CDP fallback can navigate a
   * Playwright browser to. Persisted into the active marker file so the
   * Vite plugin (or other consumers) can rebroadcast it. If the bridge is
   * already running, rewrites the marker so consumers see the update.
   */
  setDevUrl(url: string): void {
    this.devUrl = url
    if (this.relay.isServerRunning()) this.writeActiveFile()
  }

  /**
   * Start a WebSocket server on the configured bridge port. The browser-side
   * relay (injected by the Vite plugin in dev mode) connects here and forwards
   * debug-API calls.
   */
  startBridge(): void {
    this.relay.start()

    // Write the active marker file so Vite plugins watching it can
    // dispatch an HMR custom event to auto-trigger browser connects.
    this.writeActiveFile()
  }

  stopBridge(): void {
    this.relay.stop()
    this.removeActiveFile()
  }

  private writeActiveFile(): void {
    try {
      const path = mcpActiveFilePath()
      mkdirSync(dirname(path), { recursive: true })
      const payload: { port: number; pid: number; devUrl?: string } = {
        port: this.bridgePort,
        pid: process.pid,
      }
      if (this.devUrl !== null) payload.devUrl = this.devUrl
      writeFileSync(path, JSON.stringify(payload))
    } catch {
      // Best-effort — failure to write the marker should not crash the server
    }
  }

  private removeActiveFile(): void {
    try {
      const path = mcpActiveFilePath()
      if (existsSync(path)) unlinkSync(path)
    } catch {
      // Ignore — file may already be gone
    }
  }

  /** Get tool definitions for MCP handshake */
  getTools(): ToolDefinition[] {
    return this.registry.listDefinitions()
  }

  /** Handle an MCP tool call */
  async handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
    const ctx: ToolContext = { relay: this.relay, cdp: null }
    return this.registry.dispatch(name, args, ctx)
  }
}

/**
 * Snapshot of all registered tool definitions. Kept as a named export for
 * backward compatibility with downstream consumers that used to import the
 * `TOOLS` array re-export under this alias.
 */
export const mcpToolDefinitions: ToolDefinition[] = (() => {
  const registry = new ToolRegistry()
  registerDebugApiTools(registry)
  return registry.listDefinitions()
})()
