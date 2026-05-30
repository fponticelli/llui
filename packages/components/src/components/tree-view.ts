import { tagSend } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'
import { flipArrow } from '../utils/direction.js'
import {
  typeaheadAccumulate,
  typeaheadMatch,
  isTypeaheadKey,
  TYPEAHEAD_TIMEOUT_MS,
} from '../utils/typeahead.js'

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
  /** @intent("Toggle the branch with the given id expanded/collapsed") */
  | { type: 'toggleBranch'; id: string }
  /** @intent("Expand the branch with the given id") */
  | { type: 'expand'; id: string }
  /** @intent("Collapse the branch with the given id") */
  | { type: 'collapse'; id: string }
  /** @intent("Expand every branch in the provided id list") */
  | { type: 'expandAll'; ids: string[] }
  /** @intent("Collapse every expanded branch") */
  | { type: 'collapseAll' }
  /** @intent("Select the item with the given id (additive=true extends multi-selection)") */
  | { type: 'select'; id: string; additive?: boolean }
  /** @intent("Replace the selected-id set with the provided list") */
  | { type: 'setSelected'; ids: string[] }
  /** @humanOnly */
  | { type: 'focus'; id: string | null }
  /** @humanOnly */
  | { type: 'focusNext' }
  /** @humanOnly */
  | { type: 'focusPrev' }
  /** @humanOnly */
  | { type: 'focusFirst' }
  /** @humanOnly */
  | { type: 'focusLast' }
  /** @humanOnly */
  | { type: 'setVisibleItems'; ids: string[]; labels?: string[] }
  /** @humanOnly */
  | { type: 'typeahead'; char: string; now: number }
  /** @humanOnly */
  | { type: 'arrowLeftFrom'; id: string; isBranch: boolean; parentId: string | null }
  /** @humanOnly */
  | { type: 'arrowRightFrom'; id: string }
  /** @intent("Toggle the checkbox on the item with the given id (descendantIds drives recursive check)") */
  | { type: 'toggleChecked'; id: string; descendantIds?: string[] }
  /** @intent("Replace the checked-id set with the provided list") */
  | { type: 'setChecked'; ids: string[] }
  /** @humanOnly */
  | { type: 'setIndeterminate'; ids: string[] }
  /** @intent("Begin renaming the item with the given id (seeds the rename input with `initial`)") */
  | { type: 'renameStart'; id: string; initial: string }
  /** @intent("Update the rename draft as the user types") */
  | { type: 'renameChange'; value: string }
  /** @intent("Commit the in-progress rename (clears the rename state)") */
  | { type: 'renameCommit' }
  /** @intent("Cancel the in-progress rename without applying changes") */
  | { type: 'renameCancel' }
  /** @intent("Mark the branch with the given id as loading children (typically before an async fetch)") */
  | { type: 'loadingStart'; id: string }
  /** @intent("Clear the loading state for the given branch id (after async fetch completes)") */
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

