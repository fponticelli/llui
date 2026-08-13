// @vitest-environment jsdom
//
// A debounce that is still pending when its SCOPE goes away must clear its
// one-shot, not merely refuse to dispatch when it fires (issue #77). Two things
// go wrong when it does not, and neither is the one #77 was filed about — read
// the note above the last describe before trusting the issue text:
//
//  1. The scope signal is not always the MOUNT's. A debounce nested in `race`
//     or `cancel(token, inner)` is handed a derived signal that aborts when that
//     composite settles, and the chain's per-mount teardown does not run until
//     unmount — so the one-shot stayed armed for the rest of the component's
//     life, pinning its closure and the mount's registry entry.
//  2. A debounce is also retired by `cancel(key)` and by the NEXT keystroke
//     superseding it. Clearing the timer on those paths without dropping the
//     abort listener accumulates one listener per keystroke — the exact shape a
//     debounced input produces most.
//
// The five tests in the first describe pin that runner contract. The last one is
// a cross-package guard on the harness↔chain interaction, not a proof of the fix.

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { component, div, text } from '@llui/dom'
import { propertyTest } from '@llui/test'
import { createDispatch, type Deps, type InternalSend, type Registry } from '../src/core'
import { debounceRunner } from '../src/runners/debounce'
import { logRunner } from '../src/runners/log'
import { timeoutRunner } from '../src/runners/timeout'
import { asOnEffect, debounce, handleEffects, log, race, timeout, type Effect } from '../src/index'
import { trackAbortListeners } from './helpers/track-abort-listeners'

/**
 * A dispatch over just the runners these tests need, with the per-mount registry
 * held OPEN so the assertions can read it. Deliberately NOT `handleEffects()`:
 * that chain owns a registry-wide teardown listener of its own, which would mask
 * whether the debounce runner cleans up after itself.
 */
function makeDeps(): { deps: Deps; registry: Registry } {
  const registry: Registry = {
    cancelControllers: new Map(),
    debounces: new Map(),
    websockets: new Map(),
  }
  const deps: Deps = {
    registry,
    custom: () => {},
    plugins: [],
    dispatch: createDispatch([debounceRunner, logRunner, timeoutRunner]),
  }
  return { deps, registry }
}

