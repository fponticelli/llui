import type { ComponentDef, Lifetime, Binding } from './types.js'
import type { StructuralBlock } from './structural.js'
import type { RingBuffer, EachDiff } from './tracking/each-diff.js'
import type { DisposerEvent } from './tracking/disposer-log.js'
import type { CoverageTracker } from './tracking/coverage.js'
import { type DomEnv, browserEnv } from './dom-env.js'

// Single lazily-constructed browser env shared by every client-side
// component instance. Falls through to globalThis at call time — safe
// to construct on a server process (the lookups never fire there).
let _fallbackEnv: DomEnv | null = null
function fallbackBrowserEnv(): DomEnv {
  if (_fallbackEnv === null) _fallbackEnv = browserEnv()
  return _fallbackEnv
}
import type {
  EffectTimelineEntry,
  PendingEffectsList,
  MockRegistry,
} from './tracking/effect-timeline.js'
import { createLifetime } from './lifetime.js'
import { applyBinding } from './binding.js'
import { setCurrentDirtyMask } from './primitives/memo.js'
import { enterAccessor, exitAccessor } from './render-context.js'

export const FULL_MASK = 0xffffffff | 0

// ── Compiler/runtime version gate (v2b §5) ──────────────────────────
//
// `__compilerVersion` is the field every compiled `ComponentDef` carries
// at v2b+ runtime. `createInstance` consults it to detect components
// that bypassed the compiler (hand-rolled defs, builds that skipped the
// plugin) and either falls back to `genericUpdate` (with a one-time
// warn per def.name) or rejects an incompatible compiled bundle.
//
// The minimum compatible compiler version: at v2b ship this is 0.3.0.
// A def's `__compilerVersion >= RUNTIME_MIN_COMPILER_VERSION` is accepted;
// older versions throw in dev and warn in prod.
//
// The sentinel `'__test__'` is reserved for test fixtures built via
// `defineTestComponent()` — see v2b §6.3.
export const RUNTIME_MIN_COMPILER_VERSION = '0.3.0'

const _uncompiledWarned = new Set<string>()

