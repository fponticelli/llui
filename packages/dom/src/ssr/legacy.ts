/**
 * `@llui/dom/ssr/legacy` — back-compat shim for `initSsrDom()`.
 *
 * Imports jsdom and mutates globalThis with its window classes, the way
 * the 0.0.23-and-earlier API worked. Kept for one release cycle so
 * existing call sites don't break on upgrade.
 *
 * Anyone importing from here pays the jsdom bundle cost. Migrate to
 * `jsdomEnv()` from `@llui/dom/ssr/jsdom` (or `linkedomEnv()` from
 * `@llui/dom/ssr/linkedom`) and pass the result to `renderToString` /
 * `renderNodes` — it's the only path that stays concurrent-safe, works
 * on strict-isolate runtimes (Cloudflare Workers), and keeps jsdom out
 * of bundles that don't want it.
 */

let _initSsrDomWarned = false

/**
 * @deprecated Use `jsdomEnv()` from `@llui/dom/ssr/jsdom` (or
 * `linkedomEnv()` from `@llui/dom/ssr/linkedom`) and pass the result
 * to `renderToString` / `renderNodes` explicitly. Global mutation
 * forbids concurrent SSR with different DOM implementations and
 * doesn't work on strict isolate runtimes like Cloudflare Workers.
 *
 * This shim will be removed in a future breaking release.
 */
export async function initSsrDom(): Promise<void> {
  if (typeof document !== 'undefined') return

  if (!_initSsrDomWarned) {
    _initSsrDomWarned = true
    console.warn(
      '[LLui] initSsrDom() is deprecated and will be removed in a future release.\n' +
        'Migrate to:\n' +
        "  import { jsdomEnv } from '@llui/dom/ssr/jsdom'\n" +
        "  import { renderToString } from '@llui/dom/ssr'\n" +
        '  const env = await jsdomEnv()\n' +
        '  const html = renderToString(MyApp, state, env)\n' +
        'The global-mutation approach is incompatible with concurrent SSR\n' +
        'and strict-isolate runtimes (Cloudflare Workers).',
    )
  }

  // @ts-expect-error — jsdom is an optional peer dependency, not typed
  const jsdomMod = await import('jsdom')
  const jsdom = jsdomMod as { JSDOM: new (html: string) => { window: Record<string, unknown> } }
  const dom = new jsdom.JSDOM('<!DOCTYPE html><html><body></body></html>')
  const g = globalThis as Record<string, unknown>
  const win = dom.window
  for (const key of [
    'document',
    'HTMLElement',
    'Element',
    'Node',
    'Text',
    'Comment',
    'MouseEvent',
    'ShadowRoot',
    'DocumentFragment',
    'HTMLTemplateElement',
  ]) {
    if (win[key] !== undefined) g[key] = win[key]
  }
}
