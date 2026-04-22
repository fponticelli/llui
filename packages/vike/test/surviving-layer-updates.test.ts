import { describe, it, expect, beforeEach } from 'vitest'
import { component, div, text } from '@llui/dom'
import type { ComponentDef } from '@llui/dom'
import { createOnRenderClient, _resetChainForTest } from '../src/on-render-client'
import { pageSlot } from '../src/page-slot'

// Regression for issue #9: when a persistent layout layer survives a
// client navigation (the chain diff finds it identical-by-def), the
// adapter must push fresh `lluiLayoutData[i]` into the surviving
// instance via its `propsMsg` handler. Before the fix, surviving
// layers were frozen at whatever they initialized with on first mount
// — pathname, breadcrumbs, session, nav-highlight state all stale.

interface NavData {
  pathname: string
  user: string | null
}

type LayoutState = {
  pathname: string
  user: string | null
  navUpdates: number
}

type LayoutMsg = { type: 'navChanged'; data: NavData }

// Layout def with `propsMsg` opted in. The signature is a bit loose
// because TS sees `propsMsg` as `(props: Record<string, unknown>) => M`
// at the type level — we cast through unknown at the call site.
const NavAwareLayout: ComponentDef<LayoutState, LayoutMsg, never, NavData> = {
  name: 'NavAwareLayout',
  init: (data) => [{ pathname: data.pathname, user: data.user, navUpdates: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'navChanged':
        return [
          {
            pathname: msg.data.pathname,
            user: msg.data.user,
            navUpdates: state.navUpdates + 1,
          },
          [],
        ]
    }
  },
  view: ({ text }) => [
    div({ class: 'layout' }, [
      div({ class: 'layout-pathname' }, [text((s) => s.pathname)]),
      div({ class: 'layout-user' }, [text((s) => s.user ?? 'guest')]),
      div({ class: 'layout-update-count' }, [text((s) => String(s.navUpdates))]),
      div({ class: 'page-slot' }, [...pageSlot()]),
    ]),
  ],
  propsMsg: (props) => ({
    type: 'navChanged' as const,
    data: props as unknown as NavData,
  }),
}

// Layout WITHOUT propsMsg — proves the surviving-layer update path
// silently skips when the def opts out.
const StaticLayout: ComponentDef<{ value: string }, never, never, { value: string }> = {
  name: 'StaticLayout',
  init: (data) => [{ value: data.value }, []],
  update: (s) => [s, []],
  view: ({ text }) => [
    div({ class: 'static-layout' }, [text((s) => s.value), div([...pageSlot()])]),
  ],
  // No propsMsg — surviving-layer updates should skip this layer.
}

const PageA = component<{ tag: string }, never, never>({
  name: 'PageA',
  init: () => [{ tag: 'A' }, []],
  update: (s) => [s, []],
  view: ({ text }) => [div({ class: 'page-a' }, [text((s) => s.tag)])],
})

const PageB = component<{ tag: string }, never, never>({
  name: 'PageB',
  init: () => [{ tag: 'B' }, []],
  update: (s) => [s, []],
  view: ({ text }) => [div({ class: 'page-b' }, [text((s) => s.tag)])],
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
    const render = createOnRenderClient({ Layout: NavAwareLayout })

    // First mount — pathname = /home, user = null. propsMsg does NOT
    // fire on the initial mount because there's no "previous" data
    // to diff against; init() handles the initial population.
    await render({
      Page: PageA,
      lluiLayoutData: [{ pathname: '/home', user: null }],
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
      lluiLayoutData: [{ pathname: '/studio', user: 'alice' }],
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
    const render = createOnRenderClient({ Layout: NavAwareLayout })

    await render({
      Page: PageA,
      lluiLayoutData: [{ pathname: '/home', user: null }],
      isHydration: false,
    })
    expect(document.querySelector('.layout-update-count')!.textContent).toBe('0')

    // Nav with the SAME data values (different object reference, same
    // keys). The shallow-key Object.is diff should return "unchanged"
    // because pathname and user both match.
    await render({
      Page: PageB,
      lluiLayoutData: [{ pathname: '/home', user: null }],
      isHydration: false,
    })

    // Update count should still be 0 — propsMsg did not fire.
    expect(document.querySelector('.layout-update-count')!.textContent).toBe('0')
    // But the page DID swap.
    expect(document.querySelector('.page-a')).toBeNull()
    expect(document.querySelector('.page-b')).not.toBeNull()
  })

  it('updates the layer entry data so the next nav diffs against the latest', async () => {
    const render = createOnRenderClient({ Layout: NavAwareLayout })

    await render({
      Page: PageA,
      lluiLayoutData: [{ pathname: '/a', user: null }],
      isHydration: false,
    })
    await render({
      Page: PageB,
      lluiLayoutData: [{ pathname: '/b', user: null }],
      isHydration: false,
    })
    // Update count is 1 after the first nav (a → b)
    expect(document.querySelector('.layout-update-count')!.textContent).toBe('1')

    // Third nav: data goes from /b → /b (same as the most recent push).
    // Diff should report "unchanged" since the entry's stored data was
    // updated to /b on the second nav.
    await render({
      Page: PageA,
      lluiLayoutData: [{ pathname: '/b', user: null }],
      isHydration: false,
    })
    expect(document.querySelector('.layout-update-count')!.textContent).toBe('1')

    // Fourth nav: data goes /b → /c. Should fire.
    await render({
      Page: PageB,
      lluiLayoutData: [{ pathname: '/c', user: null }],
      isHydration: false,
    })
    expect(document.querySelector('.layout-update-count')!.textContent).toBe('2')
  })

  it('silently skips layers whose def has no propsMsg', async () => {
    const render = createOnRenderClient({ Layout: StaticLayout })

    await render({
      Page: PageA,
      lluiLayoutData: [{ value: 'first' }],
      isHydration: false,
    })
    expect(document.querySelector('.static-layout')!.textContent).toContain('first')

    // Nav with new data. The static layout has no propsMsg, so the
    // adapter should not throw, not warn, and the layout's state stays
    // at its initial value.
    await expect(
      render({
        Page: PageB,
        lluiLayoutData: [{ value: 'second' }],
        isHydration: false,
      }),
    ).resolves.not.toThrow()

    // Static layout still shows 'first' because there's no propsMsg
    // path to update its state. Page swapped.
    expect(document.querySelector('.static-layout')!.textContent).toContain('first')
    expect(document.querySelector('.page-b')).not.toBeNull()
  })

  it('updates surviving layers on a same-Page-def nav', async () => {
    // Scenario: PageA → PageA with changed layout data. The page layer
    // is always treated as divergent, so the page itself disposes and
    // remounts; the surviving layout in front of it still needs its
    // `propsMsg` dispatch. Verify both sides of that contract.
    const render = createOnRenderClient({ Layout: NavAwareLayout })

    await render({
      Page: PageA,
      lluiLayoutData: [{ pathname: '/x', user: null }],
      isHydration: false,
    })
    expect(document.querySelector('.layout-pathname')!.textContent).toBe('/x')
    const layoutBefore = document.querySelector('.layout')
    const pageBefore = document.querySelector('.page-a')

    await render({
      Page: PageA, // ← same page def
      lluiLayoutData: [{ pathname: '/y', user: null }], // ← but data changed
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
