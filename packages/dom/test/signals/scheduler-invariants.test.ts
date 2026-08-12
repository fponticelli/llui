import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountSignalComponent, type SignalComponentDef } from '../../src/signals/component'
import { el, signalText, signalShow, onMount } from '../../src/signals/dom'
import type { LluiDebugAPI } from '../../src/signals/devtools'

// The four commit-scheduler invariants that CLAUDE.md writes down as prose
// (issue #59), each pinned here to an executable scenario. Two of them had ZERO
// coverage before this file: the frame-flush commit path's guard, and `flush()`
// saving-and-restoring the guards rather than clearing them.
//
// Every test drives the PUBLIC handle only and asserts on observable ordering.
// That is deliberate: an earlier attempt at this suite paired each test with a
// mutant of `component.ts` matched by exact source text, and every one of those
// mutations stopped applying the moment the scheduler was refactored — a suite
// that silently tests nothing is worse than none. Black-box scenarios survive the
// refactor, and the mutations they must fail against were re-verified by hand
// against the current source (see the note on each invariant for the mutation).

function container(): HTMLElement {
  const c = document.createElement('div')
  document.body.appendChild(c)
  return c
}

function debugApi(): LluiDebugAPI {
  const debug = (globalThis as { __lluiDebug?: LluiDebugAPI }).__lluiDebug
  if (debug === undefined) {
    throw new Error('devtools are not installed — is import.meta.env.DEV off under vitest?')
  }
  return debug
}

beforeEach(() => {
  document.body.innerHTML = ''
})
afterEach(() => {
  delete (globalThis as { __lluiDebug?: LluiDebugAPI }).__lluiDebug
})

// ── invariant 1 — every commit path opens the reentrancy guard first ──
//
// The canonical trigger is a `blur` fired when a commit removes the focused node,
// which jsdom does NOT emit (removing `document.activeElement` fires neither blur
// nor focusout), so it cannot drive a test. The equivalent seam that runs user
// code synchronously INSIDE a commit is an `onMount` cleanup in a structural arm:
// tearing the arm down calls it from within `mount.update`, exactly where a blur
// handler would land, and a cleanup that dispatches ("my subscription closed →
// tell the app") is ordinary authoring rather than a contrivance.
//
// What the probe observes: with the guard set, the commit-time message is QUEUED
// and its reducer runs only after the in-flight commit has finished sweeping its
// bindings. Without it, the reentrant `send` starts a NESTED drain — reducer,
// reconcile and all — in the middle of that sweep, and the outer sweep then
// resumes against a state buffer two versions stale. `bind:a` is the probe
// binding evaluated during the FIRST commit; it can only land before the
// reentrant reducer if that commit ran to completion first.

interface ReentryState {
  open: boolean
  label: string
}
type ReentryMsg = { type: 'close' } | { type: 'cleanup-ping' }

/** `sendOnMount: true` adds a trailing `onMount` that dispatches `close` during
 * the build — the route that exercises the post-mount replay commit path. */
function reentryDef(
  log: string[],
  sendOnMount = false,
): SignalComponentDef<ReentryState, ReentryMsg> {
  return {
    name: 'ReentryProbe',
    init: () => ({ open: true, label: 'a' }),
    update: (s, m) => {
      log.push(`reduce:${m.type}`)
      return m.type === 'close' ? { ...s, open: false } : { ...s, label: 'pinged' }
    },
    view: ({ send }) => [
      signalShow({ produce: (s) => (s as ReentryState).open, deps: ['open'] }, () => [
        el('span', {}, [signalText(() => 'arm', [])]),
        onMount(() => () => {
          log.push('teardown')
          send({ type: 'cleanup-ping' })
        }),
      ]),
      // Depends on `open` as well as `label`, so it is NOT gated out of the commit
      // that closes the arm — the point is to observe the REST of that sweep. Its
      // produce logs the label it sees, so a value from a nested commit is
      // distinguishable from the first commit's.
      el('p', {}, [
        signalText(
          (s) => {
            const label = (s as ReentryState).label
            log.push(`bind:${label}`)
            return label
          },
          ['open', 'label'],
        ),
      ]),
      ...(sendOnMount
        ? [
            onMount(() => {
              send({ type: 'close' })
            }),
          ]
        : []),
    ],
  }
}

/** The invariant as an assertion over the probe log: the commit that provoked the
 * reentrant `send` finished sweeping its bindings BEFORE that message's reducer
 * ran — i.e. no nested drain happened mid-commit. */
