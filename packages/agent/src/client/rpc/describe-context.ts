import type { AgentContext } from '../../protocol.js'

/**
 * Snapshot of the most recent `send_message` outcome — what the agent
 * just did and whether it landed cleanly. Tracked by the WS RPC layer
 * after every dispatch, surfaced through `describe_context` so apps
 * don't have to roll their own `lastDispatchError` field in state.
 *
 * `status: 'dispatched'` means the reducer ran and state advanced;
 * `errors` here describes downstream effects that failed during the
 * drain window (Phase-5 catch-and-report). `status: 'rejected'`
 * means the validator caught a structural issue before the reducer.
 * `status: 'reducer-threw'` means the reducer itself threw — state
 * may be partially advanced, but the dispatch should be treated as
 * a failure for retry purposes.
 */
export type LastDispatchOutcome = {
  variant: string
  status: 'dispatched' | 'rejected' | 'reducer-threw'
  errors?: ReadonlyArray<{ message: string }>
  warnings?: ReadonlyArray<{ path: string; message: string }>
  at: number
}

export type DescribeContextHost = {
  getState(): unknown
  getAgentContext(): ((state: unknown) => AgentContext) | null
  /**
   * Optional accessor for the most recent dispatch outcome. When the
   * outcome had errors or warnings, `describe_context` prepends a
   * synthetic hint so the agent reads "Last dispatch X failed/landed
   * with caveats" without the app having to maintain a parallel state
   * field. Lenient: undefined / null accessor disables the feature.
   */
  getLastDispatchOutcome?: () => LastDispatchOutcome | null
}
export type DescribeContextResult = { context: AgentContext }

const EMPTY: AgentContext = { summary: '', hints: [], cautions: [] }

export function handleDescribeContext(host: DescribeContextHost): DescribeContextResult {
  const fn = host.getAgentContext()
  const baseContext = fn ? fn(host.getState()) : EMPTY
  const outcome = host.getLastDispatchOutcome?.() ?? null
  const synthetic = outcome ? formatLastOutcomeHint(outcome) : null
  if (!synthetic) return { context: baseContext }

  // Prepend the synthetic hint so it's the first thing the agent sees.
  // The app's own hints follow.
  const hints: string[] = [synthetic, ...(baseContext.hints ?? [])]
  return { context: { ...baseContext, hints } }
}

/**
 * Render the outcome as a single hint string. Returns null for clean
 * outcomes — no need to add noise to the context when nothing went
 * wrong on the last dispatch.
 */
function formatLastOutcomeHint(outcome: LastDispatchOutcome): string | null {
  const errors = outcome.errors ?? []
  const warnings = outcome.warnings ?? []
  if (outcome.status === 'dispatched' && errors.length === 0 && warnings.length === 0) {
    return null
  }
  if (outcome.status === 'rejected') {
    const errMsgs = errors.length > 0 ? errors.map((e) => e.message).join('; ') : 'no detail'
    return `LAST DISPATCH REJECTED: ${outcome.variant} — ${errMsgs}. Fix the payload and retry.`
  }
  if (outcome.status === 'reducer-threw') {
    const msg = errors.length > 0 ? (errors[0]?.message ?? 'reducer threw') : 'reducer threw'
    return `LAST DISPATCH ERRORED MID-FLIGHT: ${outcome.variant} — ${msg}. State may be partially advanced; observe before retrying.`
  }
  // dispatched with errors / warnings
  const parts: string[] = []
  if (errors.length > 0) {
    parts.push(
      `${String(errors.length)} downstream error${errors.length === 1 ? '' : 's'}: ${errors
        .map((e) => e.message)
        .join('; ')}`,
    )
  }
  if (warnings.length > 0) {
    parts.push(
      `${String(warnings.length)} validation warning${warnings.length === 1 ? '' : 's'}: ${warnings
        .map((w) => `${w.path}: ${w.message}`)
        .join('; ')}`,
    )
  }
  return `LAST DISPATCH (${outcome.variant}) landed with caveats — ${parts.join(' / ')}.`
}
