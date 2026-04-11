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
    const [s] = update(init(), {
      type: 'start',
      id: 'item-1',
      index: 2,
      container: 'list1',
      y: 0,
    })
    expect(s.dragging).toEqual({
      id: 'item-1',
      startIndex: 2,
      currentIndex: 2,
      fromContainer: 'list1',
      toContainer: 'list1',
      startY: 0,
      currentY: 0,
    })
  })

  it('move updates currentIndex', () => {
    const started: SortableState = {
      dragging: {
        id: 'item-1',
        startIndex: 2,
        currentIndex: 2,
        fromContainer: 'list1',
        toContainer: 'list1',
        startY: 0,
        currentY: 0,
      },
    }
    const [s] = update(started, { type: 'move', index: 4, container: 'list1', y: 0 })
    expect(s.dragging?.currentIndex).toBe(4)
  })

  it('move is idempotent when index is unchanged', () => {
    const started: SortableState = {
      dragging: {
        id: 'x',
        startIndex: 0,
        currentIndex: 3,
        fromContainer: 'list1',
        toContainer: 'list1',
        startY: 0,
        currentY: 0,
      },
    }
    const [next] = update(started, { type: 'move', index: 3, container: 'list1', y: 0 })
    expect(next).toBe(started)
  })

  it('move ignored when not dragging', () => {
    const [s] = update(init(), { type: 'move', index: 4, container: 'list1', y: 0 })
    expect(s.dragging).toBeNull()
  })

  it('drop clears dragging', () => {
    const started: SortableState = {
      dragging: {
        id: 'x',
        startIndex: 0,
        currentIndex: 3,
        fromContainer: 'list1',
        toContainer: 'list1',
        startY: 0,
        currentY: 0,
      },
    }
    const [s] = update(started, { type: 'drop' })
    expect(s.dragging).toBeNull()
  })

  it('cancel clears dragging', () => {
    const started: SortableState = {
      dragging: {
        id: 'x',
        startIndex: 0,
        currentIndex: 3,
        fromContainer: 'list1',
        toContainer: 'list1',
        startY: 0,
        currentY: 0,
      },
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
        sort: {
          dragging: {
            id: 'x',
            startIndex: 0,
            currentIndex: 1,
            fromContainer: 'list1',
            toContainer: 'list1',
            startY: 0,
            currentY: 0,
          },
        },
      }),
    ).toBe('')
  })

  it('item data-dragging flags the currently-dragged item', () => {
    const parts = connect<Ctx>((s) => s.sort, vi.fn(), { id: 'list1' })
    const item = parts.item('apple', 0)
    expect(
      item['data-dragging']({
        sort: {
          dragging: {
            id: 'apple',
            startIndex: 0,
            currentIndex: 0,
            fromContainer: 'list1',
            toContainer: 'list1',
            startY: 0,
            currentY: 0,
          },
        },
      }),
    ).toBe('')
    expect(
      item['data-dragging']({
        sort: {
          dragging: {
            id: 'banana',
            startIndex: 1,
            currentIndex: 0,
            fromContainer: 'list1',
            toContainer: 'list1',
            startY: 0,
            currentY: 0,
          },
        },
      }),
    ).toBeUndefined()
  })

  it('handle onPointerDown sends start message', () => {
    const send = vi.fn()
    const parts = connect<Ctx>((s) => s.sort, send, { id: 'list1' })
    parts.handle('apple', 2).onPointerDown({
      pointerId: 1,
      currentTarget: null,
      clientY: 0,
      preventDefault: () => {},
    } as unknown as PointerEvent)
    expect(send).toHaveBeenCalledWith({
      type: 'start',
      id: 'apple',
      index: 2,
      container: 'list1',
      y: expect.any(Number),
    })
  })

  it('item[data-index] carries the index', () => {
    const parts = connect<Ctx>((s) => s.sort, vi.fn(), { id: 'list1' })
    expect(parts.item('x', 3)['data-index']).toBe('3')
  })

  it('handle has aria-grabbed reflecting drag state', () => {
    const parts = connect<Ctx>((s) => s.sort, vi.fn(), { id: 'list1' })
    const h = parts.handle('apple', 2)
    expect(h['aria-grabbed']({ sort: { dragging: null } })).toBe(false)
    expect(
      h['aria-grabbed']({
        sort: {
          dragging: {
            id: 'apple',
            startIndex: 2,
            currentIndex: 2,
            fromContainer: 'list1',
            toContainer: 'list1',
            startY: 0,
            currentY: 0,
          },
        },
      }),
    ).toBe(true)
  })

  it('handle has tabIndex=0 for keyboard focus', () => {
    const parts = connect<Ctx>((s) => s.sort, vi.fn(), { id: 'list1' })
    expect(parts.handle('apple', 2).tabIndex).toBe(0)
  })

  it('handle role is button', () => {
    const parts = connect<Ctx>((s) => s.sort, vi.fn(), { id: 'list1' })
    expect(parts.handle('apple', 2).role).toBe('button')
  })
})