function warnUncompiledOnce(defName: string): void {
  if (_uncompiledWarned.has(defName)) return
  _uncompiledWarned.add(defName)
  if (import.meta.env?.DEV) {
    console.warn(
      `[llui] Component "${defName}" has no \`__compilerVersion\` — falling back to ` +
        `\`genericUpdate\` (FULL_MASK on every update; no bitmask gating). Either the ` +
        `file was authored as a raw \`ComponentDef\` literal (use \`defineTestComponent()\` ` +
        `in tests, or compile via @llui/vite-plugin in app code), or the build pipeline ` +
        `skipped the LLui transform. See docs/proposals/v2-compiler/v2b.md §5.`,
    )
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((p) => parseInt(p, 10) || 0)
  const pb = b.split('.').map((p) => parseInt(p, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const av = pa[i] ?? 0
    const bv = pb[i] ?? 0
    if (av !== bv) return av - bv
  }
  return 0
}

function assertCompilerCompatibility(defName: string, version: string | undefined): void {
  if (version === undefined) {
    warnUncompiledOnce(defName)
    return
  }
  if (version === '__test__') return // defineTestComponent sentinel
  // Strip pre-release tags (e.g. '0.3.0-alpha.0' → '0.3.0') so alpha builds
  // are accepted alongside the stable minimum. Conservative pre-release
  // policy: an alpha satisfies any equal-or-lower stable minimum.
  const stable = version.split('-', 1)[0]!
  if (compareVersions(stable, RUNTIME_MIN_COMPILER_VERSION) < 0) {
    const msg =
      `[llui] Component "${defName}" was compiled by @llui/compiler v${version}, ` +
      `but this runtime requires ≥ v${RUNTIME_MIN_COMPILER_VERSION}. Upgrade the compiler ` +
      `(\`pnpm up @llui/vite-plugin\`) and rebuild. See v2-compiler/v2b.md §5.`
    if (import.meta.env?.DEV) {
      throw new Error(msg)
    }
    console.warn(msg)
  }
}

/**
 * Path-keyed dirty mask computation. Walks the prefix table; each entry
 * whose `prefix(prev) !== prefix(next)` contributes its bit to the dirty
 * mask. Bit position = table position (single-word, ≤31 entries) — for
 * overflow (>31 entries), bits 31..61 land in the high half of a
 * `[number, number]` pair, matching `__dirty`'s overflow shape.
 *
 * The runtime is correct under structural-sharing reducers (immutable
 * splice): a sub-tree that wasn't touched stays reference-equal across
 * `prev`/`next`, so every accessor reading into that sub-tree skips.
 *
 * @internal
 */
export function computeDirtyFromPrefixes(
  prefixes: ReadonlyArray<(state: unknown) => unknown>,
  prev: unknown,
  next: unknown,
): number | [number, number] {
  if (prefixes.length <= 31) {
    let dirty = 0
    for (let i = 0; i < prefixes.length; i++) {
      if (prefixes[i]!(prev) !== prefixes[i]!(next)) dirty |= 1 << i
    }
    return dirty
  }
  // Overflow: two words, 31 bits each (avoid sign bit for ergonomic
  // bitwise ops). Bit i % 31 of word ⌊i / 31⌋.
  let lo = 0
  let hi = 0
  const len = prefixes.length
  for (let i = 0; i < len && i < 31; i++) {
    if (prefixes[i]!(prev) !== prefixes[i]!(next)) lo |= 1 << i
  }
  for (let i = 31; i < len && i < 62; i++) {
    if (prefixes[i]!(prev) !== prefixes[i]!(next)) hi |= 1 << (i - 31)
  }
  // Anything past 62 forces FULL_MASK in the high word — the unified
  // model's compiler-emitted prefix counts shouldn't hit this in
  // realistic apps, but degrade gracefully if they do.
  if (len > 62) hi = FULL_MASK
  return [lo, hi]
}

export interface ComponentInstance<S = unknown, M = unknown, E = unknown> {
  def: ComponentDef<S, M, E>
  state: S
  initialEffects: E[]
  rootLifetime: Lifetime
  dom: DomEnv
  allBindings: Binding[]
  structuralBlocks: StructuralBlock[]
  queue: M[]
  microtaskScheduled: boolean
  lastDirtyMask: number
  lastEffects: E[]
  send: (msg: M) => void
  signal: AbortSignal
  abortController: AbortController
  /** @internal dev-only — populated when `installDevTools` ran. Ring-buffered
   *  per-each-site reconciliation diffs for MCP introspection tools. */
  _eachDiffLog?: RingBuffer<EachDiff>
  /** @internal dev-only — monotonically incremented by the devtools-intercepted
   *  `update` before each history push. Read by `each.ts` to stamp diffs with
   *  the `updateIndex` of the message that caused the reconciliation. */
  _updateCounter?: number
  /** @internal dev-only — populated when `installDevTools` ran. Ring-buffered
   *  log of `disposeLifetime` firings (scope id + cause). Consumed by the
   *  `llui_disposer_log` MCP tool to diagnose leaks on structural transitions. */
  _disposerLog?: RingBuffer<DisposerEvent>
  /** @internal dev-only — populated when `installDevTools` ran. Per-variant
   *  Msg counter keyed by discriminant. Consumed by the `llui_coverage` MCP
   *  tool to surface Msg variants that have never fired this session. */
  _coverage?: CoverageTracker
  /** @internal dev-only — populated when `installDevTools` ran. Ring-buffered
   *  effect dispatch phase log (dispatched → resolved/cancelled) for USER
   *  effects emitted from `update()`. Consumed by the `llui_effect_timeline`
   *  MCP tool. Built-in plumbing effects (`delay`, `log`) are NOT recorded
   *  here by design — they short-circuit in `dispatchEffect` before
   *  `dispatchEffectDev` runs. They're runtime plumbing, not user intent,
   *  and surface via other channels (message queue for `delay`, browser
   *  console for `log`). */
  _effectTimeline?: RingBuffer<EffectTimelineEntry>
  /** @internal dev-only — populated when `installDevTools` ran. List of
   *  currently-pending effects addressable by id, consumed by the
   *  `llui_pending_effects` MCP tool. */
  _pendingEffects?: PendingEffectsList
  /** @internal dev-only — populated when `installDevTools` ran. Mock
   *  registry consulted by the effect-dispatch wrapper to short-circuit
   *  matching effects. Consumed by the `llui_mock_effect` MCP tool. */
  _effectMocks?: MockRegistry
  /**
   * @internal — set by mountApp/mountAtAnchor/hydrateApp/hydrateAtAnchor
   * to fire AppHandle.subscribe listeners after every update cycle.
   * Undefined until the first subscriber registers.
   */
  _onCommit?: (state: unknown) => void
  /**
   * @internal — optional hook invoked when a binding's accessor throws
   * during Phase 2. The runtime catches the throw, leaves the binding's
   * `lastValue` unchanged (so the rendered DOM stays at its previous
   * value rather than going blank), and notifies this hook. The agent
   * factory wires it to drain.errors so the LLM sees that some bindings
   * failed; non-agent hosts can leave it undefined for the default
   * console-warn behavior.
   *
   * Why catch + continue instead of letting the throw propagate?
   * One bad binding shouldn't abort the entire update loop — sibling
   * bindings on the same commit are independent and have no business
   * going stale because a different binding crashed. The user-visible
   * effect: when one cell's accessor throws (e.g. scoring fails on a
   * malformed criterion), every other cell still renders correctly;
   * only the broken binding shows its previous value.
   */
  _onBindingError?: (info: { kind: string; key?: string; message: string; stack?: string }) => void
  /**
   * @internal — live registry of currently-mounted Msg variants
   * dispatchable from rendered UI. Lazily allocated when the first
   * compiler-tagged event handler binds. Read by the agent layer (via
   * `AppHandle.getBindingDescriptors()`) to surface live affordances
   * to the LLM. See `binding-descriptors.ts` for the registration
   * protocol and `@llui/vite-plugin`'s tagger pass for the tag emission.
   */
  _bindingDescriptors?: import('./binding-descriptors.js').BindingDescriptorRegistry
}

export function createComponentInstance<S, M, E, D = void>(
  def: ComponentDef<S, M, E, D>,
  data?: D,
  parentLifetime: Lifetime | null = null,
  dom?: DomEnv,
): ComponentInstance<S, M, E> {
  // Hand-authored `__dirty` is no longer supported — the path-keyed
  // `__prefixes` emission supersedes it (62-prefix capacity, precise
  // per-prefix gating). Compiler-emitted `__dirty` was removed in
  // 2026-05 alongside this throw; any `__dirty` field at runtime must
  // be user code, and silently ignoring it would hide a stale pattern.
  // Migrate by deleting the `__dirty` field — the compiler emits
  // `__prefixes` automatically from accessor analysis, and uncompiled
  // components correctly fall back to FULL_MASK.
  if ((def as { __dirty?: unknown }).__dirty !== undefined) {
    throw new Error(
      `[llui] Component "${def.name}" defines \`__dirty\` directly. ` +
        `This field is no longer accepted — the compiler emits \`__prefixes\` ` +
        `(path-keyed reactivity) automatically. Remove \`__dirty\` from the ` +
        `ComponentDef; either the compiler will regenerate the correct ` +
        `prefix table, or uncompiled components will fall back to FULL_MASK. ` +
        `See docs/proposals/unified-composition-model.md.`,
    )
  }
  // v2b §5 — assert the def was compiled by a compatible compiler. Defs
  // without `__compilerVersion` warn once per name and fall through to
  // genericUpdate via the existing fields-absent logic; defs from a
  // too-old compiler throw in dev and warn in prod.
  assertCompilerCompatibility(def.name, (def as { __compilerVersion?: string }).__compilerVersion)
  const [initialState, initialEffects] = def.init(data as D)

  const controller = new AbortController()

  const inst: ComponentInstance<S, M, E> = {
    // `def` carries an arbitrary `D` for typed init data, but after init
    // has run the runtime never touches `def.init` again — update/view/
    // onEffect and HMR replacement don't depend on D. Cast to the
    // D=void instance storage shape here.
    def: def as ComponentDef<S, M, E>,
    state: initialState,
    initialEffects,
    // Caller-supplied DOM env. `mountApp` defaults this to `browserEnv()`;
    // `renderToString` passes the user's jsdom/linkedom env. Never null —
    // every primitive reads from inst.dom.
    dom: dom ?? fallbackBrowserEnv(),
    // When `parentLifetime` is provided the instance's rootLifetime becomes a
    // child of that scope. This is how persistent layouts wire pages
    // into the layout's scope tree: the page's rootLifetime is parented at
    // the layout's pageSlot() point so `useContext` lookups flow layout
    // → page, and scope disposal cascades correctly. Mount paths that
    // don't pass parentLifetime get the classic detached root.
    rootLifetime: createLifetime(parentLifetime),
    allBindings: [],
    structuralBlocks: [],
    queue: [],
    microtaskScheduled: false,
    lastDirtyMask: 0,
    lastEffects: [],
    signal: controller.signal,
    abortController: controller,

    send(msg: M) {
      inst.queue.push(msg)
      if (!inst.microtaskScheduled) {
        inst.microtaskScheduled = true
        queueMicrotask(() => {
          inst.microtaskScheduled = false
          processMessages(inst)
        })
      }
    },
  }

  inst.rootLifetime._kind = 'root'

  return inst
}

export function flushInstance<S, M, E>(inst: ComponentInstance<S, M, E>): void {
  if (inst.queue.length === 0) return
  inst.microtaskScheduled = false
  processMessages(inst)
}

/**
 * Dev-only: overwrite instance state and re-run both phases with FULL_MASK
 * so every binding re-evaluates. Bypasses update() — use for devtools
 * snapshot/restore, not in app code.
 */
export function _forceState<S, M, E>(inst: ComponentInstance<S, M, E>, newState: S): void {
  inst.state = newState
  inst.lastDirtyMask = FULL_MASK

  const bindings = inst.allBindings
  const bindingsBeforePhase1 = bindings.length

  setCurrentDirtyMask(FULL_MASK)

  const snapshot = inst.structuralBlocks.slice()
  for (const block of snapshot) {
    try {
      block.reconcile(newState, FULL_MASK, FULL_MASK)
    } catch (e) {
      reportReconcileError(inst, e)
    }
  }

  let phase2Len = bindingsBeforePhase1
  if (bindings.length > bindingsBeforePhase1 || (phase2Len > 0 && bindings[0]!.dead)) {
    let w = 0
    for (let r = 0; r < bindings.length; r++) {
      if (!bindings[r]!.dead) bindings[w++] = bindings[r]!
    }
    bindings.length = w
    phase2Len = Math.min(w, bindingsBeforePhase1)
  }

  const state = inst.state
  enterAccessor('a binding accessor')
  try {
    for (let i = 0, len = phase2Len; i < len; i++) {
      const binding = bindings[i]!
      if (binding.dead) continue
      if (binding.kind === 'effect') {
        try {
          binding.accessor(state)
        } catch (e) {
          reportBindingError(inst, binding, e)
        }
        continue
      }
      let newValue: unknown
      try {
        newValue = binding.accessor(state)
      } catch (e) {
        // Accessor threw — leave the binding's `lastValue` unchanged so
        // the rendered DOM stays at its previous value rather than going
        // blank. Sibling bindings on the same commit continue to
        // evaluate. The error surfaces via the optional hook (or
        // console.warn as a fallback) so it isn't silently swallowed.
        reportBindingError(inst, binding, e)
        continue
      }
      if (Object.is(newValue, binding.lastValue)) continue
      binding.lastValue = newValue
      try {
        applyBinding(binding, newValue)
      } catch (e) {
        // applyBinding writes the value to the DOM (textContent,
        // setAttribute, etc.). Throws here are usually environmental
        // (a node was removed mid-flight by a sibling binding). Same
        // contract: report and continue.
        reportBindingError(inst, binding, e)
      }
    }
  } finally {
    exitAccessor()
  }
}

function reportBindingError<S, M, E>(
  inst: ComponentInstance<S, M, E>,
  binding: Binding,
  e: unknown,
): void {
  const err = e instanceof Error ? e : new Error(String(e))
  const stack = err.stack ? err.stack.split('\n').slice(0, 8).join('\n') : undefined
  const info =
    stack !== undefined
      ? {
          kind: String(binding.kind),
          key: binding.key,
          message: `${err.name}: ${err.message}`,
          stack,
        }
      : { kind: String(binding.kind), key: binding.key, message: `${err.name}: ${err.message}` }
  if (inst._onBindingError !== undefined) {
    try {
      inst._onBindingError(info)
    } catch {
      // The hook itself threw — nothing to do; we're in a recovery
      // path already. Fall through to the console fallback.
    }
  } else if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(
      `[llui] binding accessor threw (kind=${info.kind}${info.key ? `, key=${info.key}` : ''}): ${info.message}`,
    )
  }
}

/**
 * Phase 1 (structural reconcile) parallel of `reportBindingError`. A
 * `block.reconcile` throw — most often a misuse like `sample()` inside an
 * `each().key` accessor — would otherwise escape the update loop, kill the
 * remaining structural blocks AND the entire Phase 2 binding pass on this
 * commit, and (in real apps) surface as an unhandled microtask rejection
 * the developer never sees. Routing it through the same `_onBindingError`
 * channel that Phase 2 uses gives parity: the error is named, surfaced
 * once, and the rest of the update continues.
 *
 * Note: a partial DOM mutation on the failing block is NOT rolled back.
 * The block's reconcile is responsible for keeping the DOM in a consistent
 * state on its own happy path; if it throws mid-mutation, the visible
 * result may be an inconsistent block, but sibling blocks and bindings
 * still update correctly.
 */
function reportReconcileError<S, M, E>(inst: ComponentInstance<S, M, E>, e: unknown): void {
  const err = e instanceof Error ? e : new Error(String(e))
  const stack = err.stack ? err.stack.split('\n').slice(0, 8).join('\n') : undefined
  const info =
    stack !== undefined
      ? { kind: 'reconcile', message: `${err.name}: ${err.message}`, stack }
      : { kind: 'reconcile', message: `${err.name}: ${err.message}` }
  if (inst._onBindingError !== undefined) {
    try {
      inst._onBindingError(info)
    } catch {
      // hook itself threw; fall through to console
    }
  } else if (typeof console !== 'undefined' && typeof console.error === 'function') {
    // Reconcile errors are programmer errors (almost always: sample-in-
    // accessor or a thrown structural primitive). Surface as `error` not
    // `warn` so they're not lost in noisy dev consoles.
    console.error(`[llui] structural reconcile threw: ${info.message}`)
  }
}

function processMessages<S, M, E>(inst: ComponentInstance<S, M, E>): void {
  const queue = inst.queue

  // Single-message fast path: dispatch directly to per-message-type handler
  // if available. Skips dirty computation, Phase 1/2 entirely.
  if (queue.length === 1 && inst.def.__handlers) {
    const msg = queue[0]!
    const handler = inst.def.__handlers[(msg as Record<string, unknown>).type as string] as
      | ((inst: ComponentInstance, msg: unknown) => [S, E[]])
      | undefined
    if (handler) {
      queue.length = 0
      const [newState, effects] = handler(inst as ComponentInstance, msg)
      inst.state = newState
      inst._onCommit?.(newState as unknown)
      if (import.meta.env?.DEV) {
        inst.lastDirtyMask = FULL_MASK
        inst.lastEffects = effects
      }
      for (let i = 0; i < effects.length; i++) {
        dispatchEffect(inst, effects[i]!)
      }
      return
    }
  }

  // Generic pipeline — drain queue, accumulate dirty bits (two words:
  // bits 0..30 in `combinedDirty`, bits 31..61 in `combinedDirtyHi`).
  let state = inst.state
  let combinedDirty = 0
  let combinedDirtyHi = 0
  const allEffects: E[] = []

  const defUpdate = inst.def.update
  // Path-keyed reactivity: when the compiler emits `__prefixes`, dirty
  // bits correspond to entries in the prefix table (one bit per minimal
  // reference-stable prefix read across the component's accessors). The
  // runtime computes the dirty mask by reference-comparing `prefix(prev)
  // !== prefix(next)` for each table entry — precise per-prefix and
  // supports two-word emission for up to 62 prefixes. Components compiled
  // without `__llui/vite-plugin` (or with no reactive accessors) have no
  // `__prefixes` table; they fall back to `FULL_MASK` and pay the cost
  // of re-evaluating every binding every cycle. User-authored `__dirty`
  // is no longer accepted — see types.ts for the rationale.
  const prefixes = inst.def.__prefixes as ReadonlyArray<(s: unknown) => unknown> | undefined
  for (let qi = 0; qi < queue.length; qi++) {
    const msg = queue[qi]!
    const [newState, effects] = defUpdate(state, msg)
    let dirty: number | [number, number]
    if (prefixes !== undefined) {
      dirty = computeDirtyFromPrefixes(prefixes, state, newState)
    } else {
      dirty = FULL_MASK
    }
    if (typeof dirty === 'number') {
      combinedDirty |= dirty
    } else {
      combinedDirty |= dirty[0]
      combinedDirtyHi |= dirty[1]
    }
    state = newState
    // Avoid spread — allocates an iterator per call. For typical effect
    // arrays (0-2 elements) this is a minor saving; for bursts it matters.
    for (let ei = 0; ei < effects.length; ei++) allEffects.push(effects[ei]!)
  }
  queue.length = 0

  inst.state = state
  inst._onCommit?.(state as unknown)
  // Dev-only bookkeeping — tests read lastDirtyMask/lastEffects, prod
  // doesn't. Gating here keeps two writes out of the prod hot path.
  if (import.meta.env?.DEV) {
    inst.lastDirtyMask = combinedDirty
    inst.lastEffects = allEffects
  }

  // Snapshot binding count before Phase 1 — bindings added during
  // Phase 1 already have correct initial values and skip Phase 2.
  const bindings = inst.allBindings
  const bindingsBeforePhase1 = bindings.length

  // Set current dirty mask BEFORE Phase 1 so memo() accessors used in
  // structural primitives (e.g. each.items) can use the bitmask fast path.
  setCurrentDirtyMask(combinedDirty, combinedDirtyHi)

  if (inst.def.__update) {
    // Compiler-generated fast path — replaces generic Phase 1 + Phase 2.
    // `combinedDirtyHi` is passed as the trailing positional arg so
    // stale 5-param compiled bundles continue to gate correctly: they
    // ignore the extra arg, and for ≤31-prefix components `dirtyHi`
    // is always 0 anyway. Fresh compiled bundles use the 6th param
    // for precise two-word Phase 1 gating on 32..61-prefix components.
    inst.def.__update(
      state,
      combinedDirty,
      bindings,
      inst.structuralBlocks,
      bindingsBeforePhase1,
      combinedDirtyHi,
    )
  } else {
    // Generic Phase 1 + Phase 2 fallback (uncompiled components)
    genericUpdate(inst, state, combinedDirty, combinedDirtyHi, bindings, bindingsBeforePhase1)
  }

  // Dispatch effects after DOM updates
  for (let i = 0; i < allEffects.length; i++) {
    dispatchEffect(inst, allEffects[i]!)
  }
}

function genericUpdate<S, M, E>(
  inst: ComponentInstance<S, M, E>,
  state: S,
  combinedDirty: number,
  combinedDirtyHi: number,
  bindings: Binding[],
  bindingsBeforePhase1: number,
): void {
  // Phase 1 — structural reconciliation. Structural primitives register
  // their blocks BEFORE running builders, so parents precede their nested
  // children in this array. That ordering matters: a parent's reconcile
  // may dispose the old arm, whose disposers splice nested child blocks
  // out of this shared array. Because children are always to the right
  // of their parent, the splice shifts entries left — which is safe for
  // a forward iterator that re-reads length each step.
  const blocks = inst.structuralBlocks
  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi]
    if (!block) continue
    // Two-word gate: skip when neither low nor high masks intersect.
    // `block.maskHi` is 0 for ≤31-prefix blocks, so `0 & dirtyHi === 0`
    // collapses the gate to the single-word check at runtime.
    if (!((block.mask & combinedDirty) | (block.maskHi & combinedDirtyHi))) continue
    try {
      block.reconcile(state, combinedDirty, combinedDirtyHi)
    } catch (e) {
      reportReconcileError(inst, e)
    }
  }

  // Phase 2 — compact + update bindings
  _runPhase2(
    state,
    combinedDirty,
    combinedDirtyHi,
    bindings,
    bindingsBeforePhase1,
    inst.def.name,
    inst._onBindingError,
  )
}

