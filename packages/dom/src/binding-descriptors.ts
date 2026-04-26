import type { ComponentInstance } from './update-loop.js'
import type { Lifetime } from './types.js'
import { addDisposer } from './lifetime.js'
import { getRenderContext } from './render-context.js'

/**
 * A single agent-dispatchable variant tied to currently-rendered UI.
 *
 * The agent layer's `list_actions` reads `getBindingDescriptors()` to
 * surface which Msg variants the LLM can usefully send right now —
 * not just which the app *could* accept in principle, but which have
 * a live UI binding the human user could also click. Each entry maps
 * to one variant string the compiler discovered as a literal `send({
 * type: '<variant>' })` call inside an event-handler arrow.
 */
export interface BindingDescriptor {
  variant: string
}

/**
 * Per-instance live registry. Keyed by variant; the value is a
 * refcount because multiple bindings can dispatch the same variant
 * (e.g. one button per item in an `each`), and the variant must
 * remain "live" as long as ANY of those bindings is mounted.
 *
 * The compiler tags every event-handler arrow function containing a
 * literal `send({type: 'X'})` call with a `__lluiVariants` array of
 * the discovered variants. The runtime (in `elements.ts`) reads that
 * tag at bind time and calls `registerBindingVariants(inst, lifetime,
 * variants)`. Each registration increments the variant's refcount;
 * an `onDispose` hook on the lifetime decrements when the binding's
 * scope is torn down. `getBindingDescriptors(inst)` then returns the
 * variants whose refcount is currently > 0.
 *
 * Refcount semantics (rather than a Set) matter for `each` loops.
 * 100 rows that all bind `'Item/Remove'` produce 100 increments; the
 * variant stays live until every row is unmounted, which mirrors what
 * the LLM should observe — the action remains affordable as long as
 * any row offers it.
 */
export interface BindingDescriptorRegistry {
  /**
   * Variant → live refcount. Entries are deleted when the count
   * reaches zero so iteration stays cheap regardless of churn over
   * the lifetime of the app.
   */
  counts: Map<string, number>
}

export function createBindingDescriptorRegistry(): BindingDescriptorRegistry {
  return { counts: new Map() }
}

/**
 * Increment the live refcount for each variant in `variants`, and
 * register a lifetime disposer that decrements them on unmount.
 *
 * The registry is lazily attached to the instance the first time a
 * binding registers. Apps that don't bind any tagged event handlers
 * never allocate the registry — `getBindingDescriptors` returns an
 * empty array in that case.
 */
export function registerBindingVariants(
  inst: ComponentInstance,
  lifetime: Lifetime,
  variants: readonly string[],
): void {
  if (variants.length === 0) return
  const registry = (inst._bindingDescriptors ??= createBindingDescriptorRegistry())
  for (const v of variants) {
    registry.counts.set(v, (registry.counts.get(v) ?? 0) + 1)
  }
  addDisposer(lifetime, () => {
    for (const v of variants) {
      const next = (registry.counts.get(v) ?? 0) - 1
      if (next <= 0) registry.counts.delete(v)
      else registry.counts.set(v, next)
    }
  })
}

/**
 * Read the current set of live binding descriptors from the
 * instance. Order is iteration order over the registry map (insertion
 * order with deletions); callers that need a deterministic ordering
 * should sort by `variant` themselves.
 */
export function getBindingDescriptors(inst: ComponentInstance): BindingDescriptor[] {
  const reg = inst._bindingDescriptors
  if (!reg) return []
  const out: BindingDescriptor[] = []
  for (const variant of reg.counts.keys()) out.push({ variant })
  return out
}

/**
 * Library helper for `*.connect` implementations: tags an event
 * handler with the variants it dispatches at runtime, so the binding
 * registers them when the user spreads the bag onto an element.
 *
 * Resolution rules — choose whichever is defined and non-empty:
 *
 * 1. **`send.__lluiVariants`** (translator pattern). When the user
 *    passed a compiler-tagged dispatch translator like
 *    `(m) => dispatch({type: 'Auth/UserMenu'})`, `send` itself
 *    carries the user-side variants the translator forwards. We
 *    surface those — the agent should see what `update()` actually
 *    receives, not the library's internal Msg shape.
 *
 * 2. **`libraryVariants`** fallback. When `send` is the user's raw
 *    component send (no translator), the library's internal Msgs flow
 *    directly into `update()`, so the library's own variants ARE the
 *    user variants. Library author hand-lists them once per handler.
 *
 * Returns `fn` mutated (via `Object.assign`) so the same reference
 * remains identity-equal — important for downstream code that diffs
 * handlers across re-bindings.
 *
 * @example
 * ```ts
 * import { tagSend } from '@llui/dom'
 *
 * export function connect<S>(get, send, opts) {
 *   return {
 *     trigger: {
 *       onClick: tagSend(send, ['Open'], () => send({ type: 'open' })),
 *     },
 *   }
 * }
 * ```
 */
export function tagSend<F extends (...args: never[]) => unknown>(
  send: unknown,
  libraryVariants: readonly string[],
  fn: F,
): F {
  const sendVariants = (send as { __lluiVariants?: readonly string[] } | null | undefined)
    ?.__lluiVariants
  const variants = sendVariants && sendVariants.length > 0 ? sendVariants : libraryVariants
  if (variants.length > 0) {
    Object.assign(fn, { __lluiVariants: variants })
  }
  return fn
}

/**
 * Compiler-emitted runtime helper. The vite-plugin's `*.connect(get,
 * sendFn, ...)` pattern matcher emits a call to this function
 * immediately before each connect call, with the variants statically
 * discovered in `sendFn`'s body — covering the dispatch-translation
 * layers that the event-handler tagger can't follow (a library
 * onClick calls the user's `sendFn`, which in turn calls
 * `dispatch(translatedMsg)`; static analysis of the library's onClick
 * can't see across that hop).
 *
 * Reads the active render context's `instance` and `rootLifetime` —
 * which is the right scope automatically: when invoked from the
 * top-level view body, registers on the component's root scope; when
 * invoked from inside an `each(...)` render callback, the active
 * `rootLifetime` is the per-item scope, so the registration ties to
 * that item's lifetime and unregisters on item removal.
 *
 * **No-op when called outside a render context.** The compiler tries
 * to skip emission at module top-level, but tooling never has full
 * scope visibility (re-exports, transformations, generated code), so
 * the helper itself defensively short-circuits rather than throwing.
 * The translator's variants simply don't surface — the app still
 * functions; agents can fall back to declared `agentAffordances` or
 * the message schema.
 */
export function __registerScopeVariants(variants: readonly string[]): void {
  if (variants.length === 0) return
  // Probe the render context without throwing — the helper is allowed
  // outside a view (no-op rather than fatal). `getRenderContext`
  // throws when there's no context, so we pre-check with the module-
  // private accessor pattern: import the same module and read the
  // current context manually.
  const ctx = getCurrentRenderContext()
  if (!ctx || !ctx.instance) return
  registerBindingVariants(ctx.instance, ctx.rootLifetime, variants)
}

/**
 * Internal helper: read the current render context without throwing.
 * Returns null when no context is active (module top-level, async
 * callbacks, etc.) so callers can degrade gracefully instead of
 * crashing.
 */
function getCurrentRenderContext(): import('./render-context.js').RenderContext | null {
  try {
    return getRenderContext('__registerScopeVariants')
  } catch {
    return null
  }
}
