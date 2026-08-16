import { describe, it, expect } from 'vitest'
import {
  createCommitScheduler,
  type CommitHost,
  type CommitToken,
} from '../../src/signals/commit-scope'
import { mountSignalComponent } from '../../src/signals/component'
import { component, div, text } from '../../src/signals/authoring'
import { LluiFrameworkError, isFrameworkError } from '../../src/signals/framework-error'

// The commit scope is the scoped-resource form of the runtime's reentrancy guard
// (issue #59). These tests pin the properties that make the shape worth having;
// each was a hand-written rule enforced only by review before.
//
// They drive the scheduler DIRECTLY with a fake host, because the interesting
// states — a nested scope opened from inside a commit, a commit refused because
// the mount is not live yet — are reachable through `mountSignalComponent` only by
// contriving a `blur` in jsdom. The end-to-end equivalents live in
// `scheduler-invariants.test.ts`, `issue-59-reentrant-effect-buffer.test.ts`,
// `send-reentrancy.test.ts`, `dispose-mid-drain.test.ts`,
// `on-mount-send-repro.test.ts` and `scheduler-raf.test.ts`; the last section here
// re-checks the wiring end to end.

/** Each reduced message collects one effect named after it, so the log shows
 * WHICH round released WHAT — the point of the effect-frame stack. */
interface Trace {
  events: string[]
  host: CommitHost<string, string[] | null>
  /** Run inside `reduce`, once, for the named message. */
  duringReduce: Map<string, () => void>
  /** Run inside `commit`, once — the subscriber-notification seam. */
  duringCommit: (() => void) | null
  /** Answered by `commit`; false models "the mount is not live yet". */
  live: boolean
  disposed: boolean
}

function makeHost(): Trace {
  let frame: string[] | null = null
  let inReduce = false
  const t: Trace = {
    events: [],
    duringReduce: new Map(),
    duringCommit: null,
    live: true,
    disposed: false,
    host: {
      reduce: (m: string): boolean => {
        // A nested reduce means a send re-entered the drain instead of queueing —
        // exactly the corruption the guard exists to prevent, so it is recorded
        // rather than asserted here.
        t.events.push(inReduce ? `NESTED-reduce:${m}` : `reduce:${m}`)
        if (frame === null) frame = []
        frame.push(m)
        inReduce = true
        try {
          const hook = t.duringReduce.get(m)
          if (hook !== undefined) {
            t.duringReduce.delete(m)
            hook()
          }
        } finally {
          inReduce = false
        }
        return true
      },
      commit: (): boolean => {
        t.events.push(t.live ? 'commit' : 'commit-refused')
        const hook = t.duringCommit
        if (hook !== null) {
          t.duringCommit = null
          hook()
        }
        return t.live
      },
      beginEffects: (): string[] | null => {
        const prev = frame
        frame = null
        return prev
      },
      dispatchEffects: (): void => {
        const es = frame
        frame = null
        if (es !== null) for (const e of es) t.events.push(`effect:${e}`)
      },
      endEffects: (prev: string[] | null): void => {
        frame = prev
      },
      isDisposed: (): boolean => t.disposed,
    },
  }
  return t
}

