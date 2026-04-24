import type { ToolRegistry } from '../tool-registry.js'

export function registerSsrTools(registry: ToolRegistry): void {
  registry.register(
    {
      name: 'llui_hydration_report',
      description:
        'Compare the server-rendered HTML (from @llui/vike) against the current client DOM and return divergences. Each divergence includes the DOM path, kind (attribute/text/structural), and the server vs client values. Returns an empty array when hydration is clean.',
      inputSchema: { type: 'object', properties: {} },
    },
    'debug-api',
    async (_args, ctx) => {
      const divergences = await ctx.relay!.call('getHydrationReport', [])
      return { divergences }
    },
  )

  registry.register(
    {
      name: 'llui_ssr_render',
      description:
        'Server-render the active component using its current state and return the resulting HTML string. Requires @llui/vike to be installed. Useful for verifying that the server output matches what you expect before hydration.',
      inputSchema: {
        type: 'object',
        properties: {
          state: {
            type: 'object',
            description: 'State override (defaults to current component state)',
          },
        },
      },
    },
    'debug-api',
    async (args, ctx) => {
      const currentState = args.state ?? (await ctx.relay!.call('getState', []))
      const componentInfo = (await ctx.relay!.call('getComponentInfo', [])) as {
        name: string
        file: string | null
      } | null

      if (!componentInfo?.file) {
        return {
          ok: false,
          error: 'component_file_unknown',
          hint: 'Component file path not available — ensure @llui/vite-plugin emits __componentMeta in dev mode.',
        }
      }

      try {
        // Use Function-based dynamic import to avoid Vite static analysis
        // at transform time. @llui/vike is an optional peer dep — we must
        // not let the bundler try to resolve it unconditionally.
        const dynamicImport = new Function('specifier', 'return import(specifier)') as (
          s: string,
        ) => Promise<unknown>
        const vikeModule = (await dynamicImport('@llui/vike')) as {
          onRenderHtml: (ctx: unknown) => Promise<{ documentHtml: unknown }>
        }
        const pageModule = (await dynamicImport(componentInfo.file)) as {
          default: unknown
        }
        const pageContext = {
          Page: pageModule.default,
          pageProps: { initialState: currentState },
          urlOriginal: '/',
          headersOriginal: {},
        }
        const result = await vikeModule.onRenderHtml(pageContext)
        return { ok: true, html: String(result.documentHtml) }
      } catch (err: unknown) {
        const e = err as { message?: string }
        return {
          ok: false,
          error: 'ssr_render_failed',
          hint: e.message ?? 'Unknown error',
        }
      }
    },
  )
}
