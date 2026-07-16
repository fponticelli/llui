// The `each` family — keyed list rendering with a move-minimizing (LIS) reconcile.
//
// A structural binding gated on the list's deps (items path + row-state paths); on
// change it reconciles by key. Each row is its OWN signal scope mounted on a
// combined `{ item, state, index }` ctx, so a row reacts to its item AND to
// component state with per-row, per-binding gating. State-fanout gating (which rows
// re-evaluate on a component-state change) is delegated to {@link RowStateGate}.

import {
  requireCtx,
  runBuild,
  runMounts,
  mountable,
  type BindingSpec,
  type Mountable,
  type SignalDoc,
} from './build-context.js'
import type { SignalScope } from './runtime.js'
import type { Renderable } from './element.js'
import {
  itemsSourceRowLocal,
  rebaseComponentDep,
  rebaseRowDep,
  rebaseRowSpecs,
  specNeedsRebase,
} from './row-rebase.js'
import { scopeFromSpecs, depsSignatureMatches, type ScopeShape } from './scope-build.js'
import { RowStateGate } from './row-state-gate.js'
import { EMPTY_ROW_NODES, EMPTY_ROW_TEARDOWNS, EMPTY_ROW_MOUNTS, type RowCtx } from './row.js'
import type { TransitionOptions } from '../types.js'

export type { RowCtx } from './row.js'

/** Items source for `signalEach`: an accessor reading the array out of the
 * component state, plus the dep paths the list depends on — the items path AND
 * any component-state paths the rows read (so the list reconciles on either). */
export interface EachSource<T> {
  items: (state: unknown) => readonly T[]
  deps: readonly string[]
  /** See {@link BindingSpec.componentRooted}: `true` when the items accessor reads
   * the COMPONENT state (so a nested each reads `ctx.state`, not the enclosing row
   * ctx). Set by the authoring layer from the items handle; unbranded → inference. */
  componentRooted?: boolean
}

/** A compiler-emitted (or hand-written) direct `each` row: real DOM nodes built
 * with direct ops + binding specs wired by DIRECT node reference — bypassing the
 * authoring-helper / `Mountable` / `populate` / `pathHandle` machinery the
 * generic row path runs per row. The factory runs per row under the build ctx;
 * each spec's `produce(ctx)` reads the row ctx (`{ item, state, index }`) and its
 * `commit` writes straight to the located node. See
 * `docs/proposals/v2-compiler/compiled-row-construction.md`. */
export interface DirectRow {
  nodes: Node[]
  bindings: readonly BindingSpec[]
}

/** Builds a fresh {@link DirectRow} (new nodes + binding closures) per row.
 * `getCtx` exposes the row's LIVE `{ item, state, index }` ctx (the same box the
 * binding `produce(ctx)` reads), so a row's event-handler closures can read the
 * current row item at event time — `onClick: () => send({ type: 'toggle', id:
 * getCtx().item.id })` — the direct-path analogue of the render path's
 * `pathHandle(getCtx, 'item')`. Rows with no item-referencing handlers ignore it. */
export type RowFactory = (doc: SignalDoc, getCtx: () => RowCtx<unknown>) => DirectRow

/**
 * Indices into `a` that form a longest strictly-increasing subsequence, skipping
 * entries `< 0` (used for keyed reorder: entries are old DOM positions and `-1`
 * marks a freshly-created row). Patience-sorting with parent links, O(n log n).
 * The returned set marks the rows that are ALREADY in correct relative order and
 * therefore need no DOM move — every other row is inserted/moved.
 */
function lisIndices(a: readonly number[]): Set<number> {
  const piles: number[] = [] // piles[l] = index in `a` of the smallest tail of a length-(l+1) subseq
  const prev = new Array<number>(a.length).fill(-1)
  for (let i = 0; i < a.length; i++) {
    const v = a[i]!
    if (v < 0) continue // new row — never part of the kept (LIS) set
    let lo = 0
    let hi = piles.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (a[piles[mid]!]! < v) lo = mid + 1
      else hi = mid
    }
    if (lo > 0) prev[i] = piles[lo - 1]!
    piles[lo] = i
  }
  const keep = new Set<number>()
  let k = piles.length > 0 ? piles[piles.length - 1]! : -1
  while (k >= 0) {
    keep.add(k)
    k = prev[k]!
  }
  return keep
}

