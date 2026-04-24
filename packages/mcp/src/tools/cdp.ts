import type { ToolRegistry } from '../tool-registry.js'

export function registerCdpTools(registry: ToolRegistry): void {
  registry.register(
    {
      name: 'llui_screenshot',
      description:
        'Capture a screenshot of the browser page or a specific element. Returns base64-encoded PNG or JPEG. Requires CDP transport (browser attached via :9222 or Playwright fallback).',
      inputSchema: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector — screenshot only this element' },
          fullPage: {
            type: 'boolean',
            description: 'Capture full scrollable page (default false)',
          },
          format: {
            type: 'string',
            enum: ['png', 'jpeg'],
            description: 'Image format (default png)',
          },
        },
      },
    },
    'cdp',
    async (args, ctx) => {
      if (!ctx.cdp) return cdpUnavailable()
      return ctx.cdp.screenshot({
        selector: args.selector as string | undefined,
        fullPage: args.fullPage as boolean | undefined,
        format: args.format as 'png' | 'jpeg' | undefined,
      })
    },
  )

  registry.register(
    {
      name: 'llui_a11y_tree',
      description:
        'Return the accessibility tree for the page or a specific element. Useful for verifying ARIA roles, labels, and keyboard navigation structure.',
      inputSchema: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'Root element CSS selector (default: full page)',
          },
          interestingOnly: {
            type: 'boolean',
            description: 'Omit nodes with no accessibility-relevant attributes (default true)',
          },
        },
      },
    },
    'cdp',
    async (args, ctx) => {
      if (!ctx.cdp) return cdpUnavailable()
      return ctx.cdp.accessibilitySnapshot({
        selector: args.selector as string | undefined,
        interestingOnly: (args.interestingOnly as boolean | undefined) ?? true,
      })
    },
  )

  registry.register(
    {
      name: 'llui_network_tail',
      description:
        'Return recent network requests captured since the CDP session started. Includes URL, method, status, timing, and failure info.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Max entries to return (default: all buffered, max 500)',
          },
          filter: {
            type: 'object',
            properties: {
              urlPattern: { type: 'string', description: 'Regex pattern to match URLs' },
              status: { type: 'number', description: 'HTTP status code to filter on' },
            },
          },
        },
      },
    },
    'cdp',
    async (args, ctx) => {
      if (!ctx.cdp) return cdpUnavailable()
      const filter = args.filter as { urlPattern?: string; status?: number } | undefined
      return { entries: ctx.cdp.getNetworkBuffer(args.limit as number | undefined, filter) }
    },
  )

  registry.register(
    {
      name: 'llui_console_tail',
      description:
        'Return recent browser console entries (log, info, warn, error, debug) captured since the CDP session started.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max entries to return' },
          level: {
            type: 'string',
            enum: ['log', 'info', 'warn', 'error', 'debug'],
            description: 'Filter to this level only',
          },
        },
      },
    },
    'cdp',
    async (args, ctx) => {
      if (!ctx.cdp) return cdpUnavailable()
      return {
        entries: ctx.cdp.getConsoleBuffer(
          args.limit as number | undefined,
          args.level as string | undefined,
        ),
      }
    },
  )

  registry.register(
    {
      name: 'llui_uncaught_errors',
      description:
        'Return recent uncaught JavaScript exceptions captured since the CDP session started.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max entries to return' },
        },
      },
    },
    'cdp',
    async (args, ctx) => {
      if (!ctx.cdp) return cdpUnavailable()
      return { errors: ctx.cdp.getErrorBuffer(args.limit as number | undefined) }
    },
  )

  registry.register(
    {
      name: 'llui_browser_close',
      description:
        'Close the Playwright-owned fallback browser and clear the CDP session buffers. No-op if the browser is user-owned (attached via :9222).',
      inputSchema: { type: 'object', properties: {} },
    },
    'cdp',
    async (_args, ctx) => {
      if (!ctx.cdp) return { closed: false, reason: 'no_cdp_transport' }
      return ctx.cdp.closeBrowser()
    },
  )
}

function cdpUnavailable() {
  return {
    ok: false,
    error: 'cdp_unavailable',
    hint: 'CDP transport is not configured. Pass --url <devUrl> to llui-mcp.',
  }
}
