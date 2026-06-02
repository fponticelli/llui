import { describe, it, expect } from 'vitest'
import { mountApp, component, div, text } from '../../src/signals/authoring'

// Regression: `send` must be reentrancy-safe. A message dispatched WHILE another
// is being processed — the real-world trigger is removing a focused node during a
// structural arm swap, which fires `blur` synchronously and whose handler calls
// `send` — must be QUEUED and drained, never run as a NESTED reducer+reconcile.
// Nesting mutated the scope tree / DOM mid-reconcile (corrupting an in-flight
// `removeBetween` into a NotFoundError) AND skipped the outer message's effects.
// Here a subscriber re-dispatches during the outer send (subscribers fire inside
// the send, after the reconcile) to exercise the queue deterministically in jsdom.

interface S {
  x: number
}
type M = { type: 'a' } | { type: 'b' }
type E = { type: 'fxA' } | { type: 'fxB' }

describe('send reentrancy is queued, not nested', () => {
  it('drains a reentrant send after the current one, preserving the outer effects', () => {
    const container = document.createElement('div')
    const effects: string[] = []
    const order: string[] = []
    const h = mountApp<S, M, E>(
      container,
      component<S, M, E>({
        init: () => [{ x: 0 }, []],
        update: (_s, m) => {
          order.push(`update:${m.type}`)
          if (m.type === 'a') return [{ x: 1 }, [{ type: 'fxA' }]]
          return [{ x: 2 }, [{ type: 'fxB' }]]
        },
        view: ({ state }) => [div({ id: 'x' }, [text(state.map((s) => String(s.x)))])],
        onEffect: (e) => {
          effects.push(e.type)
        },
      }),
    )
    // A subscriber that, the first time it sees x === 1, re-dispatches `b`. This
    // call happens INSIDE the `a` send (subscribers run during it) — i.e.
    // reentrantly.
    let fired = false
    h.subscribe((s) => {
      order.push(`sub:${s.x}`)
      if (s.x === 1 && !fired) {
        fired = true
        h.send({ type: 'b' })
      }
    })

    h.send({ type: 'a' })

    // Final state is `b`'s (x=2), the DOM reflects it, and BOTH effects fired —
    // the outer `a`'s effect was NOT skipped by the reentrant `b`.
    expect(h.getState().x).toBe(2)
    expect(container.querySelector('#x')?.textContent).toBe('2')
    expect(effects).toEqual(['fxA', 'fxB'])
    // `a` fully processes (update + subscriber notify + effect) before `b`'s
    // reducer runs — no interleaving.
    expect(order).toEqual(['update:a', 'sub:1', 'update:b', 'sub:2'])
    h.dispose()
  })
})