/**
 * Run a handler for a single message: call update(), reconcile blocks
 * with the given method, run Phase 2. Used by compiler-generated __handlers
 * to avoid duplicating boilerplate per message type.
 *
 * @param method 0=reconcile, 1=reconcileItems, 2=reconcileClear, 3=reconcileRemove, -1=skip blocks
 * @public — used by compiler-generated `__handlers`
 *
 * Backward-compat: pre-multi-word compiled bundles call this with 4
 * args (no `dirtyHi`). The default `dirtyHi = 0` keeps those calls
 * correct for ≤31-prefix components — the high gate always evaluates
 * to 0 so the runtime falls back to the single-word check. Components
 * with >31 prefixes need a fresh compile to start passing `dirtyHi`.
 */
export function _handleMsg(
  inst: ComponentInstance,
  msg: unknown,
  dirty: number,
  method: number,
  dirtyHi: number = 0,
): [unknown, unknown[]] {
  const [s, e] = (inst.def.update as (s: unknown, m: unknown) => [unknown, unknown[]])(
    inst.state,
    msg,
  )
  inst.state = s
  inst._onCommit?.(s)

  // memo()-wrapped accessors (auto-generated by the compiler for
  // multi-field structural accessors like each.items / branch.on /
  // show.when) gate on `currentDirtyMask`. The generic pipeline sets
  // it before Phase 1; the single-message fast path must as well, or
  // memo short-circuits with the stale value left over from the
  // previous cycle and structural blocks reconcile against a frozen
  // input.
  setCurrentDirtyMask(dirty, dirtyHi)

  if (method >= 0) {
    const bl = inst.structuralBlocks
    for (let i = 0; i < bl.length; i++) {
      const block = bl[i]
      if (!block) continue
      if (!((block.mask & dirty) | (block.maskHi & dirtyHi))) continue
      try {
        // Specialized methods (`reconcileItems`, `reconcileClear`,
        // `reconcileRemove`, `reconcileChanged`) only exist on `each`
        // blocks. Non-each blocks (`show`, `branch`, `scope`) leave
        // them undefined. The compiler-side fix in `detectArrayOp`
        // already restricts these methods to single-field cases, but
        // a show()/branch() block whose mask intersects the cleared
        // field would still be silently skipped without this fallback.
        // When the specialized method is missing, run the general
        // `reconcile` path so the block's `when`/`on` accessor still
        // re-evaluates. each blocks always have the specialized
        // methods, so they keep their fast path.
        switch (method) {
          case 0:
            block.reconcile(s, dirty, dirtyHi)
            break
          case 1:
            if (block.reconcileItems) block.reconcileItems(s)
            else block.reconcile(s, dirty, dirtyHi)
            break
          case 2:
            if (block.reconcileClear) block.reconcileClear()
            else block.reconcile(s, dirty, dirtyHi)
            break
          case 3:
            if (block.reconcileRemove) block.reconcileRemove(s)
            else block.reconcile(s, dirty, dirtyHi)
            break
          default:
            // method >= 10: reconcileChanged with stride = method - 10
            if (method >= 10) {
              if (block.reconcileChanged) block.reconcileChanged(s, method - 10)
              else block.reconcile(s, dirty, dirtyHi)
            }
            break
        }
      } catch (err) {
        reportReconcileError(inst, err)
        // continue to next block — see reportReconcileError docstring
      }
    }
  }

  const b = inst.allBindings
  _runPhase2(s, dirty, dirtyHi, b, b.length, inst.def.name, inst._onBindingError)
  return [s, e]
}

