import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSignalComponent, el, each, text } from '@llui/dom'
import type { TransitionOptions } from '@llui/dom'
import { stagger } from '../src/stagger'
import { fade } from '../src/presets'

// `stagger()` defers the wrapped bundle's `enter`/`leave` behind a per-item
// timer. That deferral has to be CANCELLABLE, because the runtime can reverse a
// phase before its delay elapses: `each()` resurrects a row that is animating
// out (cancelling the pending detach and re-invoking `enter` on the same nodes).
//
// A staggered leave that is still waiting out its delay when that happens would
// fire AFTERWARDS, on a row that is now staying — parking it at the leave
// resting values with nothing left to undo them. The row stays mounted, laid
// out, and permanently invisible: the same silent symptom as the route-seam
// residue bug, from the opposite direction.
describe('stagger() phase cancellation', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function makeEl(): HTMLElement {
    const node = document.createElement('div')
    document.body.appendChild(node)
    return node
  }

  // ── Unit: the wrapped bundle must not see a cancelled phase ──

  it('enter cancels a leave that is still waiting out its stagger delay', async () => {
    const base = {
      enter: vi.fn((_nodes: Node[]) => {}),
      leave: vi.fn((_nodes: Node[]) => Promise.resolve()),
    }
    const t = stagger(base, { delayPerItem: 60, leaveOrder: 'sequential' })
    const a = makeEl()
    const b = makeEl()

    void t.leave!([a]) // index 0 → runs now
    const bLeave = t.leave!([b]) // index 1 → scheduled for +60ms
    expect(base.leave).toHaveBeenCalledTimes(1)

    t.enter!([b]) // b is staying after all
    await vi.advanceTimersByTimeAsync(500)

    // b's leave never ran; a's did.
    expect(base.leave).toHaveBeenCalledTimes(1)
    expect(base.leave.mock.calls[0]![0]).toEqual([a])
    // The cancelled leave still RESOLVES — the runtime gates DOM removal on it,
    // so a promise that never settled would strand the row's teardown.
    await expect(bLeave as Promise<void>).resolves.toBeUndefined()
  })

  it('cancels only the nodes that re-enter, leaving the rest of the batch to go', async () => {
    const base = {
      enter: vi.fn((_nodes: Node[]) => {}),
      leave: vi.fn((_nodes: Node[]) => Promise.resolve()),
    }
    const t = stagger(base, { delayPerItem: 60, leaveOrder: 'sequential' })
    const a = makeEl()
    const b = makeEl()
    const c = makeEl()

    void t.leave!([a]) // index 0 → runs now
    void t.leave!([b, c]) // index 1 → scheduled together

    t.enter!([b]) // only b comes back
    await vi.advanceTimersByTimeAsync(500)

    expect(base.leave).toHaveBeenCalledTimes(2)
    expect(base.leave.mock.calls[1]![0]).toEqual([c])
  })

  it('cancels a pending reverse-order leave too', async () => {
    const base = {
      enter: vi.fn((_nodes: Node[]) => {}),
      leave: vi.fn((_nodes: Node[]) => Promise.resolve()),
    }
    const t = stagger(base, { delayPerItem: 60, leaveOrder: 'reverse' })
    const a = makeEl()
    const b = makeEl()

    const aLeave = t.leave!([a]) // reverse: index 0 of 2 → the LATER one
    void t.leave!([b])

    t.enter!([a])
    await vi.advanceTimersByTimeAsync(500)

    expect(base.leave).toHaveBeenCalledTimes(1)
    expect(base.leave.mock.calls[0]![0]).toEqual([b])
    await expect(aLeave as Promise<void>).resolves.toBeUndefined()
  })

  it('leave cancels an enter that is still waiting out its stagger delay', async () => {
    const base = {
      enter: vi.fn((_nodes: Node[]) => {}),
      leave: vi.fn((_nodes: Node[]) => Promise.resolve()),
    }
    const t = stagger(base, { delayPerItem: 60 })
    const a = makeEl()
    const b = makeEl()

    t.enter!([a]) // index 0 → runs now
    t.enter!([b]) // index 1 → scheduled for +60ms
    expect(base.enter).toHaveBeenCalledTimes(1)

    void t.leave!([b]) // b is going after all
    await vi.advanceTimersByTimeAsync(500)

    // The stale enter never ran — it would have animated a leaving row back in.
    expect(base.enter).toHaveBeenCalledTimes(1)
    expect(base.leave).toHaveBeenCalledTimes(1)
  })

  it('an uncancelled staggered leave still runs on its delay', async () => {
    // The other side of the contract: cancellation must not swallow the normal path.
    const base = {
      enter: vi.fn((_nodes: Node[]) => {}),
      leave: vi.fn((_nodes: Node[]) => Promise.resolve()),
    }
    const t = stagger(base, { delayPerItem: 60, leaveOrder: 'sequential' })
    const a = makeEl()
    const b = makeEl()

    void t.leave!([a])
    void t.leave!([b])
    expect(base.leave).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(500)
    expect(base.leave).toHaveBeenCalledTimes(2)
    expect(base.leave.mock.calls[1]![0]).toEqual([b])
  })

  // ── Integration: the real `each` resurrection path ──

  interface State {
    ids: number[]
  }
  type Msg = { type: 'set'; ids: number[] }

  function setup(transition: TransitionOptions) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const h = mountSignalComponent<State, Msg>(container, {
      name: 'StaggeredList',
      init: () => ({ ids: [1, 2, 3] }),
      update: (_s, m) => ({ ids: m.ids }),
      view: ({ state }) => [
        el('ul', {}, [
          each(state.at('ids'), {
            key: (id) => String(id),
            render: (id) => [el('li', {}, [text(id.map(String))])],
            transition,
          }),
        ]),
      ],
    })
    const ul = container.querySelector('ul')!
    const rowFor = (id: number): HTMLElement | undefined =>
      Array.from(ul.querySelectorAll('li')).find((li) => li.textContent === String(id))
    return { h, rowFor }
  }

  it('a row resurrected before its staggered leave starts ends visible', async () => {
    const { h, rowFor } = setup(
      stagger(fade({ duration: 20 }), { delayPerItem: 60, leaveOrder: 'sequential' }),
    )
    // Let the mount batch's stagger counters reset so the resurrection enter is
    // batch index 0 (immediate) while row 3's leave is index 1 (deferred 60ms) —
    // the ordering that leaves the stale leave firing last.
    await vi.advanceTimersByTimeAsync(400)

    const row3 = rowFor(3)!
    h.send({ type: 'set', ids: [1] }) // rows 2 and 3 leave; row 3's is deferred
    h.send({ type: 'set', ids: [1, 3] }) // row 3 comes back before its leave starts

    await vi.advanceTimersByTimeAsync(500)

    expect(row3.isConnected).toBe(true)
    expect(row3.style.opacity).toBe('')
  })

  it('the same, with reverse leave order', async () => {
    const { h, rowFor } = setup(
      stagger(fade({ duration: 20 }), { delayPerItem: 60, leaveOrder: 'reverse' }),
    )
    await vi.advanceTimersByTimeAsync(400)

    const row2 = rowFor(2)!
    h.send({ type: 'set', ids: [1] })
    h.send({ type: 'set', ids: [1, 2] })

    await vi.advanceTimersByTimeAsync(500)

    expect(row2.isConnected).toBe(true)
    expect(row2.style.opacity).toBe('')
  })

  it('rows that are not resurrected still leave and detach', async () => {
    const { h, rowFor } = setup(
      stagger(fade({ duration: 20 }), { delayPerItem: 60, leaveOrder: 'sequential' }),
    )
    await vi.advanceTimersByTimeAsync(400)

    const row2 = rowFor(2)!
    const row3 = rowFor(3)!
    h.send({ type: 'set', ids: [1] })
    h.send({ type: 'set', ids: [1, 3] }) // only row 3 comes back

    await vi.advanceTimersByTimeAsync(500)

    expect(row2.isConnected).toBe(false)
    expect(row3.isConnected).toBe(true)
  })
})