describe('debounce() abort cleanup', () => {
  let send: Mock<InternalSend>
  let controller: AbortController

  beforeEach(() => {
    vi.useFakeTimers()
    send = vi.fn<InternalSend>()
    controller = new AbortController()
    // Several cases use `log()` as the inner effect purely because it is the
    // cheapest observable one — its output is noise here.
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('aborting the component signal clears the pending timer and drops the registry entry', () => {
    const { deps, registry } = makeDeps()
    deps.dispatch(
      debounce('search', 300, timeout(0, { type: 'searched' })),
      send,
      controller.signal,
      deps,
    )

    expect(registry.debounces.has('search')).toBe(true)
    expect(vi.getTimerCount()).toBe(1)

    controller.abort()

    expect(vi.getTimerCount()).toBe(0)
    expect(registry.debounces.has('search')).toBe(false)

    vi.advanceTimersByTime(1000)
    expect(send).not.toHaveBeenCalled()
  })

  it('a fired debounce leaves no abort listener behind on the component signal', () => {
    const { deps } = makeDeps()
    const listeners = trackAbortListeners(controller.signal)

    deps.dispatch(debounce('search', 300, log('searched')), send, controller.signal, deps)
    vi.advanceTimersByTime(300)

    // Registering nothing would satisfy `added == removed` vacuously, so pin that
    // the timer really did arm one and hand it back.
    expect(listeners.added).toHaveLength(1)
    expect(listeners.removed).toEqual(listeners.added)
  })

  it('a long-lived component does not accumulate one abort listener per debounce', () => {
    const { deps } = makeDeps()
    const listeners = trackAbortListeners(controller.signal)

    for (let i = 0; i < 10; i++) {
      deps.dispatch(debounce('search', 300, log(`search ${i}`)), send, controller.signal, deps)
      vi.advanceTimersByTime(300)
    }

    expect(listeners.added).toHaveLength(10)
    expect(listeners.removed).toEqual(listeners.added)
  })

  it('a superseding debounce on the same key clears the previous timer', () => {
    const { deps, registry } = makeDeps()
    deps.dispatch(debounce('search', 300, log('first')), send, controller.signal, deps)
    deps.dispatch(debounce('search', 300, log('second')), send, controller.signal, deps)

    expect(vi.getTimerCount()).toBe(1)
    expect(registry.debounces.size).toBe(1)

    controller.abort()
    expect(vi.getTimerCount()).toBe(0)
    expect(registry.debounces.size).toBe(0)
  })

  it('through the public chain, a debounce in a settled race is cleared at once', () => {
    // The chain's per-mount teardown only runs when the MOUNT aborts, so it
    // cannot cover this: the debounce is scoped to the race's derived signal,
    // which aborts the moment the race settles. Without the runner's own abort
    // listener the one-shot stays armed for the rest of the component's life.
    const handler = handleEffects<Effect, Record<string, unknown>>().else(() => {})
    handler({
      effect: race([timeout(0, { type: 'fast' }), debounce('search', 300, log('slow'))]),
      send,
      signal: controller.signal,
    })

    expect(vi.getTimerCount()).toBe(2)
    vi.advanceTimersByTime(0) // the timeout wins; the race aborts its inner scope
    expect(send).toHaveBeenCalledWith({ type: 'fast' })
    expect(vi.getTimerCount()).toBe(0)
  })
})

// ── The cross-package criterion (issue #77) — NOT a gate on the fix ──────────
//
// The canonical debounced search input, checked in mount mode with the leak
// sweep set to FAIL.
//
// #77 asserts this run used to report the debounce one-shot as a pending timer
// at `dispose()`. IT DID NOT, and the issue text is wrong on that point: the
// chain's per-mount teardown (`handle-effects.ts`, `registryFor`'s abort
// listener) has cleared every pending debounce at mount abort since 20d5ad8b,
// which predates the #69 review that spawned this issue. So this case passed
// before the fix and passes after it — delete the runner's
// `addEventListener('abort', …)` line and the five tests above go red while this
// one stays green. It earns its place as a FORWARD guard on the harness↔chain
// interaction (a future change to either could start reporting a debounce as a
// leak), not as evidence that anything here was ever broken. The proof of the
// fix is 'a debounce in a settled race is cleared at once', above.

type SearchState = { query: string; hits: number }
type SearchMsg = { type: 'type'; value: string } | { type: 'searched' }

/**
 * How many debounces the mounted component actually ran. A leak sweep that never
 * saw a debounce would pass for the wrong reason, so the test asserts on this.
 */
let debouncesRun = 0
const searchEffects = asOnEffect(handleEffects<Effect, SearchMsg>().else(() => {}))

const searchBox = component<SearchState, SearchMsg, Effect>({
  name: 'DebouncedSearchInput',
  init: () => [{ query: '', hits: 0 }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'type':
        return [
          { ...state, query: msg.value },
          // The inner effect never runs during a synchronous property run — the
          // debounce window does not elapse — so the test needs no network stub.
          [debounce('search', 300, timeout(0, { type: 'searched' as const }))],
        ]
      case 'searched':
        return [{ ...state, hits: state.hits + 1 }, []]
    }
  },
  view: ({ state }) => [
    div([text(state.map((s) => s.query))]),
    div([text(state.map((s) => String(s.hits)))]),
  ],
  onEffect: (effect, api) => {
    if (effect.type === 'debounce') debouncesRun++
    return searchEffects(effect, api)
  },
})

describe('a component that debounces', () => {
  it("passes propertyTest in mount mode under leaks: 'error'", () => {
    debouncesRun = 0
    let queryCounter = 0
    propertyTest(searchBox, {
      invariants: [(s) => typeof s.query === 'string' && s.hits >= 0],
      messageGenerators: {
        type: () => ({ type: 'type' as const, value: `q${queryCounter++}` }),
      },
      runs: 5,
      maxSequenceLength: 6,
      seed: 77,
      mount: { leaks: 'error' },
    })

    expect(debouncesRun).toBeGreaterThan(0)
  })
})
