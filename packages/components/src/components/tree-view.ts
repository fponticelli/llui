import type { Send } from '@llui/dom'
import {
  typeaheadAccumulate,
  typeaheadMatch,
  isTypeaheadKey,
  TYPEAHEAD_TIMEOUT_MS,
} from '../utils/typeahead'

/**
 * Tree view — hierarchical list with expand/collapse. Items are identified
 * by opaque string ids; the tree structure (children relationship) is
 * provided externally. The machine tracks which branches are expanded,
 * which items are selected, and which item has keyboard focus.
 */

export type SelectionMode = 'single' | 'multiple' | 'checkbox'

export interface TreeViewState {
  /** Ids of expanded branches. */
  expanded: string[]
  /** Ids of selected items. */
  selected: string[]
  /** Ids of checked items (checkbox selection mode). */
  checked: string[]
  /** Ids known to be in the indeterminate tri-state (some-but-not-all
   *  descendants checked). Consumer-computed via propagation logic or the
   *  `toggleChecked` message's `descendantIds` parameter. */
  indeterminate: string[]
  /** Currently focused item id. */
  focused: string | null
  selectionMode: SelectionMode
  /** Ordered list of currently-visible item ids (updated by consumer via setVisible). */
  visibleItems: string[]
  /** Parallel array of visible-item labels for typeahead. If empty, typeahead
   *  matches against ids directly. Updated alongside visibleItems via the
   *  optional `labels` field on `setVisibleItems`. */
  visibleLabels: string[]
  disabled: boolean
  /** Typeahead accumulator buffer. */
  typeahead: string
  typeaheadExpiresAt: number
  /** Id of item currently being renamed, or null. */
  renaming: string | null
  /** Draft value during rename. */
  renameDraft: string
  /**
   * Ids of branches currently loading their children asynchronously. Item
   * parts expose `aria-busy` while loading so assistive tech announces
   * the in-progress state. The consumer kicks off the fetch externally
   * (in a handler that intercepts `expand`, or via an effect), dispatches
   * `loadingStart` immediately, fetches the children, then dispatches
   * `setVisibleItems` with the new tree contents followed by `loadingEnd`.
   */
  loading: string[]
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
  | { type: 'setVisibleItems'; ids: string[]; labels?: string[] }
  | { type: 'typeahead'; char: string; now: number }
  | { type: 'arrowLeftFrom'; id: string; isBranch: boolean; parentId: string | null }
  | { type: 'arrowRightFrom'; id: string }
  | { type: 'toggleChecked'; id: string; descendantIds?: string[] }
  | { type: 'setChecked'; ids: string[] }
  | { type: 'setIndeterminate'; ids: string[] }
  | { type: 'renameStart'; id: string; initial: string }
  | { type: 'renameChange'; value: string }
  | { type: 'renameCommit' }
  | { type: 'renameCancel' }
  | { type: 'loadingStart'; id: string }
  | { type: 'loadingEnd'; id: string }

export interface TreeViewInit {
  expanded?: string[]
  selected?: string[]
  checked?: string[]
  indeterminate?: string[]
  selectionMode?: SelectionMode
  disabled?: boolean
  visibleItems?: string[]
  visibleLabels?: string[]
}

export function init(opts: TreeViewInit = {}): TreeViewState {
  return {
    expanded: opts.expanded ?? [],
    selected: opts.selected ?? [],
    checked: opts.checked ?? [],
    indeterminate: opts.indeterminate ?? [],
    focused: null,
    selectionMode: opts.selectionMode ?? 'single',
    visibleItems: opts.visibleItems ?? [],
    visibleLabels: opts.visibleLabels ?? [],
    disabled: opts.disabled ?? false,
    typeahead: '',
    typeaheadExpiresAt: 0,
    renaming: null,
    renameDraft: '',
    loading: [],
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
      return [
        { ...state, visibleItems: msg.ids, visibleLabels: msg.labels ?? state.visibleLabels },
        [],
      ]
    case 'arrowLeftFrom': {
      // If this is an expanded branch, collapse it and stay focused.
      if (msg.isBranch && state.expanded.includes(msg.id)) {
        return [{ ...state, expanded: state.expanded.filter((id) => id !== msg.id) }, []]
      }
      // Otherwise, move focus to parent if provided (WAI-ARIA).
      if (msg.parentId !== null) {
        return [{ ...state, focused: msg.parentId }, []]
      }
      return [state, []]
    }
    case 'arrowRightFrom': {
      // If this branch is closed, expand it; otherwise focus the first
      // visible child (the next item in depth-first visibleItems order).
      if (!state.expanded.includes(msg.id)) {
        return [{ ...state, expanded: [...state.expanded, msg.id] }, []]
      }
      const idx = state.visibleItems.indexOf(msg.id)
      if (idx === -1 || idx === state.visibleItems.length - 1) return [state, []]
      const next = state.visibleItems[idx + 1]!
      return [{ ...state, focused: next }, []]
    }
    case 'typeahead': {
      if (state.visibleItems.length === 0) return [state, []]
      const acc = typeaheadAccumulate(state.typeahead, msg.char, msg.now, state.typeaheadExpiresAt)
      // Fall back to matching ids if labels weren't provided.
      const labels = state.visibleLabels.length > 0 ? state.visibleLabels : state.visibleItems
      const disabledMask = new Array<boolean>(labels.length).fill(false)
      const startIdx = state.focused ? state.visibleItems.indexOf(state.focused) : null
      const matchIdx = typeaheadMatch(labels, disabledMask, acc, startIdx)
      const focused =
        matchIdx === null ? state.focused : (state.visibleItems[matchIdx] ?? state.focused)
      return [
        { ...state, typeahead: acc, typeaheadExpiresAt: msg.now + TYPEAHEAD_TIMEOUT_MS, focused },
        [],
      ]
    }
    case 'toggleChecked': {
      // Toggle the item's checked state, propagating to descendants if any.
      // The caller passes `descendantIds` for branches; for leaves, pass
      // an empty list or omit. Indeterminate flag is cleared on the id
      // (a deliberate toggle is a definite state). The caller is
      // responsible for recomputing `indeterminate` on ancestors via
      // setIndeterminate after this message.
      const desc = msg.descendantIds ?? []
      const all = [msg.id, ...desc]
      const isChecked = state.checked.includes(msg.id)
      const next = isChecked
        ? state.checked.filter((id) => !all.includes(id))
        : Array.from(new Set([...state.checked, ...all]))
      const indeterminate = state.indeterminate.filter((id) => !all.includes(id))
      return [{ ...state, checked: next, indeterminate }, []]
    }
    case 'setChecked':
      return [{ ...state, checked: msg.ids }, []]
    case 'setIndeterminate':
      return [{ ...state, indeterminate: msg.ids }, []]
    case 'renameStart':
      return [{ ...state, renaming: msg.id, renameDraft: msg.initial }, []]
    case 'renameChange':
      return [{ ...state, renameDraft: msg.value }, []]
    case 'renameCommit':
    case 'renameCancel':
      return [{ ...state, renaming: null, renameDraft: '' }, []]
    case 'loadingStart':
      if (state.loading.includes(msg.id)) return [state, []]
      return [{ ...state, loading: [...state.loading, msg.id] }, []]
    case 'loadingEnd':
      return [{ ...state, loading: state.loading.filter((id) => id !== msg.id) }, []]
  }
}

export function isExpanded(state: TreeViewState, id: string): boolean {
  return state.expanded.includes(id)
}

export function isSelected(state: TreeViewState, id: string): boolean {
  return state.selected.includes(id)
}

export function isChecked(state: TreeViewState, id: string): boolean {
  return state.checked.includes(id)
}

export function isIndeterminate(state: TreeViewState, id: string): boolean {
  return state.indeterminate.includes(id)
}

export function isRenaming(state: TreeViewState, id: string): boolean {
  return state.renaming === id
}

export function isLoading(state: TreeViewState, id: string): boolean {
  return state.loading.includes(id)
}

export interface TreeItemParts<S> {
  item: {
    role: 'treeitem'
    id: string
    'aria-expanded': (s: S) => boolean | undefined
    'aria-selected': (s: S) => boolean | undefined
    'aria-level': number
    'aria-busy': (s: S) => 'true' | undefined
    tabIndex: (s: S) => number
    'data-scope': 'tree-view'
    'data-part': 'item'
    'data-value': string
    'data-depth': string
    'data-selected': (s: S) => '' | undefined
    'data-focused': (s: S) => '' | undefined
    'data-loading': (s: S) => '' | undefined
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
  /**
   * Checkbox element (only meaningful when `selectionMode === 'checkbox'`).
   * `aria-checked` is the tri-state string ('true' | 'false' | 'mixed').
   * The consumer must render a checkbox input or a visual proxy and
   * dispatch `toggleChecked` via the `onClick` binding. For branches,
   * pass the branch's descendant ids via `descendantIds` on the message
   * so children are propagated in a single reducer step.
   */
  checkbox: {
    role: 'checkbox'
    'aria-checked': (s: S) => 'true' | 'false' | 'mixed'
    'data-scope': 'tree-view'
    'data-part': 'checkbox'
    'data-state': (s: S) => 'checked' | 'unchecked' | 'indeterminate'
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
  item: (id: string, depth: number, isBranch: boolean, parentId?: string | null) => TreeItemParts<S>
}

export interface ConnectOptions {
  id: string
  /**
   * If true, clicking anywhere on a branch item (not just the disclosure
   * caret) toggles its expanded state. Default: false — clicks on the row
   * select it without toggling, consistent with most file-tree UIs.
   */
  expandOnClick?: boolean
}

export function connect<S>(
  get: (s: S) => TreeViewState,
  send: Send<TreeViewMsg>,
  opts: ConnectOptions,
): TreeViewParts<S> {
  const itemId = (v: string): string => `${opts.id}:item:${v}`
  const expandOnClick = opts.expandOnClick === true

  return {
    root: {
      role: 'tree',
      'aria-multiselectable': (s) => (get(s).selectionMode === 'multiple' ? 'true' : undefined),
      'aria-disabled': (s) => (get(s).disabled ? 'true' : undefined),
      'data-scope': 'tree-view',
      'data-part': 'root',
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
    },
    item: (
      id: string,
      depth: number,
      isBranch: boolean,
      parentId: string | null = null,
    ): TreeItemParts<S> => ({
      item: {
        role: 'treeitem',
        id: itemId(id),
        'aria-expanded': (s) => (isBranch ? isExpanded(get(s), id) : undefined),
        'aria-selected': (s) =>
          get(s).selectionMode === 'single' ? isSelected(get(s), id) : undefined,
        'aria-level': depth + 1,
        'aria-busy': (s) => (isLoading(get(s), id) ? 'true' : undefined),
        tabIndex: (s) => (get(s).focused === id ? 0 : -1),
        'data-scope': 'tree-view',
        'data-part': 'item',
        'data-value': id,
        'data-depth': String(depth),
        'data-selected': (s) => (isSelected(get(s), id) ? '' : undefined),
        'data-focused': (s) => (get(s).focused === id ? '' : undefined),
        'data-loading': (s) => (isLoading(get(s), id) ? '' : undefined),
        onClick: (e) => {
          send({ type: 'select', id, additive: e.metaKey || e.ctrlKey })
          if (expandOnClick && isBranch) send({ type: 'toggleBranch', id })
        },
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
              // WAI-ARIA: closed branch → expand (stay); open branch →
              // focus first child. Leaf → nothing. The reducer decides
              // based on current expanded state.
              if (!isBranch) return
              e.preventDefault()
              send({ type: 'arrowRightFrom', id })
              return
            case 'ArrowLeft':
              // WAI-ARIA: open branch → collapse (stay); closed branch or
              // leaf → focus parent (if known). Root end-nodes → nothing.
              e.preventDefault()
              send({ type: 'arrowLeftFrom', id, isBranch, parentId })
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
            default:
              if (isTypeaheadKey(e)) {
                send({ type: 'typeahead', char: e.key, now: Date.now() })
              }
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
      checkbox: {
        role: 'checkbox',
        'aria-checked': (s) => {
          if (isIndeterminate(get(s), id)) return 'mixed'
          return isChecked(get(s), id) ? 'true' : 'false'
        },
        'data-scope': 'tree-view',
        'data-part': 'checkbox',
        'data-state': (s) => {
          if (isIndeterminate(get(s), id)) return 'indeterminate'
          return isChecked(get(s), id) ? 'checked' : 'unchecked'
        },
      },
    }),
  }
}

export const treeView = {
  init,
  update,
  connect,
  isExpanded,
  isSelected,
  isChecked,
  isIndeterminate,
  isRenaming,
  isLoading,
}
