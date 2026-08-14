import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { component, mountApp, button, div, text, type Renderable } from '@llui/dom'
import * as menu from '../../src/components/menu'
import * as tooltip from '../../src/components/tooltip'
import * as hoverCard from '../../src/components/hover-card'
import * as navMenu from '../../src/components/navigation-menu'
import { signalOf } from '../_signal'

/**
 * #123 — "menu-machine's hover timers are guarded AND CLEARED on unmount."
 *
 * The detached-element guard makes a late timer harmless, but the timer itself
 * still sits in the event loop until it fires. `connect()` now also registers an
 * `onTeardown` when it runs under a live build (the real app path), so a pending
 * timer is cancelled with the component. `vi.getTimerCount()` is the only
 * assertion that can tell "cancelled" apart from "fired into a guard".
 */

describe('hover timers are cancelled when the component unmounts', () => {
  let currentApp: ReturnType<typeof mountApp> | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
    vi.useFakeTimers()
  })

  afterEach(() => {
    if (currentApp) {
      currentApp.dispose()
      currentApp = null
    }
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  /** Mount a component whose view runs `build` under a live build context. */
  function mount(build: () => Renderable): ReturnType<typeof mountApp> {
    const def = component<Record<string, never>, never, never>({
      name: 'TimerTeardown',
      init: () => [{}, []],
      update: (state) => [state, []],
      view: () => build(),
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    currentApp = mountApp(container, def)
    return currentApp
  }

  /** Schedule one timer through `schedule`, then assert dispose cancels it. */
  function expectCancelledOnDispose(build: () => Renderable, schedule: () => void): void {
    const app = mount(build)
    expect(vi.getTimerCount()).toBe(0)
    schedule()
    // Non-vacuous: a timer really is pending.
    expect(vi.getTimerCount()).toBe(1)
    app.dispose()
    currentApp = null
    expect(vi.getTimerCount()).toBe(0)
  }

  it('menu (menu-machine) cancels a pending submenu hover timer', () => {
    let enter!: (e: PointerEvent) => void
    const items: menu.MenuItem[] = [
      { value: 'a', kind: 'action' },
      { value: 'sub', kind: 'action', children: [{ value: 's1', kind: 'action' }] },
    ]
    const state = menu.init({ items, open: true, skipAnimations: true })
    expectCancelledOnDispose(
      () => {
        const parts = menu.connect(signalOf(state), vi.fn(), { id: 'mn' })
        enter = parts.subTrigger('sub').onPointerEnter
        return [button({ ...parts.trigger }, [text('Menu')])]
      },
      () => enter({} as PointerEvent),
    )
  })

  it('tooltip cancels a pending show timer', () => {
    let enter!: (e: PointerEvent) => void
    const state = tooltip.init()
    expectCancelledOnDispose(
      () => {
        const parts = tooltip.connect(signalOf(state), vi.fn(), { id: 'tp' })
        enter = parts.trigger.onPointerEnter
        return [button({ ...parts.trigger }, [text('Hover')])]
      },
      () => enter({} as PointerEvent),
    )
  })

  it('hover-card cancels a pending open timer', () => {
    let enter!: (e: PointerEvent) => void
    const state = hoverCard.init()
    expectCancelledOnDispose(
      () => {
        const parts = hoverCard.connect(signalOf(state), vi.fn(), { id: 'hc' })
        enter = parts.trigger.onPointerEnter
        return [button({ ...parts.trigger }, [text('Hover')])]
      },
      () => enter({} as PointerEvent),
    )
  })

  it('navigation-menu cancels a pending close timer', () => {
    let leave!: (e: PointerEvent) => void
    const state = navMenu.init()
    expectCancelledOnDispose(
      () => {
        const parts = navMenu.connect(signalOf(state), vi.fn(), { id: 'nav' })
        leave = parts.root.onPointerLeave
        return [div({ ...parts.root }, [text('nav')])]
      },
      () => leave({} as PointerEvent),
    )
  })

  it('connect() outside a build context still works (no lifecycle to hook)', () => {
    // The escape hatch that keeps `connect()` a pure part-bag builder: a unit
    // test calls it with no build in progress, so there is no teardown to
    // register and the detached-element guard remains the only safety net.
    const state = tooltip.init()
    const parts = tooltip.connect(signalOf(state), vi.fn(), { id: 'tp' })
    expect(() => parts.trigger.onPointerEnter({} as PointerEvent)).not.toThrow()
    expect(vi.getTimerCount()).toBe(1)
  })
})
