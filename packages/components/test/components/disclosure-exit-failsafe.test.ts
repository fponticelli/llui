import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  component,
  div,
  hydrateSignalApp,
  mountApp,
  renderToString,
  show,
  text,
  type Mountable,
  type SignalComponentDef,
} from '@llui/dom'
import * as accordion from '../../src/components/accordion'
import * as collapsible from '../../src/components/collapsible'

function animationEvent(type: string, animationName: string): Event {
  const event = new Event(type)
  Object.defineProperty(event, 'animationName', { value: animationName })
  return event
}

/**
 * #264 item F1 (superseding review item 4): a forgotten `parts.exitCompletion`
 * placement used to leave a closing item hanging `closing` + `inert` forever,
 * detected only by a `setTimeout`-armed dev-mode stall watchdog (removed —
 * see `disclosure-motion.ts`'s header comment on
 * `createDisclosureExitCompletionMount`). The fix is structural: `state.
 * exitWatched` is an idempotent boolean, driven by `exitWatcherAttach`/
 * `exitWatcherDetach` messages `connect()` sends only on the 0->1/1->0
 * transitions of a MOUNT-COUNT it keeps entirely in its OWN closure (#264
 * review M1 — never in state, since a persisted/restored state slice that
 * bypasses `init()` could otherwise carry a stale count and hang `closing`
 * forever the moment the one real watcher this session ever had detaches;
 * see `createExitWatcherCounter` in `disclosure-motion.ts`). `closing`
 * retention only ever engages while `exitWatched` is `true` — otherwise it
 * closes instantly. These tests exercise that through a real `mountApp`, not
 * a bare `update()` call, so the attach/detach messages the mount itself
 * sends are genuinely exercised.
 *
 * The dev-mode "you forgot to place exitCompletion" warning lives at the
 * `connect()` boundary now (a closure flag owned by that call), never inside
 * `update()` — so every warning assertion below fires a REAL DOM click, the
 * one path that boundary can observe (matching
 * `completeIfUnanimatedAfterToggle`'s identical, documented scope).
 */

interface AccState {
  accordion: accordion.AccordionState
  /** Toggled via `show()` below (#264 review LOW 4 — "detach mid-closing"
   * must detach exitCompletion while the HOST stays mounted, never by
   * disposing the whole app). */
  placeExitCompletion: boolean
}
type AccMsg =
  | { type: 'accordion'; msg: accordion.AccordionMsg }
  | { type: 'setPlaceExitCompletion'; value: boolean }

let app: ReturnType<typeof mountApp> | ReturnType<typeof hydrateSignalApp> | null = null
let warnSpy: ReturnType<typeof vi.spyOn> | null = null

afterEach(() => {
  app?.dispose()
  app = null
  document.body.replaceChildren()
  warnSpy?.mockRestore()
  warnSpy = null
})

function accordionDef(placeExitCompletion: boolean): SignalComponentDef<AccState, AccMsg> {
  return {
    name: 'DisclosureFailSafeFixture',
    init: () => [
      {
        accordion: accordion.init({ items: ['details'], value: ['details'], animated: true }),
        placeExitCompletion,
      },
      [],
    ],
    update: (state, msg) => {
      if (msg.type === 'setPlaceExitCompletion') {
        return [{ ...state, placeExitCompletion: msg.value }, []]
      }
      return [{ ...state, accordion: accordion.update(state.accordion, msg.msg)[0] }, []]
    },
    view: ({ state, send }): readonly Mountable[] => {
      const acc = accordion.connect(
        state.at('accordion'),
        (msg) => send({ type: 'accordion', msg }),
        { id: 'fail-safe-accordion' },
      )
      const item = acc.item('details')
      return [
        div({ ...acc.root }, [
          div({ ...item.item }, [
            div({ ...item.trigger }, [text('details')]),
            div({ ...item.content }, [text('content')]),
          ]),
        ]),
        show(
          state.at('placeExitCompletion'),
          () => [acc.exitCompletion],
          () => [],
        ),
      ]
    },
  }
}

function mountAccordion(placeExitCompletion: boolean): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  app = mountApp(host, accordionDef(placeExitCompletion))
  return host
}

const content = (host: HTMLElement): HTMLElement =>
  host.querySelector('[data-scope="accordion"][data-part="content"]') as HTMLElement