/**
 * Phase 2: compact dead bindings + update live bindings.
 * Shared between genericUpdate and compiler-generated __update.
 * @public — used by compiler-generated `__update` functions
 *
 * `dirtyHi` defaults to 0 for backward-compat with pre-multi-word
 * compiled bundles that pass only the single-word `dirty`. Bindings
 * read paths 0..30 in `binding.mask` and paths 31..61 in
 * `binding.maskHi`; the gate ORs both AND results so the high word is
 * a no-op for ≤31-prefix components.
 */
export function _runPhase2(
  state: unknown,
  dirty: number,
  dirtyHi: number,
  bindings: Binding[],
  bindingsBeforePhase1: number,
  componentName?: string,
  // Optional `_onBindingError` hook. Type is duplicated here rather
  // than referenced as `ComponentInstance['_onBindingError']` because
  // the underlying field is `@internal` — stripped from the generated
  // `.d.ts` — and a public-export signature can't depend on a stripped
  // type without breaking dependent packages' typecheck.
  onBindingError?: (info: { kind: string; key?: string; message: string; stack?: string }) => void,
): void {
  let phase2Len = bindingsBeforePhase1
  if (bindings.length > bindingsBeforePhase1 || (phase2Len > 0 && bindings[0]!.dead)) {
    let w = 0
    for (let r = 0; r < bindings.length; r++) {
      if (!bindings[r]!.dead) bindings[w++] = bindings[r]!
    }
    bindings.length = w
    phase2Len = Math.min(w, bindingsBeforePhase1)
  }

  if (dirty !== 0 || dirtyHi !== 0) {
    // Always catch+continue: a single accessor throw shouldn't abort
    // the rest of the bindings on the same commit. The user-visible
    // effect: a broken cell shows its previous value; sibling cells
    // stay current. In dev mode, the wrapped error (with component
    // name, kind, node descriptor, accessor source) is forwarded via
    // the `_onBindingError` hook (agent integration) or to
    // `console.error` (dev harness without an agent). The prior
    // behavior of rethrowing from `flush()` made one bad binding
    // visually break the entire view — the worst-case UX.
    const isDev = import.meta.env?.DEV && componentName
    // Single accessor label for the entire Phase 2 loop. The binding kind is
    // already part of the error message that handleBindingThrow surfaces; the
    // accessor label here serves the more specific purpose of catching
    // sample() calls reaching for a render context that isn't set during
    // the update phase. A `binding accessor` label is generic enough to apply
    // to text/attr/class/effect bindings without per-kind branching.
    enterAccessor('a binding accessor')
    try {
      for (let i = 0, len = phase2Len; i < len; i++) {
        const binding = bindings[i]!
        if (binding.dead) continue
        // Two-word gate. `maskHi` is 0 for ≤31-prefix bindings; the
        // `0 & dirtyHi === 0` branch collapses to a no-op under V8's
        // inline cache.
        if (!((binding.mask & dirty) | (binding.maskHi & dirtyHi))) continue
        if (binding.kind === 'effect') {
          try {
            binding.accessor(state)
          } catch (e) {
            handleBindingThrow(onBindingError, binding, e, isDev ? componentName : null)
          }
          continue
        }
        let newValue: unknown
        try {
          newValue = binding.accessor(state)
        } catch (e) {
          handleBindingThrow(onBindingError, binding, e, isDev ? componentName : null)
          continue
        }
        const last = binding.lastValue
        if (newValue === last || (newValue !== newValue && last !== last)) continue
        binding.lastValue = newValue
        try {
          applyBinding(binding, newValue)
        } catch (e) {
          handleBindingThrow(onBindingError, binding, e, isDev ? componentName : null)
        }
      }
    } finally {
      exitAccessor()
    }
  }
}

