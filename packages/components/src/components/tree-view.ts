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

/**
 * JSON-serializable adjacency entry for one tree node. The reducer owns the
 * tree structure (as a flat record) so it can traverse descendants/ancestors
 * for automatic indeterminate derivation and lazy-load bookkeeping without
 * any external collection. Build the record from a {@link TreeCollection} or
 * by hand; seed it via `init({ nodes, roots })` or the `setNodes` message.
 */
export interface TreeNodeMeta {
  /** Ordered ids of this node's loaded children (empty until loaded). */
  children: string[]
  /** Parent id, or null for a root. */
  parentId: string | null
  /** When true, descendant cascade and checked-derivation skip this node. */
  disabled?: boolean
  /**
   * Declares the node as a branch whose children are loaded lazily. Expanding
   * a `hasChildren` node that has not yet been loaded emits a `loadChildren`
   * effect; the consumer fetches and replies with `childrenLoaded`.
   */
  hasChildren?: boolean
}

/** Shape of a lazily-loaded child handed back via `childrenLoaded`. */
export interface TreeNodeInput {
  id: string
  /** Eagerly-known children of this freshly-loaded node, if any. */
  children?: string[]
  disabled?: boolean
  /** Mark this freshly-loaded node as itself lazily-loadable. */
  hasChildren?: boolean
}

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
   * parts expose `aria-busy` while loading so assistive tech announces the
   * in-progress state. This is now driven by the machine itself: expanding a
   * `hasChildren` node sets `loading` and emits a `loadChildren` effect; the
   * `childrenLoaded` / `childrenLoadFailed` replies clear it. The legacy
   * `loadingStart` / `loadingEnd` messages remain for manual control.
   */
  loading: string[]
  /**
   * Flat tree structure (adjacency record). Owned by the reducer for
   * descendant/ancestor traversal. JSON-serializable.
   */
  nodes: Record<string, TreeNodeMeta>
  /** Ids of the top-level (root) nodes, in order. */
  roots: string[]
  /**
   * Ids of branches whose children have been loaded (distinguishes a
   * loaded-but-empty branch from a not-yet-fetched one so we never refetch).
   */
  loaded: string[]
  /**
   * Ids of branches whose last lazy load failed. Re-expanding such a branch
   * retries the load (clears the flag and re-emits `loadChildren`).
   */
  loadFailed: string[]
}

/** Effects emitted by the tree-view machine for the consumer's `onEffect`. */
export type TreeViewEffect =
  /** Fetch the children of `id` lazily, then reply with `childrenLoaded`/`childrenLoadFailed`. */
  { type: 'loadChildren'; id: string }

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
  /** @intent("Replace the whole tree structure (adjacency record + root ids)") */
  | { type: 'setNodes'; nodes: Record<string, TreeNodeMeta>; roots: string[] }
  /** @intent("Supply the lazily-loaded children of branch `id` (clears loading, marks loaded)") */
  | { type: 'childrenLoaded'; id: string; items: TreeNodeInput[] }
  /** @intent("Report that the lazy load of branch `id` failed (allows retry on re-expand)") */
  | { type: 'childrenLoadFailed'; id: string }

export interface TreeViewInit {
  expanded?: string[]
  selected?: string[]
  checked?: string[]
  indeterminate?: string[]
  selectionMode?: SelectionMode
  disabled?: boolean
  visibleItems?: string[]
  visibleLabels?: string[]
  nodes?: Record<string, TreeNodeMeta>
  roots?: string[]
  loaded?: string[]
  loadFailed?: string[]
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
    nodes: opts.nodes ?? {},
    roots: opts.roots ?? [],
    loaded: opts.loaded ?? [],
    loadFailed: opts.loadFailed ?? [],
  }
}

// ---------------------------------------------------------------------------
// Traversal helpers (operate on the flat `nodes` record in state). Kept pure
// so the reducer stays deterministic and JSON-serializable.
// ---------------------------------------------------------------------------

/** Direct child ids of `id` (empty if unknown or a leaf). */
function childrenOf(nodes: Record<string, TreeNodeMeta>, id: string): string[] {
  return nodes[id]?.children ?? []
}

/** All descendants of `id` in depth-first order (excluding `id`). */
function descendantsOf(nodes: Record<string, TreeNodeMeta>, id: string): string[] {
  const out: string[] = []
  const walk = (current: string): void => {
    for (const child of childrenOf(nodes, current)) {
      out.push(child)
      walk(child)
    }
  }
  walk(id)
  return out
}

