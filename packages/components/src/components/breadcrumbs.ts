import type { Send, Signal } from '@llui/dom'
import { tagSend } from '@llui/dom'

/**
 * Breadcrumbs — a hierarchical trail of links to ancestor pages.
 * The last item is the current page. When `maxVisible` is set and the trail
 * is longer, the middle collapses to: first item + ellipsis + last N items,
 * until the user expands it.
 */

export interface BreadcrumbItem {
  id: string
  label: string
}

export interface BreadcrumbsState {
  items: BreadcrumbItem[]
  maxVisible: number | null
  expanded: boolean
}

export type BreadcrumbsMsg =
  /** @intent("Replace the breadcrumb trail with a new list of items") */
  | { type: 'setItems'; items: BreadcrumbItem[] }
  /** @intent("Expand the collapsed middle of the trail to reveal all items") */
  | { type: 'expand' }
  /** @intent("Collapse the trail back to its truncated form") */
  | { type: 'collapse' }

export interface BreadcrumbsInit {
  items?: BreadcrumbItem[]
  maxVisible?: number | null
  expanded?: boolean
}

export function init(opts: BreadcrumbsInit = {}): BreadcrumbsState {
  return {
    items: opts.items ?? [],
    maxVisible: opts.maxVisible ?? null,
    expanded: opts.expanded ?? false,
  }
}

export function update(state: BreadcrumbsState, msg: BreadcrumbsMsg): [BreadcrumbsState, never[]] {
  switch (msg.type) {
    case 'setItems':
      return [{ ...state, items: msg.items, expanded: false }, []]
    case 'expand':
      return [{ ...state, expanded: true }, []]
    case 'collapse':
      return [{ ...state, expanded: false }, []]
  }
}

export type VisibleBreadcrumb =
  | { type: 'item'; id: string; label: string; current: boolean }
  | { type: 'ellipsis' }

/**
 * Compute the visible breadcrumb trail. When `maxVisible` is set and exceeded
 * and the trail is not expanded, collapse the middle to:
 * `[first] … [last (maxVisible - 1) items]`. The final item is always `current`.
 */
export function visibleItems(state: BreadcrumbsState): VisibleBreadcrumb[] {
  const { items, maxVisible, expanded } = state
  const total = items.length
  if (total === 0) return []

  const lastIndex = total - 1
  const asItem = (item: BreadcrumbItem, index: number): VisibleBreadcrumb => ({
    type: 'item',
    id: item.id,
    label: item.label,
    current: index === lastIndex,
  })

  // Show the whole trail when not collapsing.
  if (maxVisible === null || expanded || maxVisible <= 0 || total <= maxVisible) {
    return items.map(asItem)
  }

  // Collapse: first item + ellipsis + the last (maxVisible - 1) items.
  const tailCount = Math.max(1, maxVisible - 1)
  const tailStart = Math.max(1, total - tailCount)
  const result: VisibleBreadcrumb[] = [asItem(items[0]!, 0), { type: 'ellipsis' }]
  for (let i = tailStart; i < total; i++) {
    result.push(asItem(items[i]!, i))
  }
  return result
}

export interface BreadcrumbsParts {
  root: {
    'aria-label': string
    'data-scope': 'breadcrumbs'
    'data-part': 'root'
  }
  list: {
    'data-scope': 'breadcrumbs'
    'data-part': 'list'
  }
  item: (id: string) => {
    'data-scope': 'breadcrumbs'
    'data-part': 'item'
    'data-value': string
  }
  link: (id: string) => {
    'aria-current': Signal<'page' | undefined>
    'data-scope': 'breadcrumbs'
    'data-part': 'link'
    'data-value': string
    'data-current': Signal<'' | undefined>
  }
  separator: {
    'aria-hidden': 'true'
    'data-scope': 'breadcrumbs'
    'data-part': 'separator'
  }
  ellipsisTrigger: {
    type: 'button'
    'aria-label': string
    'data-scope': 'breadcrumbs'
    'data-part': 'ellipsis-trigger'
    onClick: (e: MouseEvent) => void
  }
}

export interface ConnectOptions {
  label?: string
  expandLabel?: string
}

function isCurrent(state: BreadcrumbsState, id: string): boolean {
  const items = state.items
  if (items.length === 0) return false
  return items[items.length - 1]!.id === id
}

export function connect(
  state: Signal<BreadcrumbsState>,
  send: Send<BreadcrumbsMsg>,
  opts: ConnectOptions = {},
): BreadcrumbsParts {
  const label = opts.label ?? 'Breadcrumb'
  const expandLabel = opts.expandLabel ?? 'Show hidden breadcrumbs'

  return {
    root: {
      'aria-label': label,
      'data-scope': 'breadcrumbs',
      'data-part': 'root',
    },
    list: {
      'data-scope': 'breadcrumbs',
      'data-part': 'list',
    },
    item: (id: string) => ({
      'data-scope': 'breadcrumbs',
      'data-part': 'item',
      'data-value': id,
    }),
    link: (id: string) => ({
      'aria-current': state.map((st) => (isCurrent(st, id) ? 'page' : undefined)),
      'data-scope': 'breadcrumbs',
      'data-part': 'link',
      'data-value': id,
      'data-current': state.map((st) => (isCurrent(st, id) ? '' : undefined)),
    }),
    separator: {
      'aria-hidden': 'true',
      'data-scope': 'breadcrumbs',
      'data-part': 'separator',
    },
    ellipsisTrigger: {
      type: 'button',
      'aria-label': expandLabel,
      'data-scope': 'breadcrumbs',
      'data-part': 'ellipsis-trigger',
      onClick: tagSend(send, ['expand'], () => send({ type: 'expand' })),
    },
  }
}

export const breadcrumbs = { init, update, connect, visibleItems }