/**
 * Keyed list primitive. A structural binding gated on the list's deps (items
 * path + row-state paths); on change it reconciles by key. Each row is its OWN
 * signal scope mounted on a combined `{ item, state }` context — so a row reacts
 * to its item AND to component state, with per-row, per-binding gating (a shared
 * state change fans out only to the row bindings that read it; item changes hit
 * only that row). Kept rows are mutated in place, never recreated.
 *
 * Reorder is move-minimizing via a longest-increasing-subsequence pass over the
 * rows' previous DOM positions: only `n − |LIS|` rows move, so a 2-row swap is 2
 * DOM moves and a single removal is 0 — not the O(n) re-insert the naive cursor
 * walk degraded to (swap/remove were ~6×/4× slower than peer frameworks).
 */
export function signalEach<T>(
  source: EachSource<T>,
  key: (item: T) => string | number,
  renderRow: (getCtx: () => RowCtx<T>) => Renderable,
  extraDeps?: readonly string[],
  transition?: TransitionOptions,
): Mountable {
  return mountable(() => buildSignalEach(source, key, renderRow, undefined, extraDeps, transition))
}

/** Direct-construction keyed list: same keyed reconcile as {@link signalEach},
 * but each row is built by a {@link RowFactory} (direct DOM + direct binding
 * wiring) instead of running authoring helpers per row. The compiler-emitted fast
 * path for lowerable rows; also usable hand-written. */
export function signalEachDirect<T>(
  source: EachSource<T>,
  key: (item: T) => string | number,
  rowFactory: RowFactory,
  extraDeps?: readonly string[],
  transition?: TransitionOptions,
): Mountable {
  return mountable(() => buildSignalEach(source, key, undefined, rowFactory, extraDeps, transition))
}

