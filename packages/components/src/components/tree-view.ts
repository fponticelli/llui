import type { Send } from '@llui/dom'

/**
 * Tree view — hierarchical list with expand/collapse. Items are identified
 * by opaque string ids; the tree structure (children relationship) is
 * provided externally. The machine tracks which branches are expanded,
 * which items are selected, and which item has keyboard focus.
 */

export interface TreeViewState {
  /** Ids of expanded branches. */
  expanded: string[]
  /** Ids of selected items. */
  selected: string[]
  /** Currently focused item id. */
  focused: string | null
  selectionMode: 'single' | 'multiple'
  /** Ordered list of currently-visible item ids (updated by consumer via setVisible). */
  visibleItems: string[]
  disabled: boolean
}

export type TreeViewMsg =
  | { type: 'toggleBranch'; id: string }
  | { type: 'expand'; id: string }
  | { type: 'collapse'; id: string }
  | { type: 'expandAll'; ids: string[] }
  | { type: 'collapseAll' }
  | { type: 'select'; id: string; additive?: boolean }
  | { type: 'setSelected'; ids: string[] }
  | { type: 'focus'; id: string | null }
  | { type: 'focusNext' }
  | { type: 'focusPrev' }
  | { type: 'focusFirst' }
  | { type: 'focusLast' }
  | { type: 'setVisibleItems'; ids: string[] }

export interface TreeViewInit {
  expanded?: string[]
  selected?: string[]
  selectionMode?: 'single' | 'multiple'
  disabled?: boolean
  visibleItems?: string[]
}

export function init(opts: TreeViewInit = {}): TreeViewState {
  return {
    expanded: opts.expanded ?? [],
    selected: opts.selected ?? [],
    focused: null,
    selectionMode: opts.selectionMode ?? 'single',
    visibleItems: opts.visibleItems ?? [],
    disabled: opts.disabled ?? false,
  }
}

export function update(state: TreeViewState, msg: TreeViewMsg): [TreeViewState, never[]] {
  if (state.disabled && msg.type !== 'setVisibleItems') return [state, []]
  switch (msg.type) {
    case 'toggleBranch': {
      const expanded = state.expanded.includes(msg.id)
        ? state.expanded.filter((id) => id !== msg.id)
        : [...state.expanded, msg.id]
      return [{ ...state, expanded }, []]
    }
    case 'expand':
      if (state.expanded.includes(msg.id)) return [state, []]
      return [{ ...state, expanded: [...state.expanded, msg.id] }, []]
    case 'collapse':
      if (!state.expanded.includes(msg.id)) return [state, []]
      return [{ ...state, expanded: state.expanded.filter((id) => id !== msg.id) }, []]
    case 'expandAll':
      return [{ ...state, expanded: msg.ids }, []]
    case 'collapseAll':
      return [{ ...state, expanded: [] }, []]
    case 'select': {
      if (state.selectionMode === 'single') {
        return [{ ...state, selected: [msg.id] }, []]
      }
      if (msg.additive) {
        const isSelected = state.selected.includes(msg.id)
        const selected = isSelected
          ? state.selected.filter((id) => id !== msg.id)
          : [...state.selected, msg.id]
        return [{ ...state, selected }, []]
      }
      return [{ ...state, selected: [msg.id] }, []]
    }
    case 'setSelected':
      return [{ ...state, selected: msg.ids }, []]
    case 'focus':
      return [{ ...state, focused: msg.id }, []]
    case 'focusNext': {
      if (state.visibleItems.length === 0) return [state, []]
      const idx = state.focused ? state.visibleItems.indexOf(state.focused) : -1
      const next = state.visibleItems[Math.min(idx + 1, state.visibleItems.length - 1)]
      return [{ ...state, focused: next ?? state.focused }, []]
    }
    case 'focusPrev': {
      if (state.visibleItems.length === 0) return [state, []]
      const idx = state.focused
        ? state.visibleItems.indexOf(state.focused)
        : state.visibleItems.length
      const prev = state.visibleItems[Math.max(0, idx - 1)]
      return [{ ...state, focused: prev ?? state.focused }, []]
    }
    case 'focusFirst':
      return [{ ...state, focused: state.visibleItems[0] ?? null }, []]
    case 'focusLast':
      return [{ ...state, focused: state.visibleItems[state.visibleItems.length - 1] ?? null }, []]
    case 'setVisibleItems':
      return [{ ...state, visibleItems: msg.ids }, []]
  }
}

