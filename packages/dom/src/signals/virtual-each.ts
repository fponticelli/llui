// `virtualEach` — a windowed keyed list: only the rows in the scroll viewport
// (+overscan) exist in the DOM. Reuses `each`'s per-row machinery (per-row sub-build
// via `runBuild` with `inherit`, a row scope mounted on a `{ item, state, index }`
// ctx, teardowns on removal) and the shared {@link RowStateGate} for state-fanout
// gating; windowing/positioning is layered on top (fixed or per-item heights).

import {
  requireCtx,
  runBuild,
  runMounts,
  mountable,
  type BindingSpec,
  type Mountable,
} from './build-context.js'
import type { SignalScope } from './runtime.js'
import type { Renderable } from './element.js'
import { rebaseRowDep, rebaseRowSpecs } from './row-rebase.js'
import { buildAndPublishScope } from './scope-build.js'
import { RowStateGate } from './row-state-gate.js'
import { EMPTY_ROW_NODES, EMPTY_ROW_TEARDOWNS, type RowCtx } from './row.js'
import type { EachSource } from './each.js'

export interface VirtualEachSpec<T> extends EachSource<T> {
  key: (item: T) => string | number
  /** Row height in pixels. A `number` is a uniform fixed height (O(1) windowing);
   * a function returns a per-item height, letting rows vary — the window, spacer,
   * and row offsets are computed from cumulative heights (prefix sums, rebuilt when
   * `items` changes). Heights must be known from the data; measured/auto heights
   * are not supported. */
  itemHeight: number | ((item: T, index: number) => number)
  /** scroll-container height in pixels */
  containerHeight: number
  /** extra rows rendered above/below the viewport (default 3) */
  overscan?: number
  /** optional class on the scroll container */
  class?: string
  /** Additional COMPONENT-STATE dep paths the rows read, merged into the
   * structural binding's deps so a state-only change (items unchanged) still fires
   * the reconcile and refreshes visible rows. The authoring `virtualEach` passes
   * `['']` (whole state); a compiled tier could pass precise paths. Without it, a
   * row reading component state was frozen out of state-only changes (stale DOM). */
  extraDeps?: readonly string[]
  /** build a row; `getCtx` exposes the row's live `{ item, state, index }` ctx
   * (same shape as `signalEach`) for runtime item/index handles. */
  renderRow: (getCtx: () => RowCtx<T>) => Renderable
}

/**
 * Virtualized keyed list — only the rows in the scroll viewport (+overscan) exist
 * in the DOM. A scroll container (fixed `containerHeight`, `data-virtual-container`)
 * holds an inner spacer (`data-virtual-spacer`) sized to the total height; each
 * visible row is absolutely positioned (`translateY`) at its cumulative offset.
 *
 * On scroll the visible window is recomputed and rows are reconciled BY KEY using
 * the same per-row machinery as `signalEach` (per-row sub-build via `runBuild`
 * with `inherit`, a row scope mounted on a `{ item, state, index }` ctx, teardowns
 * on removal). Rows scrolled out are disposed; rows scrolled in are built. The
 * window also recomputes when `items` changes (a spec gated on `items.deps`).
 *
 * `itemHeight` is a uniform `number` (O(1) windowing) or a per-item function
 * `(item, index) => number` for variable-height rows (cumulative offsets via a
 * prefix sum, rebuilt when `items` changes). Heights come from the data —
 * measured/auto heights are not supported.
 */
export function signalVirtualEach<T>(spec: VirtualEachSpec<T>): Mountable {
  return mountable(() => buildSignalVirtualEach(spec))
}

