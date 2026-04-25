import { z } from 'zod'
import type { ToolRegistry } from '../tool-registry.js'

export function registerCdpTools(registry: ToolRegistry): void {
  registry.register(
    {
      name: 'llui_screenshot',
      description:
        'Capture a screenshot of the browser page or a specific element. Returns base64-encoded PNG or JPEG. Requires CDP transport (browser attached via :9222 or Playwright fallback).',
      schema: z.object({
        selector: z.string().optional().describe('CSS selector — screenshot only this element'),
        fullPage: z.boolean().optional().describe('Capture full scrollable page (default false)'),
        format: z.enum(['png', 'jpeg']).optional().describe('Image format (default png)'),
      }),
    },
    'cdp',
    async (args, ctx) => {
      if (!ctx.cdp) return cdpUnavailable()
      return ctx.cdp.screenshot({
        selector: args.selector,
        fullPage: args.fullPage,
        format: args.format,
      })
    },
  )

  registry.register(
    {
      name: 'llui_a11y_tree',
      description:
        'Return the accessibility tree for the page or a specific element. Useful for verifying ARIA roles, labels, and keyboard navigation structure.',
      schema: z.object({
        selector: z.string().optional().describe('Root element CSS selector (default: full page)'),
        interestingOnly: z
          .boolean()
          .optional()
          .describe('Omit nodes with no accessibility-relevant attributes (default true)'),
      }),
    },
    'cdp',
    async (args, ctx) => {
      if (!ctx.cdp) return cdpUnavailable()
      return ctx.cdp.accessibilitySnapshot({
        selector: args.selector,
        interestingOnly: args.interestingOnly ?? true,
      })
    },
  )

  registry.register(
    {
      name: 'llui_network_tail',
      description:
        'Return recent network requests captured since the CDP session started. Includes URL, method, status, timing, and failure info.',
      schema: z.object({
        limit: z
          .number()
          .optional()
          .describe('Max entries to return (default: all buffered, max 500)'),
        filter: z
          .object({
            urlPattern: z.string().optional().describe('Regex pattern to match URLs'),
            status: z.number().optional().describe('HTTP status code to filter on'),
          })
          .optional(),
      }),
    },
    'cdp',
    async (args, ctx) => {
      if (!ctx.cdp) return cdpUnavailable()
      return { entries: ctx.cdp.getNetworkBuffer(args.limit, args.filter) }
    },
  )

  registry.register(
    {
      name: 'llui_console_tail',
      description:
        'Return recent browser console entries (log, info, warn, error, debug) captured since the CDP session started.',
      schema: z.object({
        limit: z.number().optional().describe('Max entries to return'),
        level: z
          .enum(['log', 'info', 'warn', 'error', 'debug'])
          .optional()
          .describe('Filter to this level only'),
      }),
    },
    'cdp',
    async (args, ctx) => {
      if (!ctx.cdp) return cdpUnavailable()
      return { entries: ctx.cdp.getConsoleBuffer(args.limit, args.level) }
    },
  )

  registry.register(
    {
      name: 'llui_uncaught_errors',
      description:
        'Return recent uncaught JavaScript exceptions captured since the CDP session started.',
      schema: z.object({
        limit: z.number().optional().describe('Max entries to return'),
      }),
    },
    'cdp',
    async (args, ctx) => {
      if (!ctx.cdp) return cdpUnavailable()
      return { errors: ctx.cdp.getErrorBuffer(args.limit) }
    },
  )

  registry.register(
    {
      name: 'llui_browser_close',
      description:
        'Close the Playwright-owned fallback browser and clear the CDP session buffers. No-op if the browser is user-owned (attached via :9222).',
      schema: z.object({}),
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
