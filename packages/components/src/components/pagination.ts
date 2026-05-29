import type { Send, Signal } from '@llui/dom/signals'
import { useContext, tagSend } from '@llui/dom/signals'
import { LocaleContext, en } from '../locale.js'

/**
 * Pagination — page navigation with ellipses for large ranges.
 * `page` is 1-based. Siblings are the count of pages shown on each side
 * of the current page. Boundaries are shown at the start/end.
 */

export interface PaginationState {
  page: number
  pageSize: number
  total: number
  siblings: number
  boundaries: number
  disabled: boolean
}

export type PaginationMsg =
  /** @intent("Jump to a specific 1-based page number") */
  | { type: 'goTo'; page: number }
  /** @intent("Advance to the next page") */
  | { type: 'next' }
  /** @intent("Go back to the previous page") */
  | { type: 'prev' }
  /** @intent("Jump to the first page") */
  | { type: 'first' }
  /** @intent("Jump to the last page") */
  | { type: 'last' }
  /** @intent("Change how many items each page contains") */
  | { type: 'setPageSize'; pageSize: number }
  /** @humanOnly */
  | { type: 'setTotal'; total: number }

export interface PaginationInit {
  page?: number
  pageSize?: number
  total?: number
  siblings?: number
  boundaries?: number
  disabled?: boolean
}

export function init(opts: PaginationInit = {}): PaginationState {
  return {
    page: opts.page ?? 1,
    pageSize: opts.pageSize ?? 10,
    total: opts.total ?? 0,
    siblings: opts.siblings ?? 1,
    boundaries: opts.boundaries ?? 1,
    disabled: opts.disabled ?? false,
  }
}

export function totalPages(state: PaginationState): number {
  if (state.pageSize <= 0 || state.total <= 0) return 0
  return Math.max(1, Math.ceil(state.total / state.pageSize))
}

function clampPage(page: number, total: number): number {
  if (total === 0) return 1
  return Math.max(1, Math.min(page, total))
}

export function update(state: PaginationState, msg: PaginationMsg): [PaginationState, never[]] {
  if (state.disabled) return [state, []]
  const pages = totalPages(state)
  switch (msg.type) {
    case 'goTo':
      return [{ ...state, page: clampPage(msg.page, pages) }, []]
    case 'next':
      return [{ ...state, page: clampPage(state.page + 1, pages) }, []]
    case 'prev':
      return [{ ...state, page: clampPage(state.page - 1, pages) }, []]
    case 'first':
      return [{ ...state, page: 1 }, []]
    case 'last':
      return [{ ...state, page: pages }, []]
    case 'setPageSize': {
      // Preserve first visible item when pageSize changes
      const firstItem = (state.page - 1) * state.pageSize
      const nextPage = Math.floor(firstItem / msg.pageSize) + 1
      const nextPages = Math.max(1, Math.ceil(state.total / msg.pageSize))
      return [{ ...state, pageSize: msg.pageSize, page: Math.min(nextPage, nextPages) }, []]
    }
    case 'setTotal': {
      const nextPages = Math.max(1, Math.ceil(msg.total / state.pageSize))
      return [{ ...state, total: msg.total, page: Math.min(state.page, nextPages) }, []]
    }
  }
}

export type PageItem =
  | { type: 'page'; page: number }
  | { type: 'ellipsis'; position: 'start' | 'end' }

/**
 * Compute the visible page buttons with ellipses:
 * `[first ..boundaries] … [siblings around current] … [boundaries ..last]`.
 */
export function pageItems(state: PaginationState): PageItem[] {
  const pages = totalPages(state)
  if (pages === 0) return []

  // Build the set of pages we want to show: first boundary, last boundary,
  // and current ± siblings.
  const pageSet = new Set<number>()
  for (let i = 1; i <= Math.min(state.boundaries, pages); i++) pageSet.add(i)
  for (let i = Math.max(pages - state.boundaries + 1, 1); i <= pages; i++) pageSet.add(i)
  const start = Math.max(1, state.page - state.siblings)
  const end = Math.min(pages, state.page + state.siblings)
  for (let i = start; i <= end; i++) pageSet.add(i)

  // Emit items in order, inserting ellipses for gaps > 1.
  const sorted = [...pageSet].sort((a, b) => a - b)
  const items: PageItem[] = []
  for (let i = 0; i < sorted.length; i++) {
    const page = sorted[i]!
    items.push({ type: 'page', page })
    if (i < sorted.length - 1 && sorted[i + 1]! - page > 1) {
      items.push({ type: 'ellipsis', position: page < state.page ? 'start' : 'end' })
    }
  }
  return items
}

