import type { Send, Signal } from '@llui/dom'
import { useContext, tagSend } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import { flipArrow, type TextDirection } from '../utils/direction.js'

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
  dir: TextDirection
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
  /** @intent("Set the reading direction (ltr/rtl)") */
  | { type: 'setDir'; dir: TextDirection }

export interface PaginationInit {
  page?: number
  pageSize?: number
  total?: number
  siblings?: number
  boundaries?: number
  disabled?: boolean
  dir?: TextDirection
}

export function init(opts: PaginationInit = {}): PaginationState {
  return {
    page: opts.page ?? 1,
    pageSize: opts.pageSize ?? 10,
    total: opts.total ?? 0,
    siblings: opts.siblings ?? 1,
    boundaries: opts.boundaries ?? 1,
    disabled: opts.disabled ?? false,
    dir: opts.dir ?? 'ltr',
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
  // `setDir` is a config change, not navigation — apply it even when disabled.
  if (msg.type === 'setDir') return [{ ...state, dir: msg.dir }, []]
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

/**
 * The focusable pagination controls, in visual (DOM) order. Ellipsis items
 * are NOT focusable, so they never appear here — arrow navigation skips them
 * for free. Disabled prev/next buttons carry the native `disabled` attribute
 * and are likewise excluded.
 *
 * Relies only on the part contract `[data-scope="pagination"][data-part]`,
 * matching the markup `connect()` produces.
 */
function focusableControls(root: Element): HTMLButtonElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(
    '[data-scope="pagination"][data-part="prev-trigger"],' +
      '[data-scope="pagination"][data-part="item"],' +
      '[data-scope="pagination"][data-part="next-trigger"]',
  )
  const out: HTMLButtonElement[] = []
  for (const n of nodes) {
    if (n instanceof HTMLButtonElement && !n.disabled) out.push(n)
  }
  return out
}

/**
 * Roving keyboard move resolved against the live controls. The index math is
 * orientation-agnostic; RTL only changes which key counts as "forward", routed
 * through the single source of truth `flipArrow`. `dir` is the explicit reading
 * direction from State; when omitted, direction is resolved from the DOM
 * (`dir="rtl"` ancestor). Returns the control to focus, or `null` for a no-op
 * (key isn't a navigation key, or no movable target).
 */
function resolveControlFocus(e: KeyboardEvent, dir?: TextDirection): HTMLElement | null {
  const target = e.currentTarget
  if (!(target instanceof HTMLElement)) return null
  const root = target.closest('[data-scope="pagination"][data-part="root"]')
  if (!root) return null
  const controls = focusableControls(root)
  if (controls.length === 0) return null
  const idx = controls.indexOf(target as HTMLButtonElement)
  if (idx === -1) return null

  // Under rtl, ArrowLeft/ArrowRight swap (`flipArrow`); Home/End are unchanged.
  const key = flipArrow(e.key, dir ?? target)
  switch (key) {
    case 'ArrowRight':
      return idx < controls.length - 1 ? controls[idx + 1]! : null
    case 'ArrowLeft':
      return idx > 0 ? controls[idx - 1]! : null
    case 'Home':
      return controls[0]!
    case 'End':
      return controls[controls.length - 1]!
    default:
      return null
  }
}

/**
 * `onKeyDown` for every focusable pagination control. Moves DOM focus across
 * the controls (ArrowLeft/ArrowRight, Home/End), skipping ellipsis + disabled
 * prev/next. Page triggers stay real `<button>`s, so Enter/Space activate
 * natively — this handler deliberately ignores them.
 *
 * `dir` is the explicit reading direction (from State); omit it to resolve the
 * direction from the DOM instead.
 */
export function onControlKeyDown(e: KeyboardEvent, dir?: TextDirection): void {
  const next = resolveControlFocus(e, dir)
  if (next === null) return
  e.preventDefault()
  next.focus()
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
    tabindex: Signal<number>
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  nextTrigger: {
    type: 'button'
    'aria-label': string
    'aria-disabled': Signal<'true' | undefined>
    disabled: Signal<boolean>
    'data-scope': 'pagination'
    'data-part': 'next-trigger'
    tabindex: Signal<number>
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  item: (page: number) => {
    type: 'button'
    'aria-label': string
    'aria-current': Signal<'page' | undefined>
    'data-selected': Signal<'' | undefined>
    'data-scope': 'pagination'
    'data-part': 'item'
    'data-value': string
    tabindex: Signal<number>
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
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
  const pageLabel = opts.pageLabel ?? locale.pagination.page

  // Route roving focus through the direction stored in State (the source of
  // truth `flipArrow` consumes), read one-shot at keydown time.
  const onKeyDown = (e: KeyboardEvent): void => onControlKeyDown(e, state.peek().dir)

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
      // Roving tabindex: the current page's item button is the single tab stop,
      // so prev/next are only ever reached via the arrow keys (tabindex -1).
      tabindex: state.map(() => -1),
      onClick: tagSend(send, ['prev'], () => send({ type: 'prev' })),
      onKeyDown,
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
      tabindex: state.map(() => -1),
      onClick: tagSend(send, ['next'], () => send({ type: 'next' })),
      onKeyDown,
    },
    item: (page: number) => ({
      type: 'button',
      'aria-label': pageLabel(page),
      'aria-current': state.map((st) => (st.page === page ? 'page' : undefined)),
      'data-selected': state.map((st) => (st.page === page ? '' : undefined)),
      'data-scope': 'pagination',
      'data-part': 'item',
      'data-value': String(page),
      // Roving tabindex: exactly one tab stop — the current page's button.
      tabindex: state.map((st) => (st.page === page ? 0 : -1)),
      onClick: tagSend(send, ['goTo'], () => send({ type: 'goTo', page })),
      onKeyDown,
    }),
    ellipsis: (position: 'start' | 'end') => ({
      'aria-hidden': 'true',
      'data-scope': 'pagination',
      'data-part': 'ellipsis',
      'data-position': position,
    }),
  }
}

export const pagination = { init, update, connect, totalPages, pageItems, onControlKeyDown }
