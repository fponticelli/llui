import type { LluiDebugAPI } from '@llui/dom'
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Server as HttpServer } from 'node:http'
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { ToolRegistry, type ToolContext, type ToolDefinition } from './tool-registry.js'
import { registerDebugApiTools } from './tools/index.js'
import { WebSocketRelayTransport, RelayUnavailableError } from './transports/index.js'

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

  constructor(optsOrPort: LluiMcpServerOptions | number = 5200) {
    const opts: LluiMcpServerOptions =
      typeof optsOrPort === 'number' ? { bridgePort: optsOrPort } : optsOrPort
    this.bridgePort = opts.bridgePort ?? 5200
    this.registry = new ToolRegistry()
    this.relay = new WebSocketRelayTransport({
      port: opts.attachTo ? undefined : this.bridgePort,
      attachTo: opts.attachTo,
      markerPath: mcpActiveFilePath(),
    })
    registerDebugApiTools(this.registry)

    // SDK-managed MCP server — owns the JSON-RPC protocol, handshake,
    // session lifecycle. Transport is plugged in later via `connect()`.
    this.mcp = new McpServer(
      { name: '@llui/mcp', version: '0.0.15' },
      { capabilities: { tools: {} } },
    )
    this.registerMcpHandlers()
  }

  private registerMcpHandlers(): void {
    this.mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    }))

    this.mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
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