export interface PaginationParts {
  root: {
    role: 'navigation'
    'aria-label': string
    'data-scope': 'pagination'
    'data-part': 'root'
    'data-disabled': Signal<'' | undefined>
  }
  prevTrigger: {
    type: 'button'
    'aria-label': string
    'aria-disabled': Signal<'true' | undefined>
    disabled: Signal<boolean>
    'data-scope': 'pagination'
    'data-part': 'prev-trigger'
    onClick: (e: MouseEvent) => void
  }
  nextTrigger: {
    type: 'button'
    'aria-label': string
    'aria-disabled': Signal<'true' | undefined>
    disabled: Signal<boolean>
    'data-scope': 'pagination'
    'data-part': 'next-trigger'
    onClick: (e: MouseEvent) => void
  }
  item: (page: number) => {
    type: 'button'
    'aria-label': string
    'aria-current': Signal<'page' | undefined>
    'data-selected': Signal<'' | undefined>
    'data-scope': 'pagination'
    'data-part': 'item'
    'data-value': string
    onClick: (e: MouseEvent) => void
  }
  ellipsis: (position: 'start' | 'end') => {
    'aria-hidden': 'true'
    'data-scope': 'pagination'
    'data-part': 'ellipsis'
    'data-position': 'start' | 'end'
  }
}

export interface ConnectOptions {
  label?: string
  prevLabel?: string
  nextLabel?: string
  pageLabel?: (page: number) => string
}

export function connect(
  state: Signal<PaginationState>,
  send: Send<PaginationMsg>,
  opts: ConnectOptions = {},
): PaginationParts {
  const locale = useContext(LocaleContext)
  const label = opts.label ?? locale.pagination.label
  const prevLabel = opts.prevLabel ?? locale.pagination.prev
  const nextLabel = opts.nextLabel ?? locale.pagination.next
  const pageLabel = opts.pageLabel ?? en.pagination.page

  return {
    root: {
      role: 'navigation',
      'aria-label': label,
      'data-scope': 'pagination',
      'data-part': 'root',
      'data-disabled': state.map((st) => (st.disabled ? '' : undefined)),
    },
    prevTrigger: {
      type: 'button',
      'aria-label': prevLabel,
      'aria-disabled': state.map((st) => (st.page <= 1 || st.disabled ? 'true' : undefined)),
      disabled: state.map((st) => st.page <= 1 || st.disabled),
      'data-scope': 'pagination',
      'data-part': 'prev-trigger',
      onClick: tagSend(send, ['prev'], () => send({ type: 'prev' })),
    },
    nextTrigger: {
      type: 'button',
      'aria-label': nextLabel,
      'aria-disabled': state.map((st) =>
        st.page >= totalPages(st) || st.disabled ? 'true' : undefined,
      ),
      disabled: state.map((st) => st.page >= totalPages(st) || st.disabled),
      'data-scope': 'pagination',
      'data-part': 'next-trigger',
      onClick: tagSend(send, ['next'], () => send({ type: 'next' })),
    },
    item: (page: number) => ({
      type: 'button',
      'aria-label': pageLabel(page),
      'aria-current': state.map((st) => (st.page === page ? 'page' : undefined)),
      'data-selected': state.map((st) => (st.page === page ? '' : undefined)),
      'data-scope': 'pagination',
      'data-part': 'item',
      'data-value': String(page),
      onClick: tagSend(send, ['goTo'], () => send({ type: 'goTo', page })),
    }),
    ellipsis: (position: 'start' | 'end') => ({
      'aria-hidden': 'true',
      'data-scope': 'pagination',
      'data-part': 'ellipsis',
      'data-position': position,
    }),
  }
}

export const pagination = { init, update, connect, totalPages, pageItems }
