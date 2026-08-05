import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { component, div, main, text } from '@llui/dom'
import { routeTransition } from '@llui/transitions'
import {
  createOnRenderClient,
  fromTransition,
  pageSlot,
  _resetChainForTest,
} from '../src/on-render-client'

// End-to-end guard for the route seam that `fromTransition` drives.
//
// Unlike show/branch/each — where the animated element is DETACHED once `leave`
// resolves — `renderClient` calls `onLeave` and then `onEnter` on the SAME
// persistent element (the root container on a root swap, the surviving layer's
// `slotAnchor.parentElement` otherwise). A transition bundle that left its
// leave-resting values behind would have the enter snapshot them as an
// author-set inline style and restore them on cleanup, parking the page slot at
// `opacity: 0` one duration AFTER it visibly faded in — a fully mounted, fully
// laid-out, invisible page on every navigation.
//
// These tests exercise the documented wiring from `routeTransition`'s docblock
// against a real transition bundle, so a regression on either side of the seam
// (the adapter here, or the primitive in @llui/transitions) fails here.
describe('route transition seam (fromTransition + routeTransition)', () => {
  const DURATION = 20
  /** Comfortably past the duration + the transition helper's timing buffer. */
  const SETTLE = 200

  type State = { label: string }

  const PageA = component<State, never, never>({
    name: 'PageA',
    init: () => ({ label: 'A' }),
    update: (s) => s,
    view: ({ state }) => [div({ class: 'page' }, [text(state.map((s) => s.label))])],
  })

  const PageB = component<State, never, never>({
    name: 'PageB',
    init: () => ({ label: 'B' }),
    update: (s) => s,
    view: ({ state }) => [div({ class: 'page' }, [text(state.map((s) => s.label))])],
  })

  // Persistent layout: survives every nav, so the leave/enter target is its
  // slot's parent element — the production shape from the issue report.
  const AppLayout = component<Record<string, never>, never, never>({
    name: 'AppLayout',
    init: () => ({}),
    update: (s) => s,
    view: () => [div({ class: 'shell' }, [main({ class: 'nav-slot' }, [pageSlot()])])],
  })

  beforeEach(() => {
    vi.useFakeTimers()
    _resetChainForTest()
    document.body.innerHTML = ''
    const container = document.createElement('div')
    container.id = 'app'
    document.body.appendChild(container)
  })

  afterEach(() => {
    _resetChainForTest()
    vi.useRealTimers()
  })

  /** Drive one navigation to completion, including the enter's delayed cleanup. */
  async function navigate(
    render: (ctx: { Page: typeof PageA; isHydration: boolean }) => Promise<void>,
    Page: typeof PageA,
  ): Promise<void> {
    const done = render({ Page, isHydration: false })
    // renderClient awaits onLeave — the leave promise resolves on the fallback
    // timer, so the nav only completes once timers run.
    await vi.advanceTimersByTimeAsync(SETTLE)
    await done
    // onEnter is fire-and-forget; its cleanup lands one duration later.
    await vi.advanceTimersByTimeAsync(SETTLE)
  }

  it('leaves the page slot visible after a layout-preserving navigation', async () => {
    const render = createOnRenderClient({
      Layout: AppLayout,
      ...fromTransition(routeTransition({ duration: DURATION, slide: false })),
    })

    await navigate(render, PageA)
    await navigate(render, PageB)

    const slot = document.querySelector('.nav-slot') as HTMLElement
    expect(slot).not.toBeNull()
    // The bug read as a data/hydration failure: content mounted and laid out,
    // wrapper transparent. Probe the INLINE value — in jsdom (as in a
    // backgrounded tab) the computed value lags behind it.
    expect(slot.style.opacity).toBe('')
    expect(slot.style.transition).toBe('')
    expect(slot.textContent).toBe('B')
  })

  it('stays visible across many navigations', async () => {
    const render = createOnRenderClient({
      Layout: AppLayout,
      ...fromTransition(routeTransition({ duration: DURATION, slide: false })),
    })

    await navigate(render, PageA)
    for (const Page of [PageB, PageA, PageB, PageA]) {
      await navigate(render, Page)
      const slot = document.querySelector('.nav-slot') as HTMLElement
      expect(slot.style.opacity).toBe('')
    }
  })

  it('leaves the root container visible on a no-layout (root swap) navigation', async () => {
    const render = createOnRenderClient({
      ...fromTransition(routeTransition({ duration: DURATION, slide: false })),
    })

    await navigate(render, PageA)
    await navigate(render, PageB)

    const root = document.getElementById('app') as HTMLElement
    expect(root.style.opacity).toBe('')
    expect(root.textContent).toBe('B')
  })

  it('holds for the slide+fade default bundle (mergeTransitions)', async () => {
    const render = createOnRenderClient({
      Layout: AppLayout,
      ...fromTransition(routeTransition({ duration: DURATION })),
    })

    await navigate(render, PageA)
    await navigate(render, PageB)

    const slot = document.querySelector('.nav-slot') as HTMLElement
    expect(slot.style.opacity).toBe('')
    expect(slot.style.transform).toBe('')
  })

  it('hides the slot WHILE the leave is in flight (the animation still runs)', async () => {
    const render = createOnRenderClient({
      Layout: AppLayout,
      ...fromTransition(routeTransition({ duration: DURATION, slide: false })),
    })

    await navigate(render, PageA)

    const slot = document.querySelector('.nav-slot') as HTMLElement
    const done = render({ Page: PageB, isHydration: false })
    // Mid-leave: the outgoing page is animating out, so the slot IS transparent
    // here. The fix must not turn the transition into a no-op.
    expect(slot.style.opacity).toBe('0')

    await vi.advanceTimersByTimeAsync(SETTLE)
    await done
    await vi.advanceTimersByTimeAsync(SETTLE)
    expect(slot.style.opacity).toBe('')
  })
})
