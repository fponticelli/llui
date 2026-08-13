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
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { browserEnv } from '@llui/dom/ssr'
import { component, div, text } from '@llui/dom'
import { createOnRenderHtml } from '../src/on-render-html.js'
import type { RenderHtmlResult } from '../src/on-render-html.js'
import { createOnRenderClient, _resetChainForTest } from '../src/on-render-client.js'
import { pageSlot } from '../src/page-slot.js'
import { HYDRATION_MANIFEST_VERSION, buildChainData, verifyManifest } from '../src/chain.js'

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

describe('an envelope this build cannot read fails loudly', () => {
  // These three guards are only reachable from an envelope THIS build did not
  // produce — a server on an older @llui/vike, or a hand-rolled one. Every other
  // test in the package feeds `verifyManifest` an envelope the current producer
  // just built, which can never carry a stale `v` or a malformed `seeded`, so
  // the guards go unexercised (and a deletion of them goes unnoticed) unless the
  // envelope is built by hand here.
  const chain = [Shell, Article]
  // Shell seeded from its data slice, Article from init() — the shape every
  // envelope below claims to describe.
  const chainData = buildChainData(1, [{ user: 'franco@example.com' }], undefined)
  const layers = ['Shell', 'Article']

  it('rejects the v2 envelope of an older server build, naming both versions', () => {
    expect(() => verifyManifest({ v: 2, layers, seeded: [true, false] }, chain, chainData)).toThrow(
      /version mismatch: got 2, expected 3/,
    )
  })

  it('rejects an envelope with no version at all', () => {
    expect(() => verifyManifest({ layers, seeded: [true, false] }, chain, chainData)).toThrow(
      /version mismatch: got undefined, expected 3/,
    )
  })

  it('rejects a v3 envelope carrying no per-layer seed flags', () => {
    // v3's whole point is `seeded`. An envelope that claims v3 without it is a
    // build skew of its own — never silently treat the layers as unseeded.
    expect(() =>
      verifyManifest({ v: HYDRATION_MANIFEST_VERSION, layers }, chain, chainData),
    ).toThrow(/missing its per-layer seed flags/)
  })

  it('rejects a v3 envelope whose seed flags do not cover every layer', () => {
    expect(() =>
      verifyManifest({ v: HYDRATION_MANIFEST_VERSION, layers, seeded: [true] }, chain, chainData),
    ).toThrow(/missing its per-layer seed flags/)
  })

  it('accepts a hand-built envelope that does match this build', () => {
    // The negative half: the three throws above are about SKEW, not about
    // rejecting anything hand-built.
    expect(
      verifyManifest(
        { v: HYDRATION_MANIFEST_VERSION, layers, seeded: [true, false] },
        chain,
        chainData,
      ),
    ).toEqual({
      v: HYDRATION_MANIFEST_VERSION,
      layers,
      seeded: [true, false],
      initFingerprints: undefined,
    })
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

describe('an over-long lluiLayoutData does not vanish quietly', () => {
  // The surplus CANNOT be seeded anywhere — there is no layer to put it on — so
  // dropping it is right. Doing it silently is not: this whole alignment change
  // exists so a seed never goes missing without a word, and a data hook filling
  // slices no layer receives is the same disagreement seen from the other end.
  afterEach(() => vi.restoreAllMocks())

  it('warns in dev, naming the counts and the dropped range', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const chainData = buildChainData(1, [{ user: 'a' }, { user: 'b' }, { user: 'c' }], {
      title: 'T',
    })

    // Still index-aligned: layer 0 keeps its own slice, the page keeps its data.
    expect(chainData).toEqual([{ user: 'a' }, { title: 'T' }])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toMatch(/3 slice\(s\)/)
    expect(String(warn.mock.calls[0]![0])).toMatch(/1 layer\(s\)/)
    expect(String(warn.mock.calls[0]![0])).toMatch(/DROPPED/)
  })

  it('warns from a real server render whose data hook outran the chain', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const render = createOnRenderHtml({ domEnv, Layout: Shell })

    const result = await render({
      Page: Article,
      lluiLayoutData: [{ user: 'franco@example.com' }, { user: 'nobody@example.com' }],
    })

    // The chain rendered correctly off the first slice…
    expect(getHtml(result)).toContain('franco@example.com')
    expect(result.pageContext.lluiState.seeded).toEqual([true, false])
    // …and the orphan slice was reported rather than swallowed.
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toMatch(/DROPPED/)
  })

  it('stays silent when every slice has a layer to land on', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    buildChainData(2, [{ user: 'a' }, { user: 'b' }], { title: 'T' })
    // A SHORT array is the normal `passToClient` case and is caught by the
    // manifest's seed flags, not here — no warning for it either.
    buildChainData(2, [], { title: 'T' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('says nothing in a production build', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(buildChainData(1, [{ user: 'a' }, { user: 'b' }], undefined, false)).toEqual([
      { user: 'a' },
      undefined,
    ])
    expect(warn).not.toHaveBeenCalled()
  })
})
