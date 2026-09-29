import { describe, it, expect, afterEach } from 'vitest'
import { component, mountApp, div, span, text, each } from '@llui/dom'
import {
  init,
  update,
  connect,
  droppedMove,
  reorder,
  type SortableMsg,
  type SortableState,
} from '../../src/components/sortable'

/**
 * A sortable whose list REORDERS LIVE: the app owns `items`, the machine owns
 * the drag, and a completed drop — pointer `drop` OR a keyboard `toggleGrab`
 * while grabbed — moves the item. Keyed `each` moves the row nodes without
 * re-running their render, so anything the handle captured at render time
 * (its index) is stale after the first reorder.
 */

describe('droppedMove', () => {
  const grabbed = (from: number, to: number): SortableState => ({
    announcement: null,
    dragging: {
      id: 'a',
      startIndex: from,
      currentIndex: to,
      fromContainer: 'list',
      toContainer: 'list',
      startX: 0,
      startY: 0,
      currentX: 0,
      currentY: 0,
      count: 10,
    },
  })

  it('reports the move a pointer drop or a keyboard drop completes', () => {
    expect(droppedMove(grabbed(0, 2), { type: 'drop' })).toEqual({ from: 0, to: 2 })
    expect(
      droppedMove(grabbed(3, 1), {
        type: 'toggleGrab',
        id: 'a',
        index: 3,
        count: 10,
        container: 'list',
      }),
    ).toEqual({ from: 3, to: 1 })
  })

  it('reports nothing for a cancel, a move, a pick-up, or a drop onto another container', () => {
    expect(droppedMove(grabbed(0, 2), { type: 'cancel' })).toBeNull()
    expect(droppedMove(grabbed(0, 2), { type: 'moveBy', delta: 1 })).toBeNull()
    expect(
      droppedMove(init(), { type: 'toggleGrab', id: 'a', index: 0, count: 10, container: 'list' }),
    ).toBeNull()
    expect(droppedMove(init(), { type: 'drop' })).toBeNull()
    const across: SortableState = {
      announcement: null,
      dragging: { ...grabbed(0, 2).dragging!, toContainer: 'other' },
    }
    expect(droppedMove(across, { type: 'drop' })).toBeNull()
  })
})

describe('a live-reordering sortable', () => {
  let app: ReturnType<typeof mountApp> | null = null
  afterEach(() => {
    app?.dispose()
    app = null
    document.body.innerHTML = ''
  })

  interface Ctx {
    items: string[]
    sort: SortableState
  }
  type Msg = { type: 'sort'; msg: SortableMsg }

  function mount(items: string[]): { state: () => Ctx } {
    let latest: Ctx = { items, sort: init() }
    const def = component<Ctx, Msg>({
      name: 'LiveSortable',
      init: () => latest,
      update: (state, msg) => {
        const moved = droppedMove(state.sort, msg.msg)
        const [sort] = update(state.sort, msg.msg)
        latest = {
          items: moved === null ? state.items : reorder(state.items, moved.from, moved.to),
          sort,
        }
        return latest
      },
      view: ({ state, send }) => {
        const parts = connect(state.at('sort'), (m) => send({ type: 'sort', msg: m }), {
          id: 'list',
        })
        return [
          div({ ...parts.root }, [
            each(state.at('items'), {
              key: (item) => item,
              render: (item, index) => {
                const id = item.peek()
                const at = index.peek()
                return [
                  div({ ...parts.item(id, at) }, [
                    div({ ...parts.handle(id, at) }, [text('⋮')]),
                    span([text(item)]),
                  ]),
                ]
              },
            }),
          ]),
        ]
      },
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    app = mountApp(host, def)
    return { state: () => latest }
  }

  const handleOf = (label: string): HTMLElement => {
    const item = Array.from(document.querySelectorAll<HTMLElement>('[data-part="item"]')).find(
      (el) => el.textContent?.includes(label),
    )
    return item!.querySelector<HTMLElement>('[data-part="handle"]')!
  }
  const key = (el: HTMLElement, k: string): void => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  }
  const order = (): string[] =>
    Array.from(document.querySelectorAll('[data-part="item"] span')).map((s) => s.textContent!)

  it('a keyboard drop reorders, and the next grab starts from the CURRENT index', () => {
    const { state } = mount(['A', 'B', 'C', 'D'])
    key(handleOf('A'), ' ')
    key(handleOf('A'), 'ArrowDown')
    key(handleOf('A'), 'ArrowDown')
    key(handleOf('A'), ' ')
    expect(order()).toEqual(['B', 'C', 'A', 'D'])
    expect(state().items).toEqual(['B', 'C', 'A', 'D'])

    // `B` rendered at index 1 and now sits at 0. A grab that reported the
    // render-time index would move the wrong item on the next drop.
    key(handleOf('B'), ' ')
    expect(state().sort.dragging?.startIndex).toBe(0)
    key(handleOf('B'), 'ArrowDown')
    key(handleOf('B'), ' ')
    expect(order()).toEqual(['C', 'B', 'A', 'D'])
  })

  it('arrow keys never carry the drop target past either end of the list', () => {
    const { state } = mount(['A', 'B', 'C'])
    key(handleOf('B'), ' ')
    for (let i = 0; i < 5; i++) key(handleOf('B'), 'ArrowDown')
    expect(state().sort.dragging?.currentIndex).toBe(2)
    for (let i = 0; i < 5; i++) key(handleOf('B'), 'ArrowUp')
    expect(state().sort.dragging?.currentIndex).toBe(0)
    // The drop target is always a real item: exactly one carries data-over.
    expect(document.querySelectorAll('[data-over]')).toHaveLength(1)
  })

  it('Escape cancels without reordering', () => {
    const { state } = mount(['A', 'B', 'C'])
    key(handleOf('A'), ' ')
    key(handleOf('A'), 'ArrowDown')
    key(handleOf('A'), 'Escape')
    expect(order()).toEqual(['A', 'B', 'C'])
    expect(state().sort.dragging).toBeNull()
  })
})