export function isExpanded(state: TreeViewState, id: string): boolean {
  return state.expanded.includes(id)
}

export function isSelected(state: TreeViewState, id: string): boolean {
  return state.selected.includes(id)
}

export interface TreeItemParts<S> {
  item: {
    role: 'treeitem'
    id: string
    'aria-expanded': (s: S) => boolean | undefined
    'aria-selected': (s: S) => boolean | undefined
    'aria-level': number
    tabIndex: (s: S) => number
    'data-scope': 'tree-view'
    'data-part': 'item'
    'data-value': string
    'data-depth': string
    'data-selected': (s: S) => '' | undefined
    'data-focused': (s: S) => '' | undefined
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
    onFocus: (e: FocusEvent) => void
  }
  /** For branch items — expand/collapse disclosure trigger. */
  branchTrigger: {
    'data-scope': 'tree-view'
    'data-part': 'branch-trigger'
    'data-state': (s: S) => 'open' | 'closed'
    onClick: (e: MouseEvent) => void
  }
}

export interface TreeViewParts<S> {
  root: {
    role: 'tree'
    'aria-multiselectable': (s: S) => 'true' | undefined
    'aria-disabled': (s: S) => 'true' | undefined
    'data-scope': 'tree-view'
    'data-part': 'root'
    'data-disabled': (s: S) => '' | undefined
  }
  item: (id: string, depth: number, isBranch: boolean) => TreeItemParts<S>
}

export interface ConnectOptions {
  id: string
}

export function connect<S>(
  get: (s: S) => TreeViewState,
  send: Send<TreeViewMsg>,
  opts: ConnectOptions,
): TreeViewParts<S> {
  const itemId = (v: string): string => `${opts.id}:item:${v}`

  return {
    root: {
      role: 'tree',
      'aria-multiselectable': (s) => (get(s).selectionMode === 'multiple' ? 'true' : undefined),
      'aria-disabled': (s) => (get(s).disabled ? 'true' : undefined),
      'data-scope': 'tree-view',
      'data-part': 'root',
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
    },
    item: (id: string, depth: number, isBranch: boolean): TreeItemParts<S> => ({
      item: {
        role: 'treeitem',
        id: itemId(id),
        'aria-expanded': (s) => (isBranch ? isExpanded(get(s), id) : undefined),
        'aria-selected': (s) =>
          get(s).selectionMode === 'single' ? isSelected(get(s), id) : undefined,
        'aria-level': depth + 1,
        tabIndex: (s) => (get(s).focused === id ? 0 : -1),
        'data-scope': 'tree-view',
        'data-part': 'item',
        'data-value': id,
        'data-depth': String(depth),
        'data-selected': (s) => (isSelected(get(s), id) ? '' : undefined),
        'data-focused': (s) => (get(s).focused === id ? '' : undefined),
        onClick: (e) => send({ type: 'select', id, additive: e.metaKey || e.ctrlKey }),
        onFocus: () => send({ type: 'focus', id }),
        onKeyDown: (e) => {
          switch (e.key) {
            case 'ArrowDown':
              e.preventDefault()
              send({ type: 'focusNext' })
              return
            case 'ArrowUp':
              e.preventDefault()
              send({ type: 'focusPrev' })
              return
            case 'ArrowRight':
              if (isBranch) {
                e.preventDefault()
                send({ type: 'expand', id })
              }
              return
            case 'ArrowLeft':
              if (isBranch) {
                e.preventDefault()
                send({ type: 'collapse', id })
              }
              return
            case 'Home':
              e.preventDefault()
              send({ type: 'focusFirst' })
              return
            case 'End':
              e.preventDefault()
              send({ type: 'focusLast' })
              return
            case 'Enter':
            case ' ':
              e.preventDefault()
              send({ type: 'select', id, additive: e.metaKey || e.ctrlKey })
              if (isBranch) send({ type: 'toggleBranch', id })
              return
          }
        },
      },
      branchTrigger: {
        'data-scope': 'tree-view',
        'data-part': 'branch-trigger',
        'data-state': (s) => (isExpanded(get(s), id) ? 'open' : 'closed'),
        onClick: (e) => {
          e.stopPropagation()
          send({ type: 'toggleBranch', id })
        },
      },
    }),
  }
}

export const treeView = { init, update, connect, isExpanded, isSelected }
