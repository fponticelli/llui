import type { MessageAnnotations } from '../../protocol.js'
import type { MsgSchemaShape, MsgSchemaField } from '../factory.js'

type Binding = { variant: string }
type Annotations = Record<string, MessageAnnotations>

export type ListActionsHost = {
  getState(): unknown
  getBindingDescriptors(): Binding[] | null
  getMsgAnnotations(): Annotations | null
  getMsgSchema(): MsgSchemaShape | null
  getAgentAffordances(): ((state: unknown) => Array<{ type: string; [k: string]: unknown }>) | null
}

/**
 * `dispatchMode` on each action is `'shared'` (human can also click via
 * a UI affordance) or `'agent-only'` (no UI binding — agent is the only
 * dispatcher). `'human-only'` variants are filtered out before this
 * point — they never reach the LLM.
 *
 * `source` distinguishes WHERE the affordance came from:
 *   - `'binding'` — a tagged event handler is currently mounted in a
 *     live scope (refcount > 0). Variants inside dead branches —
 *     `show({when: false})`, unmounted `branch()` cases, removed `each`
 *     items — auto-vanish from this set as their lifetimes dispose.
 *     This is the framework's "what can the user click right now"
 *     answer, and it's the default surface for the agent.
 *   - `'always-affordable'` — either the app's `agentAffordances(state)`
 *     hook listed the variant, or the variant carries the
 *     `@alwaysAffordable` JSDoc tag. Both are the explicit "agent can
 *     reach this even when no live UI binding maps to it" knob — bulk
 *     seed ops (`Matrix/AddAlternatives`) and similar agent-driven
 *     paths typically land here.
 *   - `'schema'` — variant is annotated `@agentOnly` (the canonical
 *     "no UI button maps to this; the agent is the only dispatcher")
 *     and isn't already covered above. The payload is schema-synthesized
 *     and the agent fills it in.
 *
 * `'shared'` variants WITHOUT a live binding, without
 * `agentAffordances` mention, and without `@alwaysAffordable` are
 * **deliberately hidden**. They're reachable through UI navigation —
 * the human user can't click them right now, and dispatching them
 * blindly would mutate state that drives `show()`/`branch()` gates,
 * popping hidden UI subtrees into view in places the user didn't
 * navigate to.
 */
export type ListActionsResult = {
  actions: Array<{
    variant: string
    /**
     * Human-readable phrase from `@intent("…")`, or `null` when the
     * variant is unannotated. Mirror of LapActionsResponse.intent —
     * callers should treat `null` as a documentation gap and not as
     * "missing label, fall back to variant name".
     */
    intent: string | null
    requiresConfirm: boolean
    dispatchMode: 'shared' | 'agent-only'
    source: 'binding' | 'always-affordable' | 'schema'
    selectorHint: string | null
    payloadHint: object | null
    /** Cautionary text from `@warning` JSDoc, or null. */
    warning: string | null
    /** Concrete examples from `@example` JSDoc, in source order. */
    examples: string[]
    /**
     * Effect kinds this variant emits, from `@emits("k1", "k2")`.
     * Empty when not annotated. Lets the agent know what side
     * effects fire — useful for batching ("100 dispatches × cloud-
     * save = bad") and for confirming destructive flows.
     */
    emits: string[]
    /**
     * Per-field guidance lifted from `@should("…")` JSDoc on payload
     * fields. Path is dot/bracket notation rooted at the payload
     * (e.g. `"cells"` for a top-level field, `"cells[].meta"` for an
     * array element's nested field). Useful when the field is typed
     * as `unknown` or as a polymorphic shape — the hint says "type
     * matches the criterion's kind: number for quantity, …" so the
     * agent doesn't have to guess from the bare schema.
     *
     * Empty when no field on this variant carries an `@should` hint.
     */
    fieldHints: Array<{ path: string; hint: string }>
  }>
}

