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
 *   - `'binding'`     — a tagged event handler is currently mounted.
 *   - `'always-affordable'` — the app's `agentAffordances(state)` hook
 *     listed it as available right now.
 *   - `'schema'`      — neither of the above; the variant is in the
 *     Msg union, annotated `@agentOnly`, and the payload is example-
 *     only (no live UI binding maps to it). Bulk-edit operations
 *     typically land here.
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
  const affordances = host.getAgentAffordances()?.(state) ?? []
  const schema = host.getMsgSchema()

  const out: ListActionsResult['actions'] = []
  const seen = new Set<string>()

  // From bindings — these have UI affordances by definition, so they're
  // either 'shared' (default) or, in the malformed case where someone
  // bound an `@agentOnly` Msg in a view, 'agent-only'. Either way the
  // agent can dispatch them.
  for (const d of descriptors) {
    const ann = annotations[d.variant]
    if (ann?.dispatchMode === 'human-only') continue
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

  // From always-affordable
  for (const msg of affordances) {
    const ann = annotations[msg.type]
    if (ann?.dispatchMode === 'human-only') continue
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

  // From schema — variants that aren't already surfaced as bindings
  // or always-affordable, and that the author intentionally documented
  // for agent use. Two cases land here:
  //
  //   1. `@agentOnly` variants — the canonical "no UI button maps to
  //      this; the agent is the only dispatcher." Bulk edits, imports,
  //      admin operations.
  //   2. `'shared'` variants with `@intent` but no live binding — the
  //      author wrote a description for the variant, signalling it's
  //      a real agent-callable dispatch even when the corresponding UI
  //      affordance is closed (e.g. `Matrix/SetQuantityValue` lives
  //      inside the cell editor; without this case, an agent that
  //      wants to set one cell is forced to use the bulk
  //      `Matrix/SetManyCells` with a 1-element array).
  //
  // `'shared'` variants WITHOUT `@intent` stay hidden — undocumented
  // shared variants are usually internal (effect-result messages,
  // router-internal acks) that aren't intended as agent affordances.
  // `'human-only'` is always filtered.
  if (schema) {
    for (const [variant, fields] of Object.entries(schema.variants)) {
      if (seen.has(variant)) continue
      const ann = annotations[variant]
      if (ann?.dispatchMode === 'human-only') continue
      const isAgentOnly = ann?.dispatchMode === 'agent-only'
      const isDocumentedShared = ann?.dispatchMode !== 'agent-only' && Boolean(ann?.intent)
      if (!isAgentOnly && !isDocumentedShared) continue
      out.push({
        variant,
        intent: ann?.intent ?? null,
        requiresConfirm: ann?.requiresConfirm ?? false,
        dispatchMode: isAgentOnly ? 'agent-only' : 'shared',
        source: 'schema',
        selectorHint: null,
        payloadHint: synthesizePayload(variant, fields),
        warning: ann?.warning ?? null,
        examples: ann?.examples ?? [],
        emits: ann?.emits ?? [],
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
    // First option doubles as the canonical example.
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
  return null
}
