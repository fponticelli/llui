import { describe, it, expect } from 'vitest'
import { handleListActions, type ListActionsHost } from '../../../src/client/rpc/list-actions.js'
import type { MessageAnnotations } from '../../../src/protocol.js'
import type { MsgSchemaShape } from '../../../src/client/factory.js'

function makeHost(opts: {
  state?: unknown
  descriptors?: Array<{ variant: string }> | null
  annotations?: Record<string, MessageAnnotations> | null
  schema?: MsgSchemaShape | null
  affordances?: ((s: unknown) => Array<{ type: string; [k: string]: unknown }>) | null
}): ListActionsHost {
  return {
    getState: () => opts.state ?? {},
    getBindingDescriptors: () => opts.descriptors ?? null,
    getMsgAnnotations: () => opts.annotations ?? null,
    getMsgSchema: () => opts.schema ?? null,
    getAgentAffordances: () => opts.affordances ?? null,
  }
}

describe('handleListActions', () => {
  it('empty bindings and no affordances returns empty actions', () => {
    const result = handleListActions(makeHost({ descriptors: [], affordances: null }))
    expect(result).toEqual({ actions: [] })
  })

  it('human-only binding is filtered out', () => {
    const result = handleListActions(
      makeHost({
        descriptors: [{ variant: 'Delete' }, { variant: 'Save' }],
        annotations: {
          Delete: {
            intent: 'delete item',
            dispatchMode: 'human-only',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
          },
          Save: {
            intent: 'save item',
            dispatchMode: 'shared',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
          },
        },
      }),
    )
    expect(result.actions).toHaveLength(1)
    expect(result.actions.at(0)?.variant).toBe('Save')
  })

  it('null annotation intent surfaces as null (not synthesised from variant name)', () => {
    // Pre-`@intent` (or eslint-disabled) variants used to fall back to
    // `intent: <variant>` here. That made unannotated actions
    // indistinguishable from annotated ones on the LLM surface and
    // hid genuine documentation gaps. The agent now sees `null` and
    // can treat it as "this action is undocumented".
    const result = handleListActions(
      makeHost({
        descriptors: [{ variant: 'Toggle' }],
        annotations: {
          Toggle: {
            intent: null,
            dispatchMode: 'shared',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
          },
        },
      }),
    )
    expect(result.actions.at(0)?.intent).toBeNull()
  })

  it('affordances with payload sets payloadHint', () => {
    const result = handleListActions(
      makeHost({
        descriptors: [],
        affordances: () => [{ type: 'AddItem', id: 'abc', qty: 2 }],
      }),
    )
    expect(result.actions).toHaveLength(1)
    expect(result.actions.at(0)).toMatchObject({
      variant: 'AddItem',
      source: 'always-affordable',
      payloadHint: { id: 'abc', qty: 2 },
    })
  })

  it('missing annotations defaults: intent=null, requiresConfirm=false', () => {
    const result = handleListActions(
      makeHost({
        descriptors: [{ variant: 'Increment' }],
        annotations: null,
      }),
    )
    expect(result.actions.at(0)).toMatchObject({
      variant: 'Increment',
      intent: null,
      requiresConfirm: false,
      source: 'binding',
      selectorHint: null,
      payloadHint: null,
    })
  })

  it('affordance with no extra keys has null payloadHint', () => {
    const result = handleListActions(
      makeHost({
        descriptors: [],
        affordances: () => [{ type: 'Reset' }],
      }),
    )
    expect(result.actions.at(0)?.payloadHint).toBeNull()
  })

  // ── Schema-only @agentOnly variants ────────────────────────────

  it('surfaces @agentOnly schema variants with synthesized payloadHint', () => {
    // The motivating case: a Msg variant declared @agentOnly that
    // isn't bound to any UI and isn't returned by `agentAffordances`.
    // Bulk-edit operations live here — `Matrix/AddCriteria` and
    // similar app-level batch APIs the LLM is meant to use as a
    // single transaction.
    const result = handleListActions(
      makeHost({
        descriptors: [],
        annotations: {
          'Matrix/AddCriteria': {
            intent: 'Add multiple criteria in one transaction',
            dispatchMode: 'agent-only',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        schema: {
          discriminant: 'type',
          variants: {
            'Matrix/AddCriteria': {
              criteria: 'unknown',
            },
          },
        },
      }),
    )
    expect(result.actions).toHaveLength(1)
    const a = result.actions.at(0)
    expect(a).toMatchObject({
      variant: 'Matrix/AddCriteria',
      intent: 'Add multiple criteria in one transaction',
      dispatchMode: 'agent-only',
      source: 'schema',
    })
    // `unknown`-typed fields are OMITTED from the synthesized
    // example. Emitting `null` (the previous behavior) misled agents
    // into copying the literal `null` and pushing through validation
    // (validators exempt `unknown`), only to crash the renderer
    // downstream when the consumer code tried to read `.kind` off
    // the null. Now the LLM has to look at `description.messages`
    // for the field's actual shape, which is the right behaviour
    // when the schema legitimately doesn't know.
    expect(a?.payloadHint).toEqual({
      type: 'Matrix/AddCriteria',
    })
  })

  it('skips schema variants already covered by a binding', () => {
    // De-duplication: if the variant is mounted in the UI, the
    // binding entry already provides the affordance. Surfacing it
    // again as `source: 'schema'` would be noise.
    const result = handleListActions(
      makeHost({
        descriptors: [{ variant: 'Save' }],
        annotations: {
          Save: {
            intent: null,
            dispatchMode: 'agent-only',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        schema: {
          discriminant: 'type',
          variants: { Save: {} },
        },
      }),
    )
    expect(result.actions).toHaveLength(1)
    expect(result.actions.at(0)?.source).toBe('binding')
  })

  it('skips undocumented shared variants without a live binding', () => {
    // `'shared'` variants without `@intent` are usually internal —
    // effect-result acks, router-internal messages — that aren't
    // intended as agent affordances. Surfacing them would pollute
    // the action list with internal plumbing.
    const result = handleListActions(
      makeHost({
        descriptors: [],
        annotations: {
          Save: {
            intent: null,
            dispatchMode: 'shared',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        schema: {
          discriminant: 'type',
          variants: { Save: {} },
        },
      }),
    )
    expect(result.actions).toHaveLength(0)
  })

  it('hides documented shared variants from schema when no live binding maps to them', () => {
    // `'shared'` variants are reached through UI affordances. When no
    // binding currently surfaces them (e.g. the cell editor is closed),
    // the variant is genuinely unreachable for the human user — and the
    // agent shouldn't see it either, because dispatching it would flip
    // hidden state and pop UI in places the user didn't navigate to.
    // The explicit knob for "agent can reach this regardless of UI" is
    // `@alwaysAffordable`; absent that, schema-only `'shared'` variants
    // stay hidden.
    const result = handleListActions(
      makeHost({
        descriptors: [],
        annotations: {
          'Matrix/SetQuantityValue': {
            intent: 'Set a numeric quantity value in a matrix cell',
            dispatchMode: 'shared',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        schema: {
          discriminant: 'type',
          variants: {
            'Matrix/SetQuantityValue': {
              criterionId: 'string',
              alternativeId: 'string',
              value: 'number',
            },
          },
        },
      }),
    )
    expect(result.actions).toHaveLength(0)
  })

  // ── @alwaysAffordable annotation ───────────────────────────────

  it('surfaces @alwaysAffordable variants from annotations even without a live binding', () => {
    // `@alwaysAffordable` is the explicit "agent can reach this even
    // when no UI binding maps to it" knob. Bulk seed ops typically
    // carry it: `Matrix/AddAlternatives` is dispatched once to populate
    // a fresh matrix; there's no human-facing affordance for it.
    const result = handleListActions(
      makeHost({
        descriptors: [],
        annotations: {
          'Matrix/AddAlternatives': {
            intent: 'Append multiple alternatives in one transaction',
            dispatchMode: 'shared',
            requiresConfirm: false,
            alwaysAffordable: true,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        schema: {
          discriminant: 'type',
          variants: {
            'Matrix/AddAlternatives': {
              alternatives: 'unknown',
            },
          },
        },
      }),
    )
    expect(result.actions).toHaveLength(1)
    const a = result.actions.at(0)
    expect(a).toMatchObject({
      variant: 'Matrix/AddAlternatives',
      intent: 'Append multiple alternatives in one transaction',
      dispatchMode: 'shared',
      source: 'always-affordable',
    })
    expect(a?.payloadHint).toEqual({
      type: 'Matrix/AddAlternatives',
      // `alternatives` is `unknown` → omitted from the example.
    })
  })

  it('skips @alwaysAffordable variants already covered by a live binding', () => {
    // Dedup: if the variant has a binding, the binding entry already
    // provides the affordance. An additional 'always-affordable' entry
    // would be noise. Same rule as the schema-source dedup.
    const result = handleListActions(
      makeHost({
        descriptors: [{ variant: 'Save' }],
        annotations: {
          Save: {
            intent: 'save the matrix',
            dispatchMode: 'shared',
            requiresConfirm: false,
            alwaysAffordable: true,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        schema: { discriminant: 'type', variants: { Save: {} } },
      }),
    )
    expect(result.actions).toHaveLength(1)
    expect(result.actions.at(0)?.source).toBe('binding')
  })

  it('skips @alwaysAffordable variants already returned by agentAffordances', () => {
    // If the integrator's affordances callback already returned the
    // variant with a payload, that's strictly more informative than
    // the schema-synthesized one. The annotation pass defers.
    const result = handleListActions(
      makeHost({
        descriptors: [],
        annotations: {
          'Matrix/AddAlternatives': {
            intent: null,
            dispatchMode: 'shared',
            requiresConfirm: false,
            alwaysAffordable: true,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        affordances: () => [
          { type: 'Matrix/AddAlternatives', alternatives: [{ id: 'a1', title: 'first' }] },
        ],
        schema: {
          discriminant: 'type',
          variants: { 'Matrix/AddAlternatives': { alternatives: 'unknown' } },
        },
      }),
    )
    expect(result.actions).toHaveLength(1)
    expect(result.actions.at(0)).toMatchObject({
      variant: 'Matrix/AddAlternatives',
      source: 'always-affordable',
      payloadHint: { alternatives: [{ id: 'a1', title: 'first' }] },
    })
  })

  it('@alwaysAffordable + human-only is filtered out (defense in depth)', () => {
    // The combination is rejected by ESLint
    // (`agent-exclusive-annotations`), but if it sneaks past the lint
    // rule the runtime still treats `human-only` as the dominant tag.
    const result = handleListActions(
      makeHost({
        descriptors: [],
        annotations: {
          'X/Internal': {
            intent: 'internal',
            dispatchMode: 'human-only',
            requiresConfirm: false,
            alwaysAffordable: true,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        schema: { discriminant: 'type', variants: { 'X/Internal': {} } },
      }),
    )
    expect(result.actions).toHaveLength(0)
  })

  it('synthesizes example values from primitive types', () => {
    const result = handleListActions(
      makeHost({
        descriptors: [],
        annotations: {
          'X/Bulk': {
            intent: null,
            dispatchMode: 'agent-only',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        schema: {
          discriminant: 'type',
          variants: {
            'X/Bulk': {
              title: 'string',
              count: 'number',
              published: 'boolean',
              category: { enum: ['a', 'b', 'c'] },
            },
          },
        },
      }),
    )
    expect(result.actions.at(0)?.payloadHint).toEqual({
      type: 'X/Bulk',
      title: '',
      count: 0,
      published: false,
      category: 'a', // First enum option as the example
    })
  })

  it('omits optional fields without @should from the payload example', () => {
    // Optional fields are typically defaults — including them all in
    // the example would clutter the payload and pressure the LLM
    // into filling them. Only @should-flagged optional fields appear.
    const result = handleListActions(
      makeHost({
        descriptors: [],
        annotations: {
          'X/Op': {
            intent: null,
            dispatchMode: 'agent-only',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        schema: {
          discriminant: 'type',
          variants: {
            'X/Op': {
              required: 'string',
              optionalQuiet: { type: 'string', optional: true },
              optionalShould: {
                type: 'string',
                optional: true,
                priority: 'should',
                hint: 'Cite the source.',
              },
            },
          },
        },
      }),
    )
    const payload = result.actions.at(0)?.payloadHint as Record<string, unknown>
    expect(payload).toHaveProperty('required')
    expect(payload).toHaveProperty('optionalShould')
    expect(payload).not.toHaveProperty('optionalQuiet')
  })

  it('skips schema variants whose dispatchMode is human-only', () => {
    const result = handleListActions(
      makeHost({
        descriptors: [],
        annotations: {
          'X/Internal': {
            intent: null,
            dispatchMode: 'human-only',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        schema: {
          discriminant: 'type',
          variants: { 'X/Internal': {} },
        },
      }),
    )
    expect(result.actions).toHaveLength(0)
  })

  // ── @routeGated predicate ──────────────────────────────────────

  it('surfaces variants whose @routeGated predicate evaluates falsy as available:false with the authored reason', () => {
    // The variant is NOT hidden — it's surfaced as unavailable so the
    // agent learns it exists and what unblocks it. The authored 2nd arg
    // of @routeGated becomes the unavailableReason.
    const result = handleListActions(
      makeHost({
        descriptors: [],
        state: { matrixState: { kind: 'idle' } }, // not loaded
        annotations: {
          'Matrix/AddCriteria': {
            intent: 'Add criteria',
            dispatchMode: 'agent-only',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
            routeGate: "state.matrixState.kind === 'loaded'",
            routeGateReason: 'load a matrix first',
          },
        },
        schema: {
          discriminant: 'type',
          variants: { 'Matrix/AddCriteria': { criteria: 'unknown' } },
        },
      }),
    )
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]?.variant).toBe('Matrix/AddCriteria')
    expect(result.actions[0]?.available).toBe(false)
    expect(result.actions[0]?.unavailableReason).toBe('load a matrix first')
  })

  it('falls back to a generic unavailableReason when @routeGated has no reason', () => {
    const result = handleListActions(
      makeHost({
        descriptors: [],
        state: { matrixState: { kind: 'idle' } },
        annotations: {
          'Matrix/AddCriteria': {
            intent: 'Add criteria',
            dispatchMode: 'agent-only',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
            routeGate: "state.matrixState.kind === 'loaded'",
          },
        },
        schema: {
          discriminant: 'type',
          variants: { 'Matrix/AddCriteria': { criteria: 'unknown' } },
        },
      }),
    )
    expect(result.actions[0]?.available).toBe(false)
    expect(result.actions[0]?.unavailableReason).toBe('not available in the current state')
  })

  it('surfaces variants whose @routeGated predicate evaluates truthy (available, no flag)', () => {
    const result = handleListActions(
      makeHost({
        descriptors: [],
        state: { matrixState: { kind: 'loaded' } }, // gate passes
        annotations: {
          'Matrix/AddCriteria': {
            intent: 'Add criteria',
            dispatchMode: 'agent-only',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
            routeGate: "state.matrixState.kind === 'loaded'",
          },
        },
        schema: {
          discriminant: 'type',
          variants: { 'Matrix/AddCriteria': { criteria: 'unknown' } },
        },
      }),
    )
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]?.variant).toBe('Matrix/AddCriteria')
    expect(result.actions[0]?.available).toBeUndefined() // available actions omit the flag
    expect(result.actions[0]?.unavailableReason).toBeUndefined()
  })

  it('routeGate predicate that throws is fail-closed → surfaced as unavailable', () => {
    // Predicate references state.foo but state has no foo — TypeError
    // bubbles up and we treat it as "predicate said no", surfacing the
    // variant as available:false (rather than dropping it).
    const result = handleListActions(
      makeHost({
        descriptors: [],
        state: {}, // no nested keys
        annotations: {
          X: {
            intent: 'X',
            dispatchMode: 'agent-only',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
            routeGate: 'state.deeply.nested.value === 1',
          },
        },
        schema: { discriminant: 'type', variants: { X: {} } },
      }),
    )
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]?.available).toBe(false)
  })

  // ── @agentOnly gated by agentAffordances ───────────────────────

  it('gates @agentOnly schema variants behind agentAffordances when defined', () => {
    // Decisive's pattern: bulk Msgs like Matrix/AddCriteria are
    // @agentOnly. Pre-fix they were ALWAYS surfaced from schema, even
    // on the home page where there's no matrix to add to. With this
    // change, an app that defines `agentAffordances` opts into
    // route/state-aware affordance control: @agentOnly variants
    // surface only when the hook returns them.
    const homeResult = handleListActions(
      makeHost({
        descriptors: [],
        affordances: () => [], // empty: no matrix loaded, no bulk ops applicable
        annotations: {
          'Matrix/AddCriteria': {
            intent: 'Add criteria',
            dispatchMode: 'agent-only',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        schema: {
          discriminant: 'type',
          variants: { 'Matrix/AddCriteria': { criteria: 'unknown' } },
        },
      }),
    )
    expect(homeResult.actions).toHaveLength(0)

    // On the matrix page, agentAffordances includes the bulk Msg.
    const matrixResult = handleListActions(
      makeHost({
        descriptors: [],
        affordances: () => [{ type: 'Matrix/AddCriteria' }],
        annotations: {
          'Matrix/AddCriteria': {
            intent: 'Add criteria',
            dispatchMode: 'agent-only',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        schema: {
          discriminant: 'type',
          variants: { 'Matrix/AddCriteria': { criteria: 'unknown' } },
        },
      }),
    )
    // The variant surfaces from `agentAffordances` (source:
    // 'always-affordable'), and the schema pass also accepts it
    // (matches the affordance set). De-dup via `seen` ensures only
    // one entry, and it's the affordance one (richer payloadHint).
    expect(matrixResult.actions).toHaveLength(1)
    expect(matrixResult.actions[0]?.source).toBe('always-affordable')
  })

  it('keeps backward-compat: @agentOnly always surfaces when no agentAffordances is provided', () => {
    // Apps that haven't migrated keep the previous "everything's
    // available" behavior. Only flipping the default once an app
    // explicitly opts into agentAffordances avoids breaking
    // consumers.
    const result = handleListActions(
      makeHost({
        descriptors: [],
        affordances: null, // not provided
        annotations: {
          'Matrix/AddCriteria': {
            intent: 'Add criteria',
            dispatchMode: 'agent-only',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        schema: {
          discriminant: 'type',
          variants: { 'Matrix/AddCriteria': { criteria: 'unknown' } },
        },
      }),
    )
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]?.source).toBe('schema')
  })

  // ── Schema-membership filter on bindings ───────────────────────

  it('filters bindings whose variant is not in the Msg schema (lib internals)', () => {
    // Sortable / library components route through `tagSend`. When the
    // translator wiring is wrong (or the component author didn't
    // translate at all), library-internal Msgs (`move`, `drop`, …)
    // leak into the live binding registry. The schema is the source of
    // truth for "what the agent's update.ts can dispatch" — anything
    // not in the schema is library noise that pollutes the affordance
    // list and would be rejected at send_message time anyway.
    const result = handleListActions(
      makeHost({
        descriptors: [
          { variant: 'Save' }, // legitimate, in schema
          { variant: 'move' }, // sortable lib internal — should be filtered
          { variant: 'drop' }, // ditto
          { variant: 'cancel' }, // ditto
        ],
        annotations: {
          Save: {
            intent: 'save',
            dispatchMode: 'shared',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        schema: {
          discriminant: 'type',
          variants: { Save: {} },
        },
      }),
    )
    expect(result.actions).toHaveLength(1)
    expect(result.actions.at(0)?.variant).toBe('Save')
  })

  it('passes through binding variants when no schema is available', () => {
    // No schema = no source of truth for filtering. The runtime can't
    // tell library Msgs from app Msgs, so be permissive — matches the
    // pre-filter behaviour and avoids hiding legitimate bindings in
    // builds that predate schema emission.
    const result = handleListActions(
      makeHost({
        descriptors: [{ variant: 'Save' }, { variant: 'move' }],
        schema: null,
      }),
    )
    expect(result.actions.map((a) => a.variant).sort()).toEqual(['Save', 'move'])
  })

  // ── @validates surfaces as a fieldHint ─────────────────────────

  it('surfaces @validates predicate text as a fieldHint', () => {
    // The agent sees the constraint at affordance time so it ships a
    // valid value first try, instead of dispatching, getting rejected
    // with `validates-failed`, and retrying.
    const result = handleListActions(
      makeHost({
        descriptors: [],
        annotations: {
          'Criterion/SetWeight': {
            intent: 'Set the weight',
            dispatchMode: 'agent-only',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        schema: {
          discriminant: 'type',
          variants: {
            'Criterion/SetWeight': {
              weight: { type: 'number', validates: 'v >= 0 && v <= 100' },
            },
          },
        },
      }),
    )
    const a = result.actions.at(0)
    expect(a?.fieldHints).toContainEqual({
      path: 'weight',
      hint: 'validates: v >= 0 && v <= 100',
    })
  })

  it('combines @should hint and @validates predicate as separate hints', () => {
    const result = handleListActions(
      makeHost({
        descriptors: [],
        annotations: {
          X: {
            intent: 'X',
            dispatchMode: 'agent-only',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        schema: {
          discriminant: 'type',
          variants: {
            X: {
              url: {
                type: 'string',
                optional: true,
                priority: 'should',
                hint: 'Cite the source.',
                validates: 'v.length > 0',
              },
            },
          },
        },
      }),
    )
    const hints = result.actions.at(0)?.fieldHints ?? []
    expect(hints).toContainEqual({ path: 'url', hint: 'Cite the source.' })
    expect(hints).toContainEqual({ path: 'url', hint: 'validates: v.length > 0' })
  })

  // ── Discriminated unions ───────────────────────────────────────

  it('synthesizes the first branch of a discriminated-union field as the example', () => {
    // The motivating case: `format` is `{kind:'exact'} | {kind:'range', min, max}`.
    // The example shows ONE legal shape; the schema preserves the full
    // set so the agent that needs another branch reads it directly.
    const result = handleListActions(
      makeHost({
        descriptors: [],
        annotations: {
          'Cell/SetFormat': {
            intent: 'Set the format of the criterion',
            dispatchMode: 'agent-only',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        schema: {
          discriminant: 'type',
          variants: {
            'Cell/SetFormat': {
              format: {
                kind: 'discriminated-union',
                discriminant: 'kind',
                variants: {
                  exact: {},
                  range: { min: 'number', max: 'number' },
                  compound: { formula: 'string' },
                },
              },
            },
          },
        },
      }),
    )
    const a = result.actions.at(0)
    expect(a?.payloadHint).toEqual({
      type: 'Cell/SetFormat',
      format: { kind: 'exact' }, // First branch, no payload fields
    })
  })

  it('emits a fieldHints summary listing the legal discriminant values', () => {
    // The agent sees the synthetic hint at the union's path
    // enumerating every legal `<discriminant>` value, plus per-branch
    // hints with the branch's discriminant in the path.
    const result = handleListActions(
      makeHost({
        descriptors: [],
        annotations: {
          'Cell/SetFormat': {
            intent: 'Set format',
            dispatchMode: 'agent-only',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        schema: {
          discriminant: 'type',
          variants: {
            'Cell/SetFormat': {
              format: {
                kind: 'discriminated-union',
                discriminant: 'kind',
                variants: {
                  exact: {},
                  range: {
                    min: 'number',
                    max: {
                      type: 'number',
                      priority: 'should',
                      hint: 'Upper bound for normalisation.',
                    },
                  },
                },
              },
            },
          },
        },
      }),
    )
    const hints = result.actions.at(0)?.fieldHints ?? []
    expect(hints).toContainEqual({
      path: 'format',
      hint: "Discriminated union — set `kind` to one of: 'exact', 'range'.",
    })
    expect(hints).toContainEqual({
      path: 'format(kind=range).max',
      hint: 'Upper bound for normalisation.',
    })
  })

  it('lifts @should hints onto the action as fieldHints', () => {
    // Hints in the schema tree (priority: 'should' + hint string) get
    // surfaced flat on the action so callers don't have to dig into
    // `description.messages.variants[X].cells.hint`.
    const result = handleListActions(
      makeHost({
        descriptors: [],
        annotations: {
          'Matrix/SetManyCells': {
            intent: 'Set many cells in one transaction',
            dispatchMode: 'agent-only',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        schema: {
          discriminant: 'type',
          variants: {
            'Matrix/SetManyCells': {
              cells: {
                type: {
                  kind: 'array',
                  element: {
                    kind: 'object',
                    shape: {
                      criterionId: 'string',
                      alternativeId: 'string',
                      value: 'unknown',
                      meta: {
                        type: 'unknown',
                        optional: true,
                        priority: 'should',
                        hint: 'Cite where the value came from.',
                      },
                    },
                  },
                },
                priority: 'should',
                hint: 'Each entry: {criterionId, alternativeId, value, meta?}.',
              },
            },
          },
        },
      }),
    )
    const a = result.actions.at(0)
    expect(a?.fieldHints).toEqual([
      { path: 'cells', hint: 'Each entry: {criterionId, alternativeId, value, meta?}.' },
      { path: 'cells[].meta', hint: 'Cite where the value came from.' },
    ])
  })

  // ── Synthesizer never emits null for unknown ───────────────────
  // Regression guard: when a field's schema is `'unknown'`, the
  // synthesizer must omit the field from the example, not emit
  // `null`. Emitting `null` misleads agents into copying it
  // verbatim — the validator passes (it exempts unknowns), the
  // value lands in state, and the consumer crashes on `null.kind`
  // or similar. The agent should look at `description.messages`
  // for the field's actual shape when the example doesn't mention
  // it.

  it('omits unknown-typed fields nested inside an object', () => {
    const result = handleListActions(
      makeHost({
        descriptors: [],
        annotations: {
          Save: {
            intent: null,
            dispatchMode: 'agent-only',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        schema: {
          discriminant: 'type',
          variants: {
            Save: {
              criterion: {
                kind: 'object',
                shape: {
                  id: 'string',
                  weight: 'number',
                  format: 'unknown', // ← should be omitted
                },
              },
            },
          },
        },
      }),
    )
    const a = result.actions.at(0)
    expect(a?.payloadHint).toEqual({
      type: 'Save',
      criterion: { id: '', weight: 0 }, // no `format` key
    })
  })

  it('omits unknown-typed fields inside a discriminated-union variant', () => {
    const result = handleListActions(
      makeHost({
        descriptors: [],
        annotations: {
          AddCriterion: {
            intent: null,
            dispatchMode: 'agent-only',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        schema: {
          discriminant: 'type',
          variants: {
            AddCriterion: {
              criterion: {
                kind: 'discriminated-union',
                discriminant: 'kind',
                variants: {
                  quantity: {
                    range: 'unknown', // ← should be omitted
                    highIsBetter: 'boolean',
                  },
                  rating: {
                    stars: 'number',
                  },
                },
              },
            },
          },
        },
      }),
    )
    const a = result.actions.at(0)
    expect(a?.payloadHint).toEqual({
      type: 'AddCriterion',
      criterion: { kind: 'quantity', highIsBetter: false }, // no `range` key
    })
  })

  it('emits an empty array when the array element is unknown', () => {
    // No way to synthesize a meaningful element shape — give the
    // agent an empty array so they at least see "this is an
    // array, but I don't know the element type." Better than `[null]`,
    // which suggests every element should be the literal null.
    const result = handleListActions(
      makeHost({
        descriptors: [],
        annotations: {
          BulkSet: {
            intent: null,
            dispatchMode: 'agent-only',
            requiresConfirm: false,
            alwaysAffordable: false,
            examples: [],
            warning: null,
            emits: [],
          },
        },
        schema: {
          discriminant: 'type',
          variants: {
            BulkSet: {
              items: { kind: 'array', element: 'unknown' },
            },
          },
        },
      }),
    )
    expect(result.actions.at(0)?.payloadHint).toEqual({ type: 'BulkSet', items: [] })
  })
})