function buildSignalEach<T>(
  source: EachSource<T>,
  key: (item: T) => string | number,
  // `getCtx` exposes the row's LIVE combined ctx so authoring `each` can build
  // item handles whose `.peek()` reads the current row. The transform emits
  // `() => [...]` which simply ignores the argument. Undefined when `rowFactory`
  // is supplied (the direct-construction path).
  renderRow: ((getCtx: () => RowCtx<T>) => Renderable) | undefined,
  // Direct-construction row builder (compiled fast path); when set, rows are built
  // by this instead of running `renderRow` through the authoring helpers.
  rowFactory?: RowFactory,
  // Additional COMPONENT-STATE dep paths the rows read, appended to the
  // structural binding's deps ONLY (the items-source resolution is unaffected).
  // The compiled pass-1 path merges its collected row state-deps into
  // `source.deps` instead; this parameter serves the handle-sourced tiers, whose
  // items deps say nothing about what the rows read: the authoring `each` and
  // `eachArm` pass `['']` (any state change may matter — rows can read state
  // through parts/arms invisible at runtime), and compiled `eachDirect` passes
  // the precise collected paths. Without it, a row-nested arm reading an
  // unrelated state path was frozen out of state-only changes (stale DOM).
  extraDeps?: readonly string[],
  // Optional element-level transition hooks (see {@link TransitionOptions}):
  // `enter` runs on freshly-inserted rows, `leave` DEFERS a removed row's detach
  // until its promise resolves (a row re-added mid-leave resurrects), and
  // `onTransition({ entering, leaving, parent })` runs after the keyed reconcile
  // commit so FLIP can measure old→new row positions. Absent (the default) ⇒ the
  // reconcile is byte-identical to the pre-transition path. Never runs under SSR.
  transition?: TransitionOptions,
): Node {
  const c = requireCtx()
  const doc = c.doc
  // Snapshot the context map at PLACEMENT: rows build lazily on every reconcile, and
  // a `provide` lexically above this `each` has already restored the parent map by
  // then. Passing the snapshot as `runBuild`'s seed keeps the provided value visible
  // in every row (see build-context.ts `runBuild` / `provide`).
  const capturedContexts = c.contexts
  // Transitions are a live-DOM concern — disabled entirely under SSR.
  const tx = c.ssr ? undefined : transition
  const leaveHook = tx?.leave
  // When this each is itself nested in an enclosing row, its reconcile must
  // receive the component state (`ctx.state`), so its own rows mount with
  // `ctx.state` = the component state (not the enclosing row ctx).
  const inRow = c.inRow
  const start = doc.createComment('each')
  const end = doc.createComment('/each')
  const frag = doc.createDocumentFragment()
  frag.appendChild(start)
  frag.appendChild(end)

  // The Row IS the live-ctx box: factories/render closures capture the row and
  // read `row.ctx` (`getCtx = () => row.ctx`) — the former separate `holder`
  // wrapper was one extra allocation per row plus a duplicate pointer write on
  // every row update. Fields are assigned in two steps (the row must exist
  // before its build runs so closures can capture it): `scope` is null only
  // during that build, `spare` is allocated lazily on the row's FIRST update
  // (a created-and-never-updated row — the whole create-10k — never pays it),
  // and direct rows share frozen empty teardowns/mounts (they never register
  // any; mutation sites are length-guarded).
  interface Row {
    scope: SignalScope | null
    nodes: readonly Node[]
    ctx: RowCtx<T> // current ctx (holds the last-applied item + state)
    spare: RowCtx<T> | null // scratch ctx, swapped in on updates (no per-tick alloc)
    teardowns: Array<() => void> // onMount cleanups + foreign unmount for this row
    // onMount callbacks, run once after the row's nodes are first inserted (phase 3).
    mounts: ReadonlyArray<(root: Element) => void | (() => void)>
    mounted: boolean
  }
  // A row whose `leave` animation is in flight: kept out of `rows`/`order` (so the
  // keyed reconcile ignores it) but with its scope + still-connected nodes alive
  // until the promise resolves — or until a later update RE-ADDS its key, which
  // resurrects it (cancels the pending detach and moves it back into `rows`).
  interface LeavingRow {
    row: Row
    cancelled: boolean
  }
  const rows = new Map<string, Row>()
  // Rows currently animating out (deferred detach). Allocated only when a `leave`
  // hook is present, so the no-transition path adds no state.
  const leaving: Map<string, LeavingRow> | null = leaveHook ? new Map() : null

  /** Detach a leaving row and run its teardowns exactly once — unless it was
   * cancelled (resurrected) or superseded by a newer leave for the same key. */
  const finalizeLeavingRow = (k: string, entry: LeavingRow): void => {
    if (entry.cancelled) return
    if (leaving!.get(k) !== entry) return // superseded by a newer leave for this key
    entry.cancelled = true
    leaving!.delete(k)
    const row = entry.row
    if (row.teardowns.length) for (const t of row.teardowns.splice(0)) t()
    for (const node of row.nodes) node.parentNode?.removeChild(node)
  }

  /** Begin leaving `row` (already removed from `rows`): keep it alive + connected,
   * run the `leave` hook, and defer detach until its promise resolves. A `leave`
   * that returns void (e.g. `flip`, which detaches immediately and animates the
   * survivors) finalizes synchronously. */
  const startLeave = (k: string, row: Row): void => {
    const entry: LeavingRow = { row, cancelled: false }
    leaving!.set(k, entry)
    const result = leaveHook!(Array.from(row.nodes))
    if (result && typeof (result as Promise<void>).then === 'function') {
      void (result as Promise<void>).then(() => finalizeLeavingRow(k, entry))
    } else {
      finalizeLeavingRow(k, entry)
    }
  }

  // Keys in current DOM order — the previous reconcile's desired order. Drives the
  // LIS move-minimization (old position of each surviving key).
  let order: string[] = []
  // Rows in current DOM order, lockstep with `order` — so the same-structure
  // fast path indexes rows directly instead of a Map.get per row per send
  // (200k map lookups on a 1k-send burst against a 200-row table).
  let rowsInOrder: Row[] = []
  // The previous reconcile's items array — for the same-structure fast path: when
  // the new array has the same length and every CHANGED position keeps its key
  // (the streaming in-place update case), only the changed rows need updating and
  // we skip the O(n) keyed scan (String(key)+Set+Map + per-reconcile allocations).
  let prevItems: readonly T[] | null = null
  // State-fanout gating: which rows re-run on a component-state change (see
  // RowStateGate — the monotonic/latched/reset flag machine that was inline here).
  const gate = new RowStateGate()

  // When this each is nested in an enclosing row, the scope hands `reconcile`
  // the COMBINED row ctx (`{ item, state, index }`). Rows must always mount with
  // the COMPONENT state, but the items source reads whatever its deps name: a
  // row-local source (`item.map(…)` / `item.at(…)`, deps all row-local) reads
  // the combined ctx so `item`/`index` resolve; a component-state source
  // (`state.map(…)`) reads `ctx.state`. For a top-level each the input IS the
  // component state and both coincide.
  const itemsRowLocal = itemsSourceRowLocal(source)
  // Direct-construction rows from a `rowFactory` share one template, so every
  // row's specs carry identical deps → identical PathTable + masks. Build that
  // shape once (from the first row) and reuse it for all rows, skipping per-row
  // buildPathTable + bindingMask.
  let directShape: ScopeShape | null = null
  // Dep signature of the row `directShape` was built from. The direct/compiled path
  // assumes every row's factory emits an identical binding structure (true for
  // compiler output). But `eachDirect` is also a public hand-written API, where a
  // data-conditional factory can emit a DIFFERENT structure per row — reusing the
  // first row's masks would then gate a binding against paths it doesn't read
  // (silent stale DOM). Track the signature so a divergent row is caught (dev) or
  // given its own fresh shape (prod), instead of silently mis-masked.
  let directDeps: ReadonlyArray<readonly string[]> | null = null
  // Authoring rows (the render-callback path) ALSO usually share a template, so
  // their specs carry identical deps too — but a render MAY be data-conditional
  // (e.g. a block body that branches on `item.peek()`), producing different specs
  // per row. So we memoize the shape AND its dep signature, reuse it only when a
  // row's specs match (cheap array compare, no PathTable/mask rebuild), and fall
  // back to a fresh shape otherwise. Mirrors `directShape` for the verbatim path.
  let authorShape: ScopeShape | null = null
  let authorDeps: ReadonlyArray<readonly string[]> | null = null
  const reconcile = (input: unknown): void => {
    const parent = end.parentNode
    if (!parent) return
    const rowState = inRow ? (input as { state: unknown }).state : input
    const itemsState = inRow && !itemsRowLocal ? (input as { state: unknown }).state : input
    const items = source.items(itemsState)
    const n = items.length

    // State-fanout gating: does this reconcile have to re-evaluate EVERY row (a
    // component-state path the rows read changed → fan out), or only the rows whose
    // item changed? Delegated to the gate (see RowStateGate.shouldSweep); replaces
    // the coarse always-on read at the per-row update sites below.
    const sweepAll = gate.shouldSweep(rowState)

    // Transition bookkeeping (only allocated when a transition is wired): the nodes
    // of rows created / removed in THIS reconcile, handed to `enter` and
    // `onTransition({ entering, leaving, parent })` after the commit. The fast paths
    // below (same-structure, same-order) have no creates/removes/moves, so they
    // return before any of this runs — untouched by the seam.
    const enteringNodes: Node[] | null = tx ? [] : null
    const leavingNodes: Node[] | null = tx ? [] : null

    // ── Same-structure fast path ──────────────────────────────────────────
    // The streaming in-place update case (e.g. a ticker tick replacing a few
    // rows' values): same length, and every position whose item REF changed
    // keeps its key — so no create/remove/move. Update only the changed rows
    // (or all rows when the template reads component state, which any state
    // change may fan out to) and skip the O(n) keyed scan entirely — no
    // `String(key)` per row, no `Set`/`Array(n)` allocations, no LIS. Falls
    // through to the full keyed reconcile the moment a key moves or n changes.
    const prev = prevItems
    prevItems = items // set once here — covers every return path below
    if (prev !== null && n === prev.length && rows.size === n) {
      let structural = false
      for (let i = 0; i < n; i++) {
        if (items[i] !== prev[i] && String(key(items[i]!)) !== order[i]) {
          structural = true // a key moved / row replaced → need the full reconcile
          break
        }
      }
      if (!structural) {
        for (let i = 0; i < n; i++) {
          const item = items[i]!
          const row = rowsInOrder[i]!
          if (sweepAll || item !== row.ctx.item || i !== row.ctx.index) {
            // lazy spare: allocated on the row's first update, reused after
            const next = row.spare ?? { item, state: rowState, index: i }
            next.item = item
            next.state = rowState
            next.index = i
            row.scope!.update(row.ctx, next)
            row.spare = row.ctx
            row.ctx = next
          }
        }
        return
      }
    }

    const newKeys = new Array<string>(n)
    const newRows = new Array<Row>(n)
    const seen = new Set<string>()
    // Track whether the key sequence is positionally identical to the previous
    // DOM order. If so this is a pure in-place update (no create/remove/move) and
    // we can skip the ordering bookkeeping (old-position map + LIS) entirely — the
    // hot path for `update`/`replace`-in-place, which must not pay reorder cost.
    let sameOrder = order.length === n

    // ── Phase 1: create-or-update every desired row (NO DOM moves yet) ──
    for (let index = 0; index < n; index++) {
      const item = items[index]!
      const k = String(key(item))
      // Dev-only: a key already claimed THIS pass is a duplicate. Duplicates
      // silently corrupt the list — two items collapse onto one keyed row (one
      // scope, one set of nodes), so the second item never renders and reorder /
      // removal then walks a phantom position (NotFoundError). Fail loudly in dev
      // with the offending key + each-site deps; prod keeps the tolerant path
      // (last write wins for the shared row).
      if (import.meta.env?.DEV === true && seen.has(k)) {
        const msg =
          `each: duplicate key ${JSON.stringify(k)} at index ${index} — every row's ` +
          `key must be unique. Duplicate keys corrupt the keyed reconcile (the rows ` +
          `share one live scope, so reorder/removal misbehaves). ` +
          `(each items deps: ${JSON.stringify(source.deps)})`
        console.error(msg)
        throw new Error(msg)
      }
      newKeys[index] = k
      if (sameOrder && order[index] !== k) sameOrder = false
      seen.add(k)
      let row = rows.get(k)
      // A resurrected row (see below) must be re-evaluated unconditionally, even when
      // its item ref and index are unchanged: while it was out of `rows` (animating
      // out) it was skipped by every intervening reconcile, yet the RowStateGate
      // snapshot advanced without it — so a `state` change during the leave left its
      // bindings stale. The identity gate below would wrongly skip it.
      let resurrected = false
      // Re-add during leave: a key whose row is still animating out resurrects —
      // cancel the pending detach, reuse the live scope + still-connected nodes,
      // and let the existing-row update branch below apply the current item/index.
      // Its key is absent from `order` (it left in a prior pass), so Phase 3 treats
      // it as a move of already-connected nodes (no re-mount — `mounted` is true).
      if (!row && leaving) {
        const reviving = leaving.get(k)
        if (reviving && !reviving.cancelled) {
          reviving.cancelled = true
          leaving.delete(k)
          row = reviving.row
          rows.set(k, row)
          resurrected = true
          // Reverse the interrupted leave animation (the transition run-scope
          // supersedes the in-flight leave); no-op when there's no enter hook.
          if (tx?.enter) tx.enter(Array.from(row.nodes))
        }
      }
      if (!row) {
        // Create the row FIRST so the factory/render closures can capture it as
        // the live-ctx box (`getCtx = () => created.ctx`); build-pending fields
        // are assigned right below. Direct rows keep the shared empty
        // teardowns/mounts (they never register any — and splicing an empty
        // array is harmless, so sharing is safe).
        const created: Row = {
          scope: null,
          nodes: EMPTY_ROW_NODES,
          ctx: { item, state: rowState, index },
          spare: null,
          teardowns: EMPTY_ROW_TEARDOWNS,
          mounts: EMPTY_ROW_MOUNTS,
          mounted: false,
        }
        // forceInRow: the row build (and every nested arm/row build) operates on
        // the combined ctx, so structural primitives inside it become row-aware.
        let builtSpecs: readonly BindingSpec[]
        let renderHost: { scope: SignalScope | null } | null = null
        if (rowFactory) {
          const dr = rowFactory(doc, () => created.ctx)
          created.nodes = dr.nodes
          builtSpecs = dr.bindings
        } else {
          const b = runBuild(doc, () => renderRow!(() => created.ctx), c, capturedContexts, true)
          created.nodes = b.nodes
          builtSpecs = b.specs
          created.teardowns = b.teardowns
          created.mounts = b.mounts
          renderHost = b.host
        }
        // A keyed row must be one or more STABLE nodes. A structural primitive
        // (show/branch/each) returns a DocumentFragment that empties on insertion —
        // as a bare row root it leaves the row with no stable handle to move or
        // remove, so reorder/removal corrupts the DOM (NotFoundError). Require it to
        // be wrapped in an element, which becomes the row's stable boundary. Checked
        // for EVERY created row, not just the first: a data-conditional render can
        // make a LATER row's root a bare fragment even when the first row was an
        // element, and that divergent row must be caught too.
        if (created.nodes.some((nd) => nd.nodeType === 11 /* DocumentFragment */)) {
          throw new Error(
            'each: a row cannot have a `show`/`branch`/`each` as its top-level node — ' +
              'wrap the conditional body in an element (e.g. `li([show(...)])`) so the ' +
              'row has a stable node to key, move, and remove. ' +
              `(each items deps: ${JSON.stringify(source.deps)})`,
          )
        }

        // Per-row probe — accumulated across EVERY row built, never latched from
        // one row, because a data-conditional render can make rows heterogeneous
        // (the first row row-local, a later row reading component state).
        //
        // `rowNeedsRebase`: does THIS row have a VALUE spec that reads the COMPONENT
        // state (a bare component read that must be re-rooted to `ctx.state`)? Uses
        // the `componentRooted` brand (collision-proof) with the legacy string
        // fallback. Structural specs make themselves row-aware, so they're excluded.
        const rowNeedsRebase = builtSpecs.some(specNeedsRebase)
        const rowStructural = builtSpecs.some((s) => s.structural)
        // A row reads component state if any binding has a `state.*`/`state` dep,
        // needs rebasing, OR has a STRUCTURAL child (show/branch/each) whose arms are
        // built lazily and may read state from inside (e.g. a folder/file show whose
        // file arm nests a `state.editingId` rename show) — we can't see those arm
        // specs here, so a structural child forces per-state-change row re-eval.
        const rowReadsState =
          rowNeedsRebase ||
          rowStructural ||
          builtSpecs.some((s) => s.deps.some((d) => d === 'state' || d.startsWith('state.')))
        // Monotonic: once ANY row reads component state, every state change must
        // re-evaluate the affected rows (see `sweepAll`).
        if (rowReadsState) gate.markReadsState()
        // State-fanout gating: capture the component-state value paths rows read so
        // a reconcile can skip the all-row sweep when none changed (the ticker tick
        // that bumps tickCount but not displayMode). Gating stays viable only while
        // every state-reading row is cheaply gatable — a structural child (unseen
        // arm reads), a rebased connect-part, or a whole-`state` read can't be gated.
        if (rowReadsState && gate.canGate) {
          const rowGatable =
            !rowStructural &&
            !rowNeedsRebase &&
            !builtSpecs.some((s) => s.deps.some((d) => d === 'state'))
          if (!rowGatable) gate.disableGating()
          else {
            const paths: string[] = []
            for (const s of builtSpecs) {
              for (const d of s.deps) if (d.startsWith('state.')) paths.push(d.slice(6))
            }
            gate.captureGatablePaths(paths)
          }
        }
        // Re-root component-state-rooted VALUE bindings (e.g. connect() parts placed
        // in the row by an uncompiled each) to read ctx.state — only when this row
        // needs it. Local so the direct row hands `dr.bindings` through as-is.
        const rowSpecs: readonly BindingSpec[] = rowNeedsRebase
          ? rebaseRowSpecs(builtSpecs)
          : builtSpecs
        if (rowFactory) {
          // Direct path: reuse the shared per-each-site shape when this row's deps
          // match the one it was built from. A divergent row (only possible for a
          // hand-written `eachDirect` factory — compiler output is homogeneous) must
          // NOT reuse the cached masks, which describe a different binding set.
          if (directShape && !depsSignatureMatches(rowSpecs, directDeps!)) {
            if (import.meta.env?.DEV === true) {
              const msg =
                `eachDirect: row ${index} emitted a different binding structure than ` +
                `the first row — a direct/compiled each requires every row to have the ` +
                `same bindings (same deps, same order). A data-conditional factory must ` +
                `use the authoring \`each\` render path instead. (row deps: ` +
                `${JSON.stringify(rowSpecs.map((s) => s.deps))})`
              console.error(msg)
              throw new Error(msg)
            }
            // Prod: build this row its own correct shape rather than mis-masking it.
            const r = scopeFromSpecs(rowSpecs)
            created.scope = r.scope
          } else {
            // Direct rows own no nested scope, so there is no host to wire.
            const r = scopeFromSpecs(rowSpecs, directShape ?? undefined)
            if (!directShape) {
              directShape = r.shape
              directDeps = rowSpecs.map((s) => s.deps)
            }
            created.scope = r.scope
          }
        } else if (authorShape && depsSignatureMatches(rowSpecs, authorDeps!)) {
          // Authoring row whose spec structure matches the cached template: reuse
          // the shared shape, skipping per-row buildPathTable + bindingMask.
          const r = scopeFromSpecs(rowSpecs, authorShape)
          renderHost!.scope = r.scope
          created.scope = r.scope
        } else {
          // First authoring row, or a data-conditional row that diverged: build a
          // fresh shape and (re)seed the cache for subsequent matching rows.
          const r = scopeFromSpecs(rowSpecs)
          authorShape = r.shape
          authorDeps = rowSpecs.map((s) => s.deps)
          renderHost!.scope = r.scope
          created.scope = r.scope
        }
        // NOTE: the row scope is NOT mounted here. Its bindings commit in phase 3,
        // AFTER the row's nodes are inserted into the parent (see the `mounted`
        // gate below) — so a binding that depends on the node being connected to
        // its controlling parent resolves correctly. The canonical case is
        // `<option selected>`: a single `<select>` coordinates selection across its
        // options, so `option.selected = true` only takes effect once the option is
        // a child of the select; committing it on the still-detached row would be
        // silently dropped, with no re-commit (output-equality). This mirrors the
        // top-level mount contract ("insert FIRST, then mount") that `each` is the
        // last structural primitive to honor.
        row = created
        rows.set(k, row)
      } else if (resurrected || sweepAll || item !== row.ctx.item || index !== row.ctx.index) {
        // existing row that may have changed: re-run only the bindings whose part
        // of the ctx changed. Reuse the spare ctx buffer (no allocation); swap it
        // in as the new current. old (row.ctx) and new (next) stay distinct refs,
        // so the diff sees item/state changes correctly.
        // lazy spare: allocated on the row's first update, reused after. The
        // row itself is the live-ctx box, so swapping row.ctx keeps runtime
        // item handles' .peek() current — no separate holder write.
        const next = row.spare ?? { item, state: rowState, index }
        next.item = item
        next.state = rowState
        next.index = index
        row.scope!.update(row.ctx, next)
        row.spare = row.ctx
        row.ctx = next
        // No else: item + index unchanged and no binding reads component state, so
        // the row's output can't have changed — skip the diff + binding re-eval.
      }
      newRows[index] = row
    }

    // Fast path: identical key sequence → no creates, removes, or moves. The DOM
    // is already in the right order; rows were updated in place above.
    if (sameOrder) {
      order = newKeys
      rowsInOrder = newRows
      return
    }

    // Full clear: drop all rows' teardowns, then remove every row node between the
    // anchors in ONE Range op (where supported) instead of N removeChild calls.
    // Skipped when a transition is wired — leaving rows must be handled one by one
    // (deferred detach / onTransition) via Phase 2 below, not bulk-deleted.
    if (n === 0 && rows.size > 0 && !tx) {
      for (const row of rows.values())
        if (row.teardowns.length) for (const t of row.teardowns.splice(0)) t()
      const ownerDoc = (parent as Node).ownerDocument
      const range = typeof ownerDoc?.createRange === 'function' ? ownerDoc.createRange() : null
      if (range) {
        range.setStartAfter(start)
        range.setEndBefore(end)
        range.deleteContents()
      } else {
        for (const row of rows.values())
          for (const node of row.nodes) if (node.parentNode === parent) parent.removeChild(node)
      }
      rows.clear()
      order = newKeys // empty
      rowsInOrder = newRows // empty
      return
    }

    // ── Phase 2: remove rows no longer present ──
    if (rows.size > n || seen.size < rows.size) {
      for (const [k, row] of rows) {
        if (!seen.has(k)) {
          if (leavingNodes) leavingNodes.push(...row.nodes) // for onTransition
          if (leaveHook) {
            // Deferred detach: keep the row alive + connected while it animates out;
            // finalizeLeavingRow (on the leave promise) runs teardowns + removes it.
            rows.delete(k)
            startLeave(k, row)
          } else {
            if (row.teardowns.length) for (const t of row.teardowns.splice(0)) t() // onMount cleanups + foreign unmount
            for (const node of row.nodes) if (node.parentNode === parent) parent.removeChild(node)
            rows.delete(k)
          }
        }
      }
    }

    // ── Phase 3: order the DOM with minimal moves (LIS over old positions) ──
    // sources[i] = the old DOM position of the row now wanted at i, or -1 if it
    // was created this pass. Rows in the LIS are already correctly ordered and
    // stay put; every other row (and every new row) is inserted before the anchor
    // as we walk right-to-left. Moves = n − |LIS|.
    const oldPos = new Map<string, number>()
    for (let i = 0; i < order.length; i++) oldPos.set(order[i]!, i)
    const sources = new Array<number>(n)
    for (let i = 0; i < n; i++) {
      const p = oldPos.get(newKeys[i]!)
      sources[i] = p === undefined ? -1 : p
    }
    const keep = lisIndices(sources)
    let anchor: Node = end
    for (let i = n - 1; i >= 0; i--) {
      const row = newRows[i]!
      if (sources[i] === -1) {
        for (const node of row.nodes) parent.insertBefore(node, anchor)
        if (!row.mounted) {
          row.mounted = true
          // Commit the row's bindings now that its nodes are connected to the
          // parent (e.g. options to their <select>); then run onMount. Both fire
          // exactly once, on first insertion.
          row.scope!.mount(row.ctx)
          runMounts(row.mounts, parent as Element, row.teardowns)
          // A freshly-mounted row is ENTERING (a resurrected row was already
          // mounted, so it is excluded — its enter ran at resurrection).
          if (enteringNodes) enteringNodes.push(...row.nodes)
        }
      } else if (!keep.has(i)) {
        for (const node of row.nodes) parent.insertBefore(node, anchor)
      }
      // anchor for the next (leftward) row is this row's first node
      anchor = row.nodes[0] ?? anchor
    }

    order = newKeys
    rowsInOrder = newRows

    // Post-commit transition hooks: `enter` on the freshly-inserted rows, then
    // `onTransition({ entering, leaving, parent })` (FLIP measures survivors'
    // old→new positions). Only reached on a structural reconcile — the same-
    // structure / same-order fast paths returned above with nothing to animate.
    if (tx) {
      if (tx.enter && enteringNodes!.length) tx.enter(enteringNodes!)
      tx.onTransition?.({ entering: enteringNodes!, leaving: leavingNodes!, parent })
    }
  }

  // structural binding: fires when the list deps change; produce returns the
  // component state so reconcile can build each row's combined ctx. Nested in an
  // enclosing row, it reads `ctx.state` and its deps rebase onto that combined ctx.
  // Nested in a row, rebase the gating deps onto the combined ctx: the items deps
  // per the source's locality (row-local items keep, component-rooted items →
  // `state.*`), and the extra component-state deps always → `state.*`.
  const rebaseItems = itemsRowLocal ? rebaseRowDep : rebaseComponentDep
  const baseDeps = inRow ? source.deps.map(rebaseItems) : source.deps
  const hasExtra = extraDeps !== undefined && extraDeps.length > 0
  const extra = hasExtra ? (inRow ? extraDeps!.map(rebaseComponentDep) : extraDeps!) : undefined
  c.specs.push({
    deps: extra ? [...baseDeps, ...extra] : baseDeps,
    // Pass the scope state straight through: the combined row ctx when nested in
    // a row, the component state at top level. `reconcile` derives the items
    // source's state (row-local vs component) and the rows' mount state from it.
    produce: (s) => s,
    commit: (s) => reconcile(s),
    structural: true,
  })

  // On host dispose, tear down every live row (onMount cleanups, foreign
  // unmounts) — otherwise per-row side effects leak when the list unmounts.
  c.teardowns.push(() => {
    for (const [k, row] of rows) {
      if (row.teardowns.length) for (const t of row.teardowns.splice(0)) t()
      rows.delete(k)
    }
    // Finalize any rows still animating out synchronously — a leave must not hold
    // DOM/scopes past the list's unmount (its promise resolving later is a no-op:
    // `cancelled` guards it). Detach the nodes too, so the region doesn't leak.
    if (leaving) {
      for (const entry of leaving.values()) {
        if (entry.cancelled) continue
        entry.cancelled = true
        if (entry.row.teardowns.length) for (const t of entry.row.teardowns.splice(0)) t()
        for (const node of entry.row.nodes) node.parentNode?.removeChild(node)
      }
      leaving.clear()
    }
  })

  return frag
}