function expectNoNestedDrain(log: readonly string[]): void {
  const teardown = log.indexOf('teardown')
  expect(
    teardown,
    'the arm teardown must have run (the scenario is wired up)',
  ).toBeGreaterThanOrEqual(0)
  // Everything is measured from the teardown: the bindings were also evaluated
  // once at build time, and that build-time `bind:a` is not the sweep in question.
  const firstCommitSweep = log.indexOf('bind:a', teardown)
  const reentrantReducer = log.indexOf('reduce:cleanup-ping', teardown)
  expect(reentrantReducer, 'the commit-time send must have been processed').toBeGreaterThan(
    teardown,
  )
  expect(
    firstCommitSweep,
    'the in-flight commit must finish its sweep (bind:a) — a nested drain moves state first',
  ).toBeGreaterThan(teardown)
  expect(
    reentrantReducer,
    'the reentrant reducer must run AFTER the in-flight commit, not inside it',
  ).toBeGreaterThan(firstCommitSweep)
}

describe('#59 invariant 1 — every commit path opens the reentrancy guard first', () => {
  // Mutation each of these must fail against: drop the guard from the commit
  // scope (`draining = true` in `withCommitScope`). Verified by hand: all four go
  // red, with `reduce:cleanup-ping` landing immediately after `teardown`.

  it('the send drain: a commit-time send is queued, not nested', () => {
    const log: string[] = []
    const h = mountSignalComponent<ReentryState, ReentryMsg>(container(), reentryDef(log))
    h.send({ type: 'close' })
    expectNoNestedDrain(log)
    h.dispose()
  })

  it('the frame flush (raf): a commit-time send is queued, not nested', () => {
    const log: string[] = []
    const h = mountSignalComponent<ReentryState, ReentryMsg>(container(), reentryDef(log), {
      scheduler: 'raf',
    })
    h.send({ type: 'close' }) // raf: schedules the commit, does not run it
    h.flush() // the frame-flush commit path
    expectNoNestedDrain(log)
    h.dispose()
  })

  it('the post-mount replay: a commit-time send is queued, not nested', () => {
    const log: string[] = []
    // The trailing onMount dispatches during the build, while `mount` is still
    // null; the replay after `mountSignal` returns is the commit path under test.
    const h = mountSignalComponent<ReentryState, ReentryMsg>(container(), reentryDef(log, true))
    expectNoNestedDrain(log)
    h.dispose()
  })

  it('the devtools state poke: a commit-time send is queued, not nested', () => {
    const log: string[] = []
    const h = mountSignalComponent<ReentryState, ReentryMsg>(container(), reentryDef(log))
    debugApi().restoreState({ open: false, label: 'a' })
    expectNoNestedDrain(log)
    h.dispose()
  })
})

// ── invariant 2 — flush() SAVES AND RESTORES the guards ──────────────
//
// `flush()` can be called from an `onEffect` that is itself running inside an
// active drain (raf mode). If the flush cleared the guards on exit instead of
// restoring them, the still-running outer drain would believe it is not draining,
// so the next `send` — from a LATER effect of the same message — would start a
// nested drain and run that message's reducer ahead of the effects still queued
// in the outer round.

type OrderMsg = { type: 'go' } | { type: 'from-effect' }
type OrderEffect = { type: 'flush' } | { type: 'send' } | { type: 'tail' }

describe('#59 invariant 2 — flush() saves and restores the guards', () => {
  // Mutation this must fail against: replace the scope's `finally` restore with
  // an unconditional `draining = false; flushing = false`. Verified by hand: the
  // log becomes […, 'effect:send', 'reduce:from-effect', 'effect:tail'] — the
  // nested drain the guard exists to prevent.

  it('a flush() from inside a drain leaves the outer drain draining', () => {
    const log: string[] = []
    let handle: { flush: () => void; send: (m: OrderMsg) => void } | null = null
    const h = mountSignalComponent<{ n: number }, OrderMsg, OrderEffect>(
      container(),
      {
        name: 'FlushOrder',
        init: () => ({ n: 0 }),
        update: (s, m) => {
          log.push(`reduce:${m.type}`)
          if (m.type === 'from-effect') return { n: s.n + 100 }
          return [{ n: s.n + 1 }, [{ type: 'flush' }, { type: 'send' }, { type: 'tail' }]]
        },
        view: () => [el('p', {}, [signalText((s) => String((s as { n: number }).n), ['n'])])],
        onEffect: (e) => {
          log.push(`effect:${e.type}`)
          if (e.type === 'flush') handle?.flush()
          if (e.type === 'send') handle?.send({ type: 'from-effect' })
        },
      },
      { scheduler: 'raf' },
    )
    handle = h
    h.send({ type: 'go' })

    expect(log).toEqual([
      'reduce:go',
      'effect:flush', //     re-enters the scheduler while the outer drain is live
      'effect:send', //      …and the message it sends must QUEUE behind…
      'effect:tail', //      …the rest of this round's effects…
      'reduce:from-effect', // …only then does the outer loop pick it up.
    ])
    h.dispose()
  })
})

