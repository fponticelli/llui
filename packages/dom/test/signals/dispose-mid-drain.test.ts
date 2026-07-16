import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { el, signalText } from '../../src/signals/dom'

// Regression (audit finding: drain continues after mid-drain dispose): send() and
// batch() guard on `disposed`, but the drain loop did not — so an effect (or a
// commit-fired handler) that called dispose() left the loop reducing the rest of
// the queue and dispatching further effects on a torn-down component.

interface S {
  n: number
}
type M = { type: 'a' } | { type: 'b' } | { type: 'boom' }
type Eff = { type: 'kill' } | { type: 'sideEffect' }

describe('dispose mid-drain', () => {
  it('stops reducing queued messages and firing effects once disposed mid-drain', () => {
    const reduced: string[] = []
    const effectsRun: string[] = []
    const container = document.createElement('div')
    let handleRef: { dispose: () => void } | null = null

    const h = mountSignalComponent<S, M, Eff>(container, {
      init: () => ({ n: 0 }),
      update: (s, m) => {
        reduced.push(m.type)
        if (m.type === 'boom') return [{ ...s, n: s.n + 1 }, [{ type: 'kill' }]]
        return [{ ...s, n: s.n + 1 }, [{ type: 'sideEffect' }]]
      },
      view: () => [el('div', {}, [signalText((s) => (s as S).n, ['n'])])],
      onEffect: (e) => {
        effectsRun.push(e.type)
        if (e.type === 'kill') handleRef!.dispose()
      },
    })
    handleRef = h

    // A batch that enqueues: boom (→ kill effect that disposes), then two more.
    // The 'kill' effect disposes; the remaining messages must NOT be reduced and
    // their effects must NOT fire.
    h.batch(() => {
      h.send({ type: 'boom' })
      h.send({ type: 'a' })
      h.send({ type: 'b' })
    })

    expect(reduced).toEqual(['boom']) // 'a' and 'b' abandoned after dispose
    expect(effectsRun).toEqual(['kill']) // 'sideEffect' from later msgs never ran
  })
})
