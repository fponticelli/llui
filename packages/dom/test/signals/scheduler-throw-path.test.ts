import { describe, it, expect, beforeEach } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { el, signalText } from '../../src/signals/dom'

// The throw path through a settle round, pinned (issue #59).
//
// A round COLLECTS its messages' effects and dispatches them after the commit
// ("commit, then effects"). If an exception escapes the round before that point —
// a reducer that throws, or a binding that throws mid-commit with no error hook
// installed — the collected effects are DROPPED, and the exception propagates to
// whatever called `send`.
//
// That is not an accident of the old implementation, it is the behaviour the rest
// of the runtime is written against: the #57 note in `commitToDom` says in so many
// words that a throw escaping the commit "would also STRAND those effects", and it
// is the reason a subscriber throw is isolated per listener rather than allowed to
// unwind. Firing them anyway would run `onEffect` against a HALF-RECONCILED DOM,
// and a `send` from such an effect would be enqueued while the guard is still set
// and then stranded when the exception unwinds past the settle loop.
//
// The scheduler refactor moved the effect frame from a per-round LOCAL (dropped on
// unwind for free) into shared state with an explicit open/close pair, so "dropped
// on unwind" stopped being free and became something to get right — and to pin.
// The mutation these must fail against: dispatch the frame from the scope's
// `finally` (i.e. move `host.dispatchEffects()` out of the `try` in `drain`).

function container(): HTMLElement {
  const c = document.createElement('div')
  document.body.appendChild(c)
  return c
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('#59 an exception escaping a settle round drops that round’s effects', () => {
  it('a reducer that throws drops the effects its round had already collected', () => {
    const log: string[] = []
    let handle: { send: (m: ThrowMsg) => void } | null = null

    interface S {
      n: number
    }
    type ThrowMsg = { type: 'kick' } | { type: 'ok' } | { type: 'boom' }
    type Eff = { type: 'kick' } | { type: 'A' }

    const h = mountSignalComponent<S, ThrowMsg, Eff>(container(), {
      name: 'ReducerThrow',
      init: () => ({ n: 0 }),
      update: (s, m) => {
        if (m.type === 'kick') return [{ n: s.n + 1 }, [{ type: 'kick' } as Eff]]
        if (m.type === 'ok') return [{ n: s.n + 1 }, [{ type: 'A' } as Eff]]
        throw new Error('reducer boom')
      },
      view: () => [el('p', {}, [signalText((s) => String((s as S).n), ['n'])])],
      onEffect: (e) => {
        log.push(`effect:${e.type}`)
        if (e.type !== 'kick') return
        // Both sends land while the guard is set, so they QUEUE and the settle
        // loop picks them up as ONE further round: `ok` collects effect A, then
        // `boom` throws before that round can dispatch it.
        handle?.send({ type: 'ok' })
        handle?.send({ type: 'boom' })
      },
    })
    handle = h

    try {
      h.send({ type: 'kick' })
    } catch (err) {
      log.push(`threw:${(err as Error).message}`)
    }

    expect(log).toEqual(['effect:kick', 'threw:reducer boom'])
    h.dispose()
  })

  it('a binding that throws mid-commit drops the effects of the round it aborts', () => {
    const log: string[] = []

    interface S {
      n: number
    }
    type Eff = { type: 'A' }

    const h = mountSignalComponent<S, { type: 'go' }, Eff>(container(), {
      name: 'BindingThrow',
      init: () => ({ n: 0 }),
      update: (s) => [{ n: s.n + 1 }, [{ type: 'A' } as Eff]],
      view: () => [
        el('p', {}, [
          signalText(
            (s) => {
              // Builds fine at n === 0; blows up on the first reconcile, i.e. from
              // INSIDE the commit of the round that collected effect A. No binding
              // error hook is installed, so runtime.ts takes its try-free path and
              // the throw unwinds through the commit.
              if ((s as S).n > 0) throw new Error('binding boom')
              return String((s as S).n)
            },
            ['n'],
          ),
        ]),
      ],
      onEffect: (e) => {
        log.push(`effect:${e.type}`)
      },
    })

    try {
      h.send({ type: 'go' })
    } catch (err) {
      log.push(`threw:${(err as Error).message}`)
    }

    expect(log).toEqual(['threw:binding boom'])
    h.dispose()
  })
})
