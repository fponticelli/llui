import { tagSend } from '@llui/dom'
import type { Send, Signal } from '@llui/dom'
import { sortableLocale } from '../locale/sortable.js'
import { allFiniteNumbers } from '../utils/number.js'

/**
 * Sortable — pointer-based reorderable list.
 *
 * State machine tracks the currently-dragged item and where it's hovering.
 * The app owns the actual array: `droppedMove(prev, msg)` names the move a
 * message COMPLETES — a pointer `drop`, or a keyboard `toggleGrab` while an item
 * is grabbed — and `reorder(arr, from, to)` applies it. Watch `currentIndex`
 * during a drag for a live preview.
 *
 * ```ts
 * type State = { items: string[]; sort: SortableState }
 *
 * update: (state, msg) => {
 *   switch (msg.type) {
 *     case 'sort': {
 *       const moved = sortable.droppedMove(state.sort, msg.msg)
 *       const [sort] = sortable.update(state.sort, msg.msg)
 *       const items = moved ? reorder(state.items, moved.from, moved.to) : state.items
 *       return [{ items, sort }, []]
 *     }
 *   }
 * }
 *
 * // `each`, `ul`, `li`, `div`, `text`, `mapSend` are imports from '@llui/dom';
 * // the view bag provides only `state` (a Signal) and `send`.
 * view: ({ state, send }) => {
 *   const sortableState = state.at('sort')
 *   const sortableSend = mapSend<Msg, sortable.SortableMsg>(send, (msg) => ({
 *     type: 'sort',
 *     msg,
 *   }))
 *   const s = sortable.connect(sortableState, sortableSend, { id: 'list' })
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
 *
 * **Screen readers.** A keyboard user who grabs, moves, drops or cancels needs
 * to HEAR it — nothing on screen tells them where the item is. The machine
 * therefore owns two more parts, and both must be rendered:
 *
 * - `liveRegion` — a polite, atomic `role="status"` region whose `text` (a
 *   Signal, rendered as the region's CHILD, never spread as an attribute)
 *   announces "Picked up Apple, item 2 of 5.", "Apple moved to position 3 of
 *   5.", the drop and a cancel. Render it visually hidden (`sr-only`), never
 *   `display: none` — a hidden live region is never announced. Pass
 *   `itemLabel` to name the item; without it the announcements say "item".
 * - `instructions` — the how-to text, `hidden`, which every handle references
 *   through `aria-describedby` (a directly referenced hidden element still
 *   provides a description, and stays out of the reading order).
 *
 * ```ts
 * const { text: live, ...liveAttrs } = s.liveRegion
 * const { text: howTo, ...howToAttrs } = s.instructions
 * div({ ...liveAttrs, class: 'sr-only' }, [text(live)])
 * div({ ...howToAttrs }, [text(howTo)])
 * ```
 *
 * The grab is `aria-pressed` on the handle (a toggle button: pressed while
 * the item is carried). `aria-grabbed` is NOT used: ARIA 1.1 deprecated it and
 * `aria-dropeffect` with no replacement, and screen readers never broadly
 * exposed either — the live region is how every mature implementation (dnd-kit,
 * React Aria) conveys a drag. `aria-roledescription` is deliberately not set:
 * it would replace "toggle button", the one cue that Space operates the handle.
 * All text comes from `LocaleContext` (`Locale['sortable']`).
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
  /**
   * How many items the origin container held when the drag started — the "N"
   * in "item 2 of N", and the last slot a keyboard `moveBy` may reach.
   */
  count: number
}

/**
 * What the live region says about the latest drag event, as DATA (the text is
 * rendered by `connect` through the locale). Positions are 0-based here;
 * `container` is the origin container, the only one whose region speaks.
 */
export type SortableAnnouncement =
  | { kind: 'grabbed'; container: string; id: string; position: number; count: number }
  | { kind: 'moved'; container: string; id: string; position: number; count: number }
  | { kind: 'dropped'; container: string; id: string; from: number; to: number; count: number }
  | { kind: 'cancelled'; container: string; id: string; position: number; count: number }

export interface SortableState {
  dragging: DragState | null
  /** The latest announcement; `null` before any drag and after a cross-container drop. */
  announcement: SortableAnnouncement | null
}

export type SortableMsg =
  /** @humanOnly */
  | {
      type: 'start'
      id: string
      index: number
      /** Items in the origin container (for "item X of N"). */
      count: number
      container: string
      x: number
      y: number
    }
  /** @humanOnly */
  | { type: 'move'; index: number; container: string; x: number; y: number }
  /** @humanOnly */
  | { type: 'drop' }
  /** @humanOnly */
  | { type: 'cancel' }
  /** @humanOnly */
  | { type: 'toggleGrab'; id: string; index: number; count: number; container: string }
  /** @humanOnly */
  | { type: 'moveBy'; delta: number }

