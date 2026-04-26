import { computeStateDiff } from '../../state-diff.js'
import type { StateDiff } from '../../state-diff.js'

/**
 * Predict the result of dispatching `msg` without actually applying
 * it. Runs the reducer in isolation against the current state,
 * returns the would-be diff and the would-fire effects, but doesn't
 * commit or run anything. Lets the agent reason about a candidate
 * action before pulling the trigger:
 *
 *   - "If I dispatch X, what will change?" — read `stateDiff`.
 *   - "Will it fire effects? Which ones?" — read `effects`.
 *   - "Should I batch?" — predict each, see whether the diffs
 *     compose without conflict.
 *
 * The contract is bounded by TEA's purity assumption: the reducer
 * must be a pure function `(state, msg) → [newState, effects]`. LLui
 * reducers are pure by convention (the runtime never re-runs them
 * speculatively for any other reason, so impurity would already be
 * a latent bug). Apps whose reducers branch on `Date.now()` or read
 * `localStorage` will see prediction drift from real dispatch by
 * exactly that amount of impurity — usually negligible, sometimes
 * surprising; document at the call site.
 *
 * **No effects fire.** The returned `effects` array is the literal
 * effect descriptors the reducer produced — what `onEffect` would
 * have received. The agent reads them; the runtime ignores them.
 * This is the entire reason the tool exists separately from
 * `send_message`: a real dispatch hits the cloud / analytics /
 * persistence; a predicted one doesn't.
 */
export type WouldDispatchHost = {
  getState(): unknown
  /**
   * Run the reducer in isolation. `[newState, effects]` shape.
   * Implemented by the AppHandle as a thin wrapper around
   * `inst.def.update(state, msg)` — no flush, no subscribe, no
   * commit. Implementations that can't run the reducer (e.g.
   * test harnesses with no live instance) return null and the
   * tool reports unsupported.
   */
  runReducer(msg: { type: string; [k: string]: unknown }):
    | { state: unknown; effects: unknown[] }
    | null
}

export type WouldDispatchArgs = {
  msg: { type: string; [k: string]: unknown }
}

export type WouldDispatchResult =
  | {
      status: 'predicted'
      /** Diff from current state to the predicted post-reducer state. */
      stateDiff: StateDiff
      /** Effects the reducer would emit. Order matches the reducer's return. */
      effects: unknown[]
    }
  | { status: 'rejected'; reason: 'invalid' | 'unsupported'; detail?: string }

export function handleWouldDispatch(
  host: WouldDispatchHost,
  args: WouldDispatchArgs,
): WouldDispatchResult {
  if (!args.msg || typeof args.msg.type !== 'string') {
    return { status: 'rejected', reason: 'invalid', detail: 'msg.type must be a string' }
  }
  const result = host.runReducer(args.msg)
  if (result === null) {
    return {
      status: 'rejected',
      reason: 'unsupported',
      detail: 'host does not expose a reducer (no live component instance)',
    }
  }
  const prevState = host.getState()
  return {
    status: 'predicted',
    stateDiff: computeStateDiff(prevState, result.state),
    effects: result.effects,
  }
}
