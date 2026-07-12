// Regression coverage for the @llui/vike audit fixes. Each block maps to one
// verified finding; the comment names it.
import { describe, it, expect, beforeEach } from 'vitest'
import { browserEnv } from '@llui/dom/ssr'
import { component, div, text } from '@llui/dom'
import type { SignalComponentDef } from '@llui/dom'
import { createOnRenderHtml } from '../src/on-render-html.js'
import type { RenderHtmlResult } from '../src/on-render-html.js'
import { createOnRenderClient, _resetChainForTest } from '../src/on-render-client.js'
import { pageSlot } from '../src/page-slot.js'

const env = browserEnv()
const domEnv = () => env

function getHtml(result: RenderHtmlResult): string {
  const doc = result.documentHtml
  return typeof doc === 'string' ? doc : doc._escaped
}

/** Put a server-rendered document's `#app` inner HTML into a fresh container so
 * the client can hydrate over it, and stamp the server manifest into
 * window.__LLUI_STATE__ (the ONLY hydration payload — no per-layer state). */
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

// ──── Finding #1: unnamed page/layout must hydrate (identical name normalization) ────
describe('unnamed components hydrate cleanly (finding #1)', () => {
  // No `name` on either layer. Before the fix, server keyed these as
  // 'Layout'/'Page' while the client compared those against `def.name`
  // (undefined) → guaranteed hydration mismatch AFTER the DOM was swapped.
  const UnnamedLayout: SignalComponentDef<{ n: number }, never, never> = {
    init: () => ({ n: 0 }),
    update: (s) => s,
    view: () => [div({ class: 'u-layout' }, [text('shell'), pageSlot()])],
  }
  const UnnamedPage: SignalComponentDef<{ label: string }, never, never> = {
    init: () => ({ label: 'unnamed-body' }),
    update: (s) => s,
    view: ({ state }) => [div({ class: 'u-page' }, [text(state.map((s) => s.label))])],
  }

  it('server manifest uses stable per-index fallback keys', async () => {
    const render = createOnRenderHtml({ domEnv, Layout: UnnamedLayout })
    const result = await render({ Page: UnnamedPage })
    expect(result.pageContext.lluiState).toEqual({ v: 2, layers: ['layer:0', 'layer:1'] })
  })

  it('hydrates an unnamed layout + page without throwing a mismatch', async () => {
    const serverRender = createOnRenderHtml({ domEnv, Layout: UnnamedLayout })
    const container = primeHydration(await serverRender({ Page: UnnamedPage }))

    const render = createOnRenderClient({ Layout: UnnamedLayout })
    await expect(render({ Page: UnnamedPage, isHydration: true })).resolves.not.toThrow()

    expect(container.querySelector('.u-layout')).not.toBeNull()
    expect(container.querySelector('.u-page')!.textContent).toBe('unnamed-body')
  })
})

// ──── Finding #3: hydration must NOT delete a layout's siblings after pageSlot() ────
describe('hydrate preserves layout siblings after pageSlot() (finding #3)', () => {
  const LayoutWithFooter: SignalComponentDef<{ n: number }, never, never> = {
    name: 'FooterLayout',
    init: () => ({ n: 0 }),
    update: (s) => s,
    view: () => [
      div({ class: 'shell-sib' }, [
        div({ class: 'nav-bar' }, [text('nav')]),
        pageSlot(),
        div({ class: 'footer' }, [text('footer')]), // sibling AFTER the slot
      ]),
    ],
  }
  const Page: SignalComponentDef<{ label: string }, never, never> = {
    name: 'FooterPage',
    init: () => ({ label: 'body' }),
    update: (s) => s,
    view: ({ state }) => [div({ class: 'inner-page' }, [text(state.map((s) => s.label))])],
  }

  it('keeps the trailing footer sibling when hydrating an inner layer', async () => {
    const serverRender = createOnRenderHtml({ domEnv, Layout: LayoutWithFooter })
    const container = primeHydration(await serverRender({ Page }))

    const render = createOnRenderClient({ Layout: LayoutWithFooter })
    await render({ Page, isHydration: true })

    // The page mounted (append at the fresh anchor)…
    expect(container.querySelector('.inner-page')!.textContent).toBe('body')
    // …and the layout's footer, which sits AFTER pageSlot(), was NOT scanned-and-
    // deleted by a bogus 'replace' looking for a nonexistent end sentinel.
    expect(container.querySelector('.footer')).not.toBeNull()

    // Order invariant: nav-bar → anchor → page → end sentinel → footer.
    const shell = container.querySelector('.shell-sib')!
    const kids = Array.from(shell.childNodes)
    const idxOfComment = (v: string) =>
      kids.findIndex((n) => n.nodeType === 8 && (n as Comment).data === v)
    const navIdx = kids.indexOf(container.querySelector('.nav-bar')!)
    const anchorIdx = idxOfComment('llui-page-slot')
    const pageIdx = kids.indexOf(container.querySelector('.inner-page')!)
    const endIdx = idxOfComment('llui-mount-end')
    const footerIdx = kids.indexOf(container.querySelector('.footer')!)
    expect(navIdx).toBeLessThan(anchorIdx)
    expect(anchorIdx).toBeLessThan(pageIdx)
    expect(pageIdx).toBeLessThan(endIdx)
    expect(endIdx).toBeLessThan(footerIdx)
  })
})

