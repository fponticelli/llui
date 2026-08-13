import { describe, it, expect } from 'vitest'
import { extractMsgAnnotations, extractMsgSchema } from '@llui/compiler'
import { handleListActions, type ListActionsHost } from '../../../src/client/rpc/list-actions.js'
import { validatePayload } from '../../../src/client/rpc/validate-payload.js'
import type { MessageAnnotations } from '../../../src/protocol.js'
import type { MsgSchemaShape } from '../../../src/client/factory.js'

// Issue #89 — the AGENT-BOUNDARY half of the fix.
//
// The compiler used to truncate an annotation predicate at the first embedded
// quote. The agent boundary wraps `new Function` in try/catch (correct defence
// in depth), so the truncated predicate never crashed — it degraded:
//   - `compileRouteGate` fell back to `() => true`  → an ALWAYS-OPEN gate
//   - `compilePredicate`  fell back to `() => true`  → `@validates` accepted all
// This test drives the REAL compiler extractor into the REAL rpc handlers and
// asserts a quote-carrying predicate arrives intact and still gates/rejects.

function makeHost(opts: {
  state: unknown
  descriptors: Array<{ variant: string }>
  annotations: Record<string, MessageAnnotations>
}): ListActionsHost {
  return {
    getState: () => opts.state,
    getBindingDescriptors: () => opts.descriptors,
    getMsgAnnotations: () => opts.annotations,
    getMsgSchema: () => null,
    getAgentAffordances: () => null,
  }
}

/** Does this predicate survive the boundary's `new Function` compile? */
function compiles(src: string, param: string): boolean {
  try {
    new Function(param, `return (${src})`)
    return true
  } catch {
    return false
  }
}

const MSG_SOURCE = `
type Msg =
  /**
   * @intent("Purge every \\"archived\\" record")
   * @routeGated("state.mode === \\"admin\\"", "only while the \\"admin\\" mode is active")
   */
  | { type: 'purge' }
`

describe('annotation predicates at the agent boundary (issue #89)', () => {
  it('a quote-carrying @routeGated arrives intact and still CLOSES the gate', () => {
    const annotations = extractMsgAnnotations(MSG_SOURCE)
    expect(annotations).not.toBeNull()
    const gate = annotations?.purge?.routeGate
    expect(gate).toBe('state.mode === "admin"')
    // The predicate the boundary receives is valid JS — so `compileRouteGate`
    // never hits its `() => true` fallback.
    expect(compiles(gate ?? '', 'state')).toBe(true)

    const host = (state: unknown): ListActionsHost =>
      makeHost({
        state,
        descriptors: [{ variant: 'purge' }],
        annotations: annotations as Record<string, MessageAnnotations>,
      })

    const closed = handleListActions(host({ mode: 'viewer' }))
    expect(closed.actions).toHaveLength(1)
    expect(closed.actions.at(0)?.available).toBe(false)
    expect(closed.actions.at(0)?.unavailableReason).toBe('only while the "admin" mode is active')

    const open = handleListActions(host({ mode: 'admin' }))
    expect(open.actions.at(0)?.available).toBeUndefined()
  })

  it('the OLD truncated gate was always-open — that is the hole this closes', () => {
    // What the `[^"”]*` character class produced for the same annotation.
    const truncated = 'state.mode === '
    expect(compiles(truncated, 'state')).toBe(false)
    // …and the boundary's fallback for an uncompilable gate is "available",
    // so a viewer would have been offered `purge`.
    const wasOpen = handleListActions(
      makeHost({
        state: { mode: 'viewer' },
        descriptors: [{ variant: 'purge' }],
        annotations: {
          purge: {
            intent: null,
            alwaysAffordable: false,
            requiresConfirm: false,
            dispatchMode: 'shared',
            examples: [],
            warning: null,
            emits: [],
            routeGate: truncated,
            routeGateReason: null,
          },
        },
      }),
    )
    expect(wasOpen.actions.at(0)?.available).toBeUndefined()
  })

  it('no predicate the compiler emits can be truncated: every arg round-trips', () => {
    const annotations = extractMsgAnnotations(MSG_SOURCE)
    expect(annotations?.purge?.intent).toBe('Purge every "archived" record')
    // A truncated predicate always ends mid-expression; the boundary compile is
    // the exact test the runtime applies.
    for (const ann of Object.values(annotations ?? {})) {
      if (ann.routeGate) expect(compiles(ann.routeGate, 'state')).toBe(true)
    }
  })

  it('a quote-carrying @validates still REJECTS an invalid payload', () => {
    const schema: MsgSchemaShape | null = extractMsgSchema(`
      type Msg =
        | {
            type: 'SetRole'
            /** @validates("v === \\"admin\\" || v === \\"user\\"") */
            role: string
          }
    `)
    expect(schema?.variants.SetRole?.role).toEqual({
      type: 'string',
      validates: 'v === "admin" || v === "user"',
    })

    expect(validatePayload({ type: 'SetRole', role: 'admin' }, schema).ok).toBe(true)
    const bad = validatePayload({ type: 'SetRole', role: 'guest' }, schema)
    expect(bad.ok).toBe(false)
    if (bad.ok) throw new Error('unreachable — asserted above')
    expect(bad.errors.at(0)?.code).toBe('validates-failed')
  })

  it('the OLD truncated @validates accepted everything', () => {
    const truncated: MsgSchemaShape = {
      discriminant: 'type',
      variants: { SetRole: { role: { type: 'string', validates: 'v === ' } } },
    }
    expect(compiles('v === ', 'v')).toBe(false)
    expect(validatePayload({ type: 'SetRole', role: 'guest' }, truncated).ok).toBe(true)
  })
})