/**
 * Determine whether a node's children are already loaded (so expanding it is a
 * pure UI toggle, not a fetch). A node needs loading when it declares
 * `hasChildren` and has neither loaded children present nor been marked loaded.
 */
function needsLoad(state: TreeViewState, id: string): boolean {
  const meta = state.nodes[id]
  if (!meta || meta.hasChildren !== true) return false
  if (meta.children.length > 0) return false
  return !state.loaded.includes(id)
}

/**
 * Recompute the full checked + indeterminate sets from a seed checked-set,
 * bottom-up across the whole structure. A branch is checked iff it has at
 * least one ENABLED descendant and all of them are checked; it is
 * indeterminate iff some-but-not-all enabled descendants are checked (or it
 * has a checked descendant alongside an indeterminate one). Disabled nodes are
 * never auto-checked and never counted toward a parent's roll-up. Leaves keep
 * their explicit checked state from the seed.
 */
function deriveCheckState(
  nodes: Record<string, TreeNodeMeta>,
  roots: string[],
  seed: ReadonlySet<string>,
): { checked: string[]; indeterminate: string[] } {
  const checked = new Set<string>(seed)
  const indeterminate = new Set<string>()

  // Post-order so children resolve before parents.
  const visit = (id: string): void => {
    const kids = childrenOf(nodes, id)
    for (const k of kids) visit(k)
    if (kids.length === 0) return
    const enabled = kids.filter((k) => nodes[k]?.disabled !== true)
    // No enabled children to roll up from → leave parent's explicit state.
    if (enabled.length === 0) return
    let allChecked = true
    let anyChecked = false
    for (const k of enabled) {
      const kChecked = checked.has(k)
      const kIndeterminate = indeterminate.has(k)
      if (kChecked || kIndeterminate) anyChecked = true
      if (!kChecked) allChecked = false
    }
    if (allChecked) {
      checked.add(id)
      indeterminate.delete(id)
    } else if (anyChecked) {
      checked.delete(id)
      indeterminate.add(id)
    } else {
      checked.delete(id)
      indeterminate.delete(id)
    }
  }
  for (const r of roots) visit(r)

  return { checked: Array.from(checked), indeterminate: Array.from(indeterminate) }
}

/**
 * Expand a node, triggering a lazy load when required. Returns the next state
 * plus any effect to emit. Suppresses a duplicate fetch while one is already
 * in flight; retries (and clears the failed flag) when the previous load
 * failed.
 */
function expandNode(state: TreeViewState, id: string): [TreeViewState, TreeViewEffect[]] {
  const expanded = state.expanded.includes(id) ? state.expanded : [...state.expanded, id]
  if (!needsLoad(state, id)) {
    return [{ ...state, expanded }, []]
  }
  // Already loading and not previously failed → suppress duplicate fetch.
  if (state.loading.includes(id) && !state.loadFailed.includes(id)) {
    return [{ ...state, expanded }, []]
  }
  return [
    {
      ...state,
      expanded,
      loading: state.loading.includes(id) ? state.loading : [...state.loading, id],
      loadFailed: state.loadFailed.filter((x) => x !== id),
    },
    [{ type: 'loadChildren', id }],
  ]
}

