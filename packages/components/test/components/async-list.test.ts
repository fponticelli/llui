import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, isLoading, isError, isEmpty } from '../../src/components/async-list'
import type { AsyncListState } from '../../src/components/async-list'
import { rootSignal, read } from '../_signal'

type Item = { id: number; name: string }

describe('async-list reducer', () => {
  it('initializes idle with hasMore:true', () => {
    expect(init<Item>()).toMatchObject({
      items: [],
      page: 0,
      hasMore: true,
      status: 'idle',
    })
  })

  it('loadMore transitions to loading', () => {
    const [s] = update(init<Item>(), { type: 'loadMore' })
    expect(s.status).toBe('loading')
  })

  it('loadMore ignored while already loading', () => {
    const s0 = { ...init<Item>(), status: 'loading' as const }
    const [s] = update(s0, { type: 'loadMore' })
    expect(s).toBe(s0)
  })

  it('loadMore ignored when no more pages', () => {
    const s0 = { ...init<Item>(), hasMore: false }
    const [s] = update(s0, { type: 'loadMore' })
    expect(s).toBe(s0)
  })

  it('pageLoaded appends items + advances page', () => {
    const s0 = init<Item>()
    const [s1] = update(s0, { type: 'loadMore' })
    const [s2] = update(s1, {
      type: 'pageLoaded',
      items: [{ id: 1, name: 'a' }],
      hasMore: true,
    })
    expect(s2.items).toHaveLength(1)
    expect(s2.page).toBe(1)
    expect(s2.status).toBe('loaded')
  })

  it('pageLoaded marks hasMore:false on last page', () => {
    const s0 = init<Item>()
    const [s1] = update(s0, { type: 'loadMore' })
    const [s2] = update(s1, {
      type: 'pageLoaded',
      items: [{ id: 1, name: 'a' }],
      hasMore: false,
    })
    expect(s2.hasMore).toBe(false)
  })

  it('pageFailed sets error status + message', () => {
    const [s1] = update(init<Item>(), { type: 'loadMore' })
    const [s2] = update(s1, { type: 'pageFailed', error: 'offline' })
    expect(s2.status).toBe('error')
    expect(s2.error).toBe('offline')
  })

  it('retry clears error + restarts loading', () => {
    const s0 = {
      ...init<Item>(),
      status: 'error' as const,
      error: 'oops',
    }
    const [s] = update(s0, { type: 'retry' })
    expect(s.status).toBe('loading')
    expect(s.error).toBeNull()
  })

  it('reset clears everything', () => {
    const s0: AsyncListState<Item> = {
      items: [{ id: 1, name: 'a' }],
      page: 3,
      hasMore: false,
      status: 'error',
      error: 'oops',
    }
    const [s] = update(s0, { type: 'reset' })
    expect(s).toMatchObject({
      items: [],
      page: 0,
      hasMore: true,
      status: 'idle',
      error: null,
    })
  })

  it('setItems replaces items + transitions to loaded', () => {
    const [s] = update(init<Item>(), {
      type: 'setItems',
      items: [{ id: 99, name: 'z' }],
      hasMore: false,
    })
    expect(s.items).toEqual([{ id: 99, name: 'z' }])
    expect(s.status).toBe('loaded')
    expect(s.hasMore).toBe(false)
  })
})

describe('helpers', () => {
  it('isLoading / isError / isEmpty', () => {
    expect(isLoading(init<Item>())).toBe(false)
    expect(isLoading({ ...init<Item>(), status: 'loading' })).toBe(true)
    expect(isError({ ...init<Item>(), status: 'error' })).toBe(true)
    expect(isEmpty(init<Item>())).toBe(true)
    expect(isEmpty({ ...init<Item>(), items: [{ id: 1, name: 'a' }] })).toBe(false)
  })
})

describe('async-list.connect', () => {
  it('loadMoreTrigger disabled while loading', () => {
    const p = connect(rootSignal<AsyncListState<Item>>(), vi.fn())
    const loading: AsyncListState<Item> = { ...init<Item>(), status: 'loading' }
    expect(read(p.loadMoreTrigger.disabled, loading)).toBe(true)
  })

  it('loadMoreTrigger disabled when hasMore:false', () => {
    const p = connect(rootSignal<AsyncListState<Item>>(), vi.fn())
    const done: AsyncListState<Item> = { ...init<Item>(), hasMore: false }
    expect(read(p.loadMoreTrigger.disabled, done)).toBe(true)
  })

  it('root data-status reflects state', () => {
    const p = connect(rootSignal<AsyncListState<Item>>(), vi.fn())
    expect(read(p.root['data-status'], init<Item>())).toBe('idle')
  })

  it('retryTrigger hidden unless error', () => {
    const p = connect(rootSignal<AsyncListState<Item>>(), vi.fn())
    expect(read(p.retryTrigger.hidden, init<Item>())).toBe(true)
    const err: AsyncListState<Item> = { ...init<Item>(), status: 'error' }
    expect(read(p.retryTrigger.hidden, err)).toBe(false)
  })

  it('triggers dispatch correct messages', () => {
    const send = vi.fn()
    const p = connect(rootSignal<AsyncListState<Item>>(), send)
    p.loadMoreTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'loadMore' })
    p.retryTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'retry' })
  })
})
