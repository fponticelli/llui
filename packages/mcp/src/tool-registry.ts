export interface ToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export type ToolLayer = 'debug-api' | 'cdp' | 'source' | 'compiler'

export interface ToolContext {
  relay: RelayTransport | null
  cdp: CdpTransport | null
}

export interface RelayTransport {
  call(method: string, args: unknown[]): Promise<unknown>
  isAvailable(): boolean
}

export interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug'
  text: string
  timestamp: number
  stackTrace?: string
}

export interface NetworkEntry {
  requestId: string
  url: string
  method: string
  status: number | null
  startTime: number
  endTime: number | null
  durationMs: number | null
  failed: boolean
  failureReason?: string
}

export interface ErrorEntry {
  text: string
  stack: string
  timestamp: number
  url?: string
  line?: number
  column?: number
}

export interface CdpTransport {
  call(domain: string, method: string, params?: Record<string, unknown>): Promise<unknown>
  isAvailable(): boolean
  screenshot(opts: {
    selector?: string
    fullPage?: boolean
    format?: 'png' | 'jpeg'
  }): Promise<{ data: string; format: string; mimeType: string }>
  accessibilitySnapshot(opts: {
    selector?: string
    interestingOnly?: boolean
  }): Promise<unknown>
  getConsoleBuffer(limit?: number, level?: string): ConsoleEntry[]
  getNetworkBuffer(
    limit?: number,
    filter?: { urlPattern?: string; status?: number },
  ): NetworkEntry[]
  getErrorBuffer(limit?: number): ErrorEntry[]
  closeBrowser(): Promise<{ closed: boolean; reason?: string }>
}

export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>

interface Entry {
  definition: ToolDefinition
  layer: ToolLayer
  handler: ToolHandler
}

export class ToolRegistry {
  private entries = new Map<string, Entry>()

  register(definition: ToolDefinition, layer: ToolLayer, handler: ToolHandler): void {
    if (this.entries.has(definition.name)) {
      throw new Error(`Duplicate tool registration: ${definition.name}`)
    }
    this.entries.set(definition.name, { definition, layer, handler })
  }

  async dispatch(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
    const entry = this.entries.get(name)
    if (!entry) throw new Error(`Unknown tool: ${name}`)
    return entry.handler(args, ctx)
  }

  listDefinitions(): ToolDefinition[] {
    return Array.from(this.entries.values()).map((e) => e.definition)
  }

  getLayer(name: string): ToolLayer | null {
    return this.entries.get(name)?.layer ?? null
  }
}
