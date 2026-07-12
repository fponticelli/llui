import type { LluiDebugAPI } from '@llui/dom'
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Server as HttpServer } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ToolRegistry, type ToolContext, type ToolDefinition } from './tool-registry.js'
import {
  registerDebugApiTools,
  registerCdpTools,
  registerStaticCompilerTools,
  registerSourceTools,
  registerSsrTools,
  registerNotesTools,
} from './tools/index.js'
import { registerNotesResources } from './resources/notes.js'
import {
  WebSocketRelayTransport,
  RelayUnavailableError,
  CdpSessionManager,
} from './transports/index.js'

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

/**
 * Path for the per-launch HTTP bearer token used in `--http` mode. Lives
 * next to the active marker (same workspace-rooted cache dir) so a
 * same-user local client can read it, but is a SEPARATE 0600 file — the
 * token is never written into the world-readable marker. Lives here (not
 * in cli.ts) so tests can import the path without triggering the CLI's
 * top-level `main()` side effect.
 */
export function mcpHttpTokenPath(cwd: string = process.cwd()): string {
  return resolve(findWorkspaceRoot(cwd), 'node_modules/.cache/llui-mcp/http-token')
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
  /**
   * Optional dev-server URL for CDP fallback navigation. When provided,
   * the CDP session manager will use this URL as the target for Playwright
   * browser instances.
   */
  devUrl?: string
  /**
   * Whether to run the Playwright browser in headed mode (visible window).
   * Defaults to false (headless).
   */
  headed?: boolean
  /**
   * Filesystem root for the devmode-annotate notebook
   * (https://github.com/fponticelli/llui — docs/proposals/devmode-annotate/).
   * MCP notes tools (`llui_list_notes`, `llui_read_note`, …) read from
   * this directory.
   *
   * Resolution order: this option → `LLUI_NOTES_DIR` env var → workspace
   * root + `.llui/notes`.
   */
  notesRoot?: string
  /**
   * Opt in to the arbitrary-eval tool (`llui_eval`). OFF by default.
   *
   * SECURITY: `llui_eval` runs caller-supplied JavaScript in the user's
   * live browser session (RCE). It is registered only when this flag is
   * true OR `LLUI_MCP_ENABLE_EVAL=1` is set; otherwise the tool is never
   * registered and never listed.
   */
  enableEval?: boolean
}

export class LluiMcpServer {
  private readonly registry: ToolRegistry
  private readonly relay: WebSocketRelayTransport
  private readonly bridgePort: number
  private readonly mcp: McpServer
  private readonly cdp: CdpSessionManager
  private readonly notesRoot: string
  private devUrl: string | null = null

  constructor(opts: LluiMcpServerOptions = {}) {
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
      // Enforced only in attachTo (shared-HTTP-port) mode, where cli.ts
      // writes the per-launch token to this path. Harmless in standalone
      // mode (the file is absent, so the token check is skipped).
      authTokenPath: mcpHttpTokenPath(),
    })
    this.cdp = new CdpSessionManager({
      devUrl: opts.devUrl ?? null,
      headed: opts.headed ?? false,
    })
    // Persist the constructed devUrl so `llui_capture` and other tools
    // that need to reach the Vite dev server can resolve a URL without
    // an explicit setDevUrl() call. setDevUrl() still works at runtime
    // for late-arriving values (e.g. plugin stamping after init).
    this.devUrl = opts.devUrl ?? null
    this.notesRoot = resolveNotesRoot(opts.notesRoot)
    registerDebugApiTools(this.registry, { enableEval: opts.enableEval })
    registerCdpTools(this.registry)
    registerStaticCompilerTools(this.registry)
    registerSourceTools(this.registry)
    registerSsrTools(this.registry)
    registerNotesTools(this.registry)

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
   *
   * Uses the high-level `McpServer.registerTool` API: each tool's
   * Zod schema (declared once in the registry) drives both runtime
   * input validation and the JSON Schema published to `tools/list`.
   */
  private buildMcpServer(): McpServer {
    const mcp = new McpServer(
      { name: '@llui/mcp', version: PACKAGE_VERSION },
      { capabilities: { tools: {}, resources: {} } },
    )
    registerNotesResources(mcp, { notesRoot: () => this.notesRoot })
    for (const { spec, handler } of this.registry.listEntries()) {
      mcp.registerTool(
        spec.name,
        { description: spec.description, inputSchema: spec.schema.shape },
        async (args) => {
          const ctx: ToolContext = {
            relay: this.relay,
            cdp: this.cdp,
            notesRoot: this.notesRoot,
            devServerUrl: this.devUrl,
          }
          try {
            const result = await handler(args as Record<string, unknown>, ctx)
            // structuredContent is what current Claude clients
            // (Desktop + CC) consume preferentially when present —
            // typed JSON instead of a stringified blob. The text
            // content stays as a fallback for older clients.
            return {
              structuredContent: result as Record<string, unknown>,
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            } satisfies CallToolResult
          } catch (err) {
            // Bridge-unavailable errors carry a structured diagnostic —
            // surface it as an isError tool result so the caller
            // (typically Claude) sees WHY the browser isn't reachable,
            // not just that it failed.
            if (err instanceof RelayUnavailableError) {
              return {
                isError: true,
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(
                      { error: 'bridge-unavailable', ...err.diagnostic },
                      null,
                      2,
                    ),
                  },
                ],
              } satisfies CallToolResult
            }
            throw err
          }
        },
      )
    }
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
    this.cdp.setDevUrl(url)
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
    const ctx: ToolContext = {
      relay: this.relay,
      cdp: this.cdp,
      notesRoot: this.notesRoot,
      devServerUrl: this.devUrl,
    }
    return this.registry.dispatch(name, args, ctx)
  }
}

/**
 * Resolve the notes root: explicit option → env var → workspace root.
 *
 * Falls back to `<workspace>/.llui/notes` so the MCP server and Vite
 * plugin land on the same default without explicit coordination.
 */
function resolveNotesRoot(explicit: string | undefined): string {
  if (explicit) return resolve(explicit)
  const env = process.env['LLUI_NOTES_DIR']
  if (env) return resolve(env)
  return resolve(findWorkspaceRoot(), '.llui/notes')
}
