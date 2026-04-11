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
  /**
   * Container the drag originated from. Defaults to the connect's `id` for
   * single-container sortables. Set when multiple sortables share state.
   */
  fromContainer: string
  /**
   * Container the pointer is currently over. Same as `fromContainer` for
   * single-container sortables. Differs when dragging across containers.
   */
  toContainer: string
  /**
   * Pointer Y at drag start (viewport coordinates). Used by CSS to make
   * the dragged item follow the pointer via translateY(deltaY).
   */
  startY: number
  /**
   * Current pointer Y (viewport coordinates). `deltaY = currentY - startY`.
   */
  currentY: number
}

export interface SortableState {
  dragging: DragState | null
}

export type SortableMsg =
  | { type: 'start'; id: string; index: number; container: string; y: number }
  | { type: 'move'; index: number; container: string; y: number }
  | { type: 'drop' }
  | { type: 'cancel' }
  // Keyboard: toggle between picking up and dropping at current position
  | { type: 'toggleGrab'; id: string; index: number; container: string }
  // Keyboard: shift currentIndex by delta (clamped ≥ 0)
  | { type: 'moveBy'; delta: number }

export function init(): SortableState {
  return { dragging: null }
}

export function update(state: SortableState, msg: SortableMsg): [SortableState, never[]] {
  switch (msg.type) {
    case 'start':
      return [
        {
          dragging: {
            id: msg.id,
            startIndex: msg.index,
            currentIndex: msg.index,
            fromContainer: msg.container,
            toContainer: msg.container,
            startY: msg.y,
            currentY: msg.y,
          },
        },
        [],
      ]
    case 'move': {
      if (!state.dragging) return [state, []]
      if (
        state.dragging.currentIndex === msg.index &&
        state.dragging.toContainer === msg.container &&
        state.dragging.currentY === msg.y
      ) {
        return [state, []]
      }
      return [
        {
          dragging: {
            ...state.dragging,
            currentIndex: msg.index,
            toContainer: msg.container,
            currentY: msg.y,
          },
        },
        [],
      ]
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
      // Pick up (keyboard — no pointer position)
      return [
        {
          dragging: {
            id: msg.id,
            startIndex: msg.index,
            currentIndex: msg.index,
            fromContainer: msg.container,
            toContainer: msg.container,
            startY: 0,
            currentY: 0,
          },
        },
        [],
      ]
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
    'data-container-id': string
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
    'data-shift': (s: S) => 'up' | 'down' | undefined
    'style.transform': (s: S) => string | undefined
    'style.zIndex': (s: S) => string | undefined
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
  opts: ConnectOptions,
): SortableParts<S> {
  // The connect's `id` doubles as the cross-container identifier
  const containerId = opts.id

  // Snapshots taken at drag start — stable throughout the drag so computing
  // the target index is not affected by items visually shifting via CSS.
  // Map: container-id → array of midpoint Y values for each item's original
  // bounding rect (sorted by index). The handler records this on pointerdown.
  const snapshots = new Map<string, number[]>()

  function snapshotContainer(rootEl: HTMLElement, cid: string): void {
    const items = rootEl.querySelectorAll<HTMLElement>('[data-scope="sortable"][data-part="item"]')
    // Read rects once — they're pre-transform (no drag shifts yet)
    const mids: number[] = []
    for (const item of items) {
      const r = item.getBoundingClientRect()
      mids.push(r.top + r.height / 2)
    }
    snapshots.set(cid, mids)
  }

  function snapshotAll(): void {
    const roots = document.querySelectorAll<HTMLElement>(
      '[data-scope="sortable"][data-part="root"]',
    )
    for (const root of roots) {
      const cid = root.dataset.containerId
      if (cid) snapshotContainer(root, cid)
    }
  }

  // Find the target index under the pointer using the drag-start snapshot.
  // Picks the index whose midpoint is closest to the pointer Y — stable
  // against items being visually transformed during the drag.
  function findTargetAt(e: PointerEvent): { container: string; index: number } | null {
    // Find which sortable root the pointer is over (using getBoundingClientRect
    // on roots, which are not transformed during drag).
    const roots = document.querySelectorAll<HTMLElement>(
      '[data-scope="sortable"][data-part="root"]',
    )
    for (const root of roots) {
      const r = root.getBoundingClientRect()
      if (e.clientX < r.left || e.clientX > r.right) continue
      if (e.clientY < r.top || e.clientY > r.bottom) continue
      const cid = root.dataset.containerId
      if (!cid) continue
      const mids = snapshots.get(cid)
      if (!mids || mids.length === 0) return { container: cid, index: 0 }
      // Find the index whose midpoint is closest to clientY
      let bestIdx = 0
      let bestDist = Math.abs(e.clientY - mids[0]!)
      for (let i = 1; i < mids.length; i++) {
        const d = Math.abs(e.clientY - mids[i]!)
        if (d < bestDist) {
          bestDist = d
          bestIdx = i
        }
      }
      return { container: cid, index: bestIdx }
    }
    return null
  }

  return {
    root: {
      'data-scope': 'sortable',
      'data-part': 'root',
      'data-container-id': containerId,
      'data-dragging': (s) => (get(s).dragging ? '' : undefined),
      onPointerMove: (e) => {
        if (!e.buttons) return
        const hit = findTargetAt(e)
        if (hit !== null)
          send({ type: 'move', index: hit.index, container: hit.container, y: e.clientY })
      },
      onPointerUp: () => {
        snapshots.clear()
        send({ type: 'drop' })
      },
      onPointerCancel: () => {
        snapshots.clear()
        send({ type: 'cancel' })
      },
    },
    item: (id, index) => ({
      'data-scope': 'sortable',
      'data-part': 'item',
      'data-index': String(index),
      'data-id': id,
      'data-dragging': (s) => {
        const d = get(s).dragging
        return d?.id === id && d?.fromContainer === containerId ? '' : undefined
      },
      'data-over': (s) => {
        const d = get(s).dragging
        return d?.currentIndex === index && d?.toContainer === containerId ? '' : undefined
      },
      // Shift direction for items BETWEEN the source and target (excluding the
      // dragged item itself). 'down' = item should translate down to make room;
      // 'up' = item should translate up. CSS controls the actual displacement.
      'data-shift': (s) => {
        const d = get(s).dragging
        if (!d || d.fromContainer !== containerId || d.toContainer !== containerId) return undefined
        if (d.id === id) return undefined
        if (d.startIndex === d.currentIndex) return undefined
        if (d.startIndex < d.currentIndex) {
          // Dragging down: items between start+1 and current shift up
          if (index > d.startIndex && index <= d.currentIndex) return 'up'
        } else {
          // Dragging up: items between current and start-1 shift down
          if (index >= d.currentIndex && index < d.startIndex) return 'down'
        }
        return undefined
      },
      // The dragged item follows the pointer via translateY(deltaY). Other
      // items have no transform override — data-shift CSS handles them.
      'style.transform': (s) => {
        const d = get(s).dragging
        if (!d || d.id !== id || d.fromContainer !== containerId) return undefined
        const deltaY = d.currentY - d.startY
        return `translateY(${deltaY}px)`
      },
      'style.zIndex': (s) => {
        const d = get(s).dragging
        if (!d || d.id !== id || d.fromContainer !== containerId) return undefined
        return '10'
      },
    }),
    handle: (id, index) => ({
      'data-scope': 'sortable',
      'data-part': 'handle',
      role: 'button',
      tabIndex: 0,
      'aria-grabbed': (s) => {
        const d = get(s).dragging
        return d?.id === id && d?.fromContainer === containerId
      },
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
        // Snapshot positions BEFORE the drag starts, so subsequent pointermove
        // events can resolve the target index against stable (pre-transform)
        // positions. Otherwise items shifting via CSS would cause the target
        // to oscillate as elementFromPoint hits different items.
        snapshotAll()
        send({ type: 'start', id, index, container: containerId, y: e.clientY })
      },
      onKeyDown: (e) => {
        switch (e.key) {
          case ' ':
          case 'Enter':
            e.preventDefault()
            send({ type: 'toggleGrab', id, index, container: containerId })
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
