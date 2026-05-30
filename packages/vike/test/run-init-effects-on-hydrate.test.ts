import { describe, it, expect, beforeEach } from 'vitest'
import { browserEnv } from '@llui/dom/ssr'
import { component, div, text } from '@llui/dom'
import type { SignalComponentDef } from '@llui/dom'
import { createOnRenderClient, pageSlot, _resetChainForTest } from '../src/on-render-client.js'

const env = browserEnv()
const _domEnv = () => env

/**
 * Verifies the `RenderClientOptions.runInitEffectsOnHydrate` plumbing:
 * the option must flow through to the signal hydrate path for both the
 * outermost layer (container hydrate) and inner layers (anchor hydrate).
 * The @llui/dom signal side defaults to skipping init effects on
 * hydration; the vike adapter forwards the option verbatim, so this
 * exercises the chain wiring rather than the underlying behavior.
 */

type LayoutEffect = { type: 'layoutInit' }
type PageEffect = { type: 'pageInit' }

interface LayoutState {
  n: number
}

interface PageState {
  m: number
}

function makeLayoutWithInitEffect(
  seen: LayoutEffect[],
): SignalComponentDef<LayoutState, never, LayoutEffect> {
  return component<LayoutState, never, LayoutEffect>({
    name: 'LayoutWithInit',
    init: () => [{ n: 0 }, [{ type: 'layoutInit' }]],
    update: (s) => s,
    view: () => [div({}, [text('layout-shell'), pageSlot()])],
    onEffect: (effect) => {
      seen.push(effect)
    },
  })
}

function makePageWithInitEffect(
  seen: PageEffect[],
): SignalComponentDef<PageState, never, PageEffect> {
  return component<PageState, never, PageEffect>({
    name: 'PageWithInit',
    init: () => [{ m: 0 }, [{ type: 'pageInit' }]],
    update: (s) => s,
    view: () => [div({}, [text('page-body')])],
    onEffect: (effect) => {
      seen.push(effect)
    },
  })
}

beforeEach(() => {
  _resetChainForTest()
  document.body.innerHTML = ''
  const container = document.createElement('div')
  container.id = 'app'
  document.body.appendChild(container)
  // Hydration assumes server HTML is present in the container before
  // the client mounts. Vike's flow has the SSR-rendered HTML there;
  // an empty container is fine for these tests because we're only
  // asserting whether the init-effect dispatcher fires, not whether
  // the swap matches existing markup.
})

describe('vike — runInitEffectsOnHydrate plumbing through layout chain', () => {
  it('skips init effects by default on hydration (page-only chain)', async () => {
    const seenPage: PageEffect[] = []
    const PageDef = makePageWithInitEffect(seenPage)
    const render = createOnRenderClient({})
    // No Layout — the page is the only layer, so it hydrates at the root
    // container via hydrateSignalApp; no anchor mount is involved.
    const envelope = { layouts: [], page: { name: 'PageWithInit', state: { m: 5 } } }
    ;(window as { __LLUI_STATE__?: unknown }).__LLUI_STATE__ = envelope

    await render({ Page: PageDef, isHydration: true })
    expect(seenPage).toEqual([])
  })

  it('dispatches init effects on hydration when runInitEffectsOnHydrate=true (page-only chain)', async () => {
    const seenPage: PageEffect[] = []
    const PageDef = makePageWithInitEffect(seenPage)
    const render = createOnRenderClient({
      runInitEffectsOnHydrate: true,
    })
    const envelope = { layouts: [], page: { name: 'PageWithInit', state: { m: 5 } } }
    ;(window as { __LLUI_STATE__?: unknown }).__LLUI_STATE__ = envelope

    await render({ Page: PageDef, isHydration: true })
    expect(seenPage).toEqual([{ type: 'pageInit' }])
  })

  it('option flows to BOTH layout (container hydrate) and page (anchor hydrate) layers', async () => {
    const seenLayout: LayoutEffect[] = []
    const seenPage: PageEffect[] = []
    const LayoutDef = makeLayoutWithInitEffect(seenLayout)
    const PageDef = makePageWithInitEffect(seenPage)

    const render = createOnRenderClient({
      Layout: LayoutDef,
      runInitEffectsOnHydrate: true,
    })
    const envelope = {
      layouts: [{ name: 'LayoutWithInit', state: { n: 0 } }],
      page: { name: 'PageWithInit', state: { m: 5 } },
    }
    ;(window as { __LLUI_STATE__?: unknown }).__LLUI_STATE__ = envelope

    await render({ Page: PageDef, isHydration: true })

    // Both layers' init effects fired — confirms the option survives the
    // descent through MountOpts → hydrateSignalApp at the root container
    // (outermost) AND at the slot anchor (inner page layer).
    expect(seenLayout).toEqual([{ type: 'layoutInit' }])
    expect(seenPage).toEqual([{ type: 'pageInit' }])
  })

  it('option=false skips init effects in BOTH layout and page layers', async () => {
    const seenLayout: LayoutEffect[] = []
    const seenPage: PageEffect[] = []
    const LayoutDef = makeLayoutWithInitEffect(seenLayout)
    const PageDef = makePageWithInitEffect(seenPage)

    const render = createOnRenderClient({
      Layout: LayoutDef,
      runInitEffectsOnHydrate: false,
    })
    const envelope = {
      layouts: [{ name: 'LayoutWithInit', state: { n: 0 } }],
      page: { name: 'PageWithInit', state: { m: 5 } },
    }
    ;(window as { __LLUI_STATE__?: unknown }).__LLUI_STATE__ = envelope

    await render({ Page: PageDef, isHydration: true })
    expect(seenLayout).toEqual([])
    expect(seenPage).toEqual([])
  })

  it('subsequent navigation always fires init effects regardless of the flag', async () => {
    // Client-side nav uses a fresh signal mount, not a hydrate. The flag
    // only gates the hydration path; nav mounts always run init effects.
    // This is correct: the new page wasn't pre-rendered by SSR, so its
    // init() must run client-side.
    const seenPage: PageEffect[] = []
    const PageDef = makePageWithInitEffect(seenPage)
    const render = createOnRenderClient({
      runInitEffectsOnHydrate: false,
    })

    // Simulate hydration first (no effects).
    const envelope = { layouts: [], page: { name: 'PageWithInit', state: { m: 5 } } }
    ;(window as { __LLUI_STATE__?: unknown }).__LLUI_STATE__ = envelope
    await render({ Page: PageDef, isHydration: true })
    expect(seenPage).toEqual([])

    // Now navigate to a new page — fresh mount, init effects fire.
    const Page2: SignalComponentDef<PageState, never, PageEffect> = component<
      PageState,
      never,
      PageEffect
    >({
      name: 'Page2',
      init: () => [{ m: 0 }, [{ type: 'pageInit' }]],
      update: (s) => s,
      view: () => [div({}, [text('page2')])],
      onEffect: (effect) => {
        seenPage.push(effect)
      },
    })
    await render({ Page: Page2, isHydration: false })
    expect(seenPage).toEqual([{ type: 'pageInit' }])
  })
})