function handleBindingThrow(
  onBindingError: ComponentInstance['_onBindingError'] | undefined,
  binding: Binding,
  e: unknown,
  componentName: string | null,
): void {
  // Dev mode: build the rich wrapped error (with accessor source,
  // node descriptor, undefined-hint detection). Prod skips the
  // bookkeeping. Either way the report flows through `_onBindingError`
  // when wired (agent setups), else falls back to console.error so
  // operators see the cause.
  const wrapped =
    componentName !== null && e instanceof Error
      ? enhanceBindingError(e, binding, componentName)
      : null
  const err = wrapped ?? (e instanceof Error ? e : new Error(String(e)))
  const stack = err.stack ? err.stack.split('\n').slice(0, 8).join('\n') : undefined
  const info =
    stack !== undefined
      ? { kind: String(binding.kind), key: binding.key, message: err.message, stack }
      : { kind: String(binding.kind), key: binding.key, message: err.message }

  if (onBindingError !== undefined) {
    try {
      onBindingError(info)
    } catch {
      // hook itself threw; fall through to console
    }
  } else if (typeof console !== 'undefined') {
    // Dev mode shows the wrapped (richer) message. Prod shows a brief
    // line — operators still see something but without the full source
    // hint that's only useful at development time.
    if (componentName !== null) {
      console.error(err)
    } else if (typeof console.warn === 'function') {
      console.warn(
        `[llui] binding accessor threw (kind=${info.kind}${info.key ? `, key=${info.key}` : ''}): ${info.message}`,
      )
    }
  }
}

