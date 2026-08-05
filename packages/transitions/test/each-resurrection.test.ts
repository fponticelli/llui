import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSignalComponent, el, each, text } from '@llui/dom'
import { fade, collapse } from '../src/presets'

// The SECOND live consumer of "leave then enter on the SAME element".
//
// `each()` keeps a removed row alive while its `leave` animates out, and a
// re-added key RESURRECTS that row: the pending detach is cancelled, the same
// nodes move back into the live set, and `enter` is re-invoked on them to
// reverse the interrupted leave. `@llui/dom` covers the mechanics with a stub
// bundle; these tests pin the outcome with a REAL one — a resurrected row must
// end fully visible, with no leave residue frozen onto it.
//
// Unlike the route seam, resurrection always interrupts a leave that is still in
// flight (finalization is what detaches the row, and it runs off the leave's own
// promise), so this path was already safe. It stays covered here because it is
// the runtime's only supported reuse of an animated element.
describe('each() row resurrection with a real transition bundle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  interface State {
    ids: number[]
  }
  type Msg = { type: 'set'; ids: number[] }

  function setup(transition: ReturnType<typeof fade>) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const h = mountSignalComponent<State, Msg>(container, {
      name: 'IdList',
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
    return { h, ul, rowFor }
  }

  it('a row resurrected mid-leave ends fully visible', async () => {
    const { h, rowFor } = setup(fade({ duration: 20 }))
    const row2 = rowFor(2)!

    h.send({ type: 'set', ids: [1, 3] }) // row 2 starts leaving
    expect(row2.style.opacity).toBe('0') // animating out
    expect(row2.isConnected).toBe(true) // detach deferred

    h.send({ type: 'set', ids: [1, 2, 3] }) // re-added mid-leave → resurrect
    expect(rowFor(2)).toBe(row2) // the SAME node, not a rebuild

    await vi.advanceTimersByTimeAsync(200) // past both the leave and the enter

    expect(row2.isConnected).toBe(true)
    expect(row2.style.opacity).toBe('')
    expect(row2.style.transition).toBe('')
  })

  it('survives repeated remove/re-add cycles on the same row', async () => {
    const { h, rowFor } = setup(fade({ duration: 20 }))
    const row2 = rowFor(2)!

    for (let i = 0; i < 3; i++) {
      h.send({ type: 'set', ids: [1, 3] })
      h.send({ type: 'set', ids: [1, 2, 3] })
      await vi.advanceTimersByTimeAsync(200)
      expect(rowFor(2)).toBe(row2)
      expect(row2.style.opacity).toBe('')
    }
  })

  it('a row left to finish leaving is detached, not resurrected', async () => {
    // The invariant on the other side: without a re-add, the completed leave
    // must still detach the row (the residue it keeps is only ever transient).
    const { h, rowFor } = setup(fade({ duration: 20 }))
    const row2 = rowFor(2)!

    h.send({ type: 'set', ids: [1, 3] })
    await vi.advanceTimersByTimeAsync(200)

    expect(row2.isConnected).toBe(false)
    expect(rowFor(2)).toBeUndefined()
  })

  it('collapse() resurrection restores the row’s natural size', async () => {
    const { h, rowFor } = setup(collapse({ duration: 20 }) as ReturnType<typeof fade>)
    const row2 = rowFor(2)!

    h.send({ type: 'set', ids: [1, 3] })
    expect(row2.style.height).toBe('0px')

    h.send({ type: 'set', ids: [1, 2, 3] })
    await vi.advanceTimersByTimeAsync(200)

    expect(row2.isConnected).toBe(true)
    expect(row2.style.height).toBe('')
    expect(row2.style.overflow).toBe('')
  })
})
