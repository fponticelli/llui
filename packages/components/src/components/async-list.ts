import type { Send } from '@llui/dom'

/**
 * Async list — paginated/infinite-scroll list that accumulates pages.
 * The machine is generic over the item type; the consumer runs the
 * actual fetch in response to `loadMore` (via a custom handler or
 * effect) and dispatches `pageLoaded`/`pageFailed` when the request
 * completes.
 *
 * Typical flow in consumer's update handler:
 *
 *   (state, msg) => {
 *     if (msg.type === 'loadMore') {
 *       fetch(`/api/items?page=${state.list.page + 1}`)
 *         .then(r => r.json())
 *         .then(items => send({type: 'pageLoaded', items, hasMore: items.length === PAGE_SIZE}))
 *         .catch(e => send({type: 'pageFailed', error: String(e)}))
 *     }
 *   }
 */

export type AsyncStatus = 'idle' | 'loading' | 'loaded' | 'error'

export interface AsyncListState<T = unknown> {
  items: T[]
  page: number
  hasMore: boolean
  status: AsyncStatus
  error: string | null
}

export type AsyncListMsg<T = unknown> =
  | { type: 'loadMore' }
  | { type: 'pageLoaded'; items: T[]; hasMore: boolean }
  | { type: 'pageFailed'; error: string }
  | { type: 'reset' }
  | { type: 'setItems'; items: T[]; hasMore?: boolean }
  | { type: 'retry' }

export interface AsyncListInit<T = unknown> {
  items?: T[]
  page?: number
  hasMore?: boolean
}

export function init<T = unknown>(opts: AsyncListInit<T> = {}): AsyncListState<T> {
  return {
    items: opts.items ?? [],
    page: opts.page ?? 0,
    hasMore: opts.hasMore ?? true,
    status: 'idle',
    error: null,
  }
}

export function update<T>(
  state: AsyncListState<T>,
  msg: AsyncListMsg<T>,
): [AsyncListState<T>, never[]] {
  switch (msg.type) {
    case 'loadMore':
    case 'retry':
      if (state.status === 'loading' || !state.hasMore) return [state, []]
      return [{ ...state, status: 'loading', error: null }, []]
    case 'pageLoaded':
      return [
        {
          ...state,
          items: [...state.items, ...msg.items],
          page: state.page + 1,
          hasMore: msg.hasMore,
          status: 'loaded',
          error: null,
        },
        [],
      ]
    case 'pageFailed':
      return [{ ...state, status: 'error', error: msg.error }, []]
    case 'reset':
      return [{ items: [], page: 0, hasMore: true, status: 'idle', error: null }, []]
    case 'setItems':
      return [
        {
          ...state,
          items: msg.items,
          hasMore: msg.hasMore ?? state.hasMore,
          status: 'loaded',
          error: null,
        },
        [],
      ]
  }
}

export function isLoading<T>(state: AsyncListState<T>): boolean {
  return state.status === 'loading'
}

export function isError<T>(state: AsyncListState<T>): boolean {
  return state.status === 'error'
}

export function isEmpty<T>(state: AsyncListState<T>): boolean {
  return state.items.length === 0
}

export interface AsyncListParts<S, _T> {
  root: {
    'data-scope': 'async-list'
    'data-part': 'root'
    'data-status': (s: S) => AsyncStatus
  }
  sentinel: {
    'data-scope': 'async-list'
    'data-part': 'sentinel'
    'aria-hidden': 'true'
  }
  loadMoreTrigger: {
    type: 'button'
    disabled: (s: S) => boolean
    'data-scope': 'async-list'
    'data-part': 'load-more-trigger'
    onClick: (e: MouseEvent) => void
  }
  retryTrigger: {
    type: 'button'
    'data-scope': 'async-list'
    'data-part': 'retry-trigger'
    hidden: (s: S) => boolean
    onClick: (e: MouseEvent) => void
  }
  errorText: {
    role: 'alert'
    'aria-live': 'polite'
    'data-scope': 'async-list'
    'data-part': 'error-text'
    hidden: (s: S) => boolean
  }
}

export function connect<S, T>(
  get: (s: S) => AsyncListState<T>,
  send: Send<AsyncListMsg<T>>,
): AsyncListParts<S, T> {
  return {
    root: {
      'data-scope': 'async-list',
      'data-part': 'root',
      'data-status': (s) => get(s).status,
    },
    sentinel: {
      'data-scope': 'async-list',
      'data-part': 'sentinel',
      'aria-hidden': 'true',
    },
    loadMoreTrigger: {
      type: 'button',
      disabled: (s) => {
        const st = get(s)
        return st.status === 'loading' || !st.hasMore
      },
      'data-scope': 'async-list',
      'data-part': 'load-more-trigger',
      onClick: () => send({ type: 'loadMore' }),
    },
    retryTrigger: {
      type: 'button',
      'data-scope': 'async-list',
      'data-part': 'retry-trigger',
      hidden: (s) => get(s).status !== 'error',
      onClick: () => send({ type: 'retry' }),
    },
    errorText: {
      role: 'alert',
      'aria-live': 'polite',
      'data-scope': 'async-list',
      'data-part': 'error-text',
      hidden: (s) => get(s).status !== 'error',
    },
  }
}

/**
 * Install an IntersectionObserver on the sentinel element that auto-dispatches
 * `loadMore` whenever the sentinel scrolls into view. Call from onMount.
 */
export function watchSentinel<T>(
  send: Send<AsyncListMsg<T>>,
  sentinel: Element,
  rootMargin: string = '200px',
): () => void {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          send({ type: 'loadMore' })
          return
        }
      }
    },
    { rootMargin },
  )
  io.observe(sentinel)
  return () => io.disconnect()
}

export const asyncList = {
  init,
  update,
  connect,
  isLoading,
  isError,
  isEmpty,
  watchSentinel,
}
