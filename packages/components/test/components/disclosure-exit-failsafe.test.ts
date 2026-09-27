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
 * `createDisclosureExitCompletionMount`).
 *
 * **FINAL mechanism (#264 review-264j) — read `disclosure-motion.ts`'s
 * header before touching this again.** "Is a watcher mounted" lives in a
 * module-level runtime registry keyed by `opts.id`, never in state or a
 * message: `AccordionState`/`CollapsibleState` carry NOTHING about it, and
 * `init()` is fully deterministic. The reducer's ONE new fact is a
 * `retain?: boolean` field on every closing-capable message, stamped by
 * `connect()`'s trigger handlers (and the `close()` helper) from the
 * registry AT DISPATCH TIME — `closing` retention engages only when
 * `animated && msg.retain === true`. These tests exercise that through a
 * real `mountApp`, not a bare `update()` call, so the real registry
 * attach/detach and the real click-time `retain` stamping are genuinely
 * exercised (unit-level reducer/registry coverage lives in
 * `accordion.test.ts`/`collapsible.test.ts`; determinism/replay coverage
 * lives in `disclosure-exit-replay.test.ts`).
 *
 * Every test below uses its OWN unique `id` — the registry and the
 * dev-warning throttle are both module-level, keyed by `id`, so reusing one
 * across tests would leak state between them (exactly the shared-per-page
 * keying the design intends, which is why ids must be unique per test here
 * just as they must be unique per page in production).
 */

interface AccState {
  accordion: accordion.AccordionState
  /** Toggled via `show()` below — never simulated by disposing the whole
   * app, so the host stays mounted while only `exitCompletion` unmounts. */
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

function accordionDef(
  id: string,
  placeExitCompletion: boolean,
  initAccordion?: () => accordion.AccordionState,
): SignalComponentDef<AccState, AccMsg> {
  return {
    name: 'DisclosureFailSafeFixture',
    init: () => [
      {
        accordion: (
          initAccordion ??
          (() => accordion.init({ items: ['details'], value: ['details'], animated: true }))
        )(),
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
        {
          id,
        },
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

function mountAccordion(id: string, placeExitCompletion: boolean): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  app = mountApp(host, accordionDef(id, placeExitCompletion))
  return host
}

const content = (host: HTMLElement): HTMLElement =>
  host.querySelector('[data-scope="accordion"][data-part="content"]') as HTMLElement
const trigger = (host: HTMLElement): HTMLElement =>
  host.querySelector('[data-scope="accordion"][data-part="trigger"]') as HTMLElement

function click(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

describe('#264 item F1 — exitCompletion fail-safe (registry mechanism, #264 review-264j)', () => {
  it('forgotten part + animated + programmatic close closes instantly, no leftovers', () => {
    const host = mountAccordion('f1-forgotten', false)
    app?.send({ type: 'accordion', msg: { type: 'close', value: 'details' } })
    const el = content(host)
    expect(el.dataset.state).toBe('closed')
    expect(el.hidden).toBe(true)
    expect(el.getAttribute('aria-hidden')).toBe('true')
    expect(el.hasAttribute('inert')).toBe(true)
  })

  it('DEV warning fires exactly once per id, from a real click, when exitCompletion was never placed', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = mountAccordion('f1-warn-once', false)
    click(trigger(host)) // open -> closed (no retention, no part placed)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain('exitCompletion')
    // Throttled per id: reopening and closing again does not warn again.
    click(trigger(host))
    click(trigger(host))
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it("no DEV warning fires for a purely programmatic send bypassing connect()'s own handlers (documented scope)", () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mountAccordion('f1-no-warn-programmatic', false)
    app?.send({ type: 'accordion', msg: { type: 'close', value: 'details' } })
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('parts.close() IS an animated-aware programmatic close: it stamps retain from the registry', () => {
    const id = 'f1-parts-close'
    const host = document.createElement('div')
    document.body.append(host)
    let closeFn: ((value: string) => void) | null = null
    app = mountApp(host, {
      name: 'PartsCloseFixture',
      init: () => [
        {
          accordion: accordion.init({ items: ['details'], value: ['details'], animated: true }),
          placeExitCompletion: true,
        },
        [],
      ],
      update: (state: AccState, msg: AccMsg) => {
        if (msg.type === 'setPlaceExitCompletion')
          return [{ ...state, placeExitCompletion: msg.value }, []]
        return [{ ...state, accordion: accordion.update(state.accordion, msg.msg)[0] }, []]
      },
      view: ({ state, send }): readonly Mountable[] => {
        const acc = accordion.connect(
          state.at('accordion'),
          (msg) => send({ type: 'accordion', msg }),
          { id },
        )
        closeFn = acc.close
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
    })
    closeFn!('details')
    expect(content(host).dataset.state).toBe('closing')
  })

  it('a placed exitCompletion runs the full four-phase lifecycle: closed -> open -> closing -> closed', () => {
    const host = mountAccordion('f1-lifecycle', true)
    const el = content(host)
    expect(el.dataset.state).toBe('open')

    // jsdom has no real Web Animations support at all (`getAnimations` is
    // `undefined`), so neither the click's own synchronous safety net nor
    // `exitCompletion`'s reactive `check()` can tell "no motion" from
    // "unknown" and correctly decline to settle — exactly the faithful
    // jsdom shape of a skin that DOES run a real (CSS) exit animation.
    click(trigger(host)) // open -> closing (retained: watcher attached)
    expect(el.dataset.state).toBe('closing')

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

  it('detaching exitCompletion mid-closing settles it (registry count -> 0, cleanup settles), HOST staying mounted throughout', () => {
    const host = mountAccordion('f1-detach-settles', true)
    click(trigger(host))
    expect(content(host).dataset.state).toBe('closing')

    // Remove ONLY `exitCompletion` from the view via `show()` — the
    // accordion root/trigger/content stay mounted the whole time.
    app?.send({ type: 'setPlaceExitCompletion', value: false })

    const el = content(host)
    expect(el.dataset.state).toBe('closed')
    expect(el.hidden).toBe(true)
    expect(el.getAttribute('aria-hidden')).toBe('true')
    expect(el.hasAttribute('inert')).toBe(true)
    expect(host.isConnected).toBe(true)
    click(trigger(host))
    expect(el.dataset.state).toBe('open')
  })

  describe('restored snapshot cases (P1-P4, #264 review-264j — a snapshot bypassing init() carries NOTHING watcher-related, by construction)', () => {
    it('P1: restored snapshot WITHOUT the part placed, programmatic close closes instantly', () => {
      const id = 'p1-restored-no-part'
      const restored: accordion.AccordionState = {
        ...accordion.init({ items: ['details'], value: ['details'], animated: true }),
      }
      const host = document.createElement('div')
      document.body.append(host)
      app = mountApp(
        host,
        accordionDef(id, false, () => restored),
      )
      app.send({ type: 'accordion', msg: { type: 'close', value: 'details' } })
      const el = content(host)
      expect(el.dataset.state).toBe('closed')
      expect(el.hasAttribute('inert')).toBe(true)
    })

    it('P2: restored snapshot ALREADY mid-close, part NOT placed — stays closing (documented LOW), a later toggle still recovers cleanly', () => {
      // A restored slice with an item already in `closing` (e.g. a snapshot
      // taken mid-exit) and no `exitCompletion` ever mounted this session
      // has no watcher to settle it reactively — this is the accepted,
      // documented residual (#264 review-264j): unlike the fully-open/
      // fully-closed cases, there is no MESSAGE that "arrives on its own"
      // for an already-closing item, so it persists until the next real
      // interaction. It never HANGS the component irrecoverably, though —
      // toggling the SAME item is a real reducer transition that resolves
      // it via the ordinary `withValue`/`retainedExits` path.
      const id = 'p2-restored-mid-close-no-part'
      const restored: accordion.AccordionState = {
        ...accordion.init({ items: ['details'], value: [], animated: true }),
        closing: ['details'],
        exitGenerations: [{ value: 'details', generation: 1 }],
        exitSequence: 1,
      }
      const host = document.createElement('div')
      document.body.append(host)
      app = mountApp(
        host,
        accordionDef(id, false, () => restored),
      )
      expect(content(host).dataset.state).toBe('closing')
      // Re-opening it is a real transition and resolves the stale entry.
      click(trigger(host))
      expect(content(host).dataset.state).toBe('open')
    })

    it('P3: restored snapshot ALREADY mid-close, part IS placed — detaching it settles the stale entry through the ordinary cleanup path', () => {
      const id = 'p3-restored-mid-close-with-part'
      const restored: accordion.AccordionState = {
        ...accordion.init({ items: ['details'], value: [], animated: true }),
        closing: ['details'],
        exitGenerations: [{ value: 'details', generation: 1 }],
        exitSequence: 1,
      }
      const host = document.createElement('div')
      document.body.append(host)
      app = mountApp(
        host,
        accordionDef(id, true, () => restored),
      )
      expect(content(host).dataset.state).toBe('closing')
      // Detaching the ONLY watcher for this id settles every still-closing
      // entry unconditionally, through the ordinary `exitComplete` message —
      // no dedicated "detach" message exists to do this instead.
      app.send({ type: 'setPlaceExitCompletion', value: false })
      expect(content(host).dataset.state).toBe('closed')
    })

    it('P4: restored (no part), later placing then unplacing the part settles/re-settles correctly in sequence', () => {
      const id = 'p4-restored-place-unplace'
      const restored: accordion.AccordionState = {
        ...accordion.init({ items: ['details'], value: ['details'], animated: true }),
      }
      const host = document.createElement('div')
      document.body.append(host)
      app = mountApp(
        host,
        accordionDef(id, false, () => restored),
      )
      app.send({ type: 'accordion', msg: { type: 'close', value: 'details' } })
      const s1 = content(host).dataset.state
      app.send({ type: 'setPlaceExitCompletion', value: true }) // real attach now
      const s2 = content(host).dataset.state
      app.send({ type: 'setPlaceExitCompletion', value: false }) // real detach: settles
      expect([s1, s2, content(host).dataset.state]).toEqual(['closed', 'closed', 'closed'])
    })
  })

  it('same-send two-connect() calls sharing one id share ONE registry count', () => {
    const id = 'same-send-two-connect'
    interface TwoConnectState {
      accordion: accordion.AccordionState
      placeA: boolean
      placeB: boolean
    }
    type TwoConnectMsg =
      | { type: 'accordion'; msg: accordion.AccordionMsg }
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
        return [{ ...state, accordion: accordion.update(state.accordion, msg.msg)[0] }, []]
      },
      view: ({ state, send }): readonly Mountable[] => {
        const dispatch = (msg: accordion.AccordionMsg): void => send({ type: 'accordion', msg })
        // TWO independent connect() calls, SAME id, SAME `send` reference.
        const accA = accordion.connect(state.at('accordion'), dispatch, { id })
        const accB = accordion.connect(state.at('accordion'), dispatch, { id })
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

  it('INLINE wrappers: two connect() calls, each with its OWN inline dispatcher closure, still share one registry count by ID', () => {
    const id = 'inline-two-wrapper'
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
        return [{ ...state, accordion: accordion.update(state.accordion, msg.msg)[0] }, []]
      },
      view: ({ state, send }): readonly Mountable[] => {
        // Two DISTINCT inline wrappers — no shared `dispatch` const, unlike
        // the previous test. The registry is keyed purely by `id`, so this
        // has NOTHING to break, unlike the review-264h design it replaced.
        const accA = accordion.connect(
          state.at('accordion'),
          (msg) => send({ type: 'accordion', msg }),
          { id },
        )
        const accB = accordion.connect(
          state.at('accordion'),
          (msg) => send({ type: 'accordion', msg }),
          { id },
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
    // Only A's exitCompletion is placed; B's never mounts at all.
    click(trigger(host))
    expect(content(host).dataset.state).toBe('closing')
    app?.send({ type: 'setPlaceB', value: true })
    app?.send({ type: 'setPlaceA', value: false })
    expect(content(host).dataset.state).toBe('closing') // B still mounted
    app?.send({ type: 'setPlaceB', value: false })
    expect(content(host).dataset.state).toBe('closed')
  })

  it('show/branch re-running connect() on remount does not drift the registry count', () => {
    const id = 'show-branch-re-run'
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
              {
                id,
              },
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

    click(trigger(host)) // reopen so the remount starts clean
    app?.send({ type: 'setShowAccordion', value: false }) // unmounts: detaches
    app?.send({ type: 'setShowAccordion', value: true }) // remounts: re-attaches (fresh connect())

    click(trigger(host))
    expect(content(host).dataset.state).toBe('closing')
    const el = content(host)
    el.dispatchEvent(animationEvent('animationstart', 'exit'))
    el.dispatchEvent(animationEvent('animationend', 'exit'))
    expect(content(host).dataset.state).toBe('closed')
  })

  it('placing exitCompletion TWICE tracks correctly: one detaching does not drop retention while the other stays mounted', () => {
    const id = 'double-placement'
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
          | { type: 'accordion'; msg: accordion.AccordionMsg }
          | { type: 'setPlaceFirst'; value: boolean }
          | { type: 'setPlaceSecond'; value: boolean },
      ) => {
        if (msg.type === 'setPlaceFirst') return [{ ...state, placeFirst: msg.value }, []]
        if (msg.type === 'setPlaceSecond') return [{ ...state, placeSecond: msg.value }, []]
        return [{ ...state, accordion: accordion.update(state.accordion, msg.msg)[0] }, []]
      },
      view: ({ state, send }): readonly Mountable[] => {
        const acc = accordion.connect(
          state.at('accordion'),
          (msg) => send({ type: 'accordion', msg }),
          {
            id,
          },
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

    app?.send({ type: 'setPlaceFirst', value: false })
    expect(content(host).dataset.state).toBe('closing')

    app?.send({ type: 'setPlaceSecond', value: false })
    expect(content(host).dataset.state).toBe('closed')
  })

  it('no DEV warning fires when exitCompletion is placed correctly', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = mountAccordion('f1-no-warn-placed', true)
    click(trigger(host))
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('starts no timer of any kind (no fake timer to advance) during a forgotten-part close', () => {
    vi.useFakeTimers()
    try {
      const before = vi.getTimerCount()
      const host = mountAccordion('f1-no-timers', false)
      app?.send({ type: 'accordion', msg: { type: 'close', value: 'details' } })
      expect(vi.getTimerCount()).toBe(before)
      expect(content(host).dataset.state).toBe('closed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('is SSR/hydration-safe: server never touches the registry, init is deterministic, and a real hydrate + interaction both work', () => {
    const id = 'f1-ssr-hydrate'
    const serverState: AccState = {
      accordion: accordion.init({ items: ['details'], value: ['details'], animated: true }),
      placeExitCompletion: true,
    }
    // SSR never runs onMount, so nothing in the registry is ever touched
    // server-side — no `closing` state can hang there because nothing
    // server-side ever retains at all (retain is never stamped without a
    // real click).
    expect(serverState.accordion.closing).toEqual([])

    const def = accordionDef(id, true)
    const container = document.createElement('div')
    document.body.append(container)
    container.innerHTML = renderToString(def, serverState, document)
    expect(content(container).dataset.state).toBe('open')

    // Actually HYDRATE over the server HTML — `hydrateSignalApp` builds the
    // client tree and swaps it in atomically, so every element reference
    // must be re-queried AFTER this call.
    app = hydrateSignalApp(container, def, serverState)

    // Post-hydration, the exitCompletion mount has run and attached this
    // id for real — a real click now retains through `closing` rather than
    // closing instantly.
    click(trigger(container))
    expect(content(container).dataset.state).toBe('closing')
    const el = content(container)
    el.dispatchEvent(animationEvent('animationstart', 'exit'))
    el.dispatchEvent(animationEvent('animationend', 'exit'))
    expect(content(container).dataset.state).toBe('closed')

    container.remove()
  })
})

describe('#264 item F1 — collapsible exitCompletion fail-safe (mounted, registry mechanism)', () => {
  interface ColState {
    collapsible: collapsible.CollapsibleState
    placeExitCompletion: boolean
  }
  type ColMsg =
    | { type: 'collapsible'; msg: collapsible.CollapsibleMsg }
    | { type: 'setPlaceExitCompletion'; value: boolean }

  function mountCollapsible(id: string, placeExitCompletion: boolean): HTMLElement {
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
            { id },
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
    const host = mountCollapsible('col-forgotten', false)
    app?.send({ type: 'collapsible', msg: { type: 'close' } })
    const el = colContent(host)
    expect(el.dataset.state).toBe('closed')
    expect(el.hidden).toBe(true)
    expect(el.getAttribute('aria-hidden')).toBe('true')
    expect(el.hasAttribute('inert')).toBe(true)
  })

  it('DEV warning fires exactly once per id, from a real click, when exitCompletion was never placed', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = mountCollapsible('col-warn-once', false)
    click(colTrigger(host))
    expect(warnSpy).toHaveBeenCalledTimes(1)
    click(colTrigger(host))
    click(colTrigger(host))
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('parts.close() stamps retain from the registry for collapsible too', () => {
    const id = 'col-parts-close'
    const host = document.createElement('div')
    document.body.append(host)
    let closeFn: (() => void) | null = null
    app = mountApp(
      host,
      component<ColState, ColMsg>({
        name: 'CollapsiblePartsCloseFixture',
        init: () => [
          {
            collapsible: collapsible.init({ open: true, animated: true }),
            placeExitCompletion: true,
          },
          [],
        ],
        update: (state, msg) => {
          if (msg.type === 'setPlaceExitCompletion')
            return [{ ...state, placeExitCompletion: msg.value }, []]
          return [{ ...state, collapsible: collapsible.update(state.collapsible, msg.msg)[0] }, []]
        },
        view: ({ state, send }): readonly Mountable[] => {
          const c = collapsible.connect(
            state.at('collapsible'),
            (msg) => send({ type: 'collapsible', msg }),
            { id },
          )
          closeFn = c.close
          return [
            div({ ...c.root }, [
              div({ ...c.trigger }, [text('trigger')]),
              div({ ...c.content }, [text('content')]),
            ]),
            c.exitCompletion,
          ]
        },
      }),
    )
    closeFn!()
    expect(colContent(host).dataset.state).toBe('closing')
  })

  it('detaching exitCompletion mid-closing settles it (registry -> 0, cleanup settles), HOST staying mounted throughout', () => {
    const host = mountCollapsible('col-detach-settles', true)
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
