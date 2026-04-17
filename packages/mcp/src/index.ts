import type { LluiDebugAPI } from '@llui/dom'
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { ToolRegistry, type ToolContext, type ToolDefinition } from './tool-registry.js'
import { registerDebugApiTools } from './tools/index.js'
import { WebSocketRelayTransport } from './transports/index.js'

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

// ── MCP Protocol Types ──────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string | number
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

// ── MCP Server ──────────────────────────────────────────────────

export class LluiMcpServer {
  private readonly registry: ToolRegistry
  private readonly relay: WebSocketRelayTransport
  private readonly bridgePort: number
  private devUrl: string | null = null

  constructor(bridgePort = 5200) {
    this.bridgePort = bridgePort
    this.registry = new ToolRegistry()
    this.relay = new WebSocketRelayTransport({ port: bridgePort })
    registerDebugApiTools(this.registry)
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

  /** Start the MCP server on stdin/stdout */
  start(): void {
    let buffer = ''

    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk: string) => {
      buffer += chunk
      // MCP uses newline-delimited JSON
      const lines = buffer.split('\n')
      buffer = lines.pop()! // keep incomplete line
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const request = JSON.parse(line) as JsonRpcRequest
          this.handleRequest(request).then((response) => {
            process.stdout.write(JSON.stringify(response) + '\n')
          })
        } catch {
          // Ignore parse errors
        }
      }
    })
  }

  private async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    try {
      switch (request.method) {
        case 'initialize':
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: '@llui/mcp', version: '0.0.0' },
            },
          }

        case 'tools/list':
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: { tools: this.getTools() },
          }

        case 'tools/call': {
          const params = request.params as {
            name: string
            arguments: Record<string, unknown>
          }
          const result = await this.handleToolCall(params.name, params.arguments ?? {})
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            },
          }
        }

        default:
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: {
              code: -32601,
              message: `Method not found: ${request.method}`,
            },
          }
      }
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32000, message: String(err) },
      }
    }
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