// ── invariant 3 — the drain abandons its queue once disposed ─────────
//
// Observable form: messages already queued when a mid-drain `dispose()` lands are
// never reduced, and no effect of theirs fires. Two guards enforce it together —
// `dispose()` clears the queue and the drain loop re-checks `isDisposed()` — so
// this is stated as the BEHAVIOUR rather than as either mechanism.

type DisposeMsg = { type: 'tick' } | { type: 'kill' } | { type: 'after' }
type DisposeEffect = { type: 'kill' } | { type: 'work' }

describe('#59 invariant 3 — the drain abandons its queue once disposed', () => {
  // Mutation both of these must fail against: remove BOTH the shutdown's
  // `queue.length = 0` AND the drain loop's `isDisposed()` bail. Verified by hand,
  // in both directions: either guard alone still holds the behaviour (removing one
  // is an equivalent mutant), and removing both makes each scenario reduce the
  // trailing `after` on a torn-down component. Pinning the behaviour rather than
  // one of the two mechanisms is the point — a future change may legitimately
  // drop one, and only then does this test become the thing standing behind the
  // invariant.

  it('dispose() from an effect stops the reducers queued behind it', () => {
    const log: string[] = []
    let handle: { dispose: () => void; send: (m: DisposeMsg) => void } | null = null
    const h = mountSignalComponent<{ n: number }, DisposeMsg, DisposeEffect>(container(), {
      name: 'DisposeDrain',
      init: () => ({ n: 0 }),
      update: (s, m) => {
        log.push(`reduce:${m.type}`)
        if (m.type === 'kill') return [{ n: s.n + 1 }, [{ type: 'kill' }]]
        return [{ n: s.n + 1 }, [{ type: 'work' }]]
      },
      view: () => [el('p', {}, [signalText((s) => String((s as { n: number }).n), ['n'])])],
      onEffect: (e) => {
        log.push(`effect:${e.type}`)
        if (e.type !== 'kill') return
        // Order matters, and it is what makes this test load-bearing: the `after`
        // messages must already be IN the queue when `dispose()` lands. Effects run
        // inside the settle, so a send from here queues behind the guard; disposing
        // afterwards is what the drain's bail-out and `shutdown`'s queue clear are
        // for. Sending them the other way round (or from outside, as an earlier
        // version of this test did) hits `send()`'s own post-dispose guard instead
        // and pins nothing about the drain.
        handle?.send({ type: 'after' })
        handle?.send({ type: 'after' })
        handle?.dispose()
      },
    })
    handle = h
    h.send({ type: 'kill' })
    expect(log).toEqual(['reduce:kill', 'effect:kill'])
  })

  it('dispose() from a reducer stops the messages queued behind it', () => {
    const log: string[] = []
    let handle: { dispose: () => void } | null = null
    const h = mountSignalComponent<{ n: number; open: boolean }, DisposeMsg>(container(), {
      name: 'DisposeReducer',
      init: () => ({ n: 0, open: true }),
      update: (s, m) => {
        log.push(`reduce:${m.type}`)
        if (m.type === 'kill') {
          handle?.dispose()
          return s
        }
        return { ...s, n: s.n + 1, open: false }
      },
      view: ({ send }) => [
        signalShow({ produce: (s) => (s as { open: boolean }).open, deps: ['open'] }, () => [
          el('span', {}, [signalText(() => 'arm', [])]),
          // The teardown enqueues TWO messages, so the second is still queued when
          // the first one's reducer disposes.
          onMount(() => () => {
            send({ type: 'kill' })
            send({ type: 'after' })
          }),
        ]),
      ],
    })
    handle = h
    h.send({ type: 'tick' })
    expect(log).toEqual(['reduce:tick', 'reduce:kill'])
  })
})

// ── invariant 4 — a commit with a null mount stays owed ──────────────
//
// `onMount` callbacks run synchronously inside `mountSignal`, BEFORE the mount is
// assigned, so a state-changing send from one reaches the commit with no live
// mount. The commit must report that it did not land and the pending flag must
// survive, or the post-mount replay has nothing to replay and the view stays
// frozen at its initial value until some unrelated later dispatch.

describe('#59 invariant 4 — a commit while the mount is null stays owed', () => {
  // Mutation this must fail against: clear the pending flag on the not-live
  // branch of the commit. Verified by hand: the paragraph renders 'pending'.

  it('a send() from onMount paints on the first frame', () => {
    const c = container()
    const h = mountSignalComponent<{ stats: string | null }, { type: 'compute' }>(c, {
      name: 'OnMountSend',
      init: () => ({ stats: null }),
      update: () => ({ stats: 'COMPUTED' }),
      view: ({ send }) => [
        el('p', {}, [
          signalText((s) => (s as { stats: string | null }).stats ?? 'pending', ['stats']),
        ]),
        onMount(() => {
          send({ type: 'compute' })
        }),
      ],
    })
    expect(c.textContent).toBe('COMPUTED')
    h.dispose()
  })
})
