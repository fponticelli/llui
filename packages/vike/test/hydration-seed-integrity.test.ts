// Issue #112 — a missing `lluiLayoutData` on the client must fail LOUDLY.
//
// Vike forwards a pageContext key to the client only when it is listed in
// `passToClient`. `lluiLayoutData` therefore arrives on the server (where +data
// ran) and is ABSENT on the client unless the app opted in — so the server
// rendered a layout from its data slice and the client silently re-seeded the
// same layout from `init()`. The manifest compared layer NAMES only, so the
// integrity check passed and a logged-in shell hydrated to `anonymous`.
//
// The manifest now carries a per-layer "seeded from data" flag, and the chain's
// data array is built index-aligned so a short/missing `lluiLayoutData` can never
// slide the page's slice onto a layout.
import { describe, it, expect, beforeEach } from 'vitest'
import { browserEnv } from '@llui/dom/ssr'
import { component, div, text } from '@llui/dom'
import { createOnRenderHtml } from '../src/on-render-html.js'
import type { RenderHtmlResult } from '../src/on-render-html.js'
import { createOnRenderClient, _resetChainForTest } from '../src/on-render-client.js'
import { pageSlot } from '../src/page-slot.js'
import { HYDRATION_MANIFEST_VERSION } from '../src/chain.js'

const env = browserEnv()
const domEnv = () => env

type ShellState = { user: string }
type ArticleState = { title: string }

const Shell = component<ShellState, never, never>({
  name: 'Shell',
  init: () => ({ user: 'anonymous' }),
  update: (s) => s,
  view: ({ state }) => [div({ class: 'shell' }, [text(state.map((s) => s.user)), pageSlot()])],
})

const Article = component<ArticleState, never, never>({
  name: 'Article',
  init: () => ({ title: 'untitled' }),
  update: (s) => s,
  view: ({ state }) => [div({ class: 'article' }, [text(state.map((s) => s.title))])],
})

function getHtml(result: RenderHtmlResult): string {
  const doc = result.documentHtml
  return typeof doc === 'string' ? doc : doc._escaped
}

function primeHydration(result: RenderHtmlResult): HTMLElement {
  const html = getHtml(result)
  const match = html.match(/<div id="app">([\s\S]*?)<\/div>\s*<script>/)
  document.body.innerHTML = ''
  const container = document.createElement('div')
  container.id = 'app'
  container.innerHTML = match?.[1] ?? ''
  document.body.appendChild(container)
  ;(window as { __LLUI_STATE__?: unknown }).__LLUI_STATE__ = result.pageContext.lluiState
  return container
}

beforeEach(() => {
  _resetChainForTest()
  document.body.innerHTML = ''
  delete (window as { __LLUI_STATE__?: unknown }).__LLUI_STATE__
})

describe('manifest records where each layer’s seed came from', () => {
  it('flags a data-seeded layer and an init-seeded layer separately', async () => {
    const render = createOnRenderHtml({ domEnv, Layout: Shell })
    const result = await render({
      Page: Article,
      lluiLayoutData: [{ user: 'franco@example.com' }],
    })
    const manifest = result.pageContext.lluiState
    expect(manifest.v).toBe(HYDRATION_MANIFEST_VERSION)
    expect(manifest.layers).toEqual(['Shell', 'Article'])
    // Shell seeded from lluiLayoutData[0]; Article had no +data → init().
    expect(manifest.seeded).toEqual([true, false])
  })

  it('does not leak the seed VALUE into the envelope (integrity only)', async () => {
    const render = createOnRenderHtml({ domEnv, Layout: Shell })
    const result = await render({
      Page: Article,
      lluiLayoutData: [{ user: 'franco@example.com' }],
    })
    const html = getHtml(result)
    const script = html.match(/window\.__LLUI_STATE__ = (\{[\s\S]*?\})<\/script>/)
    expect(script).not.toBeNull()
    expect(script![1]).not.toContain('franco@example.com')
  })
})

describe('a client pageContext missing lluiLayoutData fails loudly', () => {
  it('throws naming passToClient instead of reverting the layout to init()', async () => {
    const serverRender = createOnRenderHtml({ domEnv, Layout: Shell })
    const result = await serverRender({
      Page: Article,
      lluiLayoutData: [{ user: 'franco@example.com' }],
    })
    // The server HTML carries the real user.
    expect(getHtml(result)).toContain('franco@example.com')

    primeHydration(result)

    // …and this is what Vike hands the client when `lluiLayoutData` is not in
    // `passToClient`: the key is simply gone.
    const render = createOnRenderClient({ Layout: Shell })
    await expect(render({ Page: Article, isHydration: true })).rejects.toThrow(/passToClient/)
  })

  it('names the layer whose seed went missing', async () => {
    const serverRender = createOnRenderHtml({ domEnv, Layout: Shell })
    const result = await serverRender({
      Page: Article,
      lluiLayoutData: [{ user: 'franco@example.com' }],
    })
    primeHydration(result)
    const render = createOnRenderClient({ Layout: Shell })
    await expect(render({ Page: Article, isHydration: true })).rejects.toThrow(/<Shell>/)
  })

  it('throws when the client has a slice the server did not have', async () => {
    // The mirror image: the server rendered init() state, the client would seed
    // from data. Same divergence, opposite direction — equally silent before.
    const serverRender = createOnRenderHtml({ domEnv, Layout: Shell })
    const result = await serverRender({ Page: Article })
    primeHydration(result)

    const render = createOnRenderClient({ Layout: Shell })
    await expect(
      render({
        Page: Article,
        lluiLayoutData: [{ user: 'franco@example.com' }],
        isHydration: true,
      }),
    ).rejects.toThrow(/seed/i)
  })

  it('hydrates cleanly when the app DOES forward lluiLayoutData', async () => {
    const layoutData = [{ user: 'franco@example.com' }]
    const serverRender = createOnRenderHtml({ domEnv, Layout: Shell })
    const container = primeHydration(
      await serverRender({ Page: Article, lluiLayoutData: layoutData }),
    )

    const render = createOnRenderClient({ Layout: Shell })
    await render({ Page: Article, lluiLayoutData: layoutData, isHydration: true })
    expect(container.querySelector('.shell')!.textContent).toContain('franco@example.com')
  })
})

describe('chain data is index-aligned with the chain', () => {
  it('a page +data slice never lands on the outermost layout', async () => {
    // `[...lluiLayoutData, pageContext.data]` with a missing/short
    // `lluiLayoutData` shifts every index: the LAYOUT is seeded with the PAGE's
    // data and the page falls back to init().
    const render = createOnRenderHtml({ domEnv, Layout: Shell })
    const result = await render({ Page: Article, data: { title: 'Hydration' } })
    const html = getHtml(result)

    expect(html).toContain('anonymous') // Shell used its own init()
    expect(html).toContain('Hydration') // Article used the page's +data
    expect(result.pageContext.lluiState.seeded).toEqual([false, true])
  })

  it('the client aligns identically, so an aligned server render hydrates', async () => {
    const serverRender = createOnRenderHtml({ domEnv, Layout: Shell })
    const container = primeHydration(
      await serverRender({ Page: Article, data: { title: 'Hydration' } }),
    )

    const render = createOnRenderClient({ Layout: Shell })
    await render({ Page: Article, data: { title: 'Hydration' }, isHydration: true })
    expect(container.querySelector('.shell')!.textContent).toContain('anonymous')
    expect(container.querySelector('.article')!.textContent).toBe('Hydration')
  })
})
