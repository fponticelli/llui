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
import { isExitWatched } from '../../src/internal/disclosure-motion'

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
 * exitWatchers` holds `{ session, count }` — the mount COUNT lives in
 * ordinary, JSON-serializable state, keyed by a token identifying the
 * CURRENT JS realm (see `ExitWatchers`'s header in `disclosure-motion.ts`,
 * #264 review-264i) — and `isExitWatched(exitWatchers)` is `true` only when
 * `session` matches this realm AND `count > 0`. `closing` retention only
 * ever engages while that holds — otherwise it closes instantly. These tests
 * exercise that through a real `mountApp`, not a bare `update()` call, so the
 * attach/detach messages the mount itself sends are genuinely exercised.
 *
 * This REPLACES an earlier design (#264 review M1/review-264h) that counted
 * mounts in a `connect()`-owned closure, keyed by DISPATCHER IDENTITY
 * (`send`) in a module-level `WeakMap`, plus a microtask-scheduled recovery
 * for a stale persisted flag. That broke the moment two `connect()` calls
 * over the same slice used two DIFFERENT dispatcher wrappers — an idiomatic
 * `(msg) => send({ type: 'accordion', msg })` written inline at each call
 * site is a distinct function object each time, so no `WeakMap` could unify
 * them, and the non-placing call's stale-recovery microtask would detach the
 * OTHER call's genuinely live watcher. Counting in state instead means every
 * `exitWatcherAttach`/`exitWatcherDetach` message lands on the SAME reducer
 * regardless of how many independent `connect()` closures or dispatcher
 * shapes sent it — no closure coordination needed at all, and no microtask:
 * the self-heal for a restored, foreign-session slice is a synchronous,
 * pure reducer transition, not a scheduled side effect racing the mount.
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
    // placed, so `exitWatchers.count` stays 0 and the slice never reads as
    // watched.
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

  it('a SAME-realm restored stale count is honest, accurate data — a fresh attach on top is simply an ADDITIONAL watcher', () => {
    // Documents a boundary of the design, not a bug: `isExitWatched`
    // structurally rules out a FOREIGN session (necessarily a past page
    // load — see the P2-P4 tests below), but within the SAME realm a
    // restored `exitWatchers.count` is genuinely valid data as far as this
    // process can tell, even if it came from an instance that disposed
    // without its own detach landing first (`send()` after `dispose()` is a
    // documented no-op, so a snapshot taken concurrently with an unmount can
    // legitimately carry an un-decremented count). Placing a NEW
    // `exitCompletion` on top of that restored count does not "start
    // fresh" — it adds one more real watcher to whatever the slice already
    // recorded, exactly as it would for any other live second placement
    // (see "placing exitCompletion TWICE" below).
    const host1 = document.createElement('div')
    document.body.append(host1)
    const app1 = mountApp(host1, accordionDef(true))
    const snap: accordion.AccordionState = JSON.parse(JSON.stringify(app1.getState().accordion))
    app1.dispose()
    host1.remove()
    expect(snap.exitWatchers.count).toBe(1) // the dropped detach's stale count, honestly carried forward

    const def = accordionDef(true)
    const persisted: SignalComponentDef<AccState, AccMsg> = {
      ...def,
      init: () => [{ accordion: snap, placeExitCompletion: true }, []],
    }
    const host = document.createElement('div')
    document.body.append(host)
    const app2 = mountApp(host, persisted)
    app = app2

    click(trigger(host))
    expect(content(host).dataset.state).toBe('closing')
    // The restored 1 plus this mount's own attach: 2, not 1 — never trust a
    // same-realm restored count to correspond to zero live watchers.
    expect(app2.getState().accordion.exitWatchers.count).toBe(2)
  })

  /**
   * A restored slice whose `exitWatchers.session` is FOREIGN to this realm
   * (necessarily the case after an actual page reload — this module is
   * re-evaluated and mints a fresh session token; a literal string here
   * stands in for "some other realm's token") is unwatched regardless of
   * its `count`, with NO recovery message and NO microtask needed —
   * `isExitWatched` reads it directly, synchronously, the instant it is
   * consulted (#264 review-264i, replacing review-264h's microtask-scheduled
   * self-heal for the identical hazard). Every test below is therefore
   * fully synchronous: no `await`, no scheduled tick.
   */
  function foreignExitWatchers(count: number): accordion.AccordionState['exitWatchers'] {
    return { session: 'a-past-page-load-token', count }
  }

  function restoredState(count: number): accordion.AccordionState {
    return {
      ...accordion.init({ items: ['details'], value: ['details'], animated: true }),
      exitWatchers: foreignExitWatchers(count),
    }
  }

  function mountRestored(snap: accordion.AccordionState, place: boolean): HTMLElement {
    const def = accordionDef(place)
    const persisted: SignalComponentDef<AccState, AccMsg> = {
      ...def,
      init: () => [{ accordion: snap, placeExitCompletion: place }, []],
    }
    const host = document.createElement('div')
    document.body.append(host)
    app = mountApp(host, persisted)
    return host
  }

  it('P2 (#264 review-264i): restored FOREIGN session with a stale positive count, NOTHING mounted, a programmatic close closes instantly', () => {
    const snap = restoredState(5)
    const host = mountRestored(snap, false)
    app?.send({ type: 'accordion', msg: { type: 'close', value: 'details' } })
    const el = content(host)
    expect(el.dataset.state).toBe('closed')
    expect(el.hidden).toBe(true)
    expect(el.hasAttribute('inert')).toBe(true)
  })

  it('P3 (#264 review-264i): restored FOREIGN session, NOTHING mounted, a real click closes instantly + warning fires', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const snap = restoredState(5)
    const host = mountRestored(snap, false)
    click(trigger(host))
    expect(content(host).dataset.state).toBe('closed')
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('P4 (#264 review-264i): restored FOREIGN session, nothing mounted, close, then a LATER real mount/unmount still behaves', () => {
    const snap = restoredState(3)
    const host = mountRestored(snap, false)
    app?.send({ type: 'accordion', msg: { type: 'close', value: 'details' } })
    const s1 = content(host).dataset.state
    app?.send({ type: 'setPlaceExitCompletion', value: true }) // real attach: session adopted, count 1
    const s2 = content(host).dataset.state
    app?.send({ type: 'setPlaceExitCompletion', value: false }) // real detach: settles
    expect([s1, s2, content(host).dataset.state]).toEqual(['closed', 'closed', 'closed'])
  })

  it('a restored FOREIGN session does not prevent a genuinely mounted exitCompletion THIS session from retaining', () => {
    const snap = restoredState(5) // stale positive count, foreign session
    const host = mountRestored(snap, true) // placed from the start this session
    click(trigger(host))
    // A real watcher attached this realm: `attachExitWatcher` adopts the
    // CURRENT session at count 1, ignoring the foreign count entirely — so
    // the close RETAINS rather than closing instantly.
    expect(content(host).dataset.state).toBe('closing')
  })

  it('two connect() calls sharing one send share ONE mount count (#264 review follow-up)', () => {
    // Two independent `connect()` calls over the SAME accordion slice,
    // dispatching through the SAME `send` — each placing its OWN
    // exitCompletion. Detaching one must not drop retention while the
    // other's is still mounted, exactly like the single-connect() double-
    // placement case — now trivially true because the count lives in STATE,
    // shared by construction across every `connect()` call over that state,
    // with no per-`connect()` coordination required at all (#264
    // review-264i).
    interface TwoConnectState {
      accordion: accordion.AccordionState
      placeA: boolean
      placeB: boolean
    }
    type TwoConnectMsg =
      | AccMsg
      | { type: 'setPlaceA'; value: boolean }
      | { type: 'setPlaceB'; value: boolean }
    const host = document.createElement('div')
    document.body.append(host)
    app = mountApp(host, {
      name: 'TwoConnectFixture',
      init: () => [
        {
          accordion: accordion.init({ items: ['details'], value: ['details'], animated: true }),
          placeA: true,
          placeB: true,
        },
        [],
      ],
      update: (state: TwoConnectState, msg: TwoConnectMsg) => {
        if (msg.type === 'setPlaceA') return [{ ...state, placeA: msg.value }, []]
        if (msg.type === 'setPlaceB') return [{ ...state, placeB: msg.value }, []]
        if (msg.type === 'accordion') {
          return [{ ...state, accordion: accordion.update(state.accordion, msg.msg)[0] }, []]
        }
        return [state, []]
      },
      view: ({ state, send }): readonly Mountable[] => {
        const dispatch = (msg: accordion.AccordionMsg): void => send({ type: 'accordion', msg })
        // TWO independent connect() calls, same slice, same `send` reference.
        const accA = accordion.connect(state.at('accordion'), dispatch, { id: 'two-connect-a' })
        const accB = accordion.connect(state.at('accordion'), dispatch, { id: 'two-connect-b' })
        const item = accA.item('details')
        return [
          div({ ...accA.root }, [
            div({ ...item.item }, [
              div({ ...item.trigger }, [text('details')]),
              div({ ...item.content }, [text('content')]),
            ]),
          ]),
          show(
            state.at('placeA'),
            () => [accA.exitCompletion],
            () => [],
          ),
          show(
            state.at('placeB'),
            () => [accB.exitCompletion],
            () => [],
          ),
        ]
      },
    })
    click(trigger(host))
    expect(content(host).dataset.state).toBe('closing')

    app?.send({ type: 'setPlaceA', value: false })
    expect(content(host).dataset.state).toBe('closing') // B's placement still mounted

    app?.send({ type: 'setPlaceB', value: false })
    expect(content(host).dataset.state).toBe('closed') // both detached now
  })

  it('INLINE wrappers: two connect() calls, each with its OWN inline dispatcher closure, still aggregate one count (#264 review-264i)', () => {
    // The regression this round fixed: two `connect()` calls each wrapped in
    // their OWN inline arrow — `(msg) => send({ type: 'accordion', msg })`
    // written SEPARATELY at each call site rather than sharing one `dispatch`
    // const — are two DIFFERENT function objects. The OLD design keyed its
    // shared counter by DISPATCHER IDENTITY in a `WeakMap`, so these two
    // inline wrappers built two INDEPENDENT counters over the same real
    // mounts: the non-placing call's stale-recovery microtask would detach
    // the placing call's genuinely live watcher, closing instantly with a
    // false "forgot to place" warning even from a fresh `init()`. Counting
    // in STATE has no dispatcher identity to key on at all, so this cannot
    // happen regardless of how many distinct inline wrappers are used.
    interface InlineState {
      accordion: accordion.AccordionState
      placeA: boolean
      placeB: boolean
    }
    type InlineMsg =
      | { type: 'accordion'; msg: accordion.AccordionMsg }
      | { type: 'setPlaceA'; value: boolean }
      | { type: 'setPlaceB'; value: boolean }
    const host = document.createElement('div')
    document.body.append(host)
    app = mountApp(host, {
      name: 'InlineWrapperFixture',
      init: () => [
        {
          accordion: accordion.init({ items: ['details'], value: ['details'], animated: true }),
          placeA: true,
          placeB: false,
        },
        [],
      ],
      update: (state: InlineState, msg: InlineMsg) => {
        if (msg.type === 'setPlaceA') return [{ ...state, placeA: msg.value }, []]
        if (msg.type === 'setPlaceB') return [{ ...state, placeB: msg.value }, []]
        if (msg.type === 'accordion') {
          return [{ ...state, accordion: accordion.update(state.accordion, msg.msg)[0] }, []]
        }
        return [state, []]
      },
      view: ({ state, send }): readonly Mountable[] => {
        // Two DISTINCT inline wrappers — no shared `dispatch` const.
        const accA = accordion.connect(
          state.at('accordion'),
          (msg) => send({ type: 'accordion', msg }),
          {
            id: 'inline-a',
          },
        )
        const accB = accordion.connect(
          state.at('accordion'),
          (msg) => send({ type: 'accordion', msg }),
          {
            id: 'inline-b',
          },
        )
        const item = accA.item('details')
        return [
          div({ ...accA.root }, [
            div({ ...item.item }, [
              div({ ...item.trigger }, [text('details')]),
              div({ ...item.content }, [text('content')]),
            ]),
          ]),
          show(
            state.at('placeA'),
            () => [accA.exitCompletion],
            () => [],
          ),
          show(
            state.at('placeB'),
            () => [accB.exitCompletion],
            () => [],
          ),
        ]
      },
    })
    // Only A's exitCompletion is placed; B's never mounts at all. A real
    // click must still RETAIN through `closing`.
    click(trigger(host))
    expect(content(host).dataset.state).toBe('closing')
    // Now B mounts too (a second, independently-inline-wrapped watcher).
    app?.send({ type: 'setPlaceB', value: true })
    // Detaching A alone must not drop retention — B is still mounted.
    app?.send({ type: 'setPlaceA', value: false })
    expect(content(host).dataset.state).toBe('closing')
    app?.send({ type: 'setPlaceB', value: false })
    expect(content(host).dataset.state).toBe('closed')
  })

  it('show/branch re-running connect() on remount does not drift the count (#264 review-264i)', () => {
    // A `show`/`branch` arm that unmounts and REMOUNTS the accordion's own
    // root re-runs `connect()` itself, not just `exitCompletion` — a fresh
    // closure every time. The count must still land correctly: after an
    // unmount (detaching whatever was attached) and a fresh remount
    // (attaching again), a subsequent close retains exactly once, with no
    // leftover count from the torn-down instance.
    interface ReRunState {
      accordion: accordion.AccordionState
      showAccordion: boolean
    }
    type ReRunMsg =
      | { type: 'accordion'; msg: accordion.AccordionMsg }
      | { type: 'setShowAccordion'; value: boolean }
    const host = document.createElement('div')
    document.body.append(host)
    app = mountApp(host, {
      name: 'ReRunConnectFixture',
      init: () => [
        {
          accordion: accordion.init({ items: ['details'], value: ['details'], animated: true }),
          showAccordion: true,
        },
        [],
      ],
      update: (state: ReRunState, msg: ReRunMsg) => {
        if (msg.type === 'setShowAccordion') return [{ ...state, showAccordion: msg.value }, []]
        return [{ ...state, accordion: accordion.update(state.accordion, msg.msg)[0] }, []]
      },
      view: ({ state, send }): readonly Mountable[] => [
        show(
          state.at('showAccordion'),
          () => {
            const acc = accordion.connect(
              state.at('accordion'),
              (msg) => send({ type: 'accordion', msg }),
              { id: 're-run-accordion' },
            )
            const item = acc.item('details')
            return [
              div({ ...acc.root }, [
                div({ ...item.item }, [
                  div({ ...item.trigger }, [text('details')]),
                  div({ ...item.content }, [text('content')]),
                ]),
              ]),
              acc.exitCompletion,
            ]
          },
          () => [],
        ),
      ],
    })
    click(trigger(host))
    expect(content(host).dataset.state).toBe('closing')

    // Reopen so the next remount starts from a clean, non-closing state,
    // then tear the whole arm down and bring it back — a fresh `connect()`.
    click(trigger(host))
    app?.send({ type: 'setShowAccordion', value: false }) // unmounts: detaches
    app?.send({ type: 'setShowAccordion', value: true }) // remounts: re-attaches

    click(trigger(host))
    expect(content(host).dataset.state).toBe('closing')
    const el = content(host)
    el.dispatchEvent(animationEvent('animationstart', 'exit'))
    el.dispatchEvent(animationEvent('animationend', 'exit'))
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
    expect(serverState.accordion.closing).toEqual([])
    expect(isExitWatched(serverState.accordion.exitWatchers)).toBe(false)

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
