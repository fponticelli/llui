import { z } from 'zod'

/**
 * External-facing tool definition. Kept JSON-Schema-shaped on the
 * outside so back-compat consumers (`getTools()`, the
 * `mcpToolDefinitions` snapshot, tests asserting `inputSchema.properties`)
 * keep working unchanged. The JSON Schema is derived from the Zod
 * schema via `z.toJSONSchema` at registration time.
 */
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
  accessibilitySnapshot(opts: { selector?: string; interestingOnly?: boolean }): Promise<unknown>
  getConsoleBuffer(limit?: number, level?: string): ConsoleEntry[]
  getNetworkBuffer(
    limit?: number,
    filter?: { urlPattern?: string; status?: number },
  ): NetworkEntry[]
  getErrorBuffer(limit?: number): ErrorEntry[]
  closeBrowser(): Promise<{ closed: boolean; reason?: string }>
}

/**
 * Author-facing tool spec. The Zod schema is the single source of
 * truth for both runtime input validation and the JSON Schema
 * published in `tools/list`. Handlers receive the parsed (and thus
 * typed) arguments — no more `args.foo as string` ceremony at every
 * call site.
 */
export interface ToolSpec<S extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>> {
  name: string
  description: string
  schema: S
}

export type ToolHandler<S extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>> = (
  args: z.infer<S>,
  ctx: ToolContext,
) => Promise<unknown>

interface Entry {
  spec: ToolSpec
  layer: ToolLayer
  handler: ToolHandler
  /** Memoized JSON Schema for back-compat `ToolDefinition.inputSchema`. */
  jsonSchema: ToolDefinition['inputSchema']
}

/**
 * Convert a Zod object schema to the JSON Schema shape this registry
 * has historically exposed (`{type:'object', properties, required?}`).
 * Filters out the `additionalProperties` and `$schema` keys Zod's
 * `toJSONSchema` adds — they don't affect MCP clients but bloat the
 * snapshot and break tests asserting an exact shape.
 */
function toLegacyJsonSchema(schema: z.ZodObject<z.ZodRawShape>): ToolDefinition['inputSchema'] {
  const raw = z.toJSONSchema(schema) as {
    type?: string
    properties?: Record<string, unknown>
    required?: string[]
  }
  const out: ToolDefinition['inputSchema'] = {
    type: 'object',
    properties: raw.properties ?? {},
  }
  if (raw.required && raw.required.length > 0) out.required = raw.required
  return out
}

export class ToolRegistry {
  private entries = new Map<string, Entry>()

  register<S extends z.ZodObject<z.ZodRawShape>>(
    spec: ToolSpec<S>,
    layer: ToolLayer,
    handler: ToolHandler<S>,
  ): void {
    if (this.entries.has(spec.name)) {
      throw new Error(`Duplicate tool registration: ${spec.name}`)
    }
    this.entries.set(spec.name, {
      spec: spec as ToolSpec,
      layer,
      handler: handler as ToolHandler,
      jsonSchema: toLegacyJsonSchema(spec.schema),
    })
  }

  async dispatch(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
    const entry = this.entries.get(name)
    if (!entry) throw new Error(`Unknown tool: ${name}`)
    // Validate input against the Zod schema before dispatching. Any
    // mismatched / extra-required fields surface as a structured
    // error here rather than a downstream `undefined.foo` crash.
    const parsed = entry.spec.schema.safeParse(args)
    if (!parsed.success) {
      throw new Error(`Invalid args for ${name}: ${parsed.error.message}`)
    }
    return entry.handler(parsed.data, ctx)
  }

  listDefinitions(): ToolDefinition[] {
    return Array.from(this.entries.values()).map((e) => ({
      name: e.spec.name,
      description: e.spec.description,
      inputSchema: e.jsonSchema,
    }))
  }

  /**
   * Iterator over the registered (spec, handler) pairs. Used by
   * `index.ts` to register each tool with the SDK's high-level
   * `McpServer.registerTool` API.
   */
  listEntries(): { spec: ToolSpec; handler: ToolHandler }[] {
    return Array.from(this.entries.values()).map((e) => ({ spec: e.spec, handler: e.handler }))
  }

  getLayer(name: string): ToolLayer | null {
    return this.entries.get(name)?.layer ?? null
  }
}
