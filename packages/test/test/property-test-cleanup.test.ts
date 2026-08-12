import { describe, it, expect, afterEach, vi } from 'vitest'
import { propertyTest } from '../src/property-test'
import { component, div, text, mountApp } from '@llui/dom'

// Captured ONCE, before any test runs, so the identity assertions below compare
// against the functions that were installed before the harness ever ran — a
// comparison the harness cannot make true by accident. A bare `setTimeout`
// reference read *after* a run IS `globalThis.setTimeout` read at the same
// instant, so asserting one against the other proves nothing at all.
const REAL_CONSOLE_ERROR = console.error
const REAL_SET_TIMEOUT = globalThis.setTimeout
const REAL_CLEAR_TIMEOUT = globalThis.clearTimeout
const REAL_SET_INTERVAL = globalThis.setInterval
const REAL_CLEAR_INTERVAL = globalThis.clearInterval

afterEach(() => {
  console.error = REAL_CONSOLE_ERROR
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** All four scheduling globals are the functions this file loaded with. */
function expectRealTimerGlobals(): void {
  expect(globalThis.setTimeout).toBe(REAL_SET_TIMEOUT)
  expect(globalThis.clearTimeout).toBe(REAL_CLEAR_TIMEOUT)
  expect(globalThis.setInterval).toBe(REAL_SET_INTERVAL)
  expect(globalThis.clearInterval).toBe(REAL_CLEAR_INTERVAL)
}

describe('propertyTest mount-mode cleanup', () => {
  it('restores the ORIGINAL console.error and timer globals when the view throws during build', () => {
    const Boom = component<{ n: number }, { type: 'tick' }, never>({
      name: 'BuildBoom',
      init: () => [{ n: 0 }, []],
      update: (s) => [{ n: s.n + 1 }, []],
      view: () => {
        throw new Error('view exploded during build')
      },
    })

    expect(() =>
      propertyTest(Boom, {
        invariants: [() => true],
        messageGenerators: { tick: () => ({ type: 'tick' as const }) },
        runs: 1,
        maxSequenceLength: 3,
        seed: 1,
        mount: {},
      }),
    ).toThrow(/view exploded during build/)

    // Identity, not behaviour: a collector left installed still "works" as a
    // function, it just swallows every later test's error output.
    expect(console.error).toBe(REAL_CONSOLE_ERROR)
    // The #69 shape for the timer patch: a throw straight out of the harness must
    // still put all four scheduling globals back.
    expectRealTimerGlobals()
  })

  it('disposes the handle when a commit throws mid-run', () => {
    let aborted = 0
    const Boom = component<{ n: number }, { type: 'tick' }, { type: 'watch' }>({
      name: 'CommitBoom',
      init: () => [{ n: 0 }, [{ type: 'watch' as const }]],
      update: (s) => [{ n: s.n + 1 }, []],
      view: ({ state }) => [
        div([
          text(
            state.map((s) => {
              if (s.n > 0) throw new Error('accessor exploded on commit')
              return String(s.n)
            }),
          ),
        ]),
      ],
      onEffect: (_effect, api) => {
        api.signal.addEventListener('abort', () => {
          aborted++
        })
      },
    })

    expect(() =>
      propertyTest(Boom, {
        invariants: [() => true],
        messageGenerators: { tick: () => ({ type: 'tick' as const }) },
        runs: 1,
        maxSequenceLength: 3,
        seed: 1,
        mount: {},
      }),
    ).toThrow(/commit threw/)

    // dispose() aborts the mount's lifecycle signal — proof the finally ran on
    // the failure path (and on every shrink replay, hence >= 1).
    expect(aborted).toBeGreaterThan(0)
    expect(console.error).toBe(REAL_CONSOLE_ERROR)
    expectRealTimerGlobals()
  })

  it('patches the scheduling globals for the run and restores them afterwards', () => {
    // The restore assertion is only worth anything if the globals were actually
    // replaced while the run was in flight, so this test proves BOTH halves: the
    // component observes wrappers from inside `onEffect`, and the file's
    // load-time originals are back once `propertyTest` returns.
    let sawWrappedSetTimeout = false
    let sawWrappedSetInterval = false
    const Observer = component<{ n: number }, { type: 'tick' }, { type: 'look' }>({
      name: 'GlobalObserver',
      init: () => [{ n: 0 }, [{ type: 'look' as const }]],
      update: (s) => [{ n: s.n + 1 }, []],
      view: ({ state }) => [div([text(state.map((s) => String(s.n)))])],
      onEffect: () => {
        if (globalThis.setTimeout !== REAL_SET_TIMEOUT) sawWrappedSetTimeout = true
        if (globalThis.setInterval !== REAL_SET_INTERVAL) sawWrappedSetInterval = true
      },
    })

    propertyTest(Observer, {
      invariants: [(s) => s.n >= 0],
      messageGenerators: { tick: () => ({ type: 'tick' as const }) },
      runs: 2,
      maxSequenceLength: 3,
      seed: 5,
      mount: { leaks: 'error' },
    })

    expect(sawWrappedSetTimeout).toBe(true)
    expect(sawWrappedSetInterval).toBe(true)
    expectRealTimerGlobals()
    expect(console.error).toBe(REAL_CONSOLE_ERROR)
  })

  it('restores whatever clock was installed on the way in, including a fake one', () => {
    vi.useFakeTimers()
    const fakeSetTimeout = globalThis.setTimeout
    const fakeClearTimeout = globalThis.clearTimeout
    const fakeSetInterval = globalThis.setInterval
    const fakeClearInterval = globalThis.clearInterval
    expect(fakeSetTimeout).not.toBe(REAL_SET_TIMEOUT)

    const Counter = component<{ n: number }, { type: 'tick' }, never>({
      name: 'FakeClockCounter',
      init: () => [{ n: 0 }, []],
      update: (s) => [{ n: s.n + 1 }, []],
      view: ({ state }) => [div([text(state.map((s) => String(s.n)))])],
    })

    propertyTest(Counter, {
      invariants: [(s) => s.n >= 0],
      messageGenerators: { tick: () => ({ type: 'tick' as const }) },
      runs: 2,
      maxSequenceLength: 3,
      seed: 11,
      mount: { leaks: 'error' },
    })

    expect(globalThis.setTimeout).toBe(fakeSetTimeout)
    expect(globalThis.clearTimeout).toBe(fakeClearTimeout)
    expect(globalThis.setInterval).toBe(fakeSetInterval)
    expect(globalThis.clearInterval).toBe(fakeClearInterval)
  })

  it("reports a timer left pending at dispose under leaks: 'error'", () => {
    vi.useFakeTimers()
    const Leaky = component<{ n: number }, { type: 'tick' }, { type: 'later' }>({
      name: 'LeakyTimer',
      init: () => [{ n: 0 }, [{ type: 'later' as const }]],
      update: (s) => [{ n: s.n + 1 }, []],
      view: ({ state }) => [div([text(state.map((s) => String(s.n)))])],
      onEffect: () => {
        // Never cleared and not tied to the mount lifecycle: outlives dispose().
        setTimeout(() => {}, 1000)
      },
    })

    let message = ''
    try {
      propertyTest(Leaky, {
        invariants: [() => true],
        messageGenerators: { tick: () => ({ type: 'tick' as const }) },
        runs: 1,
        maxSequenceLength: 2,
        seed: 1,
        mount: { leaks: 'error' },
      })
    } catch (e) {
      message = (e as Error).message
    }

    expect(message).toContain('pending timer')
    expect(message).toContain('setTimeout')
  })

  it("reports an interval left running at dispose under leaks: 'error'", () => {
    vi.useFakeTimers()
    const Ticker = component<{ n: number }, { type: 'tick' }, { type: 'start' }>({
      name: 'LeakyInterval',
      init: () => [{ n: 0 }, [{ type: 'start' as const }]],
      update: (s) => [{ n: s.n + 1 }, []],
      view: ({ state }) => [div([text(state.map((s) => String(s.n)))])],
      onEffect: () => {
        setInterval(() => {}, 50)
      },
    })

    let message = ''
    try {
      propertyTest(Ticker, {
        invariants: [() => true],
        messageGenerators: { tick: () => ({ type: 'tick' as const }) },
        runs: 1,
        maxSequenceLength: 2,
        seed: 1,
        mount: { leaks: 'error' },
      })
    } catch (e) {
      message = (e as Error).message
    }

    expect(message).toContain('pending timer')
    expect(message).toContain('setInterval')
  })

  it('does not report a leak when the component clears its timer on dispose', () => {
    vi.useFakeTimers()
    const Tidy = component<{ n: number }, { type: 'tick' }, { type: 'later' }>({
      name: 'TidyTimer',
      init: () => [{ n: 0 }, [{ type: 'later' as const }]],
      update: (s) => [{ n: s.n + 1 }, []],
      view: ({ state }) => [div([text(state.map((s) => String(s.n)))])],
      onEffect: (_effect, api) => {
        const id = setTimeout(() => {}, 1000)
        api.signal.addEventListener('abort', () => clearTimeout(id))
      },
    })

    // Must not throw: the timer is cleared by dispose(), so nothing is pending.
    propertyTest(Tidy, {
      invariants: [() => true],
      messageGenerators: { tick: () => ({ type: 'tick' as const }) },
      runs: 3,
      maxSequenceLength: 4,
      seed: 7,
      mount: { leaks: 'error' },
    })

    expect(console.error).toBe(REAL_CONSOLE_ERROR)
  })

  it('only WARNS about a pending timer by default, so a library timer cannot break a suite', () => {
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // The shape @llui/effects' own `debounce` runner schedules: a one-shot that
    // checks `api.signal.aborted` when it fires instead of clearing on abort. It
    // cannot dispatch into a disposed handle, so it is not a defect — but it IS
    // armed at dispose(), and the author cannot fix a timer that lives inside a
    // library. Failing on it would be a silent breaking change for every consumer
    // that debounces.
    const Debouncing = component<{ n: number }, { type: 'tick' }, { type: 'debounced' }>({
      name: 'DebouncingSearch',
      init: () => [{ n: 0 }, [{ type: 'debounced' as const }]],
      update: (s) => [{ n: s.n + 1 }, [{ type: 'debounced' as const }]],
      view: ({ state }) => [div([text(state.map((s) => String(s.n)))])],
      onEffect: (_effect, api) => {
        setTimeout(() => {
          if (api.signal.aborted) return
        }, 300)
      },
    })

    // No `leaks` key: the default must not fail the run.
    propertyTest(Debouncing, {
      invariants: [(s) => s.n >= 0],
      messageGenerators: { tick: () => ({ type: 'tick' as const }) },
      runs: 4,
      maxSequenceLength: 3,
      seed: 13,
      mount: {},
    })

    // Reported once for the whole call, not once per run — a `runs: 1000` suite
    // must not drown in identical warnings.
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('pending timer')
  })

  it("leaks: 'off' neither fails nor warns, and leaves the scheduling globals alone", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let sawUntouchedGlobals = false
    const Leaky = component<{ n: number }, { type: 'tick' }, { type: 'later' }>({
      name: 'OptedOutTimer',
      init: () => [{ n: 0 }, [{ type: 'later' as const }]],
      update: (s) => [{ n: s.n + 1 }, []],
      view: ({ state }) => [div([text(state.map((s) => String(s.n)))])],
      onEffect: () => {
        sawUntouchedGlobals =
          globalThis.setTimeout === REAL_SET_TIMEOUT &&
          globalThis.setInterval === REAL_SET_INTERVAL &&
          globalThis.clearTimeout === REAL_CLEAR_TIMEOUT &&
          globalThis.clearInterval === REAL_CLEAR_INTERVAL
        const id = setTimeout(() => {}, 1000)
        clearTimeout(id)
      },
    })

    propertyTest(Leaky, {
      invariants: [() => true],
      messageGenerators: { tick: () => ({ type: 'tick' as const }) },
      runs: 2,
      maxSequenceLength: 2,
      seed: 1,
      mount: { leaks: 'off' },
    })

    // Opting out means the harness installs no wrappers at all: no per-timer stack
    // capture, and four fewer globals patched.
    expect(sawUntouchedGlobals).toBe(true)
    expect(warn).not.toHaveBeenCalled()
    expectRealTimerGlobals()
  })

  it('names the leaking effect in the report rather than the harness frames', () => {
    vi.useFakeTimers()
    const Leaky = component<{ n: number }, { type: 'tick' }, { type: 'later' }>({
      name: 'NamedLeak',
      init: () => [{ n: 0 }, [{ type: 'later' as const }]],
      update: (s) => [{ n: s.n + 1 }, []],
      view: ({ state }) => [div([text(state.map((s) => String(s.n)))])],
      onEffect: function scheduleTheLeak() {
        setTimeout(() => {}, 1000)
      },
    })

    let message = ''
    try {
      propertyTest(Leaky, {
        invariants: [() => true],
        messageGenerators: { tick: () => ({ type: 'tick' as const }) },
        runs: 1,
        maxSequenceLength: 2,
        seed: 1,
        mount: { leaks: 'error' },
      })
    } catch (e) {
      message = (e as Error).message
    }

    expect(message).toContain('scheduleTheLeak')
    // The harness's own scheduling wrapper is dropped from the report — those
    // frames are noise that would push the effect's frame out of the top three.
    expect(message).not.toContain('src/property-test.ts')
  })
})

describe('mount lifecycle contract the harness relies on', () => {
  // AC4, asserted directly instead of through an unfalsifiable probe: after
  // `dispose()` the runtime drops the message, so NO public call can reach a
  // subscriber. A harness-side "was a listener notified after dispose?" flag can
  // therefore never be set — which is why the harness registers no probe at all.
  it('does not notify a subscriber after dispose()', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const Counter = component<{ n: number }, { type: 'tick' }, never>({
      name: 'SubscriberCounter',
      init: () => [{ n: 0 }, []],
      update: (s) => [{ n: s.n + 1 }, []],
      view: ({ state }) => [div([text(state.map((s) => String(s.n)))])],
    })

    const container = document.createElement('div')
    const handle = mountApp(container, Counter)
    const seen: number[] = []
    handle.subscribe((s) => seen.push(s.n))

    handle.send({ type: 'tick' })
    handle.flush()
    // Positive control: the probe DOES fire while the mount is live, so the
    // post-dispose assertion below is falsifiable rather than vacuously true.
    expect(seen).toEqual([1])

    handle.dispose()
    handle.send({ type: 'tick' })
    handle.flush()

    expect(seen).toEqual([1])
  })

  it('makes subscribe() after dispose() a no-op', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const Counter = component<{ n: number }, { type: 'tick' }, never>({
      name: 'LateSubscriber',
      init: () => [{ n: 0 }, []],
      update: (s) => [{ n: s.n + 1 }, []],
      view: ({ state }) => [div([text(state.map((s) => String(s.n)))])],
    })

    const container = document.createElement('div')
    const handle = mountApp(container, Counter)
    handle.dispose()

    let notified = 0
    const unsubscribe = handle.subscribe(() => {
      notified++
    })
    handle.send({ type: 'tick' })
    handle.flush()
    unsubscribe()

    expect(notified).toBe(0)
  })
})