export function handleListActions(host: ListActionsHost): ListActionsResult {
  const annotations = host.getMsgAnnotations() ?? {}
  const state = host.getState()
  const descriptors = host.getBindingDescriptors() ?? []
  const affordancesFn = host.getAgentAffordances()
  const affordances = affordancesFn ? affordancesFn(state) : []
  // When the app provides `agentAffordances(state)`, it's opted into
  // explicit affordance control: only state-relevant Msgs are listed.
  // `@agentOnly` schema-source variants are then filtered to those the
  // hook returned — so a bulk-edit Msg like `Matrix/AddCriteria`
  // doesn't surface on the home page just because it's tagged
  // `@agentOnly`. Apps without `agentAffordances` keep the previous
  // permissive default ("everything's available unless you say
  // otherwise") since flipping that without explicit opt-in would
  // break consumers who rely on schema-source surfacing of
  // bulk Msgs.
  const explicitAffordances = affordancesFn !== null
  const affordanceVariants = new Set(affordances.map((m) => m.type))
  const schema = host.getMsgSchema()

  const out: ListActionsResult['actions'] = []
  const seen = new Set<string>()

  // From bindings — these have UI affordances by definition, so they're
  // either 'shared' (default) or, in the malformed case where someone
  // bound an `@agentOnly` Msg in a view, 'agent-only'. Either way the
  // agent can dispatch them.
  //
  // Filtered against the Msg schema: a binding whose variant isn't in
  // the user's Msg union is a library-internal Msg leaking through
  // `tagSend` translator wiring (the sortable component's `move`,
  // `drop`, `cancel`, etc. — they're routed into the user's update.ts
  // via a different shape but their lib names slip into the binding
  // registry). The agent has no use for those names — `would_dispatch`
  // / `send_message` would reject them as `unknown-variant` anyway —
  // so they pollute the affordance list. When a schema is available,
  // the schema's variant set is the source of truth.
  for (const d of descriptors) {
    if (schema && !(d.variant in schema.variants)) continue
    const ann = annotations[d.variant]
    if (ann?.dispatchMode === 'human-only') continue
    if (!passesRouteGate(ann, state)) continue
    seen.add(d.variant)
    const variantSchema = schema?.variants[d.variant]
    out.push({
      variant: d.variant,
      intent: ann?.intent ?? null,
      requiresConfirm: ann?.requiresConfirm ?? false,
      dispatchMode: ann?.dispatchMode === 'agent-only' ? 'agent-only' : 'shared',
      source: 'binding',
      selectorHint: null,
      payloadHint: null,
      warning: ann?.warning ?? null,
      examples: ann?.examples ?? [],
      emits: ann?.emits ?? [],
      fieldHints: variantSchema ? collectFieldHints(variantSchema) : [],
    })
  }

  // From `agentAffordances(state)` — the integrator's explicit list of
  // currently-reachable Msgs, with concrete payloads they author.
  for (const msg of affordances) {
    const ann = annotations[msg.type]
    if (ann?.dispatchMode === 'human-only') continue
    if (!passesRouteGate(ann, state)) continue
    seen.add(msg.type)
    const { type, ...rest } = msg
    const variantSchema = schema?.variants[type]
    out.push({
      variant: type,
      intent: ann?.intent ?? null,
      requiresConfirm: ann?.requiresConfirm ?? false,
      dispatchMode: ann?.dispatchMode === 'agent-only' ? 'agent-only' : 'shared',
      source: 'always-affordable',
      selectorHint: null,
      payloadHint: Object.keys(rest).length > 0 ? rest : null,
      warning: ann?.warning ?? null,
      examples: ann?.examples ?? [],
      emits: ann?.emits ?? [],
      fieldHints: variantSchema ? collectFieldHints(variantSchema) : [],
    })
  }

  // From `@alwaysAffordable` annotations — the per-variant equivalent
  // of `agentAffordances`. Variants tagged this way surface regardless
  // of whether a live binding maps to them, so bulk seed ops
  // (`Matrix/AddAlternatives`) and similar agent-driven paths are
  // available even when their UI counterparts (if any) aren't mounted.
  // The payload is schema-synthesized — `agentAffordances` is the way
  // to ship a concrete pre-filled payload alongside the affordance.
  for (const [variant, ann] of Object.entries(annotations)) {
    if (seen.has(variant)) continue
    if (ann.dispatchMode === 'human-only') continue
    if (!ann.alwaysAffordable) continue
    if (!passesRouteGate(ann, state)) continue
    seen.add(variant)
    const fields = schema?.variants[variant]
    out.push({
      variant,
      intent: ann.intent,
      requiresConfirm: ann.requiresConfirm,
      dispatchMode: ann.dispatchMode === 'agent-only' ? 'agent-only' : 'shared',
      source: 'always-affordable',
      selectorHint: null,
      payloadHint: fields ? synthesizePayload(variant, fields) : null,
      warning: ann.warning,
      examples: ann.examples,
      emits: ann.emits,
      fieldHints: fields ? collectFieldHints(fields) : [],
    })
  }

  // From schema — variants that aren't already surfaced above and that
  // the author marked `@agentOnly`. The canonical "no UI button maps
  // to this; the agent is the only dispatcher." Bulk edits, imports,
  // admin operations that have no human-facing affordance at all.
  //
  // `'shared'` variants WITHOUT a live binding stay hidden here — they
  // are reachable through UI navigation, and dispatching them while
  // their UI subtree is unmounted would pop hidden state in places the
  // user didn't navigate to. The explicit knobs are `@alwaysAffordable`
  // (handled above) or `agentAffordances(state)`.
  //
  // When the app provides `agentAffordances`, this pass is filtered:
  // an `@agentOnly` variant only surfaces if the hook returned it.
  // That makes route-gated bulk Msgs (`Matrix/AddCriteria` available
  // only when a matrix is loaded) work as expected — they stop
  // appearing on the home page just because they're tagged
  // `@agentOnly`. Apps without `agentAffordances` keep the previous
  // permissive default.
  if (schema) {
    for (const [variant, fields] of Object.entries(schema.variants)) {
      if (seen.has(variant)) continue
      const ann = annotations[variant]
      if (ann?.dispatchMode !== 'agent-only') continue
      if (explicitAffordances && !affordanceVariants.has(variant)) continue
      if (!passesRouteGate(ann, state)) continue
      out.push({
        variant,
        intent: ann.intent,
        requiresConfirm: ann.requiresConfirm,
        dispatchMode: 'agent-only',
        source: 'schema',
        selectorHint: null,
        payloadHint: synthesizePayload(variant, fields),
        warning: ann.warning,
        examples: ann.examples,
        emits: ann.emits,
        fieldHints: collectFieldHints(fields),
      })
    }
  }

  return { actions: out }
}

