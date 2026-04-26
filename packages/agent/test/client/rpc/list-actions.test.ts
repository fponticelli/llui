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
    expect(a?.payloadHint).toEqual({
      type: 'Matrix/AddCriteria',
      criteria: null, // 'unknown' → null placeholder
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

  it('surfaces documented shared variants from schema even without a live binding', () => {
    // A `'shared'` variant with `@intent` is documented for agent use.
    // Without this case, an agent that wanted to set one cell would
    // be forced to use bulk operations like `Matrix/SetManyCells` with
    // a 1-element array, even though `Matrix/SetQuantityValue` is the
    // direct path. The author's `@intent` is the explicit signal.
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
    expect(result.actions).toHaveLength(1)
    expect(result.actions.at(0)).toMatchObject({
      variant: 'Matrix/SetQuantityValue',
      intent: 'Set a numeric quantity value in a matrix cell',
      dispatchMode: 'shared',
      source: 'schema',
    })
    expect(result.actions.at(0)?.payloadHint).toEqual({
      type: 'Matrix/SetQuantityValue',
      criterionId: '',
      alternativeId: '',
      value: 0,
    })
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
})