describe('sortable keyboard events', () => {
  type Ctx = { sort: SortableState }

  function makeKey(key: string): KeyboardEvent {
    return new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true })
  }

  it('Space sends toggleGrab', () => {
    const send = vi.fn()
    const parts = connect<Ctx>((s) => s.sort, send, { id: 'list1' })
    const e = makeKey(' ')
    parts.handle('apple', 1).onKeyDown(e)
    expect(send).toHaveBeenCalledWith({
      type: 'toggleGrab',
      id: 'apple',
      index: 1,
      container: 'list1',
    })
    expect(e.defaultPrevented).toBe(true)
  })

  it('Enter sends toggleGrab', () => {
    const send = vi.fn()
    const parts = connect<Ctx>((s) => s.sort, send, { id: 'list1' })
    parts.handle('apple', 1).onKeyDown(makeKey('Enter'))
    expect(send).toHaveBeenCalledWith({
      type: 'toggleGrab',
      id: 'apple',
      index: 1,
      container: 'list1',
    })
  })

  it('Escape sends cancel', () => {
    const send = vi.fn()
    const parts = connect<Ctx>((s) => s.sort, send, { id: 'list1' })
    parts.handle('apple', 1).onKeyDown(makeKey('Escape'))
    expect(send).toHaveBeenCalledWith({ type: 'cancel' })
  })

  it('ArrowDown sends moveBy +1', () => {
    const send = vi.fn()
    const parts = connect<Ctx>((s) => s.sort, send, { id: 'list1' })
    const e = makeKey('ArrowDown')
    parts.handle('apple', 0).onKeyDown(e)
    expect(send).toHaveBeenCalledWith({ type: 'moveBy', delta: 1 })
    expect(e.defaultPrevented).toBe(true)
  })

  it('ArrowUp sends moveBy -1', () => {
    const send = vi.fn()
    const parts = connect<Ctx>((s) => s.sort, send, { id: 'list1' })
    parts.handle('apple', 2).onKeyDown(makeKey('ArrowUp'))
    expect(send).toHaveBeenCalledWith({ type: 'moveBy', delta: -1 })
  })

  it('unrelated keys are ignored', () => {
    const send = vi.fn()
    const parts = connect<Ctx>((s) => s.sort, send, { id: 'list1' })
    parts.handle('apple', 0).onKeyDown(makeKey('a'))
    expect(send).not.toHaveBeenCalled()
  })
})

describe('sortable reducer — keyboard messages', () => {
  it('toggleGrab starts when not dragging', () => {
    const [s] = update(init(), { type: 'toggleGrab', id: 'apple', index: 2, container: 'list1' })
    expect(s.dragging).toEqual({
      id: 'apple',
      startIndex: 2,
      currentIndex: 2,
      fromContainer: 'list1',
      toContainer: 'list1',
      startY: 0,
      currentY: 0,
    })
  })

  it('toggleGrab drops when already dragging', () => {
    const state: SortableState = {
      dragging: {
        id: 'apple',
        startIndex: 0,
        currentIndex: 3,
        fromContainer: 'list1',
        toContainer: 'list1',
        startY: 0,
        currentY: 0,
      },
    }
    const [s] = update(state, { type: 'toggleGrab', id: 'banana', index: 1, container: 'list1' })
    expect(s.dragging).toBeNull()
  })

  it('moveBy updates currentIndex when dragging', () => {
    const state: SortableState = {
      dragging: {
        id: 'apple',
        startIndex: 0,
        currentIndex: 2,
        fromContainer: 'list1',
        toContainer: 'list1',
        startY: 0,
        currentY: 0,
      },
    }
    const [s] = update(state, { type: 'moveBy', delta: 1 })
    expect(s.dragging?.currentIndex).toBe(3)
  })

  it('moveBy negative delta works', () => {
    const state: SortableState = {
      dragging: {
        id: 'apple',
        startIndex: 0,
        currentIndex: 5,
        fromContainer: 'list1',
        toContainer: 'list1',
        startY: 0,
        currentY: 0,
      },
    }
    const [s] = update(state, { type: 'moveBy', delta: -2 })
    expect(s.dragging?.currentIndex).toBe(3)
  })

  it('moveBy clamps at zero', () => {
    const state: SortableState = {
      dragging: {
        id: 'apple',
        startIndex: 0,
        currentIndex: 0,
        fromContainer: 'list1',
        toContainer: 'list1',
        startY: 0,
        currentY: 0,
      },
    }
    const [s] = update(state, { type: 'moveBy', delta: -5 })
    expect(s.dragging?.currentIndex).toBe(0)
  })

  it('moveBy is ignored when not dragging', () => {
    const [s] = update(init(), { type: 'moveBy', delta: 1 })
    expect(s.dragging).toBeNull()
  })
})

