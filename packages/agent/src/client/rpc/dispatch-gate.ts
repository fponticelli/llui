import type { MessageAnnotations } from '../../protocol.js'

/**
 * Outcome of the shared annotation gate applied before an agent-driven
 * dispatch (real via `send_message`, or predicted via `would_dispatch`).
 * A blocked result carries a machine reason plus human-readable detail
 * the agent can act on.
 */
export type DispatchGateResult =
  | { ok: true }
  | { ok: false; reason: 'human-only' | 'invalid'; detail: string }

/**
 * The single policy that decides whether an agent may dispatch `msgType`.
 * Shared by `send_message` (real dispatch) and `would_dispatch`
 * (prediction) so an agent can neither run NOR probe a gated transition:
 *
 *   - Unknown variant (the app declared annotations but not this type) →
 *     `invalid`. Prevents dispatching a variant `update()` never handles.
 *   - `dispatchMode: 'human-only'` → `human-only`. These are user-only UI
 *     events (focus/scroll/hover, destructive confirmations bound to a
 *     button) the agent has no business triggering.
 *
 * Permissive when `annotations` is empty (no compiler metadata): the
 * reducer stays the last line of defense, matching the tool's behavior
 * on hosts without schema/annotation metadata.
 *
 * NOTE: `@routeGated` is deliberately NOT enforced here — it is an
 * affordance-VISIBILITY concern (surfaced in `list_actions` as
 * `available: false`), and a broken/throwing predicate must never be
 * able to block a real dispatch.
 */
export function checkDispatchGate(
  msgType: string,
  annotations: Record<string, MessageAnnotations>,
): DispatchGateResult {
  const ann = annotations[msgType]

  // If annotations exist at all and this variant isn't among them, it's
  // an unknown type the app never declared — reject before it reaches
  // update().
  const hasAnnotations = Object.keys(annotations).length > 0
  if (hasAnnotations && !ann) {
    return { ok: false, reason: 'invalid', detail: `unknown variant: ${msgType}` }
  }

  if (ann?.dispatchMode === 'human-only') {
    return {
      ok: false,
      reason: 'human-only',
      detail: ann.intent
        ? `"${ann.intent}" can only be triggered by the user (human-only action)`
        : 'this action can only be triggered by the user (human-only)',
    }
  }

  return { ok: true }
}
