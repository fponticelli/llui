import { describe, it, expect, beforeEach } from 'vitest'
import { component, div, text } from '@llui/dom/signals'
import type { SignalComponentDef } from '@llui/dom/signals'
import { createOnRenderClient, _resetChainForTest } from '../src/on-render-client'
import { pageSlot } from '../src/page-slot'

// Regression for issue #9: when a persistent layout layer survives a
// client navigation (the chain diff finds it identical-by-def), the
// adapter must push fresh `lluiLayoutData[i]` into the surviving
// instance via the user-supplied `onLayerDataChange` callback. Before
// the fix, surviving layers were frozen at whatever they initialized
// with on first mount — pathname, breadcrumbs, session, nav-highlight
// state all stale.

// In the signal runtime a layer's state IS its seed: the adapter uses the
// `lluiLayoutData[i]` slice directly as the layout's initial state, so the data
// carries the full state shape (including navUpdates). State updates on surviving
// layers flow in via the adapter's `onLayerDataChange` callback (wired below),
// which dispatches a `navChanged` message; the reducer increments navUpdates.
type NavData = {
  pathname: string
  user: string | null
  navUpdates: number
}

type LayoutState = NavData

type LayoutMsg = { type: 'navChanged'; data: NavData }

const NavAwareLayout: SignalComponentDef<LayoutState, LayoutMsg, never> = {
  name: 'NavAwareLayout',
  init: () => ({ pathname: '', user: null, navUpdates: 0 }),
  update: (state, msg) => {
    switch (msg.type) {
      case 'navChanged':
        return {
          pathname: msg.data.pathname,
          user: msg.data.user,
          navUpdates: state.navUpdates + 1,
        }
    }
  },
  view: ({ state }) => [
    div({ class: 'layout' }, [
      div({ class: 'layout-pathname' }, [text(state.map((s) => s.pathname))]),
      div({ class: 'layout-user' }, [text(state.map((s) => s.user ?? 'guest'))]),
      div({ class: 'layout-update-count' }, [text(state.map((s) => String(s.navUpdates)))]),
      div({ class: 'page-slot' }, [pageSlot()]),
    ]),
  ],
}

// Layout for the "no callback registered" case — proves the
// surviving-layer update path silently skips when the adapter has no
// onLayerDataChange option configured.
const StaticLayout: SignalComponentDef<{ value: string }, never, never> = {
  name: 'StaticLayout',
  init: () => ({ value: '' }),
  update: (s) => s,
  view: ({ state }) => [
    div({ class: 'static-layout' }, [text(state.map((s) => s.value)), div([pageSlot()])]),
  ],
}

const navAwareDispatch = ({
  def,
  handle,
  newData,
}: {
  def: { name: string }
  handle: { send: (msg: unknown) => void }
  newData: unknown
}) => {
  if (def.name === 'NavAwareLayout') {
    handle.send({ type: 'navChanged', data: newData as NavData })
  }
}

const PageA = component<{ tag: string }, never, never>({
  name: 'PageA',
  init: () => ({ tag: 'A' }),
  update: (s) => s,
  view: ({ state }) => [div({ class: 'page-a' }, [text(state.map((s) => s.tag))])],
})

const PageB = component<{ tag: string }, never, never>({
  name: 'PageB',
  init: () => ({ tag: 'B' }),
  update: (s) => s,
  view: ({ state }) => [div({ class: 'page-b' }, [text(state.map((s) => s.tag))])],
})

