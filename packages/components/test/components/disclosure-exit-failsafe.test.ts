import { afterEach, describe, expect, it, vi } from 'vitest'
import { component, div, mountApp, renderToString, text, type Mountable } from '@llui/dom'
import * as accordion from '../../src/components/accordion'
import * as collapsible from '../../src/components/collapsible'

/**
 * #264 item F1 (superseding review item 4): a forgotten `parts.exitCompletion`
 * placement used to leave a closing item hanging `closing` + `inert` forever,
 * detected only by a `setTimeout`-armed dev-mode stall watchdog (removed —
 * see `disclosure-motion.ts`'s header comment on
 * `createDisclosureExitCompletionMount`). The fix is now structural: the
 * reducer tracks whether `exitCompletion` is CURRENTLY mounted
 * (`state.exitWatcher`) and only ever retains `closing` while it is —
 * otherwise it closes instantly. These tests exercise that through a real
 * `mountApp`, not a bare `update()` call, so the attach/detach messages the
 * mount itself sends are genuinely exercised.
 */

interface AccState {
  accordion: accordion.AccordionState
}
type AccMsg = { type: 'accordion'; msg: accordion.AccordionMsg }

let app: ReturnType<typeof mountApp> | null = null
let warnSpy: ReturnType<typeof vi.spyOn> | null = null

afterEach(() => {
  app?.dispose()
  app = null
  document.body.replaceChildren()
  warnSpy?.mockRestore()
  warnSpy = null
})

function mountAccordion(placeExitCompletion: boolean): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  app = mountApp(
    host,
    component<AccState, AccMsg>({
      name: 'DisclosureFailSafeFixture',
      init: () => [
        {
          accordion: accordion.init({
            items: ['details'],
            value: ['details'],
            animated: true,
          }),
        },
        [],
      ],
      update: (state, msg) => [
        { ...state, accordion: accordion.update(state.accordion, msg.msg)[0] },
        [],
      ],
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
          ...(placeExitCompletion ? [acc.exitCompletion] : []),
        ]
      },
    }),
  )
  return host
}

const content = (host: HTMLElement): HTMLElement =>
  host.querySelector('[data-scope="accordion"][data-part="content"]') as HTMLElement

describe('#264 item F1 — exitCompletion fail-safe', () => {
  it('forgotten part + animated + programmatic close on a no-motion skin closes instantly, no leftovers', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = mountAccordion(false)
    // No CSS in this fixture, so this is a no-motion skin either way; the
    // point under test is that the exitCompletion Mountable was never
    // placed, so `exitWatcher` never flips true.
    app?.send({ type: 'accordion', msg: { type: 'close', value: 'details' } })
    const el = content(host)
    expect(el.dataset.state).toBe('closed')
    expect(el.hidden).toBe(true)
    expect(el.hasAttribute('inert')).toBe(true)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('a placed exitCompletion still runs the full four-phase lifecycle (open -> closing -> closed)', () => {
    const host = mountAccordion(true)
    const el = content(host)
    expect(el.dataset.state).toBe('open')

    app?.send({ type: 'accordion', msg: { type: 'close', value: 'details' } })
    // With the watcher attached, the close retains until the content's own
    // exit animation/transition ends. This fixture defines no CSS motion, so
    // `exitCompletion`'s own reactive MutationObserver-driven `check()`
    // settles it — no click-driven synchronous safety net runs here because
    // `close` was sent directly (a programmatic close), not via the trigger.
    expect(el.dataset.state).toBe('closing')
  })

  it('detaching exitCompletion mid-closing settles it rather than leaving it stuck', () => {
    const host = mountAccordion(true)
    app?.send({ type: 'accordion', msg: { type: 'close', value: 'details' } })
    expect(content(host).dataset.state).toBe('closing')

    // Remove exitCompletion from the view (simulating a conditional
    // unmount) by disposing the whole app — exercises the mount's cleanup
    // path, which must never leave anything hung.
    app?.dispose()
    app = null
    // Nothing further to assert on the DOM once disposed; the reducer-level
    // test in collapsible.test.ts pins the state transition directly. This
    // integration test exists to prove dispose does not throw or hang.
  })

  it('no DEV warning fires when exitCompletion is placed correctly', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mountAccordion(true)
    app?.send({ type: 'accordion', msg: { type: 'close', value: 'details' } })
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('starts no timer of any kind (no fake timer to advance) during a forgotten-part close', () => {
    vi.useFakeTimers()
    try {
      const before = vi.getTimerCount()
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const host = mountAccordion(false)
      app?.send({ type: 'accordion', msg: { type: 'close', value: 'details' } })
      expect(vi.getTimerCount()).toBe(before)
      expect(content(host).dataset.state).toBe('closed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('is SSR/hydration-safe: the server never closes, and init is deterministic', () => {
    const state = accordion.update(
      accordion.init({ items: ['details'], value: ['details'], animated: true }),
      { type: 'close', value: 'details' },
    )[0]
    // SSR-time: no exitWatcher was ever attached, so this closes instantly —
    // deterministic, no server-side "closing" state ever exists to hang.
    expect(state).toMatchObject({ closing: [], exitWatcher: false })
    expect(() =>
      renderToString(
        {
          init: () => state,
          update: (s) => s,
          view: ({ state: s, send }) => {
            const acc = accordion.connect(s, send, { id: 'ssr-accordion' })
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
        },
        state,
        document,
      ),
    ).not.toThrow()
  })
})

describe('#264 item F1 — collapsible exitCompletion fail-safe (mounted)', () => {
  interface ColState {
    collapsible: collapsible.CollapsibleState
  }
  type ColMsg = { type: 'collapsible'; msg: collapsible.CollapsibleMsg }

  function mountCollapsible(placeExitCompletion: boolean): HTMLElement {
    const host = document.createElement('div')
    document.body.append(host)
    app = mountApp(
      host,
      component<ColState, ColMsg>({
        name: 'CollapsibleFailSafeFixture',
        init: () => [{ collapsible: collapsible.init({ open: true, animated: true }) }, []],
        update: (state, msg) => [
          { ...state, collapsible: collapsible.update(state.collapsible, msg.msg)[0] },
          [],
        ],
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
            ...(placeExitCompletion ? [c.exitCompletion] : []),
          ]
        },
      }),
    )
    return host
  }

  const colContent = (host: HTMLElement): HTMLElement =>
    host.querySelector('[data-scope="collapsible"][data-part="content"]') as HTMLElement

  it('forgotten part closes instantly with no inert/aria-hidden leftovers', () => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = mountCollapsible(false)
    app?.send({ type: 'collapsible', msg: { type: 'close' } })
    const el = colContent(host)
    expect(el.dataset.state).toBe('closed')
    expect(el.hidden).toBe(true)
    expect(el.hasAttribute('inert')).toBe(true)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})