function enhanceBindingError(err: unknown, binding: Binding, componentName: string): Error {
  // For text bindings, binding.node is the Text node — use its parent element.
  const node = binding.node
  const target = node.nodeType === 1 ? (node as Element) : (node.parentElement ?? null)
  let nodeDesc = '?'
  if (target) {
    const id = target.id ? `#${target.id}` : ''
    const cls =
      target.className && typeof target.className === 'string'
        ? `.${target.className.split(' ').filter(Boolean).slice(0, 2).join('.')}`
        : ''
    nodeDesc = `<${target.tagName.toLowerCase()}${id}${cls}>`
    if (node.nodeType === 3) nodeDesc += ' text-child'
    else if (node.nodeType === 8) nodeDesc += ' comment-child'
  }
  const keyPart = binding.key ? ` .${binding.key}` : ''
  const errMsg = err instanceof Error ? err.message : String(err)

  // Build accessor source hint if available
  let accessorHint = ''
  try {
    const src = binding.accessor.toString().slice(0, 80)
    accessorHint = `\n  accessor: ${src}${binding.accessor.toString().length > 80 ? '...' : ''}`
  } catch {
    // toString() may throw on revoked proxies, etc.
  }

  // Detect common undefined/null access pattern and add a helpful hint
  let undefinedHint = ''
  if (err instanceof TypeError && /Cannot read propert(ies|y).*of (undefined|null)/.test(errMsg)) {
    undefinedHint =
      '\n  hint: Check that your accessor handles undefined state fields (e.g., use optional chaining: s.user?.name)'
  }

  const wrapped = new Error(
    `[LLui] ${binding.kind}${keyPart} binding on ${nodeDesc} — accessor threw in <${componentName}>\n` +
      `  ↳ ${errMsg}` +
      undefinedHint +
      accessorHint,
    err instanceof Error ? { cause: err } : undefined,
  )
  wrapped.stack = (err instanceof Error && err.stack) || wrapped.stack
  return wrapped
}