/**
 * Build an example payload object the LLM can fill in. Required
 * fields always appear; optional fields appear only when annotated
 * `@should` (LLM is encouraged to fill them in). Fields without a
 * concrete primitive type (`'unknown'`) emit `null` placeholders the
 * LLM is expected to replace.
 *
 * The first key is `type` so the payload reads as a complete Msg
 * shape — copy-paste-ready into `send_message`.
 */
/**
 * Evaluate `@routeGated("predicate")` against the current state.
 * Returns true (variant passes) when:
 *   - the variant has no `@routeGated` annotation, OR
 *   - the predicate evaluates truthy with `state` bound.
 *
 * Predicate is compiled lazily via `new Function('state', 'return (' +
 * src + ')')` and cached in a module-level Map. Compile failures
 * (syntactically broken predicates) degrade to "true" so a single
 * malformed annotation doesn't paralyze the affordance pass — the
 * build-time linter is the right place to catch syntactic issues.
 * Evaluation throws fail-closed (return false) since a predicate that
 * crashes on the current state shouldn't surface the variant.
 */
function passesRouteGate(ann: MessageAnnotations | undefined, state: unknown): boolean {
  const src = ann?.routeGate
  if (!src) return true
  const predicate = compileRouteGate(src)
  try {
    return Boolean(predicate(state))
  } catch {
    return false
  }
}