// ──── Finding #4: a null +data slice is a seed, not "absent" ────
describe('null data slice is preserved as the seed (finding #4)', () => {
  // init() returns a non-null default; a `+data` returning null must WIN (render
  // against null), not silently fall back to init() via a `??`.
  const NullablePage: SignalComponentDef<{ label: string } | null, never, never> = {
    name: 'NullablePage',
    init: () => ({ label: 'from-init' }),
    update: (s) => s,
    // eslint-disable-next-line eqeqeq
    view: ({ state }) => [
      div({ class: 'np' }, [text(state.map((s) => (s == null ? 'NULL-SEED' : s.label)))]),
    ],
  }

  it('renders HTML against the null seed on the server', async () => {
    const render = createOnRenderHtml({ domEnv })
    const result = await render({ Page: NullablePage, data: null })
    expect(getHtml(result)).toContain('NULL-SEED')
    expect(getHtml(result)).not.toContain('from-init')
  })

  it('mounts (client nav) against the null seed, not init()', async () => {
    document.body.innerHTML = '<div id="app"></div>'
    const render = createOnRenderClient({})
    await render({ Page: NullablePage, data: null, isHydration: false })
    expect(document.querySelector('.np')!.textContent).toBe('NULL-SEED')
  })

  it('hydrates against the null seed, not init()', async () => {
    const serverRender = createOnRenderHtml({ domEnv })
    const container = primeHydration(await serverRender({ Page: NullablePage, data: null }))
    const render = createOnRenderClient({})
    await render({ Page: NullablePage, data: null, isHydration: true })
    expect(container.querySelector('.np')!.textContent).toBe('NULL-SEED')
  })
})

// ──── Finding #7: overlapping async onLeave navigations must not corrupt the chain ────
describe('navigation epoch guard on async onLeave (finding #7)', () => {
  type S = { tag: string }
  const mkPage = (tag: string, cls: string): SignalComponentDef<S, never, never> => ({
    name: `Page-${tag}`,
    init: () => ({ tag }),
    update: (s) => s,
    view: ({ state }) => [div({ class: cls }, [text(state.map((s) => s.tag))])],
  })
  const PageA = mkPage('A', 'page-a')
  const PageB = mkPage('B', 'page-b')
  const PageC = mkPage('C', 'page-c')

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>'
  })

  it('abandons a nav that was lapped while awaiting onLeave (no chain corruption)', async () => {
    const leaveResolvers: Array<() => void> = []
    const mountedTags: string[] = []
    const render = createOnRenderClient({
      onLeave: () => new Promise<void>((res) => leaveResolvers.push(res)),
      onMount: (chain) => {
        mountedTags.push((chain[chain.length - 1]!.getState() as S).tag)
      },
    })

    // First mount — no onLeave (no outgoing page).
    await render({ Page: PageA, isHydration: false })
    expect(mountedTags).toEqual(['A'])

    // Two overlapping navs. Each parks at its own onLeave await synchronously.
    const p2 = render({ Page: PageB, isHydration: false })
    const p3 = render({ Page: PageC, isHydration: false })
    expect(leaveResolvers).toHaveLength(2)

    // Resolve B's leave first: B was lapped by C, so it must ABANDON (never mount).
    leaveResolvers[0]!()
    // Then C's leave: C is the latest nav, so it proceeds.
    leaveResolvers[1]!()
    await Promise.all([p2, p3])

    // B never mounted; the final page is C, and A is gone.
    expect(mountedTags).toEqual(['A', 'C'])
    expect(document.querySelector('.page-b')).toBeNull()
    expect(document.querySelector('.page-c')).not.toBeNull()
    expect(document.querySelector('.page-a')).toBeNull()
  })
})

// ──── Finding #10: hydration works from a state-free manifest ────
describe('hydration reconstructs seed without a full state script (finding #10)', () => {
  it('ships only the manifest (no per-layer state) yet hydrates correctly', async () => {
    const Page: SignalComponentDef<{ msg: string }, never, never> = {
      name: 'DataPage',
      init: () => ({ msg: 'init-default' }),
      update: (s) => s,
      view: ({ state }) => [div({ class: 'dp' }, [text(state.map((s) => s.msg))])],
    }

    const serverRender = createOnRenderHtml({ domEnv })
    const result = await serverRender({ Page, data: { msg: 'from-server-data' } })

    // The hydration script carries ONLY the manifest — the state value is nowhere
    // in the document (it's reconstructed client-side from pageContext.data).
    const html = getHtml(result)
    const scriptMatch = html.match(/window\.__LLUI_STATE__ = (\{[\s\S]*?\})<\/script>/)
    expect(scriptMatch).not.toBeNull()
    expect(scriptMatch![1]).not.toContain('from-server-data')
    expect(JSON.parse(scriptMatch![1])).toEqual({ v: 2, layers: ['DataPage'] })

    // Client hydrates from data (Vike re-supplies pageContext.data), not the script.
    const container = primeHydration(result)
    const render = createOnRenderClient({})
    await render({ Page, data: { msg: 'from-server-data' }, isHydration: true })
    expect(container.querySelector('.dp')!.textContent).toBe('from-server-data')
  })
})