function dispatchEffect<S, M, E>(inst: ComponentInstance<S, M, E>, effect: E): void {
  const eff = effect as Record<string, unknown>

  // Built-in: delay
  if (eff.type === 'delay') {
    const ms = eff.ms as number
    const onDone = eff.onDone as M
    setTimeout(() => inst.send(onDone), ms)
    return
  }

  // Built-in: log
  if (eff.type === 'log') {
    console.log(eff.message)
    return
  }

  // Dev-only: record on the timeline / consult the mock registry.
  // Short-circuits real dispatch when a mock matches. Zero cost in
  // production — the guard on `_effectTimeline` is undefined unless
  // `installDevTools` populated the trackers.
  if (inst._effectTimeline !== undefined && dispatchEffectDev(inst, effect)) return

  // User onEffect handler
  if (inst.def.onEffect) {
    inst.def.onEffect({ effect, send: inst.send, signal: inst.signal })
  }
}

/**
 * Dev-only effect dispatch wrapper. Records the `dispatched` phase and,
 * when a mock matches, auto-delivers the mocked response through the
 * effect's own `onSuccess` callback on a microtask (same timing contract
 * as a real async resolve). Non-matched effects are tracked as pending
 * so `llui_pending_effects` / `llui_resolve_effect` can observe them.
 *
 * @returns `true` when a mock matched (caller should skip the real
 *   dispatch) or `false` to proceed with the user-provided onEffect.
 */
