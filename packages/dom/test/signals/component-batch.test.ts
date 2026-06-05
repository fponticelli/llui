import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { div, text } from '../../src/signals/authoring'

// `batch(fn)` coalesces a burst of synchronous `send`s into ONE reconcile + one
// subscriber notification against the final state, while every reducer still runs
// in order and effects still fire per message. State is applied by the time
// `batch` returns (the synchronous contract holds at the boundary).

interface S {
  n: number
  log: string[]
}
type M = { type: 'inc' } | { type: 'push'; v: string } | { type: 'boom' }
type E = { type: 'fx'; v: string }

function setup(opts?: { onEffect?: boolean }) {
  const container = document.createElement('div')
  const effects: string[] = []
  const commits: number[] = [] // value of n at each subscriber notification (= each commit)
  const h = mountSignalComponent<S, M, E>(container, {
    init: () => [{ n: 0, log: [] }, []],
    update: (s, m) => {
      if (m.type === 'inc')
        return [{ ...s, n: s.n + 1 }, opts?.onEffect ? [{ type: 'fx', v: `e${s.n}` }] : []]
      if (m.type === 'push') return [{ ...s, log: [...s.log, m.v] }, []]
      if (m.type === 'boom') throw new Error('reducer boom')
      return [s, []]
    },
    onEffect: opts?.onEffect ? (e) => void effects.push(e.v) : undefined,
    view: ({ state }) => [div([text(state.at('n').map((v) => String(v)))])],
  })
  h.subscribe((s) => commits.push(s.n))
  const shown = (): string => container.querySelector('div')!.textContent ?? ''
  return { h, shown, commits, effects, container }
}

describe('batch() — burst coalescing', () => {
  it('coalesces N sends into ONE commit, with final state applied at the boundary', () => {
    const { h, shown, commits } = setup()
    h.batch(() => {
      for (let i = 0; i < 5; i++) h.send({ type: 'inc' })
    })
    expect(h.getState().n).toBe(5) // all reducers ran
    expect(shown()).toBe('5') // DOM reflects final state by the time batch returned
    expect(commits).toEqual([5]) // exactly one notification, with the final value
  })

  it('without batch, each send commits (no coalescing) — baseline', () => {
    const { h, commits } = setup()
    h.send({ type: 'inc' })
    h.send({ type: 'inc' })
    expect(commits).toEqual([1, 2]) // two separate commits
  })

  it('effects still fire per message during a batch (only the commit is deferred)', () => {
    const { h, effects, commits } = setup({ onEffect: true })
    h.batch(() => {
      h.send({ type: 'inc' })
      h.send({ type: 'inc' })
      h.send({ type: 'inc' })
    })
    expect(effects).toEqual(['e0', 'e1', 'e2']) // one effect per message, in order
    expect(commits).toEqual([3]) // but a single reconcile
  })

  it('nested batch flushes once at the outermost exit', () => {
    const { h, commits } = setup()
    h.batch(() => {
      h.send({ type: 'inc' })
      h.batch(() => {
        h.send({ type: 'inc' })
        h.send({ type: 'inc' })
      })
      h.send({ type: 'inc' })
    })
    expect(h.getState().n).toBe(4)
    expect(commits).toEqual([4]) // one commit despite the nested batch
  })

  it('flushes on throw (state advanced → DOM catches up) and rethrows', () => {
    const { h, shown, commits } = setup()
    expect(() =>
      h.batch(() => {
        h.send({ type: 'inc' })
        h.send({ type: 'inc' })
        throw new Error('mid-batch')
      }),
    ).toThrow('mid-batch')
    // the two sends before the throw are applied and committed once
    expect(h.getState().n).toBe(2)
    expect(shown()).toBe('2')
    expect(commits).toEqual([2])
  })

  it('a batch with no state change commits nothing', () => {
    const { h, commits } = setup()
    h.batch(() => {
      // send a no-op message type that returns the same state ref
    })
    expect(commits).toEqual([])
  })
})

describe('batch in the view bag', () => {
  it('a handler can batch a burst of sends via the bag', () => {
    const container = document.createElement('div')
    const commits: number[] = []
    let fire: (() => void) | null = null
    const h = mountSignalComponent<{ n: number }, { type: 'inc' }>(container, {
      init: () => [{ n: 0 }, []],
      update: (s, m) => (m.type === 'inc' ? [{ n: s.n + 1 }, []] : [s, []]),
      view: ({ state, send, batch }) => {
        // capture a burst-dispatcher the way an event handler would
        fire = () =>
          batch(() => {
            send({ type: 'inc' })
            send({ type: 'inc' })
            send({ type: 'inc' })
          })
        return [div([text(state.at('n').map((v) => String(v)))])]
      },
    })
    h.subscribe((s) => commits.push(s.n))
    fire!()
    expect(h.getState().n).toBe(3)
    expect(container.querySelector('div')!.textContent).toBe('3')
    expect(commits).toEqual([3]) // one reconcile from the bag's batch
  })

  it('an onEffect handler can coalesce a burst via the effect bag `batch`', () => {
    const container = document.createElement('div')
    const commits: number[] = []
    type EM = { type: 'kick' } | { type: 'inc' }
    type EE = { type: 'burst'; n: number }
    const h = mountSignalComponent<{ n: number }, EM, EE>(container, {
      init: () => [{ n: 0 }, []],
      update: (s, m) => {
        if (m.type === 'kick') return [s, [{ type: 'burst', n: 3 }]]
        if (m.type === 'inc') return [{ n: s.n + 1 }, []]
        return [s, []]
      },
      // the effect bag exposes `batch` alongside `send` — coalesce the burst it drives
      onEffect: (e, { send, batch }) => {
        if (e.type === 'burst') {
          batch(() => {
            for (let i = 0; i < e.n; i++) send({ type: 'inc' })
          })
        }
      },
      view: ({ state }) => [div([text(state.at('n').map((v) => String(v)))])],
    })
    h.subscribe((s) => commits.push(s.n))
    h.send({ type: 'kick' }) // → effect → batch(3× inc)
    expect(h.getState().n).toBe(3)
    expect(container.querySelector('div')!.textContent).toBe('3')
    // 'kick' didn't change state (no commit); the batched 3 incs commit once
    expect(commits).toEqual([3])
  })
})
