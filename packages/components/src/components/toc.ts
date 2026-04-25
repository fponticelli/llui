import type { Send } from '@llui/dom'
import { useContext } from '@llui/dom'
import { LocaleContext } from '../locale.js'
import type { Locale } from '../locale.js'

/**
 * Table of contents — a navigation list that tracks which heading is
 * currently visible in the main scroll area and highlights it. The
 * state machine tracks the flat list of heading ids and the currently
 * active one; the view layer installs an IntersectionObserver in
 * onMount to detect which heading is on screen and dispatches
 * `setActive`.
 *
 * Typical setup in onMount:
 *
 *   const headings = document.querySelectorAll('h2[id], h3[id]')
 *   const io = new IntersectionObserver((entries) => {
 *     for (const e of entries) {
 *       if (e.isIntersecting) send({ type: 'setActive', id: e.target.id })
 *     }
 *   }, { rootMargin: '0px 0px -80% 0px' })
 *   headings.forEach((h) => io.observe(h))
 *   return () => io.disconnect()
 */

export interface TocEntry {
  id: string
  label: string
  /** Nesting level (1 = top-level). */
  level: number
}

export interface TocState {
  items: TocEntry[]
  activeId: string | null
  /** Ids of entries the user has manually expanded (for collapsible sub-levels). */
  expanded: string[]
}

export type TocMsg =
  /** @humanOnly */
  | { type: 'setItems'; items: TocEntry[] }
  /** @humanOnly */
  | { type: 'setActive'; id: string | null }
  /** @intent("Toggle the expanded state of the entry with the given id") */
  | { type: 'toggleExpanded'; id: string }
  /** @intent("Expand every collapsible entry") */
  | { type: 'expandAll' }
  /** @intent("Collapse every expanded entry") */
  | { type: 'collapseAll' }

export interface TocInit {
  items?: TocEntry[]
  activeId?: string | null
  expanded?: string[]
}

export function init(opts: TocInit = {}): TocState {
  return {
    items: opts.items ?? [],
    activeId: opts.activeId ?? null,
    expanded: opts.expanded ?? [],
  }
}

export function update(state: TocState, msg: TocMsg): [TocState, never[]] {
  switch (msg.type) {
    case 'setItems':
      return [{ ...state, items: msg.items }, []]
    case 'setActive':
      if (state.activeId === msg.id) return [state, []]
      return [{ ...state, activeId: msg.id }, []]
    case 'toggleExpanded': {
      const expanded = state.expanded.includes(msg.id)
        ? state.expanded.filter((id) => id !== msg.id)
        : [...state.expanded, msg.id]
      return [{ ...state, expanded }, []]
    }
    case 'expandAll':
      return [{ ...state, expanded: state.items.map((i) => i.id) }, []]
    case 'collapseAll':
      return [{ ...state, expanded: [] }, []]
  }
}

export function isActive(state: TocState, id: string): boolean {
  return state.activeId === id
}

export function isExpanded(state: TocState, id: string): boolean {
  return state.expanded.includes(id)
}

export interface TocItemParts<S> {
  item: {
    'data-scope': 'toc'
    'data-part': 'item'
    'data-level': string
    'data-active': (s: S) => '' | undefined
    'data-value': string
  }
  link: {
    href: string
    'aria-current': (s: S) => 'location' | undefined
    'data-scope': 'toc'
    'data-part': 'link'
    'data-active': (s: S) => '' | undefined
  }
  expandTrigger: {
    type: 'button'
    'aria-expanded': (s: S) => boolean
    'aria-label': string | ((s: S) => string)
    'data-scope': 'toc'
    'data-part': 'expand-trigger'
    'data-state': (s: S) => 'open' | 'closed'
    onClick: (e: MouseEvent) => void
  }
}

export interface TocParts<S> {
  root: {
    role: 'navigation'
    'aria-label': string | ((s: S) => string)
    'data-scope': 'toc'
    'data-part': 'root'
  }
  list: {
    role: 'list'
    'data-scope': 'toc'
    'data-part': 'list'
  }
  item: (entry: TocEntry) => TocItemParts<S>
}

export interface ConnectOptions {
  label?: string
  /** Prefix for href targets (default: '#'). */
  hrefPrefix?: string
  expandLabel?: string
}

export function connect<S>(
  get: (s: S) => TocState,
  send: Send<TocMsg>,
  opts: ConnectOptions = {},
): TocParts<S> {
  const locale = useContext<S, Locale>(LocaleContext)
  const prefix = opts.hrefPrefix ?? '#'
  const expandLabel: string | ((s: S) => string) =
    opts.expandLabel ?? ((s: S) => locale(s).toc.expand)

  return {
    root: {
      role: 'navigation',
      'aria-label': opts.label ?? ((s: S) => locale(s).toc.label),
      'data-scope': 'toc',
      'data-part': 'root',
    },
    list: {
      role: 'list',
      'data-scope': 'toc',
      'data-part': 'list',
    },
    item: (entry: TocEntry): TocItemParts<S> => ({
      item: {
        'data-scope': 'toc',
        'data-part': 'item',
        'data-level': String(entry.level),
        'data-active': (s) => (isActive(get(s), entry.id) ? '' : undefined),
        'data-value': entry.id,
      },
      link: {
        href: `${prefix}${entry.id}`,
        'aria-current': (s) => (isActive(get(s), entry.id) ? 'location' : undefined),
        'data-scope': 'toc',
        'data-part': 'link',
        'data-active': (s) => (isActive(get(s), entry.id) ? '' : undefined),
      },
      expandTrigger: {
        type: 'button',
        'aria-expanded': (s) => isExpanded(get(s), entry.id),
        'aria-label': expandLabel,
        'data-scope': 'toc',
        'data-part': 'expand-trigger',
        'data-state': (s) => (isExpanded(get(s), entry.id) ? 'open' : 'closed'),
        onClick: () => send({ type: 'toggleExpanded', id: entry.id }),
      },
    }),
  }
}

/**
 * Install an IntersectionObserver that watches heading elements and
 * dispatches `setActive` as the user scrolls. Call from onMount and
 * invoke the returned function on unmount.
 *
 * `rootMargin` defaults to '0px 0px -80% 0px' — a heading is considered
 * active once its top edge enters the top 20% of the viewport.
 */
export function watchActiveHeading(
  send: Send<TocMsg>,
  selector: string = '[id][data-toc]',
  rootMargin: string = '0px 0px -80% 0px',
): () => void {
  const headings = Array.from(document.querySelectorAll<HTMLElement>(selector))
  if (headings.length === 0) return () => {}
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          send({ type: 'setActive', id: (e.target as HTMLElement).id })
          return
        }
      }
    },
    { rootMargin },
  )
  for (const h of headings) io.observe(h)
  return () => io.disconnect()
}

export const toc = {
  init,
  update,
  connect,
  isActive,
  isExpanded,
  watchActiveHeading,
}