export function update(state: TreeViewState, msg: TreeViewMsg): [TreeViewState, TreeViewEffect[]] {
  if (
    state.disabled &&
    msg.type !== 'setVisibleItems' &&
    msg.type !== 'setNodes' &&
    msg.type !== 'childrenLoaded' &&
    msg.type !== 'childrenLoadFailed'
  )
    return [state, []]
  switch (msg.type) {
    case 'toggleBranch': {
      if (state.expanded.includes(msg.id)) {
        // Collapse — keep loading/loaded state so an in-flight load still
        // resolves correctly (stale-insert) and we never refetch.
        return [{ ...state, expanded: state.expanded.filter((id) => id !== msg.id) }, []]
      }
      return expandNode(state, msg.id)
    }
    case 'expand':
      return expandNode(state, msg.id)
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
      // If this branch is closed, expand it (triggering a lazy load when
      // required); otherwise focus the first visible child (the next item in
      // depth-first visibleItems order).
      if (!state.expanded.includes(msg.id)) {
        return expandNode(state, msg.id)
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
      // Toggle the item, cascading to ENABLED descendants, then re-derive
      // checked/indeterminate for every ancestor automatically from the
      // `nodes` structure. If no structure is known, fall back to the
      // explicit `descendantIds` (legacy) or a plain leaf toggle.
      const hasStructure = state.nodes[msg.id] !== undefined
      const turningOn = !state.checked.includes(msg.id)

      if (!hasStructure) {
        const desc = msg.descendantIds ?? []
        const all = [msg.id, ...desc]
        const next = turningOn
          ? Array.from(new Set([...state.checked, ...all]))
          : state.checked.filter((id) => !all.includes(id))
        const indeterminate = state.indeterminate.filter((id) => !all.includes(id))
        return [{ ...state, checked: next, indeterminate }, []]
      }

      // Cascade across enabled descendants (and self if enabled).
      const cascade = [msg.id, ...descendantsOf(state.nodes, msg.id)].filter(
        (id) => state.nodes[id]?.disabled !== true,
      )
      const seed = new Set(state.checked)
      for (const id of cascade) {
        if (turningOn) seed.add(id)
        else seed.delete(id)
      }
      const { checked, indeterminate } = deriveCheckState(state.nodes, state.roots, seed)
      return [{ ...state, checked, indeterminate }, []]
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
    case 'setNodes':
      return [{ ...state, nodes: msg.nodes, roots: msg.roots }, []]
    case 'childrenLoaded': {
      // Insert the loaded children into the structure even if the node was
      // collapsed in the meantime (stale-insert). Mark loaded so we never
      // refetch (including the loaded-but-empty case), and clear loading /
      // failed flags.
      const childIds = msg.items.map((c) => c.id)
      const nodes: Record<string, TreeNodeMeta> = { ...state.nodes }
      const parent = nodes[msg.id]
      nodes[msg.id] = {
        children: childIds,
        parentId: parent?.parentId ?? null,
        ...(parent?.disabled ? { disabled: true } : {}),
        hasChildren: true,
      }
      for (const c of msg.items) {
        nodes[c.id] = {
          children: c.children ?? [],
          parentId: msg.id,
          ...(c.disabled ? { disabled: true } : {}),
          ...(c.hasChildren ? { hasChildren: true } : {}),
        }
      }
      const nextState: TreeViewState = {
        ...state,
        nodes,
        loading: state.loading.filter((id) => id !== msg.id),
        loadFailed: state.loadFailed.filter((id) => id !== msg.id),
        loaded: state.loaded.includes(msg.id) ? state.loaded : [...state.loaded, msg.id],
      }
      // Re-derive tri-state if a checked ancestor should cascade onto the
      // freshly-loaded enabled descendants, or vice-versa.
      if (state.selectionMode === 'checkbox') {
        const { checked, indeterminate } = deriveCheckState(
          nextState.nodes,
          nextState.roots,
          new Set(nextState.checked),
        )
        return [{ ...nextState, checked, indeterminate }, []]
      }
      return [nextState, []]
    }
    case 'childrenLoadFailed':
      return [
        {
          ...state,
          loading: state.loading.filter((id) => id !== msg.id),
          loadFailed: state.loadFailed.includes(msg.id)
            ? state.loadFailed
            : [...state.loadFailed, msg.id],
        },
        [],
      ]
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

export function isLoaded(state: TreeViewState, id: string): boolean {
  return state.loaded.includes(id)
}

export function isLoadFailed(state: TreeViewState, id: string): boolean {
  return state.loadFailed.includes(id)
}

export interface TreeItemParts {
  item: {
    role: 'treeitem'
    id: string
    'aria-expanded': Signal<boolean | undefined>
    'aria-selected': Signal<boolean | undefined>
    'aria-level': number
    'aria-busy': Signal<'true' | undefined>
    tabindex: Signal<number>
    'data-scope': 'tree-view'
    'data-part': 'item'
    'data-value': string
    'data-depth': string
    'data-selected': Signal<'' | undefined>
    'data-focused': Signal<'' | undefined>
    'data-loading': Signal<'' | undefined>
    'data-load-failed': Signal<'' | undefined>
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
        tabindex: state.map((s) => (s.focused === id ? 0 : -1)),
        'data-scope': 'tree-view',
        'data-part': 'item',
        'data-value': id,
        'data-depth': String(depth),
        'data-selected': state.map((s) => (isSelected(s, id) ? '' : undefined)),
        'data-focused': state.map((s) => (s.focused === id ? '' : undefined)),
        'data-loading': state.map((s) => (isLoading(s, id) ? '' : undefined)),
        'data-load-failed': state.map((s) => (isLoadFailed(s, id) ? '' : undefined)),
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
  isLoaded,
  isLoadFailed,
}