function dispatchEffectDev<S, M, E>(inst: ComponentInstance<S, M, E>, effect: E): boolean {
  const timeline = inst._effectTimeline
  if (timeline === undefined) return false

  const eff = effect as Record<string, unknown>
  const id = newEffectId()
  const type = typeof eff.type === 'string' ? eff.type : '<unknown>'
  const dispatchedAt = Date.now()

  const mock = inst._effectMocks?.match(effect)
  if (mock) {
    timeline.push({ effectId: id, type, phase: 'dispatched', timestamp: dispatchedAt })
    // Auto-deliver the mocked response via the effect's onSuccess callback (if any).
    // This mirrors what the real dispatch would do, so the component receives a Msg
    // from the mocked effect without any network/IO happening.
    const payload = effect as Record<string, unknown>
    if (typeof payload.onSuccess === 'function') {
      const msg = (payload.onSuccess as (d: unknown) => unknown)(mock.response)
      // Schedule delivery as a microtask so it runs after the current update
      // cycle completes (same timing contract as a real async effect resolve).
      Promise.resolve().then(() => inst.send(msg as never))
    }
    timeline.push({
      effectId: id,
      type,
      phase: 'resolved-mocked',
      timestamp: dispatchedAt,
      durationMs: 0,
    })
    return true
  }

  timeline.push({ effectId: id, type, phase: 'dispatched', timestamp: dispatchedAt })
  inst._pendingEffects?.push({ id, type, dispatchedAt, status: 'queued', payload: effect })
  return false
}

function newEffectId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID()
  return `eff-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
