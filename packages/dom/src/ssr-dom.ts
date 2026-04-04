/**
 * Set up a minimal DOM environment for server-side rendering.
 * Must be called (and awaited) once before renderToString on the server.
 * Uses jsdom — the calling package must have jsdom as a dependency.
 *
 * Import this from '@llui/dom/ssr' in server entry points only.
 * Never import in client code — jsdom is a server-only dependency.
 *
 * No-op if `document` is already defined.
 */
export async function initSsrDom(): Promise<void> {
  if (typeof document !== 'undefined') return

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
