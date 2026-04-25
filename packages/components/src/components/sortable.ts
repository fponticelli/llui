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
   * Pointer X at drag start (viewport coordinates). Used by 2D layouts
   * to compute `deltaX = currentX - startX` alongside the Y axis. In 1D
   * layouts X is tracked but ignored by the renderer.
   */
  startX: number
  /**
   * Pointer Y at drag start (viewport coordinates). Used by CSS / the
   * library's `style.transform` binding to make the dragged item follow
   * the pointer.
   */
  startY: number
  /**
   * Current pointer X (viewport coordinates). `deltaX = currentX - startX`.
   */
  currentX: number
  /**
   * Current pointer Y (viewport coordinates). `deltaY = currentY - startY`.
   */
  currentY: number
}

export interface SortableState {
  dragging: DragState | null
}

export type SortableMsg =
  /** @humanOnly */
  | { type: 'start'; id: string; index: number; container: string; x: number; y: number }
  /** @humanOnly */
  | { type: 'move'; index: number; container: string; x: number; y: number }
  /** @humanOnly */
  | { type: 'drop' }
  /** @humanOnly */
  | { type: 'cancel' }
  /** @humanOnly */
  | { type: 'toggleGrab'; id: string; index: number; container: string }
  /** @humanOnly */
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
            startX: msg.x,
            startY: msg.y,
            currentX: msg.x,
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
        state.dragging.currentX === msg.x &&
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
            currentX: msg.x,
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
            startX: 0,
            startY: 0,
            currentX: 0,
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
  /**
   * Drag-target selection + render strategy.
   *
   *   - `'1d'` (default) — single-axis, Y-only. `findTargetAt` picks
   *     by vertical distance; `style.transform` on the dragged item
   *     is `translateY(deltaY)`; non-dragged items between source
   *     and target emit `data-shift: 'up' | 'down'` so CSS can
   *     animate them via `translateY(±var(--sortable-shift))`.
   *     Correct for vertical lists; fails for 2D layouts (flex-wrap,
   *     grid) because same-row items collapse to the same midpoint
   *     distance.
   *
   *   - `'2d'` — Euclidean target selection against 2D midpoints;
   *     dragged item follows both X and Y (`translate(dx, dy)`);
   *     non-dragged items between source and target get a per-item
   *     `style.transform = translate(deltaFromSnapshot)` that opens
   *     the correct gap regardless of row boundaries. `data-shift`
   *     is always `undefined` in 2D so CSS `translateY(var(--...))`
   *     rules don't conflict with the per-item transform.
   *
   * Keyboard navigation (`moveBy`) stays linear-array in both modes —
   * arrow keys step through the array indices regardless of visual
   * row, because that's what screen readers announce and what the
   * underlying data order actually is.
   */
  layout?: '1d' | '2d'
}