export function init(): SortableState {
  return { dragging: null, announcement: null }
}

/** The announcement a drag's END makes: where it landed, or `null` for another list's drop. */
function dropAnnouncement(d: DragState): SortableAnnouncement | null {
  if (d.toContainer !== d.fromContainer) return null
  return {
    kind: 'dropped',
    container: d.fromContainer,
    id: d.id,
    from: d.startIndex,
    to: d.currentIndex,
    count: d.count,
  }
}

function grab(
  id: string,
  index: number,
  count: number,
  container: string,
  x: number,
  y: number,
): SortableState {
  return {
    dragging: {
      id,
      startIndex: index,
      currentIndex: index,
      fromContainer: container,
      toContainer: container,
      startX: x,
      startY: y,
      currentX: x,
      currentY: y,
      count,
    },
    announcement: { kind: 'grabbed', container, id, position: index, count },
  }
}

export function update(state: SortableState, msg: SortableMsg): [SortableState, never[]] {
  if (!allFiniteNumbers(msg)) return [state, []]
  switch (msg.type) {
    case 'start':
      return [grab(msg.id, msg.index, msg.count, msg.container, msg.x, msg.y), []]
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
      const d = state.dragging
      // A new SLOT in the origin list is announced; a coordinate-only move is
      // not (it would re-announce on every pointer frame), and neither is a
      // hover over another list, whose size this machine does not know.
      const slotChanged = d.currentIndex !== msg.index || d.toContainer !== msg.container
      const announcement: SortableAnnouncement | null =
        slotChanged && msg.container === d.fromContainer
          ? {
              kind: 'moved',
              container: d.fromContainer,
              id: d.id,
              position: msg.index,
              count: d.count,
            }
          : state.announcement
      return [
        {
          dragging: {
            ...d,
            currentIndex: msg.index,
            toContainer: msg.container,
            currentX: msg.x,
            currentY: msg.y,
          },
          announcement,
        },
        [],
      ]
    }
    case 'drop':
      return state.dragging
        ? [{ dragging: null, announcement: dropAnnouncement(state.dragging) }, []]
        : [state, []]
    case 'cancel': {
      const d = state.dragging
      if (!d) return [state, []]
      return [
        {
          dragging: null,
          announcement: {
            kind: 'cancelled',
            container: d.fromContainer,
            id: d.id,
            position: d.startIndex,
            count: d.count,
          },
        },
        [],
      ]
    }
    case 'toggleGrab':
      if (state.dragging) {
        // Already dragging — drop at current position
        return [{ dragging: null, announcement: dropAnnouncement(state.dragging) }, []]
      }
      // Pick up (keyboard — no pointer position)
      return [grab(msg.id, msg.index, msg.count, msg.container, 0, 0), []]
    case 'moveBy': {
      const d = state.dragging
      if (!d) return [state, []]
      // Never past either end: the drop target is always a real slot.
      const next = Math.min(Math.max(0, d.count - 1), Math.max(0, d.currentIndex + msg.delta))
      if (!Number.isFinite(next)) return [state, []]
      if (next === d.currentIndex) return [state, []]
      return [
        {
          dragging: { ...d, currentIndex: next },
          announcement: {
            kind: 'moved',
            container: d.fromContainer,
            id: d.id,
            position: next,
            count: d.count,
          },
        },
        [],
      ]
    }
  }
}

/**
 * The reorder a message COMPLETES, or `null`. A pointer `drop` and a keyboard
 * `toggleGrab` while an item is grabbed both end a drag at `currentIndex`;
 * `cancel` (Escape, pointercancel) ends one WITHOUT a move. Only a drop inside
 * the container the drag started from is a reorder of that list — a drop onto
 * another container is the consumer's transfer to handle.
 *
 * Call it with the state BEFORE `update` runs.
 */
export function droppedMove(
  prev: SortableState,
  msg: SortableMsg,
): { from: number; to: number } | null {
  const d = prev.dragging
  if (d === null) return null
  if (msg.type !== 'drop' && msg.type !== 'toggleGrab') return null
  if (d.fromContainer !== d.toContainer) return null
  return { from: d.startIndex, to: d.currentIndex }
}

