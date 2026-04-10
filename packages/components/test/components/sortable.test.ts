import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, reorder } from '../../src/components/sortable'
import type { SortableState } from '../../src/components/sortable'

describe('reorder utility', () => {
  it('moves item forward', () => {
    expect(reorder(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
  })
  it('moves item backward', () => {
    expect(reorder(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c'])
  })
  it('is a no-op when from === to', () => {
    const arr = ['a', 'b', 'c']
    const result = reorder(arr, 1, 1)
    expect(result).toEqual(['a', 'b', 'c'])
  })
  it('clamps out-of-range indices', () => {
    expect(reorder(['a', 'b', 'c'], 0, 99)).toEqual(['b', 'c', 'a'])
    expect(reorder(['a', 'b', 'c'], 2, -5)).toEqual(['c', 'a', 'b'])
  })
})

describe('sortable reducer', () => {
  it('initializes with no dragging', () => {
    expect(init()).toEqual({ dragging: null })
  })

  it('start sets dragging state', () => {
    const [s] = update(init(), { type: 'start', id: 'item-1', index: 2 })
    expect(s.dragging).toEqual({ id: 'item-1', startIndex: 2, currentIndex: 2 })
  })

  it('move updates currentIndex', () => {
    const started: SortableState = {
      dragging: { id: 'item-1', startIndex: 2, currentIndex: 2 },
    }
    const [s] = update(started, { type: 'move', index: 4 })
    expect(s.dragging?.currentIndex).toBe(4)
  })

  it('move is idempotent when index is unchanged', () => {
    const started: SortableState = {
      dragging: { id: 'x', startIndex: 0, currentIndex: 3 },
    }
    const [next] = update(started, { type: 'move', index: 3 })
    expect(next).toBe(started)
  })

  it('move ignored when not dragging', () => {
    const [s] = update(init(), { type: 'move', index: 4 })
    expect(s.dragging).toBeNull()
  })

  it('drop clears dragging', () => {
    const started: SortableState = {
      dragging: { id: 'x', startIndex: 0, currentIndex: 3 },
    }
    const [s] = update(started, { type: 'drop' })
    expect(s.dragging).toBeNull()
  })

  it('cancel clears dragging', () => {
    const started: SortableState = {
      dragging: { id: 'x', startIndex: 0, currentIndex: 3 },
    }
    const [s] = update(started, { type: 'cancel' })
    expect(s.dragging).toBeNull()
  })
})

describe('sortable.connect', () => {
  type Ctx = { sort: SortableState }

  it('root has data-scope and data-part', () => {
    const parts = connect<Ctx>((s) => s.sort, vi.fn(), { id: 'list1' })
    expect(parts.root['data-scope']).toBe('sortable')
    expect(parts.root['data-part']).toBe('root')
  })

  it('root data-dragging reflects state', () => {
    const parts = connect<Ctx>((s) => s.sort, vi.fn(), { id: 'list1' })
    expect(parts.root['data-dragging']({ sort: { dragging: null } })).toBeUndefined()
    expect(
      parts.root['data-dragging']({
        sort: { dragging: { id: 'x', startIndex: 0, currentIndex: 1 } },
      }),
    ).toBe('')
  })

  it('item data-dragging flags the currently-dragged item', () => {
    const parts = connect<Ctx>((s) => s.sort, vi.fn(), { id: 'list1' })
    const item = parts.item('apple', 0)
    expect(
      item['data-dragging']({
        sort: { dragging: { id: 'apple', startIndex: 0, currentIndex: 0 } },
      }),
    ).toBe('')
    expect(
      item['data-dragging']({
        sort: { dragging: { id: 'banana', startIndex: 1, currentIndex: 0 } },
      }),
    ).toBeUndefined()
  })

  it('handle onPointerDown sends start message', () => {
    const send = vi.fn()
    const parts = connect<Ctx>((s) => s.sort, send, { id: 'list1' })
    parts.handle('apple', 2).onPointerDown({
      pointerId: 1,
      currentTarget: null,
      preventDefault: () => {},
    } as unknown as PointerEvent)
    expect(send).toHaveBeenCalledWith({ type: 'start', id: 'apple', index: 2 })
  })

  it('item[data-index] carries the index', () => {
    const parts = connect<Ctx>((s) => s.sort, vi.fn(), { id: 'list1' })
    expect(parts.item('x', 3)['data-index']).toBe('3')
  })
})
