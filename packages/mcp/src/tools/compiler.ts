import type { ToolRegistry } from '../tool-registry.js'

export function registerCompilerTools(registry: ToolRegistry): void {
  registry.register(
    {
      name: 'llui_show_compiled',
      description:
        "Return the pre-transform and post-transform source for the active component's view function. Useful for understanding what the Vite plugin compiled and why a binding exists.",
      inputSchema: {
        type: 'object',
        properties: {
          viewFn: {
            type: 'string',
            description: 'Specific view helper name to extract (optional)',
          },
        },
      },
    },
    'compiler',
    async (args, ctx) => {
      const result = (await ctx.relay!.call('getCompiledSource', [args.viewFn ?? null])) as {
        pre: string
        post: string
      } | null
      return result ?? { pre: null, post: null }
    },
  )

  registry.register(
    {
      name: 'llui_explain_mask',
      description:
        'For a given state-path key, return the mask bit and related paths. Helps diagnose why a binding does or does not update when a message fires.',
      inputSchema: {
        type: 'object',
        properties: {
          msgType: {
            type: 'string',
            description: 'State path key to look up in the mask map',
          },
        },
        required: ['msgType'],
      },
    },
    'compiler',
    async (args, ctx) => {
      const map = (await ctx.relay!.call('getMsgMaskMap', [])) as Record<string, number> | null
      if (!map) {
        return {
          msgType: args.msgType,
          mask: null,
          error: 'No mask map available — component may not have agent metadata emitted',
        }
      }
      const mask = map[args.msgType as string] ?? 0
      const paths = Object.entries(map)
        .filter(([, bit]) => bit === mask && mask !== 0)
        .map(([path]) => path)
      return { msgType: args.msgType, mask, paths }
    },
  )

  registry.register(
    {
      name: 'llui_goto_binding_source',
      description:
        'Return the source file, line, and column of the view() expression that created a specific binding index. Use with llui_get_bindings to map binding indices to their origin.',
      inputSchema: {
        type: 'object',
        properties: {
          bindingIndex: { type: 'number', description: 'The binding index (0-based)' },
        },
        required: ['bindingIndex'],
      },
    },
    'compiler',
    async (args, ctx) => {
      return ctx.relay!.call('getBindingSource', [args.bindingIndex])
    },
  )
}