const routeGateCache = new Map<string, (state: unknown) => boolean>()
function compileRouteGate(src: string): (state: unknown) => boolean {
  let fn = routeGateCache.get(src)
  if (fn) return fn
  try {
    fn = new Function('state', `return (${src})`) as (state: unknown) => boolean
  } catch {
    fn = () => true
  }
  routeGateCache.set(src, fn)
  return fn
}

function synthesizePayload(variant: string, fields: Record<string, MsgSchemaField>): object {
  const out: Record<string, unknown> = { type: variant }
  for (const [name, descriptor] of Object.entries(fields)) {
    const optional = isOptional(descriptor)
    const priority = isShould(descriptor)
    // Skip optional fields unless they're @should-flagged. Required
    // fields always appear.
    if (optional && priority !== 'should') continue
    out[name] = exampleValue(descriptor)
  }
  return out
}

/**
 * Walk a variant's field tree and collect every `@should` hint into a
 * flat list keyed by field path. Path conventions:
 *   - top-level field: `"cells"`
 *   - nested object property: `"cells.value"`
 *   - array element: `"cells[]"` for the element itself; descendants
 *     use `"cells[].meta"` and so on.
 *
 * Surfaces the same hints that show up nested inside
 * `description.messages.variants[X].field.hint` so callers don't have
 * to dig through the schema tree to find them.
 */
function collectFieldHints(
  fields: Record<string, MsgSchemaField>,
): Array<{ path: string; hint: string }> {
  const out: Array<{ path: string; hint: string }> = []
  for (const [name, descriptor] of Object.entries(fields)) {
    walkHint(name, descriptor, out)
  }
  return out
}

function walkHint(
  path: string,
  d: MsgSchemaField,
  out: Array<{ path: string; hint: string }>,
): void {
  // Rich descriptor with a hint at this position.
  if (typeof d === 'object' && d !== null && 'type' in d) {
    if (typeof d.hint === 'string' && d.hint.length > 0) {
      out.push({ path, hint: d.hint })
    }
    // `@validates(...)` predicates surface alongside `@should` hints
    // so the agent sees the constraint at affordance time rather than
    // only as a post-dispatch rejection. The verbatim predicate text
    // is what the runtime evaluates; agents trained on JS read it
    // directly. Prefix `validates: ` to disambiguate from freeform
    // `@should` text.
    if (typeof d.validates === 'string' && d.validates.length > 0) {
      out.push({ path, hint: `validates: ${d.validates}` })
    }
    walkHintBare(path, d.type, out)
    return
  }
  walkHintBare(path, d, out)
}

function walkHintBare(path: string, t: unknown, out: Array<{ path: string; hint: string }>): void {
  if (t === null || typeof t !== 'object') return
  const obj = t as Record<string, unknown>
  if (obj.kind === 'object' && obj.shape !== null && typeof obj.shape === 'object') {
    for (const [name, descriptor] of Object.entries(obj.shape as Record<string, MsgSchemaField>)) {
      walkHint(`${path}.${name}`, descriptor, out)
    }
    return
  }
  if (obj.kind === 'array') {
    walkHint(`${path}[]`, obj.element as MsgSchemaField, out)
  }
  if (obj.kind === 'discriminated-union') {
    // Synthetic hint at the union's path summarizing the legal
    // discriminant values. Lets the agent see "format expects one of:
    // exact, range, compound" without walking the full schema. Then
    // walk each branch's per-field hints with a path-suffix that
    // disambiguates which branch the hint applies to.
    const variants = obj.variants as Record<string, Record<string, MsgSchemaField>>
    const discriminant = String(obj.discriminant)
    const legalValues = Object.keys(variants)
    if (legalValues.length > 0) {
      out.push({
        path,
        hint: `Discriminated union — set \`${discriminant}\` to one of: ${legalValues
          .map((v) => `'${v}'`)
          .join(', ')}.`,
      })
    }
    for (const [discValue, fields] of Object.entries(variants)) {
      for (const [fieldName, fieldDesc] of Object.entries(fields)) {
        walkHint(`${path}(${discriminant}=${discValue}).${fieldName}`, fieldDesc, out)
      }
    }
  }
}