describe('persistent layouts — surviving-layer prop updates', () => {
  beforeEach(() => {
    _resetChainForTest()
    document.body.innerHTML = ''
    const container = document.createElement('div')
    container.id = 'app'
    document.body.appendChild(container)
  })

  it('dispatches propsMsg on a surviving layer when its data slice changes', async () => {
    const render = createOnRenderClient({
      Layout: NavAwareLayout,
      onLayerDataChange: navAwareDispatch,
    })

    // First mount — pathname = /home, user = null. propsMsg does NOT
    // fire on the initial mount because there's no "previous" data
    // to diff against; init() handles the initial population.
    await render({
      Page: PageA,
      lluiLayoutData: [{ pathname: '/home', user: null, navUpdates: 0 }],
      isHydration: false,
    })
    expect(document.querySelector('.layout-pathname')!.textContent).toBe('/home')
    expect(document.querySelector('.layout-user')!.textContent).toBe('guest')
    expect(document.querySelector('.layout-update-count')!.textContent).toBe('0')
    expect(document.querySelector('.page-a')).not.toBeNull()

    // Nav: page changes (PageA → PageB), AND layout data changes
    // (pathname /home → /studio, user null → alice). The layout def
    // is unchanged, so it survives the diff. The adapter must call
    // propsMsg with the new data and dispatch the resulting message
    // through the layout's send.
    await render({
      Page: PageB,
      lluiLayoutData: [{ pathname: '/studio', user: 'alice', navUpdates: 0 }],
      isHydration: false,
    })

    // Layout DOM is the SAME node identity (survived).
    expect(document.querySelector('.layout-pathname')!.textContent).toBe('/studio')
    expect(document.querySelector('.layout-user')!.textContent).toBe('alice')
    expect(document.querySelector('.layout-update-count')!.textContent).toBe('1')
    // Page swapped.
    expect(document.querySelector('.page-a')).toBeNull()
    expect(document.querySelector('.page-b')).not.toBeNull()
  })

  it('skips propsMsg when the data slice is unchanged (Object.is shallow keys)', async () => {
    const render = createOnRenderClient({
      Layout: NavAwareLayout,
      onLayerDataChange: navAwareDispatch,
    })

    await render({
      Page: PageA,
      lluiLayoutData: [{ pathname: '/home', user: null, navUpdates: 0 }],
      isHydration: false,
    })
    expect(document.querySelector('.layout-update-count')!.textContent).toBe('0')

    // Nav with the SAME data values (different object reference, same
    // keys). The shallow-key Object.is diff should return "unchanged"
    // because pathname and user both match.
    await render({
      Page: PageB,
      lluiLayoutData: [{ pathname: '/home', user: null, navUpdates: 0 }],
      isHydration: false,
    })

    // Update count should still be 0 — propsMsg did not fire.
    expect(document.querySelector('.layout-update-count')!.textContent).toBe('0')
    // But the page DID swap.
    expect(document.querySelector('.page-a')).toBeNull()
    expect(document.querySelector('.page-b')).not.toBeNull()
  })

  it('updates the layer entry data so the next nav diffs against the latest', async () => {
    const render = createOnRenderClient({
      Layout: NavAwareLayout,
      onLayerDataChange: navAwareDispatch,
    })

    await render({
      Page: PageA,
      lluiLayoutData: [{ pathname: '/a', user: null, navUpdates: 0 }],
      isHydration: false,
    })
    await render({
      Page: PageB,
      lluiLayoutData: [{ pathname: '/b', user: null, navUpdates: 0 }],
      isHydration: false,
    })
    // Update count is 1 after the first nav (a → b)
    expect(document.querySelector('.layout-update-count')!.textContent).toBe('1')

    // Third nav: data goes from /b → /b (same as the most recent push).
    // Diff should report "unchanged" since the entry's stored data was
    // updated to /b on the second nav.
    await render({
      Page: PageA,
      lluiLayoutData: [{ pathname: '/b', user: null, navUpdates: 0 }],
      isHydration: false,
    })
    expect(document.querySelector('.layout-update-count')!.textContent).toBe('1')

    // Fourth nav: data goes /b → /c. Should fire.
    await render({
      Page: PageB,
      lluiLayoutData: [{ pathname: '/c', user: null, navUpdates: 0 }],
      isHydration: false,
    })
    expect(document.querySelector('.layout-update-count')!.textContent).toBe('2')
  })

  it('silently skips layers when no onLayerDataChange option is provided', async () => {
    // No callback registered — surviving layers retain initial state
    // across navigations regardless of data changes.
    const render = createOnRenderClient({ Layout: StaticLayout })

    await render({
      Page: PageA,
      lluiLayoutData: [{ value: 'first' }],
      isHydration: false,
    })
    expect(document.querySelector('.static-layout')!.textContent).toContain('first')

    // Nav with new data. No callback is wired, so the adapter should
    // not throw, not warn, and the layout's state stays at its
    // initial value.
    await expect(
      render({
        Page: PageB,
        lluiLayoutData: [{ value: 'second' }],
        isHydration: false,
      }),
    ).resolves.not.toThrow()

    // Static layout still shows 'first' because no onLayerDataChange
    // hook is wired to update its state. Page swapped.
    expect(document.querySelector('.static-layout')!.textContent).toContain('first')
    expect(document.querySelector('.page-b')).not.toBeNull()
  })

  it('updates surviving layers on a same-Page-def nav', async () => {
    // Scenario: PageA → PageA with changed layout data. The page layer
    // is always treated as divergent, so the page itself disposes and
    // remounts; the surviving layout in front of it still needs its
    // `propsMsg` dispatch. Verify both sides of that contract.
    const render = createOnRenderClient({
      Layout: NavAwareLayout,
      onLayerDataChange: navAwareDispatch,
    })

    await render({
      Page: PageA,
      lluiLayoutData: [{ pathname: '/x', user: null, navUpdates: 0 }],
      isHydration: false,
    })
    expect(document.querySelector('.layout-pathname')!.textContent).toBe('/x')
    const layoutBefore = document.querySelector('.layout')
    const pageBefore = document.querySelector('.page-a')

    await render({
      Page: PageA, // ← same page def
      lluiLayoutData: [{ pathname: '/y', user: null, navUpdates: 0 }], // ← but data changed
      isHydration: false,
    })

    expect(document.querySelector('.layout-pathname')!.textContent).toBe('/y')
    expect(document.querySelector('.layout-update-count')!.textContent).toBe('1')
    // Layout DOM node preserved (surviving layer).
    expect(document.querySelector('.layout')).toBe(layoutBefore)
    // Page DOM node replaced — same def, but a fresh mount.
    expect(document.querySelector('.page-a')).not.toBe(pageBefore)
    expect(document.querySelector('.page-a')).not.toBeNull()
  })
})
