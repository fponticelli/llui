import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { signalText, el, signalShow } from '../../src/signals/dom'

// `ArmController.switchTo` must short-circuit on an UNCHANGED arm key even when no
// arm is currently mounted — the falsy `show` with no `orElse`, and the absent
// `branch` arm. Its guard used to be `this.mounted && this.mounted.key === key`,
// which is false whenever nothing is mounted, so a redundant same-key reconcile
// fell through to `finalizePendingLeaves()` and hard-detached an arm that was
// still animating out, cutting its `leave` short.
//
// This also underwrites the reason structural bindings may skip output-equality
// (see `runtime.ts`): a redundant structural commit is only safe to allow if it is
// genuinely side-effect-free.

interface S {
  items: readonly string[]
  label: string
}
type M = { type: 'set'; items: readonly string[] }

/** A `leave` hook that never settles on its own, so a deferred leave stays in
 * flight for the whole test and we can observe whether it was cut short. */
function pendingLeave() {
  const calls: Node[][] = []
  return {
    calls,
    leave: (nodes: Node[]): Promise<void> => {
      calls.push(nodes)
      return new Promise<void>(() => {})
    },
  }
}

function setup(leave: (nodes: Node[]) => Promise<void>) {
  const container = document.createElement('div')
  const h = mountSignalComponent<S, M>(container, {
    init: () => ({ items: ['a'], label: 'x' }),
    update: (s, m) => ({ ...s, items: m.items }),
    view: () => [
      el('div', {}, [
        signalShow(
          // A COARSE condition: its dep (`items`) can dirty while its boolean value
          // stays the same — which is exactly what produces a redundant same-key
          // reconcile.
          { produce: (s) => (s as S).items.length > 0, deps: ['items'] },
          () => [el('p', { class: 'arm' }, [signalText((s) => (s as S).label, ['label'])])],
          undefined, // no orElse — nothing is mounted while the condition is false
          { leave },
        ),
      ]),
    ],
  })
  return { container, h }
}

describe('ArmController — redundant same-key switch is side-effect-free', () => {
  it('does not cut short an in-flight leave when the arm key is unchanged', async () => {
    const lv = pendingLeave()
    const { container, h } = setup(lv.leave)
    const armNode = container.querySelector('.arm')!
    expect(armNode).not.toBeNull()

    // Condition goes false: nothing mounts (no orElse) and the outgoing arm defers
    // its detach until `leave` resolves — which it never does here.
    h.send({ type: 'set', items: [] })
    expect(lv.calls.length).toBe(1)
    expect(container.contains(armNode)).toBe(true) // still animating out

    // A REDUNDANT reconcile: `items` dirties (new array ref) but the condition is
    // still false, so the arm key is unchanged. The leaving arm must be untouched.
    h.send({ type: 'set', items: [] })
    expect(lv.calls.length).toBe(1) // no second leave
    expect(container.contains(armNode)).toBe(true) // NOT hard-detached

    h.send({ type: 'set', items: [] })
    expect(container.contains(armNode)).toBe(true)
  })

  it('still swaps back in when the key genuinely changes mid-leave', async () => {
    const lv = pendingLeave()
    const { container, h } = setup(lv.leave)
    const first = container.querySelector('.arm')!

    h.send({ type: 'set', items: [] })
    expect(container.contains(first)).toBe(true)

    // Toggling back interrupts the leave: the pending arm is finalized (detached +
    // torn down exactly once) and a FRESH arm mounts.
    h.send({ type: 'set', items: ['b'] })
    expect(container.contains(first)).toBe(false)
    const second = container.querySelector('.arm')!
    expect(second).not.toBeNull()
    expect(second).not.toBe(first)
    expect(container.querySelectorAll('.arm').length).toBe(1)
  })

  it('a redundant switch while an arm IS mounted stays a no-op (unchanged behaviour)', () => {
    const lv = pendingLeave()
    const { container, h } = setup(lv.leave)
    const armNode = container.querySelector('.arm')!

    // `items` dirties, condition stays true — the mounted arm must be the same node.
    h.send({ type: 'set', items: ['a', 'b'] })
    expect(container.querySelector('.arm')).toBe(armNode)
    expect(lv.calls.length).toBe(0)
  })
})