function buildSignalVirtualEach<T>(spec: VirtualEachSpec<T>): Node {
  const c = requireCtx()
  const doc = c.doc
  // Nested in an enclosing row, reconcile reads the component state from the
  // combined ctx (so rows window/mount against it, not the enclosing row ctx).
  const inRow = c.inRow
  const overscan = spec.overscan ?? 3

  const scroll = doc.createElement('div') as HTMLElement
  scroll.setAttribute('data-virtual-container', '')
  scroll.style.setProperty('overflow', 'auto')
  scroll.style.setProperty('position', 'relative')
  scroll.style.setProperty('height', `${spec.containerHeight}px`)
  if (spec.class) scroll.setAttribute('class', spec.class)

  const spacer = doc.createElement('div') as HTMLElement
  spacer.setAttribute('data-virtual-spacer', '')
  spacer.style.setProperty('position', 'relative')
  spacer.style.setProperty('width', '100%')
  scroll.appendChild(spacer)

  // Same slimming as signalEach's Row: the row object IS the live-ctx box
  // (no separate `holder` allocation/write), and `spare` is allocated lazily
  // on the row's first update.
  interface Row {
    scope: SignalScope | null // null only between creation and the build below
    nodes: readonly Node[]
    wrapper: HTMLElement
    ctx: RowCtx<T>
    spare: RowCtx<T> | null
    index: number
    teardowns: Array<() => void>
  }
  const rows = new Map<string, Row>()

  let lastState: unknown = null
  let scrollTop = 0

  // State-fanout gating (shared RowStateGate): capture which component-state paths
  // the visible rows read (after rebasing to `state.*`), so a state change that
  // touches NONE of them skips the per-row `scope.update` sweep instead of
  // re-running every windowed row.
  const gate = new RowStateGate()

  // Fold one built row's rebased specs into the gate's state-read profile: a
  // structural child or a whole-`state` read is ungatable (sweep on any change); a
  // `state.foo` read contributes a gatable path.
  const captureRowStateReads = (specs: readonly BindingSpec[]): void => {
    const paths: string[] = []
    for (const s of specs) {
      if (s.structural) {
        // A structural child (show/branch/each) builds arms lazily — its inner
        // state reads are invisible here, so we can't gate; sweep on any change.
        gate.disableGating()
        gate.markReadsState()
        continue
      }
      for (const d of s.deps) {
        if (d === 'state') {
          gate.disableGating()
          gate.markReadsState()
        } else if (d.startsWith('state.')) {
          gate.markReadsState()
          paths.push(d.slice(6))
        }
      }
    }
    if (paths.length) gate.captureGatablePaths(paths)
  }

  // Height metrics. Fixed height → O(1) formulas. Per-item height → a prefix-sum
  // array (`prefix[i]` = cumulative top of row i, `prefix[n]` = total height),
  // rebuilt only when the `items` array reference changes (so a pure scroll reuses
  // it). All windowing/positioning goes through the helpers so both modes share
  // the reconcile loop.
  const fixedHeight = typeof spec.itemHeight === 'number' ? spec.itemHeight : null
  const heightFn = typeof spec.itemHeight === 'function' ? spec.itemHeight : null
  let metricsItems: readonly T[] | null = null
  let prefix: number[] = [0]

  const ensureMetrics = (items: readonly T[]): void => {
    if (fixedHeight !== null || items === metricsItems) return
    metricsItems = items
    const p = new Array<number>(items.length + 1)
    p[0] = 0
    for (let i = 0; i < items.length; i++) p[i + 1] = p[i]! + heightFn!(items[i]!, i)
    prefix = p
  }

  const totalHeight = (n: number): number => (fixedHeight !== null ? n * fixedHeight : prefix[n]!)
  const offsetOf = (i: number): number => (fixedHeight !== null ? i * fixedHeight : prefix[i]!)
  const heightOf = (i: number): number =>
    fixedHeight !== null ? fixedHeight : prefix[i + 1]! - prefix[i]!
  // Largest index in [0, n] whose top offset is ≤ px (the row containing px).
  const rowAtOffset = (px: number, n: number): number => {
    if (fixedHeight !== null) return Math.floor(px / fixedHeight)
    let lo = 0
    let hi = n
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (prefix[mid]! <= px) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  // Smallest index in [0, n] whose top offset is ≥ px (first row starting at/after).
  const rowStartingAtOrAfter = (px: number, n: number): number => {
    if (fixedHeight !== null) return Math.ceil(px / fixedHeight)
    let lo = 0
    let hi = n
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (prefix[mid]! >= px) hi = mid
      else lo = mid + 1
    }
    return lo
  }

  const computeRange = (length: number): [number, number] => {
    if (length === 0) return [0, 0]
    const start = Math.max(0, rowAtOffset(scrollTop, length) - overscan)
    const end = Math.min(
      length,
      rowStartingAtOrAfter(scrollTop + spec.containerHeight, length) + overscan,
    )
    return [start, end]
  }

  const positionWrapper = (wrapper: HTMLElement, index: number): void => {
    wrapper.style.setProperty('position', 'absolute')
    wrapper.style.setProperty('top', '0')
    wrapper.style.setProperty('left', '0')
    wrapper.style.setProperty('right', '0')
    wrapper.style.setProperty('height', `${heightOf(index)}px`)
    wrapper.style.setProperty('transform', `translateY(${offsetOf(index)}px)`)
  }

  const disposeRow = (row: Row): void => {
    if (row.teardowns.length) for (const t of row.teardowns.splice(0)) t()
    if (row.wrapper.parentNode === spacer) spacer.removeChild(row.wrapper)
  }

  const reconcile = (state: unknown): void => {
    lastState = state
    const items = spec.items(state)
    ensureMetrics(items)
    spacer.style.setProperty('height', `${totalHeight(items.length)}px`)

    // State-fanout gate: must existing windowed rows re-run for a state change?
    // Only when a component-state path they read changed since the last reconcile;
    // a scroll (same state) or an unrelated-field change skips the sweep.
    const sweepState = gate.shouldSweep(state)

    const [start, end] = computeRange(items.length)
    const seen = new Set<string>()

    for (let index = start; index < end; index++) {
      const item = items[index]!
      const k = String(spec.key(item))
      seen.add(k)
      const row = rows.get(k)
      if (!row) {
        const wrapper = doc.createElement('div') as HTMLElement
        wrapper.setAttribute('data-virtual-item', '')
        wrapper.setAttribute('data-virtual-key', k)
        positionWrapper(wrapper, index)
        const rowCtx: RowCtx<T> = { item, state, index }
        // The row record is created first so the render closure can capture it
        // as the live-ctx box (same pattern as signalEach).
        const created: Row = {
          scope: null,
          nodes: EMPTY_ROW_NODES,
          wrapper,
          ctx: rowCtx,
          spare: null,
          index,
          teardowns: EMPTY_ROW_TEARDOWNS,
        }
        // forceInRow + rebase the row's value specs to read ctx.state (same as
        // signalEach), so component-state reads in a virtual row resolve correctly.
        const built = runBuild(doc, () => spec.renderRow(() => created.ctx), c, undefined, true)
        built.specs = rebaseRowSpecs(built.specs)
        captureRowStateReads(built.specs)
        const scope = buildAndPublishScope(built)
        // Insert FIRST (row nodes → wrapper → spacer), THEN mount, THEN onMount —
        // matching each's phase-3 so selection-style bindings commit on attached
        // nodes (fixes the dropped-commit-on-detached-node class).
        for (const n of built.nodes) wrapper.appendChild(n)
        spacer.appendChild(wrapper)
        scope.mount(rowCtx)
        runMounts(built.mounts, wrapper, built.teardowns)
        created.scope = scope
        created.nodes = built.nodes
        created.teardowns = built.teardowns
        rows.set(k, created)
        continue
      }
      // existing row: re-run only the bindings whose part of the ctx changed.
      // Gate the scope update — skip it when neither item/index nor any read
      // state path changed (a scroll, or a state change the row doesn't read).
      // lazy spare (first update allocates; reused after); the row is the
      // live-ctx box, so swapping row.ctx keeps handles' .peek() current.
      if (sweepState || item !== row.ctx.item || index !== row.ctx.index) {
        const next = row.spare ?? { item, state, index }
        next.item = item
        next.state = state
        next.index = index
        row.scope!.update(row.ctx, next)
        row.spare = row.ctx
        row.ctx = next
      }
      // Reposition on index change; in variable-height mode also reposition every
      // pass, since an earlier item's height change shifts this row's offset even
      // when its own index is unchanged.
      if (row.index !== index || fixedHeight === null) {
        row.index = index
        positionWrapper(row.wrapper, index)
      }
    }

    for (const [k, row] of rows) {
      if (!seen.has(k)) {
        disposeRow(row)
        rows.delete(k)
      }
    }
  }

  // Recompute the window on scroll WITHOUT a component-state change.
  const onScroll = (): void => {
    scrollTop = scroll.scrollTop
    reconcile(lastState)
  }
  scroll.addEventListener('scroll', onScroll, { passive: true } as AddEventListenerOptions)

  // Structural binding gated on the list deps PLUS any extra component-state deps
  // (so a state-only change still fires the reconcile and refreshes visible rows
  // reading component state). produce returns the component state so reconcile can
  // build row ctxs; the state-fanout gate above keeps the per-change cost bounded.
  const specDeps =
    spec.extraDeps && spec.extraDeps.length > 0 ? [...spec.deps, ...spec.extraDeps] : spec.deps
  c.specs.push({
    deps: inRow ? specDeps.map(rebaseRowDep) : specDeps,
    produce: inRow ? (s) => (s as { state: unknown }).state : (s) => s,
    commit: (s) => reconcile(s),
    structural: true,
  })

  // On host dispose: detach the scroll listener and tear down every live row.
  c.teardowns.push(() => {
    scroll.removeEventListener('scroll', onScroll)
    for (const [k, row] of rows) {
      disposeRow(row)
      rows.delete(k)
    }
  })

  return scroll
}