export interface SortableParts {
  root: {
    'data-scope': 'sortable'
    'data-part': 'root'
    'data-container-id': string
    'data-dragging': Signal<'' | undefined>
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
    'data-dragging': Signal<'' | undefined>
    'data-over': Signal<'' | undefined>
    'data-shift': Signal<'up' | 'down' | undefined>
    'style.transform': Signal<string | undefined>
    'style.zIndex': Signal<string | undefined>
  }
  handle: (
    id: string,
    index: number,
  ) => {
    'data-scope': 'sortable'
    'data-part': 'handle'
    role: 'button'
    tabindex: 0
    /** A toggle button: pressed while this handle's item is carried. */
    'aria-pressed': Signal<boolean>
    'aria-label': string
    /** The `instructions` part's id. */
    'aria-describedby': string
    onPointerDown: (e: PointerEvent) => void
    onKeyDown: (e: KeyboardEvent) => void
  }
  /**
   * The polite live region announcing grab / move / drop / cancel. `text` is
   * the region's CHILD (a Signal), not an attribute: spread the rest and render
   * `text(text)` inside. Keep it visually hidden but rendered (`sr-only`) — a
   * `display: none` region is never announced. Only the ORIGIN container's
   * region speaks, so connects that share one state never announce twice.
   */
  liveRegion: {
    role: 'status'
    'aria-live': 'polite'
    'aria-atomic': 'true'
    'data-scope': 'sortable'
    'data-part': 'live-region'
    text: Signal<string>
  }
  /**
   * The keyboard instructions every handle's `aria-describedby` points at.
   * `hidden`: a directly referenced hidden element still supplies the
   * description, and stays out of the reading order. `text` is its CHILD.
   */
  instructions: {
    id: string
    hidden: true
    'data-scope': 'sortable'
    'data-part': 'instructions'
    text: string
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
  /**
   * The name a listener hears for an item, from its `id` ("Picked up Apple,
   * item 2 of 5."; "Drag handle for Apple"). Without it the announcements say
   * "item" and every handle has the same label.
   */
  itemLabel?: (id: string) => string
}

export function connect(
  state: Signal<SortableState>,
  send: Send<SortableMsg>,
  opts: ConnectOptions,
): SortableParts {
  // The connect's `id` doubles as the cross-container identifier
  const containerId = opts.id
  const layout = opts.layout ?? '1d'
  const locale = sortableLocale()
  const instructionsId = `${containerId}:instructions`
  const labelOf = (id: string): string | undefined => opts.itemLabel?.(id)

  function announce(a: SortableAnnouncement | null): string {
    if (a === null || a.container !== containerId) return ''
    const item = labelOf(a.id)
    switch (a.kind) {
      case 'grabbed':
        return locale.grabbed(item, a.position + 1, a.count)
      case 'moved':
        return locale.moved(item, a.position + 1, a.count)
      case 'dropped':
        return locale.dropped(item, a.from + 1, a.to + 1, a.count)
      case 'cancelled':
        return locale.cancelled(item, a.position + 1, a.count)
    }
  }

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

  // The CURRENT position of a handle's item among its container's items. The
  // `index` a handle closes over is frozen at render: a keyed `each()` moves
  // the row nodes on a reorder without re-running their render, so after the
  // first drop it names the wrong slot. The DOM is the live order.
  function liveItems(handle: Element): { index: number | null; count: number } {
    const itemEl = handle.closest('[data-scope="sortable"][data-part="item"]')
    const rootEl = handle.closest('[data-scope="sortable"][data-part="root"]')
    if (itemEl === null || rootEl === null) return { index: null, count: 0 }
    const items = Array.from(rootEl.querySelectorAll('[data-scope="sortable"][data-part="item"]'))
    const at = items.indexOf(itemEl)
    return { index: at === -1 ? null : at, count: items.length }
  }

  return {
    liveRegion: {
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      'data-scope': 'sortable',
      'data-part': 'live-region',
      text: state.map((s) => announce(s.announcement)),
    },
    instructions: {
      id: instructionsId,
      hidden: true,
      'data-scope': 'sortable',
      'data-part': 'instructions',
      text: locale.instructions,
    },
    root: {
      'data-scope': 'sortable',
      'data-part': 'root',
      'data-container-id': containerId,
      'data-dragging': state.map((s) => (s.dragging ? '' : undefined)),
      onPointerMove: tagSend(send, ['move'], (e) => {
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
      }),
      onPointerUp: tagSend(send, ['drop'], () => {
        snapshots.clear()
        send({ type: 'drop' })
      }),
      onPointerCancel: tagSend(send, ['cancel'], () => {
        snapshots.clear()
        send({ type: 'cancel' })
      }),
    },
    item: (id, index) => ({
      'data-scope': 'sortable',
      'data-part': 'item',
      'data-index': String(index),
      'data-id': id,
      'data-dragging': state.map((s) => {
        const d = s.dragging
        return d?.id === id && d?.fromContainer === containerId ? '' : undefined
      }),
      'data-over': state.map((s) => {
        const d = s.dragging
        if (!d || d.toContainer !== containerId) return undefined
        // Look up this item's CURRENT DOM index via the drag-start snapshot.
        // The `index` closed over here is frozen at initial render and goes
        // stale after each() reconciles a reorder.
        const snap = snapshots.get(containerId)
        const liveIndex = snap?.idToIndex.get(id) ?? index
        return d.currentIndex === liveIndex ? '' : undefined
      }),
      // Shift direction for items BETWEEN the source and target (excluding the
      // dragged item itself). 'down' = item should translate down to make room;
      // 'up' = item should translate up. CSS controls the actual displacement.
      //
      // In 2D layout, `data-shift` is always undefined — the per-item
      // `style.transform` below opens the correct gap directly. Keeping
      // `data-shift` out of the 2D path prevents any author-provided
      // CSS rule like `[data-shift] { translate: 0 var(--sortable-shift) }`
      // from fighting with the computed transform.
      'data-shift': state.map((s) => {
        if (layout === '2d') return undefined
        const d = s.dragging
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
      }),
      // The dragged item follows the pointer. In 1D, translateY only; in
      // 2D, both axes. Non-dragged items in 2D between source and target
      // get a per-item translate computed from the snapshot — each item's
      // vector is `snapshot[newSlot] - snapshot[ownSlot]` so the gap
      // opens correctly regardless of row wrap. In 1D, non-dragged items
      // emit `undefined` here and rely on the consumer's CSS `data-shift`
      // rule.
      'style.transform': state.map((s) => {
        const d = s.dragging
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
      }),
      'style.zIndex': state.map((s) => {
        const d = s.dragging
        if (!d || d.id !== id || d.fromContainer !== containerId) return undefined
        return '10'
      }),
    }),
    handle: (id, index) => ({
      'data-scope': 'sortable',
      'data-part': 'handle',
      role: 'button',
      tabindex: 0,
      'aria-pressed': state.map((s) => {
        const d = s.dragging
        return d?.id === id && d?.fromContainer === containerId
      }),
      'aria-label': locale.handle(labelOf(id)),
      'aria-describedby': instructionsId,
      onPointerDown: tagSend(send, ['start'], (e) => {
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
        // The CURRENT DOM index of this handle's item (see `liveItems`).
        const live = target ? liveItems(target) : { index: null, count: 0 }
        const currentIndex = live.index ?? index
        // Snapshot positions BEFORE the drag starts, so subsequent pointermove
        // events can resolve the target index against stable (pre-transform)
        // positions. Otherwise items shifting via CSS would cause the target
        // to oscillate as elementFromPoint hits different items.
        snapshotAll()
        send({
          type: 'start',
          id,
          index: currentIndex,
          count: Math.max(live.count, currentIndex + 1),
          container: containerId,
          x: e.clientX,
          y: e.clientY,
        })
      }),
      onKeyDown: tagSend(send, ['toggleGrab', 'cancel', 'moveBy'], (e) => {
        const target = e.currentTarget instanceof HTMLElement ? e.currentTarget : null
        const live = target ? liveItems(target) : { index: null, count: 0 }
        switch (e.key) {
          case ' ':
          case 'Enter': {
            e.preventDefault()
            const dropping = state.peek().dragging !== null
            const at = live.index ?? index
            send({
              type: 'toggleGrab',
              id,
              index: at,
              count: Math.max(live.count, at + 1),
              container: containerId,
            })
            // A drop the consumer applies MOVES this row, and moving a
            // focused node drops its focus to <body>: the keyboard user
            // would lose their place on the very item they just placed.
            // Put focus back on the handle once the reorder has landed —
            // now for a synchronous commit, next frame for a deferred one.
            if (dropping && target !== null) {
              const restore = (): void => {
                const active = target.ownerDocument.activeElement
                if (target.isConnected && (active === null || active === target.ownerDocument.body))
                  target.focus()
              }
              restore()
              if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restore)
            }
            return
          }
          case 'Escape':
            e.preventDefault()
            send({ type: 'cancel' })
            return
          case 'ArrowDown':
          case 'ArrowRight': {
            e.preventDefault()
            // The drop target is always a real slot: never past the last item.
            const d = state.peek().dragging
            if (d !== null && live.count > 0 && d.currentIndex >= live.count - 1) return
            send({ type: 'moveBy', delta: 1 })
            return
          }
          case 'ArrowUp':
          case 'ArrowLeft':
            e.preventDefault()
            send({ type: 'moveBy', delta: -1 })
            return
        }
      }),
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
  // f is clamped to [0, len-1] and len > 0, so splice always removes one item.
  const [item] = result.splice(f, 1)
  result.splice(t, 0, item!)
  return result
}

export const sortable = { init, update, connect, reorder, droppedMove }