describe('commit token', () => {
  it('brands an escaped token as a framework error without committing', () => {
    const t = makeHost()
    const s = createCommitScheduler(t.host, 'sync')
    // Stash the token's USE rather than the token, so nothing here has to defeat
    // TS's narrowing to talk about a value assigned inside a callback.
    let stashedSettle: (() => void) | undefined
    s.withCommitScope('scheduled', (token: CommitToken) => {
      stashedSettle = () => token.settle()
    })
    // Capturing the token is legal JavaScript; USING it afterwards is not. Without
    // this refusal, a stashed token would be a commit with no reentrancy guard —
    // the one hole a lexical enclosure cannot close on its own.
    expect(stashedSettle).toBeDefined()
    let thrown: unknown
    try {
      stashedSettle!()
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(LluiFrameworkError)
    expect(isFrameworkError(thrown)).toBe(true)
    expect((thrown as Error).message).toBe(
      '[llui] CommitToken.settle() was called outside its commit scope. A token ' +
        'is valid only for the body it was handed to; commit through the ' +
        'CommitScheduler surface instead.',
    )
    // …and the refusal is a throw, not a silent no-op that quietly commits.
    expect(t.events).toEqual([])
  })

  it('holds the guard for the whole body, so a body that never settles defers', () => {
    const t = makeHost()
    const s = createCommitScheduler(t.host, 'sync')
    // The documented cost of `withCommitScope` being THE extension point: the
    // guard covers the entire body, so a body that forgets `settle()` leaves what
    // it enqueued in the queue. A lost turn, not a lost message — the next
    // dispatch settles both. Pinned so the fifth commit path knows what it buys.
    s.withCommitScope('scheduled', () => {
      s.dispatch('a')
    })
    expect(t.events).toEqual([])
    s.dispatch('b')
    expect(t.events).toEqual(['reduce:a', 'reduce:b', 'commit', 'effect:a', 'effect:b'])
  })
})

describe('nested commit scopes', () => {
  it('restores the OUTER guard, so a later send stays queued instead of nesting', () => {
    const t = makeHost()
    const s = createCommitScheduler(t.host, 'sync')
    // Inside `a`'s reducer: open a nested scope (what a devtools poke or a
    // `flush()` from an `onEffect` does), then send `b`. If the nested scope's
    // `finally` cleared the guard instead of restoring it, `b` would open a fresh
    // scope and reduce NESTED inside `a` — recorded as `NESTED-reduce:b`.
    t.duringReduce.set('a', () => {
      s.pokeCommit()
      s.dispatch('b')
    })
    s.dispatch('a')

    expect(t.events).toEqual([
      'reduce:a',
      'commit', // the nested scope committed the poked state immediately
      // `b` was QUEUED, then reduced by the OUTER loop — which is still running,
      // so it picks `b` up before reaching its own commit. One commit per settled
      // round, never a second redundant one.
      'reduce:b',
      'commit',
      // BOTH rounds' effects, released by the round that collected them: the
      // nested round collected nothing, so the outer one still owns `a` and `b`.
      'effect:a',
      'effect:b',
    ])
    expect(t.events.some((e) => e.startsWith('NESTED-'))).toBe(false)
  })

  it('a scope opened when none was open still restores to "not draining"', () => {
    const t = makeHost()
    const s = createCommitScheduler(t.host, 'sync')
    s.dispatch('a')
    t.events.length = 0
    // If the restore leaked `draining === true`, this second top-level dispatch
    // would enqueue and never drain — the mirror-image failure of the one above.
    s.dispatch('b')
    expect(t.events).toEqual(['reduce:b', 'commit', 'effect:b'])
  })

  it('a settle nested in a commit releases only ITS OWN effects', () => {
    const t = makeHost()
    const s = createCommitScheduler(t.host, 'sync')
    // The real shape of issue #59's worst case: a subscriber, notified during the
    // commit, dispatches AND pokes. The poke opens a nested scope that reduces the
    // queued message and commits it. `a`'s effect was collected by the OUTER round
    // and must still be dispatched BY that round, after the nested scope closes —
    // not swallowed, and not re-ordered ahead of `b`'s own commit.
    t.duringCommit = () => {
      s.dispatch('b')
      s.pokeCommit()
    }
    s.dispatch('a')

    expect(t.events).toEqual([
      'reduce:a',
      'commit', //     the outer commit, whose notification re-enters
      'commit', //     the poke's own commit — its own observable state frame
      'reduce:b', //   the queued message, settled inside the nested scope
      'commit',
      'effect:b', //   released by the nested round…
      'effect:a', //   …and only then the outer round's own effect
    ])
  })

  it('a nested round that THROWS drops its own effects and restores the outer frame', () => {
    const t = makeHost()
    const s = createCommitScheduler(t.host, 'sync')
    // Both halves of the frame contract in one trace. The nested round collects
    // `b`, then its reducer throws: those effects are dropped (dispatching them
    // would run `onEffect` against a half-reconciled DOM — see `drain`), and the
    // outer round's frame comes back intact, so `a` still fires. Swap `drain`'s
    // `dispatchEffects()` into the `finally` and `effect:b` appears; drop
    // `endEffects` from the `finally` and `effect:a` disappears.
    t.duringCommit = () => {
      s.dispatch('b')
      t.duringReduce.set('b', () => {
        throw new Error('reducer boom')
      })
      // The poke is the nested scope; catching here keeps the OUTER round alive so
      // its own frame is observable afterwards.
      try {
        s.pokeCommit()
      } catch (err) {
        t.events.push(`caught:${(err as Error).message}`)
      }
    }
    s.dispatch('a')

    expect(t.events).toEqual([
      'reduce:a',
      'commit', //                 the outer commit, whose notification re-enters
      'commit', //                 the poke's own commit
      'reduce:b', //               …then the nested settle, which throws
      'caught:reducer boom',
      'effect:a', //               the outer frame survived; `b`'s effect did not
    ])
  })
})

describe('a forced scope commits what is owed before it settles', () => {
  it("'frame' commits even inside a batch, where a scheduled scope would defer", () => {
    const t = makeHost()
    const s = createCommitScheduler(t.host, 'raf')
    s.batch(() => {
      s.dispatch('a')
      expect(t.events).toEqual(['reduce:a', 'effect:a']) // batched: no commit yet
      t.events.length = 0
      // `flush()` from inside a batch: the owed commit lands on scope entry, which
      // is what "the DOM is current when I return" means. The settle that follows
      // still honours the batch, so nothing further commits.
      s.flushNow()
      expect(t.events).toEqual(['commit'])
    })
    s.shutdown()
  })

  it("'immediate' makes the poked state its own observable frame", () => {
    const t = makeHost()
    const s = createCommitScheduler(t.host, 'sync')
    // A message is already queued when the poke lands (the subscriber-dispatch
    // case). Committing FIRST is what keeps the poked state visible on its own,
    // before the queued message merges into it — an agent/devtools-visible frame
    // that folding the poke into the settle would erase.
    s.withCommitScope('scheduled', () => {
      s.dispatch('queued-before-poke')
      s.pokeCommit()
    })
    expect(t.events).toEqual([
      'commit', //                      the poke, on its own
      'reduce:queued-before-poke',
      'commit', //                      …then the queued message
      'effect:queued-before-poke',
    ])
  })
})

describe('an owed commit survives a mount that is not live yet', () => {
  it('keeps the commit pending until one actually lands', () => {
    const t = makeHost()
    const s = createCommitScheduler(t.host, 'sync')
    t.live = false
    s.dispatch('a') // reduces, tries to commit, is refused
    expect(t.events).toEqual(['reduce:a', 'commit-refused', 'effect:a'])

    // The scheduler owns the pending flag and clears it only on a commit that
    // LANDED, so the host cannot leave the reconcile silently dropped — the
    // on-mount-send bug. The replay picks it up with no further message.
    t.events.length = 0
    t.live = true
    s.replayPostMountCommit()
    expect(t.events).toEqual(['commit'])

    // …and it is not committed twice.
    t.events.length = 0
    s.replayPostMountCommit()
    expect(t.events).toEqual([])
  })

  it('does not replay under raf, where the owed commit is already a frame', () => {
    const t = makeHost()
    const s = createCommitScheduler(t.host, 'raf')
    t.live = false
    s.dispatch('a')
    t.events.length = 0
    s.replayPostMountCommit()
    expect(t.events).toEqual([])
    s.shutdown()
  })
})

describe('the drain abandons its queue once disposed', () => {
  it('stops reducing mid-drain', () => {
    const t = makeHost()
    const s = createCommitScheduler(t.host, 'sync')
    t.duringReduce.set('a', () => {
      s.dispatch('b')
      s.dispatch('c')
      t.disposed = true
    })
    s.dispatch('a')
    // `b` and `c` are never reduced, nothing commits, and `a`'s already-collected
    // effect is dropped rather than dispatched: the bail-out `return`s past
    // `dispatchEffects`, exactly as the pre-refactor `drain`'s early `return`
    // skipped its trailing dispatch statement. End to end it makes no difference —
    // the host's `runEffect` refuses once disposed (`dispose-mid-drain.test.ts`) —
    // but the scheduler must not depend on the host for that.
    expect(t.events).toEqual(['reduce:a'])
  })
})

describe('the mounted component still honours the whole contract', () => {
  interface S {
    n: number
  }
  type M = { type: 'inc' }

  it('send stays synchronous and batch coalesces to one commit', () => {
    const container = document.createElement('div')
    let commits = 0
    const h = mountSignalComponent(
      container,
      component<S, M, never>({
        name: 'scoped',
        init: () => ({ n: 0 }),
        update: (s) => ({ n: s.n + 1 }),
        view: ({ state }) => [div({ class: 'n' }, [text(state.at('n').map((n) => String(n)))])],
      }),
    )
    h.subscribe(() => commits++)

    h.send({ type: 'inc' })
    expect(container.querySelector('.n')?.textContent).toBe('1') // synchronous
    expect(commits).toBe(1)

    h.batch(() => {
      for (let i = 0; i < 5; i++) h.send({ type: 'inc' })
    })
    expect(h.getState().n).toBe(6) // every reducer ran
    expect(container.querySelector('.n')?.textContent).toBe('6')
    expect(commits).toBe(2) // …but only ONE further commit
    h.dispose()
  })
})