function isOptional(d: MsgSchemaField): boolean {
  return typeof d === 'object' && 'type' in d && d.optional === true
}

function isShould(d: MsgSchemaField): 'should' | undefined {
  return typeof d === 'object' && 'type' in d ? d.priority : undefined
}

function exampleValue(d: MsgSchemaField): unknown {
  // Unwrap rich descriptor to get the bare type for synthesis.
  const t =
    typeof d === 'object' && 'type' in d
      ? d.type
      : (d as
          | Exclude<MsgSchemaField, object>
          | Extract<MsgSchemaField, { kind?: string; enum?: string[] }>)
  return synthesizeBare(t as never)
}

function synthesizeBare(t: unknown): unknown {
  if (typeof t === 'string') {
    if (t === 'string') return ''
    if (t === 'number') return 0
    if (t === 'boolean') return false
    return null // 'unknown' or unrecognized keyword → placeholder
  }
  if (t === null || typeof t !== 'object') return null
  const obj = t as Record<string, unknown>
  if ('enum' in obj && Array.isArray(obj.enum)) {
    // First option doubles as the canonical example. Native value type
    // round-trips (string/number/boolean) since the compiler preserved
    // the literal kind on emit.
    return obj.enum[0] ?? null
  }
  if (obj.kind === 'object' && obj.shape !== null && typeof obj.shape === 'object') {
    // Recurse into the nested shape. Same optional-skip rule as the
    // top-level synthesizer: required fields appear, optional ones
    // appear only when @should-flagged.
    const out: Record<string, unknown> = {}
    for (const [name, descriptor] of Object.entries(obj.shape as Record<string, MsgSchemaField>)) {
      const isOpt = isOptional(descriptor)
      const pri = isShould(descriptor)
      if (isOpt && pri !== 'should') continue
      out[name] = exampleValue(descriptor)
    }
    return out
  }
  if (obj.kind === 'array') {
    // Wrap the synthesized element in a one-item array. Lets the LLM
    // see the per-entry shape without us guessing at array length.
    return [synthesizeBare(obj.element)]
  }
  if (obj.kind === 'discriminated-union') {
    // Synthesize the FIRST branch as the concrete example. The full
    // shape (every legal branch + its payload) is preserved in
    // `description.messages.variants[X]` from `describe_app`, so the
    // agent that needs another branch reads the schema directly.
    // `collectFieldHints` adds a synthetic enumeration of the legal
    // `<discriminant>` values onto the hint surface so the agent
    // doesn't have to dig into the schema for the simple case.
    const variants = obj.variants as Record<string, Record<string, MsgSchemaField>>
    const discriminant = String(obj.discriminant)
    const firstEntry = Object.entries(variants).at(0)
    if (!firstEntry) return null
    const [firstValue, firstFields] = firstEntry
    const branch: Record<string, unknown> = { [discriminant]: firstValue }
    for (const [name, descriptor] of Object.entries(firstFields)) {
      const isOpt = isOptional(descriptor)
      const pri = isShould(descriptor)
      if (isOpt && pri !== 'should') continue
      branch[name] = exampleValue(descriptor)
    }
    return branch
  }
  return null
}