const trigger = (host: HTMLElement): HTMLElement =>
  host.querySelector('[data-scope="accordion"][data-part="trigger"]') as HTMLElement

function click(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

describe('#264 item F1 — exitCompletion fail-safe', () => {
  it('forgotten part + animated + programmatic close on a no-motion skin closes instantly, no leftovers', () => {
    const host = mountAccordion(false)
    // No CSS in this fixture, so this is a no-motion skin either way; the
    // point under test is that the exitCompletion Mountable was never
    // placed, so `exitWatched` never becomes true.
    app?.send({ type: 'accordion', msg: { type: 'close', value: 'details' } })
    const el = content(host)
    expect(el.dataset.state).toBe('closed')
    expect(el.hidden).toBe(true)
    expect(el.getAttribute('aria-hidden')).toBe('true')
    expect(el.hasAttribute('inert')).toBe(true)
  })

  it('DEV warning fires exactly once, from a real click, when exitCompletion was never placed', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = mountAccordion(false)
    click(trigger(host)) // open -> closing/closed side effect: this item is already open, so closes it
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('exitCompletion')
    // Throttled: reopening and closing again does not warn a second time.
    click(trigger(host))
    click(trigger(host))
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('no DEV warning fires for a purely programmatic close bypassing the trigger (documented scope)', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mountAccordion(false)
    app?.send({ type: 'accordion', msg: { type: 'close', value: 'details' } })
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('a placed exitCompletion runs the full four-phase lifecycle: closed -> open -> closing -> closed', () => {
    const host = mountAccordion(true)
    const el = content(host)
    // Starts open (item.init() below is unused; see mountAccordion's own
    // init override) — drive it through a full close/reopen/close cycle via
    // real clicks so all four `data-state` phases are observed in sequence.
    expect(el.dataset.state).toBe('open')

    // jsdom has no real Web Animations support at all (`getAnimations` is
    // `undefined`), so neither the click's own synchronous safety net nor
    // `exitCompletion`'s reactive `check()` can tell "no motion" from
    // "unknown" and correctly decline to settle — exactly the faithful
    // jsdom shape of a skin that DOES run a real (CSS) exit animation.
    click(trigger(host)) // open -> closing (retained: watcher attached)
    expect(el.dataset.state).toBe('closing')

    // Simulate the skin's real exit animation actually finishing.
    el.dispatchEvent(animationEvent('animationstart', 'exit'))
    el.dispatchEvent(animationEvent('animationend', 'exit'))
    expect(el.dataset.state).toBe('closed')

    click(trigger(host)) // closed -> open
    expect(el.dataset.state).toBe('open')

    click(trigger(host)) // open -> closing -> closed again
    expect(el.dataset.state).toBe('closing')
    el.dispatchEvent(animationEvent('animationstart', 'exit'))
    el.dispatchEvent(animationEvent('animationend', 'exit'))
    expect(el.dataset.state).toBe('closed')
  })

  it('detaching exitCompletion mid-closing settles it, with the HOST staying mounted throughout', () => {
    const host = mountAccordion(true)
    click(trigger(host))
    expect(content(host).dataset.state).toBe('closing')

    // Remove ONLY `exitCompletion` from the view via `show()` — the
    // accordion root/trigger/content stay mounted the whole time (#264
    // review LOW 4: never simulated by disposing the whole app).
    app?.send({ type: 'setPlaceExitCompletion', value: false })

    const el = content(host)
    expect(el.dataset.state).toBe('closed')
    expect(el.hidden).toBe(true)
    expect(el.getAttribute('aria-hidden')).toBe('true')
    expect(el.hasAttribute('inert')).toBe(true)
    // The host is still alive and interactive.
    expect(host.isConnected).toBe(true)
    click(trigger(host))
    expect(el.dataset.state).toBe('open')
  })

  it('a persisted/restored state slice never reintroduces the hang (#264 review M1)', () => {
    // 1. A live session: mount, then snapshot the slice the way a
    // persistence layer would (JSON round trip). At this point the mount
    // has already attached, so the snapshot carries `exitWatched: true`.
    const host1 = document.createElement('div')
    document.body.append(host1)
    const app1 = mountApp(host1, accordionDef(true))
    const snap: accordion.AccordionState = JSON.parse(JSON.stringify(app1.getState().accordion))
    app1.dispose()
    host1.remove()

    // 2. "Reload": construct the NEXT session's initial state directly from
    // the persisted slice, bypassing `accordion.init()` entirely — exactly
    // what a host's own hydration/persistence layer does. The OLD design (a
    // reducer-owned count, incremented/decremented relative to whatever the
    // state already held) would start this session's arithmetic from the
    // STALE count the snapshot carried, so a single real detach could leave
    // it reading "still watched" when nothing actually is. The closure-owned
    // counter (#264 review M1) starts this session's count at a genuine 0
    // regardless of what the snapshot says, so this cannot happen.
    const def = accordionDef(true)
    const persisted: SignalComponentDef<AccState, AccMsg> = {
      ...def,
      init: () => [{ accordion: snap, placeExitCompletion: true }, []],
    }
    const host = document.createElement('div')
    document.body.append(host)
    app = mountApp(host, persisted)

    click(trigger(host))
    expect(content(host).dataset.state).toBe('closing')
    app?.send({ type: 'setPlaceExitCompletion', value: false })
    expect(content(host).dataset.state).toBe('closed')
  })

  it('placing exitCompletion TWICE tracks correctly: one detaching does not drop retention while the other stays mounted', () => {
    const host = document.createElement('div')
    document.body.append(host)
    app = mountApp(host, {
      name: 'DoublePlacementFixture',
      init: () => [
        {
          accordion: accordion.init({ items: ['details'], value: ['details'], animated: true }),
          placeFirst: true,
          placeSecond: true,
        },
        [],
      ],
      update: (
        state: { accordion: accordion.AccordionState; placeFirst: boolean; placeSecond: boolean },
        msg:
          | AccMsg
          | { type: 'setPlaceFirst'; value: boolean }
          | { type: 'setPlaceSecond'; value: boolean },
      ) => {
        if (msg.type === 'setPlaceFirst') return [{ ...state, placeFirst: msg.value }, []]
        if (msg.type === 'setPlaceSecond') return [{ ...state, placeSecond: msg.value }, []]
        if (msg.type === 'accordion') {
          return [{ ...state, accordion: accordion.update(state.accordion, msg.msg)[0] }, []]
        }
        return [state, []]
      },
      view: ({ state, send }): readonly Mountable[] => {
        const acc = accordion.connect(
          state.at('accordion'),
          (msg) => send({ type: 'accordion', msg }),
          { id: 'double-placement-accordion' },
        )
        const item = acc.item('details')
        return [
          div({ ...acc.root }, [
            div({ ...item.item }, [
              div({ ...item.trigger }, [text('details')]),
              div({ ...item.content }, [text('content')]),
            ]),
          ]),
          show(
            state.at('placeFirst'),
            () => [acc.exitCompletion],
            () => [],
          ),
          show(
            state.at('placeSecond'),
            () => [acc.exitCompletion],
            () => [],
          ),
        ]
      },
    })
    click(trigger(host))
    expect(content(host).dataset.state).toBe('closing')

    // Detach the FIRST placement — the SECOND is still mounted, so retention
    // must not drop.
    app?.send({ type: 'setPlaceFirst', value: false })
    expect(content(host).dataset.state).toBe('closing')

    // Detach the SECOND (last) placement — now nothing is watching, so it
    // settles immediately.
    app?.send({ type: 'setPlaceSecond', value: false })
    expect(content(host).dataset.state).toBe('closed')
  })

  it('no DEV warning fires when exitCompletion is placed correctly', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = mountAccordion(true)
    click(trigger(host))
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('starts no timer of any kind (no fake timer to advance) during a forgotten-part close', () => {
    vi.useFakeTimers()
    try {
      const before = vi.getTimerCount()
      const host = mountAccordion(false)
      app?.send({ type: 'accordion', msg: { type: 'close', value: 'details' } })
      expect(vi.getTimerCount()).toBe(before)
      expect(content(host).dataset.state).toBe('closed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('is SSR/hydration-safe: server never closes, init is deterministic, and a real hydrate + interaction both work', () => {
    const serverState: AccState = {
      accordion: accordion.init({ items: ['details'], value: ['details'], animated: true }),
      placeExitCompletion: true,
    }
    // SSR-time: no exitWatcher was ever attached (mounts never run on the
    // server), so this is deterministic — no server-side "closing" state
    // ever exists to hang.
    expect(serverState.accordion).toMatchObject({ closing: [], exitWatched: false })

    const def = accordionDef(true)
    const container = document.createElement('div')
    document.body.append(container)
    container.innerHTML = renderToString(def, serverState, document)
    expect(content(container).dataset.state).toBe('open')

    // Actually HYDRATE over the server HTML (#264 review LOW 4 — a
    // `renderToString` call alone proves nothing about hydration).
    // `hydrateSignalApp` builds the client tree and swaps it in atomically,
    // so every element reference must be re-queried AFTER this call — the
    // pre-hydration nodes are discarded, not reused.
    app = hydrateSignalApp(container, def, serverState)

    // Post-hydration, the exitCompletion mount has run and attached — a
    // real click now retains through `closing` rather than closing instantly.
    click(trigger(container))
    expect(content(container).dataset.state).toBe('closing')
    const el = content(container)
    el.dispatchEvent(animationEvent('animationstart', 'exit'))
    el.dispatchEvent(animationEvent('animationend', 'exit'))
    expect(content(container).dataset.state).toBe('closed')

    container.remove()
  })
})

describe('#264 item F1 — collapsible exitCompletion fail-safe (mounted)', () => {
  interface ColState {
    collapsible: collapsible.CollapsibleState
    placeExitCompletion: boolean
  }
  type ColMsg =
    | { type: 'collapsible'; msg: collapsible.CollapsibleMsg }
    | { type: 'setPlaceExitCompletion'; value: boolean }

  function mountCollapsible(placeExitCompletion: boolean): HTMLElement {
    const host = document.createElement('div')
    document.body.append(host)
    app = mountApp(
      host,
      component<ColState, ColMsg>({
        name: 'CollapsibleFailSafeFixture',
        init: () => [
          { collapsible: collapsible.init({ open: true, animated: true }), placeExitCompletion },
          [],
        ],
        update: (state, msg) => {
          if (msg.type === 'setPlaceExitCompletion') {
            return [{ ...state, placeExitCompletion: msg.value }, []]
          }
          return [{ ...state, collapsible: collapsible.update(state.collapsible, msg.msg)[0] }, []]
        },
        view: ({ state, send }): readonly Mountable[] => {
          const c = collapsible.connect(
            state.at('collapsible'),
            (msg) => send({ type: 'collapsible', msg }),
            { id: 'fail-safe-collapsible' },
          )
          return [
            div({ ...c.root }, [
              div({ ...c.trigger }, [text('trigger')]),
              div({ ...c.content }, [text('content')]),
            ]),
            show(
              state.at('placeExitCompletion'),
              () => [c.exitCompletion],
              () => [],
            ),
          ]
        },
      }),
    )
    return host
  }

  const colContent = (host: HTMLElement): HTMLElement =>
    host.querySelector('[data-scope="collapsible"][data-part="content"]') as HTMLElement
  const colTrigger = (host: HTMLElement): HTMLElement =>
    host.querySelector('[data-scope="collapsible"][data-part="trigger"]') as HTMLElement

  it('forgotten part closes instantly with no inert/aria-hidden leftovers', () => {
    const host = mountCollapsible(false)
    app?.send({ type: 'collapsible', msg: { type: 'close' } })
    const el = colContent(host)
    expect(el.dataset.state).toBe('closed')
    expect(el.hidden).toBe(true)
    expect(el.getAttribute('aria-hidden')).toBe('true')
    expect(el.hasAttribute('inert')).toBe(true)
  })

  it('DEV warning fires exactly once, from a real click, when exitCompletion was never placed', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = mountCollapsible(false)
    click(colTrigger(host))
    expect(warnSpy).toHaveBeenCalledTimes(1)
    click(colTrigger(host))
    click(colTrigger(host))
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('detaching exitCompletion mid-closing settles it, with the HOST staying mounted throughout', () => {
    const host = mountCollapsible(true)
    click(colTrigger(host))
    expect(colContent(host).dataset.state).toBe('closing')

    app?.send({ type: 'setPlaceExitCompletion', value: false })

    const el = colContent(host)
    expect(el.dataset.state).toBe('closed')
    expect(el.getAttribute('aria-hidden')).toBe('true')
    expect(el.hasAttribute('inert')).toBe(true)
    expect(host.isConnected).toBe(true)
  })
})
