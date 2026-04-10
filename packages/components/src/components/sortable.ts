import type { Send } from '@llui/dom'

/**
 * Sortable — pointer-based reorderable list.
 *
 * State machine tracks the currently-dragged item and where it's hovering.
 * The app owns the actual array; listen for `drop` and use `reorder(arr, from, to)`
 * to compute the new order, or watch `currentIndex` during drag for live preview.
 *
 * ```ts
 * type State = { items: string[]; sort: SortableState }
 *
 * update: (state, msg) => {
 *   switch (msg.type) {
 *     case 'sort':
 *       return [{ ...state, sort: sortable.update(state.sort, msg.msg)[0] }, []]
 *     case 'drop': {
 *       const d = state.sort.dragging
 *       if (!d) return [state, []]
 *       return [{ ...state, items: reorder(state.items, d.startIndex, d.currentIndex) }, []]
 *     }
 *   }
 * }
 *
 * view: ({ send, each, text }) => {
 *   const s = sortable.connect<State>(s => s.sort, m => send({ type: 'sort', msg: m }), { id: 'list' })
 *   return [
 *     ul({ ...s.root, class: 'list' }, [
 *       ...each({
 *         items: (st) => st.items,
 *         key: (x) => x,
 *         render: ({ item, index }) => [
 *           li({ ...s.item(item(), index()), class: 'item' }, [
 *             div({ ...s.handle(item(), index()), class: 'handle' }, [text('⋮⋮')]),
 *             text(item),
 *           ]),
 *         ],
 *       }),
 *     ]),
 *   ]
 * }
 * ```
 *
 * Hook up pointermove/pointerup at the root (attachPointerHandlers) — or
 * wire them directly via `onPointerMove` / `onPointerUp` on the root part.
 */

export interface DragState {
  id: string
  startIndex: number
  currentIndex: number
}

export interface SortableState {
  dragging: DragState | null
}

export type SortableMsg =
  | { type: 'start'; id: string; index: number }
  | { type: 'move'; index: number }
  | { type: 'drop' }
  | { type: 'cancel' }
  // Keyboard: toggle between picking up and dropping at current position
  | { type: 'toggleGrab'; id: string; index: number }
  // Keyboard: shift currentIndex by delta (clamped ≥ 0)
  | { type: 'moveBy'; delta: number }

export function init(): SortableState {
  return { dragging: null }
}

export function update(state: SortableState, msg: SortableMsg): [SortableState, never[]] {
  switch (msg.type) {
    case 'start':
      return [{ dragging: { id: msg.id, startIndex: msg.index, currentIndex: msg.index } }, []]
    case 'move': {
      if (!state.dragging) return [state, []]
      if (state.dragging.currentIndex === msg.index) return [state, []]
      return [{ dragging: { ...state.dragging, currentIndex: msg.index } }, []]
    }
    case 'drop':
      return state.dragging ? [{ dragging: null }, []] : [state, []]
    case 'cancel':
      return state.dragging ? [{ dragging: null }, []] : [state, []]
    case 'toggleGrab':
      if (state.dragging) {
        // Already dragging — drop at current position
        return [{ dragging: null }, []]
      }
      // Pick up
      return [{ dragging: { id: msg.id, startIndex: msg.index, currentIndex: msg.index } }, []]
    case 'moveBy': {
      if (!state.dragging) return [state, []]
      const next = Math.max(0, state.dragging.currentIndex + msg.delta)
      if (next === state.dragging.currentIndex) return [state, []]
      return [{ dragging: { ...state.dragging, currentIndex: next } }, []]
    }
  }
}