describe('sortable cross-container', () => {
  it('start sets fromContainer and toContainer to the same value', () => {
    const [s] = update(init(), { type: 'start', id: 'a', index: 0, container: 'todo', y: 0 })
    expect(s.dragging?.fromContainer).toBe('todo')
    expect(s.dragging?.toContainer).toBe('todo')
  })

  it('move to a different container updates toContainer', () => {
    const [s1] = update(init(), { type: 'start', id: 'a', index: 0, container: 'todo', y: 0 })
    const [s2] = update(s1, { type: 'move', index: 2, container: 'done', y: 0 })
    expect(s2.dragging?.fromContainer).toBe('todo')
    expect(s2.dragging?.toContainer).toBe('done')
    expect(s2.dragging?.currentIndex).toBe(2)
  })

  it('move within the same container updates only currentIndex', () => {
    const [s1] = update(init(), { type: 'start', id: 'a', index: 0, container: 'todo', y: 0 })
    const [s2] = update(s1, { type: 'move', index: 3, container: 'todo', y: 0 })
    expect(s2.dragging?.toContainer).toBe('todo')
    expect(s2.dragging?.currentIndex).toBe(3)
  })

  it('move is idempotent when both index and container are unchanged', () => {
    const [s1] = update(init(), { type: 'start', id: 'a', index: 2, container: 'todo', y: 0 })
    const [s2] = update(s1, { type: 'move', index: 2, container: 'todo', y: 0 })
    expect(s2).toBe(s1)
  })

  it('moving from one container to another then back', () => {
    const [s1] = update(init(), { type: 'start', id: 'a', index: 0, container: 'todo', y: 0 })
    const [s2] = update(s1, { type: 'move', index: 0, container: 'done', y: 0 })
    const [s3] = update(s2, { type: 'move', index: 1, container: 'todo', y: 0 })
    expect(s3.dragging?.fromContainer).toBe('todo')
    expect(s3.dragging?.toContainer).toBe('todo')
    expect(s3.dragging?.currentIndex).toBe(1)
  })

  it('connect roots have data-container-id matching their connect id', () => {
    type Ctx = { sort: SortableState }
    const list1 = connect<Ctx>((s) => s.sort, vi.fn(), { id: 'todo' })
    const list2 = connect<Ctx>((s) => s.sort, vi.fn(), { id: 'done' })
    expect(list1.root['data-container-id']).toBe('todo')
    expect(list2.root['data-container-id']).toBe('done')
  })

  it('item data-dragging only flags items in the source container', () => {
    type Ctx = { sort: SortableState }
    const todoParts = connect<Ctx>((s) => s.sort, vi.fn(), { id: 'todo' })
    const doneParts = connect<Ctx>((s) => s.sort, vi.fn(), { id: 'done' })
    const state: Ctx = {
      sort: {
        dragging: {
          id: 'task-1',
          startIndex: 0,
          currentIndex: 0,
          fromContainer: 'todo',
          toContainer: 'done',
          startY: 0,
          currentY: 0,
        },
      },
    }
    expect(todoParts.item('task-1', 0)['data-dragging'](state)).toBe('')
    // Same id but in different container — not dragging from done
    expect(doneParts.item('task-1', 0)['data-dragging'](state)).toBeUndefined()
  })

  it('item data-over only flags items in the target container', () => {
    type Ctx = { sort: SortableState }
    const todoParts = connect<Ctx>((s) => s.sort, vi.fn(), { id: 'todo' })
    const doneParts = connect<Ctx>((s) => s.sort, vi.fn(), { id: 'done' })
    const state: Ctx = {
      sort: {
        dragging: {
          id: 'task-1',
          startIndex: 0,
          currentIndex: 2,
          fromContainer: 'todo',
          toContainer: 'done',
          startY: 0,
          currentY: 0,
        },
      },
    }
    // currentIndex 2 is in the target container 'done'
    expect(doneParts.item('task-x', 2)['data-over'](state)).toBe('')
    // Same index but wrong container
    expect(todoParts.item('task-y', 2)['data-over'](state)).toBeUndefined()
  })
})