export interface TreeItemParts {
  item: {
    role: 'treeitem'
    id: string
    'aria-expanded': Signal<boolean | undefined>
    'aria-selected': Signal<boolean | undefined>
    'aria-level': number
    'aria-busy': Signal<'true' | undefined>
    tabIndex: Signal<number>
    'data-scope': 'tree-view'
    'data-part': 'item'
    'data-value': string
    'data-depth': string
    'data-selected': Signal<'' | undefined>
    'data-focused': Signal<'' | undefined>
    'data-loading': Signal<'' | undefined>
    onClick: (e: MouseEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
    onFocus: (e: FocusEvent) => void
  }
  /** For branch items — expand/collapse disclosure trigger. */
  branchTrigger: {
    'data-scope': 'tree-view'
    'data-part': 'branch-trigger'
    'data-state': Signal<'open' | 'closed'>
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
    'aria-checked': Signal<'true' | 'false' | 'mixed'>
    'data-scope': 'tree-view'
    'data-part': 'checkbox'
    'data-state': Signal<'checked' | 'unchecked' | 'indeterminate'>
  }
}

export interface TreeViewParts {
  root: {
    role: 'tree'
    'aria-owns': Signal<string | undefined>
    'aria-multiselectable': Signal<'true' | undefined>
    'aria-disabled': Signal<'true' | undefined>
    'data-scope': 'tree-view'
    'data-part': 'root'
    'data-disabled': Signal<'' | undefined>
  }
  item: (id: string, depth: number, isBranch: boolean, parentId?: string | null) => TreeItemParts
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

export function connect(
  state: Signal<TreeViewState>,
  send: Send<TreeViewMsg>,
  opts: ConnectOptions,
): TreeViewParts {
  const itemId = (v: string): string => `${opts.id}:item:${v}`
  const expandOnClick = opts.expandOnClick === true

  return {
    root: {
      role: 'tree',
      'aria-owns': state.map((s) => {
        const items = s.visibleItems
        if (items.length === 0) return undefined
        return items.map((id) => itemId(id)).join(' ')
      }),
      'aria-multiselectable': state.map((s) =>
        s.selectionMode === 'multiple' ? 'true' : undefined,
      ),
      'aria-disabled': state.map((s) => (s.disabled ? 'true' : undefined)),
      'data-scope': 'tree-view',
      'data-part': 'root',
      'data-disabled': state.map((s) => (s.disabled ? '' : undefined)),
    },
    item: (
      id: string,
      depth: number,
      isBranch: boolean,
      parentId: string | null = null,
    ): TreeItemParts => ({
      item: {
        role: 'treeitem',
        id: itemId(id),
        'aria-expanded': state.map((s) => (isBranch ? isExpanded(s, id) : undefined)),
        'aria-selected': state.map((s) =>
          s.selectionMode === 'single' ? isSelected(s, id) : undefined,
        ),
        'aria-level': depth + 1,
        'aria-busy': state.map((s) => (isLoading(s, id) ? 'true' : undefined)),
        tabIndex: state.map((s) => (s.focused === id ? 0 : -1)),
        'data-scope': 'tree-view',
        'data-part': 'item',
        'data-value': id,
        'data-depth': String(depth),
        'data-selected': state.map((s) => (isSelected(s, id) ? '' : undefined)),
        'data-focused': state.map((s) => (s.focused === id ? '' : undefined)),
        'data-loading': state.map((s) => (isLoading(s, id) ? '' : undefined)),
        onClick: tagSend(send, ['select', 'toggleBranch'], (e) => {
          send({ type: 'select', id, additive: e.metaKey || e.ctrlKey })
          if (expandOnClick && isBranch) send({ type: 'toggleBranch', id })
        }),
        onFocus: tagSend(send, ['focus'], () => send({ type: 'focus', id })),
        onKeyDown: tagSend(
          send,
          [
            'focusNext',
            'focusPrev',
            'arrowRightFrom',
            'arrowLeftFrom',
            'focusFirst',
            'focusLast',
            'select',
            'toggleBranch',
            'typeahead',
          ],
          (e) => {
            const key = flipArrow(e.key, e.currentTarget as Element)
            switch (key) {
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
        ),
      },
      branchTrigger: {
        'data-scope': 'tree-view',
        'data-part': 'branch-trigger',
        'data-state': state.map((s) => (isExpanded(s, id) ? 'open' : 'closed')),
        onClick: tagSend(send, ['toggleBranch'], (e) => {
          e.stopPropagation()
          send({ type: 'toggleBranch', id })
        }),
      },
      checkbox: {
        role: 'checkbox',
        'aria-checked': state.map((s) => {
          if (isIndeterminate(s, id)) return 'mixed'
          return isChecked(s, id) ? 'true' : 'false'
        }),
        'data-scope': 'tree-view',
        'data-part': 'checkbox',
        'data-state': state.map((s) => {
          if (isIndeterminate(s, id)) return 'indeterminate'
          return isChecked(s, id) ? 'checked' : 'unchecked'
        }),
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
