import { describe, it, expect } from 'vitest'
import { component, div, text } from '@llui/dom'
import { testView, type TestViewOptions } from '../src/test-view'
import { propertyTest } from '../src/property-test'

// The harness forwards the WHOLE MountSignalOptions bag to `mountApp`, so a
// consumer can test their app in the mode it actually runs in — notably
// `scheduler: 'raf'`, where the DOM commit + subscriber notification coalesce to
// one reconcile per frame and `flush()` forces it synchronously. The default
// stays `'sync'` (commit inside every send), so existing harness tests are
// unaffected.

type S = { n: number }
type Msg = { type: 'inc' }

const Counter = component<S, Msg, never>({
  name: 'Counter',
  init: () => [{ n: 0 }, []],
  update: (s, m) => (m.type === 'inc' ? [{ n: s.n + 1 }, []] : [s, []]),
  view: ({ state }) => [div({ class: 'out' }, [text(state.at('n').map((n) => String(n)))])],
})

// Type-level guard, enforced by `pnpm --filter @llui/test check` (tsconfig
// includes `test/`): `TestViewOptions` must EXCLUDE every option that competes
// with what testView itself owns — the seed state (`initialState`) and the
// container (`hydrate`, which both re-seeds AND expects server HTML in a
// container testView just created empty). Both outrank the positional `state`
// argument inside `mountSignalComponent`, so accepting either would let an
// option silently make that argument dead.
type Assert<T extends true> = T
type _ExcludesCompetingSeeds = Assert<
  Extract<keyof TestViewOptions<{ n: number }>, 'initialState' | 'hydrate'> extends never
    ? true
    : false
>
// …while everything else still flows through.
type _ForwardsTheRest = Assert<
  'scheduler' | 'contexts' | 'devtools' extends keyof TestViewOptions<{ n: number }> ? true : false
>

describe('testView mount options', () => {
  it('defaults to the sync scheduler — one commit per send', () => {
    const v = testView(Counter, { n: 0 })
    let commits = 0
    v.handle.subscribe(() => commits++)

    // Drive the raw handle, not `v.send`: the harness's own `send` flushes, which
    // would hide the difference between the two schedulers.
    v.handle.send({ type: 'inc' })
    v.handle.send({ type: 'inc' })

    expect(v.text('.out')).toBe('2')
    expect(commits).toBe(2)
    v.unmount()
  })

  it("under scheduler: 'raf', two sends before flush() produce ONE commit", () => {
    const v = testView(Counter, { n: 0 }, { scheduler: 'raf' })
    let commits = 0
    v.handle.subscribe(() => commits++)

    expect(v.text('.out')).toBe('0') // the initial mount still commits synchronously

    v.handle.send({ type: 'inc' })
    v.handle.send({ type: 'inc' })

    expect(v.handle.getState().n).toBe(2) // state advances synchronously — the data contract
    expect(v.text('.out')).toBe('0') // …while the DOM lags until the frame
    expect(commits).toBe(0)

    v.handle.flush()
    expect(v.text('.out')).toBe('2')
    expect(commits).toBe(1) // ONE coalesced commit, not two
    v.unmount()
  })
})

describe('propertyTest mount options', () => {
  it('forwards mount options to mountApp', () => {
    // `initialState` is the observable proof that the whole options bag reaches
    // `mountApp`: the invariant holds only if the mounted component started from
    // the forwarded seed rather than from `init()`'s `{ n: 0 }`.
    propertyTest(Counter, {
      runs: 1,
      maxSequenceLength: 3,
      seed: 1,
      invariants: [(s) => s.n >= 100],
      messageGenerators: { inc: () => ({ type: 'inc' as const }) },
      mount: { options: { initialState: { n: 100 } } },
    })
  })

  it('keeps assertDom valid under a forwarded raf scheduler — the per-step flush', () => {
    // NOT a second proof of forwarding (the test above owns that): this pins the
    // interaction between the two. Under `raf` the DOM lags state until the frame,
    // so `assertDom` is only meaningful because `runMount` flushes after every
    // send. Drop that flush and this fails (rAF never fires inside a synchronous
    // test body) while every sync-scheduled mount test stays green.
    propertyTest(Counter, {
      runs: 1,
      maxSequenceLength: 5,
      seed: 1,
      invariants: [(s) => s.n >= 0],
      messageGenerators: { inc: () => ({ type: 'inc' as const }) },
      mount: {
        options: { scheduler: 'raf' },
        assertDom: (s, container) => container.querySelector('.out')?.textContent === String(s.n),
      },
    })
  })
})