export function connect<S>(
  get: (s: S) => SortableState,
  send: Send<SortableMsg>,
  opts: ConnectOptions,
): SortableParts<S> {
  // The connect's `id` doubles as the cross-container identifier
  const containerId = opts.id
  const layout = opts.layout ?? '1d'

  // Snapshots taken at drag start — stable throughout the drag so computing
  // the target index is not affected by items visually shifting via CSS.
  // Map: container-id → array of midpoint {x, y} pairs for each item's
  // original bounding rect (sorted by index). The handler records this on
  // pointerdown. Always 2D internally; 1D layout's findTargetAt ignores X.
  interface Snapshot {
    mids: Array<{ x: number; y: number }>
    // id → current DOM index at drag start. Used by data-shift / per-item
    // transform to look up an item's live position, since the `index`
    // captured at render time is frozen and goes stale after each()
    // reconciles a reorder.
    idToIndex: Map<string, number>
  }
  const snapshots = new Map<string, Snapshot>()

  function snapshotContainer(rootEl: HTMLElement, cid: string): void {
    const items = rootEl.querySelectorAll<HTMLElement>('[data-scope="sortable"][data-part="item"]')
    // Read rects once — they're pre-transform (no drag shifts yet)
    const mids: Array<{ x: number; y: number }> = []
    const idToIndex = new Map<string, number>()
    items.forEach((item, i) => {
      const r = item.getBoundingClientRect()
      mids.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
      const itemId = item.dataset.id
      if (itemId !== undefined) idToIndex.set(itemId, i)
    })
    snapshots.set(cid, { mids, idToIndex })
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
  // 1D mode: picks by Y-only distance (original behavior). 2D mode: picks
  // by Euclidean distance over {x, y} midpoints — required for flex-wrap
  // / grid layouts where multiple items share a row and collapse to the
  // same Y value. Both modes are stable against items being visually
  // transformed during the drag because midpoints are taken pre-transform.
  function findTargetAt(e: PointerEvent): { container: string; index: number } | null {
    const roots = document.querySelectorAll<HTMLElement>(
      '[data-scope="sortable"][data-part="root"]',
    )
    for (const root of roots) {
      const r = root.getBoundingClientRect()
      if (e.clientX < r.left || e.clientX > r.right) continue
      if (e.clientY < r.top || e.clientY > r.bottom) continue
      const cid = root.dataset.containerId
      if (!cid) continue
      const snap = snapshots.get(cid)
      if (!snap || snap.mids.length === 0) return { container: cid, index: 0 }
      const mids = snap.mids
      let bestIdx = 0
      if (layout === '2d') {
        // Euclidean (squared — monotonic with distance, saves a sqrt).
        const dx0 = e.clientX - mids[0]!.x
        const dy0 = e.clientY - mids[0]!.y
        let bestDist = dx0 * dx0 + dy0 * dy0
        for (let i = 1; i < mids.length; i++) {
          const dx = e.clientX - mids[i]!.x
          const dy = e.clientY - mids[i]!.y
          const d = dx * dx + dy * dy
          if (d < bestDist) {
            bestDist = d
            bestIdx = i
          }
        }
      } else {
        // 1D — Y-only distance. Preserves the original behavior for
        // vertical lists; same-row items in a flex-wrap would tie and
        // the first match wins, which is the bug that motivates 2D.
        let bestDist = Math.abs(e.clientY - mids[0]!.y)
        for (let i = 1; i < mids.length; i++) {
          const d = Math.abs(e.clientY - mids[i]!.y)
          if (d < bestDist) {
            bestDist = d
            bestIdx = i
          }
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
          send({
            type: 'move',
            index: hit.index,
            container: hit.container,
            x: e.clientX,
            y: e.clientY,
          })
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
        if (!d || d.toContainer !== containerId) return undefined
        // Look up this item's CURRENT DOM index via the drag-start snapshot.
        // The `index` closed over here is frozen at initial render and goes
        // stale after each() reconciles a reorder.
        const snap = snapshots.get(containerId)
        const liveIndex = snap?.idToIndex.get(id) ?? index
        return d.currentIndex === liveIndex ? '' : undefined
      },
      // Shift direction for items BETWEEN the source and target (excluding the
      // dragged item itself). 'down' = item should translate down to make room;
      // 'up' = item should translate up. CSS controls the actual displacement.
      //
      // In 2D layout, `data-shift` is always undefined — the per-item
      // `style.transform` below opens the correct gap directly. Keeping
      // `data-shift` out of the 2D path prevents any author-provided
      // CSS rule like `[data-shift] { translate: 0 var(--sortable-shift) }`
      // from fighting with the computed transform.
      'data-shift': (s) => {
        if (layout === '2d') return undefined
        const d = get(s).dragging
        if (!d || d.fromContainer !== containerId || d.toContainer !== containerId) return undefined
        if (d.id === id) return undefined
        if (d.startIndex === d.currentIndex) return undefined
        // Look up this item's live DOM index — see note on data-over.
        const snap = snapshots.get(containerId)
        const liveIndex = snap?.idToIndex.get(id) ?? index
        if (d.startIndex < d.currentIndex) {
          // Dragging down: items between start+1 and current shift up
          if (liveIndex > d.startIndex && liveIndex <= d.currentIndex) return 'up'
        } else {
          // Dragging up: items between current and start-1 shift down
          if (liveIndex >= d.currentIndex && liveIndex < d.startIndex) return 'down'
        }
        return undefined
      },
      // The dragged item follows the pointer. In 1D, translateY only; in
      // 2D, both axes. Non-dragged items in 2D between source and target
      // get a per-item translate computed from the snapshot — each item's
      // vector is `snapshot[newSlot] - snapshot[ownSlot]` so the gap
      // opens correctly regardless of row wrap. In 1D, non-dragged items
      // emit `undefined` here and rely on the consumer's CSS `data-shift`
      // rule.
      'style.transform': (s) => {
        const d = get(s).dragging
        if (!d) return undefined
        const isDragged = d.id === id && d.fromContainer === containerId
        if (isDragged) {
          const deltaY = d.currentY - d.startY
          if (layout === '2d') {
            const deltaX = d.currentX - d.startX
            return `translate(${deltaX}px, ${deltaY}px)`
          }
          return `translateY(${deltaY}px)`
        }
        // Non-dragged items: per-item displacement in 2D only.
        if (layout !== '2d') return undefined
        if (d.fromContainer !== containerId || d.toContainer !== containerId) return undefined
        if (d.startIndex === d.currentIndex) return undefined
        const snap = snapshots.get(containerId)
        if (!snap) return undefined
        const liveIndex = snap.idToIndex.get(id)
        if (liveIndex === undefined) return undefined
        // Which slot this item should visually occupy while the drag
        // previews the reorder:
        //   drag-down (start < current): items at liveIndex in
        //     (start .. current] shift left-by-one in array order, so
        //     they take the slot at liveIndex - 1.
        //   drag-up (current < start): items at liveIndex in
        //     [current .. start) shift right-by-one, take slot
        //     liveIndex + 1.
        let targetSlot: number
        if (d.startIndex < d.currentIndex) {
          if (liveIndex <= d.startIndex || liveIndex > d.currentIndex) return undefined
          targetSlot = liveIndex - 1
        } else {
          if (liveIndex < d.currentIndex || liveIndex >= d.startIndex) return undefined
          targetSlot = liveIndex + 1
        }
        const own = snap.mids[liveIndex]
        const target = snap.mids[targetSlot]
        if (!own || !target) return undefined
        const dx = target.x - own.x
        const dy = target.y - own.y
        return `translate(${dx}px, ${dy}px)`
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
        // Compute the CURRENT DOM index of this handle's item — the captured
        // `index` param is stale after a reorder (each() moves keyed nodes
        // without re-running render, so the closure's index is frozen at
        // initial mount). Walk up to find the containing item, then count its
        // position among sibling items.
        let currentIndex = index
        if (target) {
          const itemEl = (target as Element).closest<HTMLElement>(
            '[data-scope="sortable"][data-part="item"]',
          )
          const rootEl = (target as Element).closest<HTMLElement>(
            '[data-scope="sortable"][data-part="root"]',
          )
          if (itemEl && rootEl) {
            const items = rootEl.querySelectorAll<HTMLElement>(
              '[data-scope="sortable"][data-part="item"]',
            )
            for (let i = 0; i < items.length; i++) {
              if (items[i] === itemEl) {
                currentIndex = i
                break
              }
            }
          }
        }
        // Snapshot positions BEFORE the drag starts, so subsequent pointermove
        // events can resolve the target index against stable (pre-transform)
        // positions. Otherwise items shifting via CSS would cause the target
        // to oscillate as elementFromPoint hits different items.
        snapshotAll()
        send({
          type: 'start',
          id,
          index: currentIndex,
          container: containerId,
          x: e.clientX,
          y: e.clientY,
        })
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
