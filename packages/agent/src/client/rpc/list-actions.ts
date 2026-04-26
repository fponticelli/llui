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
    intent: string
    requiresConfirm: boolean
    dispatchMode: 'shared' | 'agent-only'
    source: 'binding' | 'always-affordable' | 'schema'
    selectorHint: string | null
    payloadHint: object | null
    /** Cautionary text from `@warning` JSDoc, or null. */
    warning: string | null
    /** Concrete examples from `@example` JSDoc, in source order. */
    examples: string[]
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
    out.push({
      variant: d.variant,
      intent: ann?.intent ?? d.variant,
      requiresConfirm: ann?.requiresConfirm ?? false,
      dispatchMode: ann?.dispatchMode === 'agent-only' ? 'agent-only' : 'shared',
      source: 'binding',
      selectorHint: null,
      payloadHint: null,
      warning: ann?.warning ?? null,
      examples: ann?.examples ?? [],
    })
  }

  // From always-affordable
  for (const msg of affordances) {
    const ann = annotations[msg.type]
    if (ann?.dispatchMode === 'human-only') continue
    seen.add(msg.type)
    const { type, ...rest } = msg
    out.push({
      variant: type,
      intent: ann?.intent ?? type,
      requiresConfirm: ann?.requiresConfirm ?? false,
      dispatchMode: ann?.dispatchMode === 'agent-only' ? 'agent-only' : 'shared',
      source: 'always-affordable',
      selectorHint: null,
      payloadHint: Object.keys(rest).length > 0 ? rest : null,
      warning: ann?.warning ?? null,
      examples: ann?.examples ?? [],
    })
  }

  // From schema — only `@agentOnly` variants that aren't already
  // surfaced as bindings or always-affordable. These are the bulk-
  // edit and admin-style affordances that an app exposes specifically
  // to the agent (no UI button maps to them) and that `agentAffordances`
  // hasn't enumerated. Including them here lets the LLM discover the
  // full set of dispatches without having to read the Msg schema and
  // construct payloads from scratch.
  if (schema) {
    for (const [variant, fields] of Object.entries(schema.variants)) {
      if (seen.has(variant)) continue
      const ann = annotations[variant]
      // Only `@agentOnly` is surfaced here. `'shared'` variants without
      // a live binding are intentionally hidden — if the human can't
      // click them right now, the agent shouldn't fire them either.
      // `'human-only'` is always filtered.
      if (ann?.dispatchMode !== 'agent-only') continue
      out.push({
        variant,
        intent: ann?.intent ?? variant,
        requiresConfirm: ann?.requiresConfirm ?? false,
        dispatchMode: 'agent-only',
        source: 'schema',
        selectorHint: null,
        payloadHint: synthesizePayload(variant, fields),
        warning: ann?.warning ?? null,
        examples: ann?.examples ?? [],
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
function synthesizePayload(
  variant: string,
  fields: Record<string, MsgSchemaField>,
): object {
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

function isOptional(d: MsgSchemaField): boolean {
  return typeof d === 'object' && 'type' in d && d.optional === true
}

function isShould(d: MsgSchemaField): 'should' | undefined {
  return typeof d === 'object' && 'type' in d ? d.priority : undefined
}

function exampleValue(d: MsgSchemaField): unknown {
  // Unwrap rich descriptor to get the bare type for synthesis.
  const t = typeof d === 'object' && 'type' in d ? d.type : (d as Exclude<MsgSchemaField, object> | Extract<MsgSchemaField, { kind?: string; enum?: string[] }>)
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
    for (const [name, descriptor] of Object.entries(
      obj.shape as Record<string, MsgSchemaField>,
    )) {
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