export interface SortableParts<S> {
  root: {
    'data-scope': 'sortable'
    'data-part': 'root'
    'data-dragging': (s: S) => '' | undefined
    onPointerMove: (e: PointerEvent) => void
    onPointerUp: (e: PointerEvent) => void
    onPointerCancel: (e: PointerEvent) => void
  }
  item: (
    id: string,
    index: number,
  ) => {
    'data-scope': 'sortable'
    'data-part': 'item'
    'data-index': string
    'data-id': string
    'data-dragging': (s: S) => '' | undefined
    'data-over': (s: S) => '' | undefined
  }
  handle: (
    id: string,
    index: number,
  ) => {
    'data-scope': 'sortable'
    'data-part': 'handle'
    role: 'button'
    tabIndex: 0
    'aria-grabbed': (s: S) => boolean
    'aria-label': string
    onPointerDown: (e: PointerEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
}

export interface ConnectOptions {
  id: string
}

export function connect<S>(
  get: (s: S) => SortableState,
  send: Send<SortableMsg>,
  _opts: ConnectOptions,
): SortableParts<S> {
  const findItemIndex = (e: PointerEvent): number | null => {
    // Walk up from the element at the pointer looking for [data-part="item"]
    const target = document.elementFromPoint(e.clientX, e.clientY)
    if (!target) return null
    const item = (target as Element).closest<HTMLElement>(
      '[data-scope="sortable"][data-part="item"]',
    )
    if (!item) return null
    const idxStr = item.dataset.index
    if (idxStr === undefined) return null
    const idx = Number(idxStr)
    return Number.isFinite(idx) ? idx : null
  }

  return {
    root: {
      'data-scope': 'sortable',
      'data-part': 'root',
      'data-dragging': (s) => (get(s).dragging ? '' : undefined),
      onPointerMove: (e) => {
        if (!e.buttons) return
        const idx = findItemIndex(e)
        if (idx !== null) send({ type: 'move', index: idx })
      },
      onPointerUp: () => send({ type: 'drop' }),
      onPointerCancel: () => send({ type: 'cancel' }),
    },
    item: (id, index) => ({
      'data-scope': 'sortable',
      'data-part': 'item',
      'data-index': String(index),
      'data-id': id,
      'data-dragging': (s) => (get(s).dragging?.id === id ? '' : undefined),
      'data-over': (s) => (get(s).dragging?.currentIndex === index ? '' : undefined),
    }),
    handle: (id, index) => ({
      'data-scope': 'sortable',
      'data-part': 'handle',
      role: 'button',
      tabIndex: 0,
      'aria-grabbed': (s) => get(s).dragging?.id === id,
      'aria-label':
        'Drag handle. Press space to pick up, arrow keys to move, space again to drop, escape to cancel.',
      onPointerDown: (e) => {
        e.preventDefault()
        const target = e.currentTarget as Element | null
        if (target && 'setPointerCapture' in target) {
          try {
            ;(target as Element & { setPointerCapture: (id: number) => void }).setPointerCapture(
              e.pointerId,
            )
          } catch {
            // Ignore — not all elements support pointer capture
          }
        }
        send({ type: 'start', id, index })
      },
      onKeyDown: (e) => {
        switch (e.key) {
          case ' ':
          case 'Enter':
            e.preventDefault()
            send({ type: 'toggleGrab', id, index })
            return
          case 'Escape':
            e.preventDefault()
            send({ type: 'cancel' })
            return
          case 'ArrowDown':
          case 'ArrowRight':
            e.preventDefault()
            send({ type: 'moveBy', delta: 1 })
            return
          case 'ArrowUp':
          case 'ArrowLeft':
            e.preventDefault()
            send({ type: 'moveBy', delta: -1 })
            return
        }
      },
    }),
  }
}

// ── Reorder utility ────────────────────────────────────────────

/**
 * Move an item in an array from one index to another, returning a new array.
 * Out-of-range indices are clamped to array bounds.
 */
export function reorder<T>(arr: readonly T[], from: number, to: number): T[] {
  const len = arr.length
  if (len === 0) return []
  const f = Math.max(0, Math.min(len - 1, from))
  const t = Math.max(0, Math.min(len - 1, to))
  if (f === t) return arr.slice()
  const result = arr.slice()
  const [item] = result.splice(f, 1)
  result.splice(t, 0, item)
  return result
}

export const sortable = { init, update, connect, reorder }
