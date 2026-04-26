import type { AppHandle } from '@llui/dom'

/**
 * Captured trace of an agent-driven session: the sequence of
 * messages dispatched and the final state observed after the last
 * one. Serializable as JSON so test fixtures can live alongside
 * code (`__fixtures__/login-flow.json`) and replay deterministically
 * in CI.
 */
export interface AgentSessionFixture {
  /**
   * State snapshot taken when recording started. Replay starts from
   * here — if the new handle's initial state diverges, the harness
   * reports the divergence so callers can decide whether to fail or
   * normalize.
   */
  initialState: unknown
  /**
   * Messages dispatched in order. Each is the raw msg the agent
   * sent (or whatever the recorder's `send(msg)` was called with).
   */
  msgs: Array<{ type: string; [k: string]: unknown }>
  /** State after every `msg` has been dispatched + drained. */
  finalState: unknown
}

export interface AgentSessionRecorder {
  /**
   * Send a message through the wrapped channel. Forwards to the
   * underlying `handle.send` and records the msg into the trace.
   * Use this in place of `handle.send(msg)` for the duration of
   * the session you want to capture.
   */
  send(msg: { type: string; [k: string]: unknown }): void
  /**
   * Stop recording, snapshot the final state, return the fixture.
   * After `stop()`, further `send()` calls throw.
   */
  stop(): AgentSessionFixture
}

/**
 * Begin recording an agent session. Returns a recorder whose `send`
 * forwards to the handle and captures the message; `stop()` finalizes
 * the trace into a JSON-serializable fixture.
 *
 * Typical usage:
 *
 * ```ts
 * const handle = mountApp(root, App)
 * const r = recordAgentSession(handle)
 * r.send({ type: 'Cloud/NewMatrix' })
 * r.send({ type: 'Matrix/AddCriteria', criteria: [...] })
 * r.send({ type: 'Cloud/Save' })
 * const fixture = r.stop()
 * // Persist `fixture` as JSON; replay in CI to assert the same
 * // sequence still produces the same final state.
 * ```
 *
 * The recorder relies on the handle's `flush()` after every send so
 * the snapshot in `stop()` reflects the drained-message-queue state.
 * For long-running async effects, snapshot only fires after the
 * synchronous reducer cycles complete; subsequent commits from
 * effect responses won't be captured. Apps that need full async
 * coverage can manually call `await handle.flush()` plus a microtask
 * sleep before `stop()`, or wrap individual sends in
 * `await new Promise(r => setTimeout(r, 0))` between them.
 */
export function recordAgentSession(handle: AppHandle): AgentSessionRecorder {
  const initialState = handle.getState()
  const msgs: AgentSessionFixture['msgs'] = []
  let stopped = false

  return {
    send(msg) {
      if (stopped) throw new Error('[agent-session] send() called after stop()')
      msgs.push(msg)
      handle.send(msg)
      handle.flush()
    },
    stop(): AgentSessionFixture {
      if (stopped) throw new Error('[agent-session] stop() called twice')
      stopped = true
      return {
        initialState,
        msgs,
        finalState: handle.getState(),
      }
    },
  }
}

/**
 * Replay a previously-recorded session against a fresh `handle`.
 * Dispatches each msg in order, snapshots state after the last one,
 * and compares to `fixture.finalState`. Returns:
 *
 *   - `matches: true`           — bit-exact replay; nothing changed.
 *   - `matches: false, diff`   — final state differs; `diff` lists the
 *     paths that diverged in the same JSON-Patch shape as
 *     `send_message`'s `stateDiff`. Use it in test assertions:
 *     `expect(result.diff).toEqual([])`.
 *
 * The harness deliberately ignores the `initialState` half of the
 * fixture by default — replay starts from whatever the new handle's
 * `init()` produced, so apps with deterministic init don't need to
 * carry their initial state around in source control. Pass
 * `assertInitial: true` to also enforce that the initial states
 * match; useful when a test wants to catch init-effect drift.
 */
export interface ReplayResult {
  matches: boolean
  /**
   * Diff from fixture.finalState to the replay's actual final state.
   * Empty when `matches: true`. Empty when `matches: false` only if
   * the divergence was at the `initialState` level and `assertInitial`
   * was true.
   */
  diff: Array<{ op: 'add' | 'remove' | 'replace'; path: string; value?: unknown }>
}

export interface ReplayOptions {
  /**
   * When true, also assert that the new handle's initial state
   * matches `fixture.initialState`. Defaults to false — most apps
   * have deterministic init, but ones that read time / random /
   * environment shouldn't enforce this.
   */
  assertInitial?: boolean
}

export function replayAgentSession(
  handle: AppHandle,
  fixture: AgentSessionFixture,
  options: ReplayOptions = {},
): ReplayResult {
  if (options.assertInitial === true) {
    const initialDiff = simpleDiff(fixture.initialState, handle.getState())
    if (initialDiff.length > 0) {
      return { matches: false, diff: initialDiff }
    }
  }
  for (const msg of fixture.msgs) {
    handle.send(msg)
    handle.flush()
  }
  const actualFinal = handle.getState()
  const diff = simpleDiff(fixture.finalState, actualFinal)
  return { matches: diff.length === 0, diff }
}

/**
 * Local copy of the JSON-Patch diff algorithm. Duplicated rather
 * than imported from `@llui/agent` to avoid a runtime dependency
 * cycle: `@llui/test` is small and core, agent is an optional
 * package, and we don't want test fixtures to drag agent code in.
 *
 * If `@llui/agent`'s `computeStateDiff` ever changes shape, this
 * needs to track. Tests that assert exact diff content will catch
 * the drift; the contract surface is small (3 ops × {add, remove,
 * replace}) and stable.
 */
function simpleDiff(prev: unknown, next: unknown): ReplayResult['diff'] {
  const ops: ReplayResult['diff'] = []
  walk(prev, next, '', ops)
  return ops
}

function walk(prev: unknown, next: unknown, base: string, ops: ReplayResult['diff']): void {
  if (Object.is(prev, next)) return
  if (
    prev === null ||
    next === null ||
    prev === undefined ||
    next === undefined ||
    typeof prev !== 'object' ||
    typeof next !== 'object'
  ) {
    ops.push({ op: 'replace', path: base, value: next })
    return
  }
  const prevIsArr = Array.isArray(prev)
  const nextIsArr = Array.isArray(next)
  if (prevIsArr !== nextIsArr) {
    ops.push({ op: 'replace', path: base, value: next })
    return
  }
  if (prevIsArr && nextIsArr) {
    const minLen = Math.min(prev.length, next.length)
    for (let i = 0; i < minLen; i++) walk(prev[i], next[i], `${base}/${i}`, ops)
    if (prev.length > next.length) {
      for (let i = prev.length - 1; i >= next.length; i--) {
        ops.push({ op: 'remove', path: `${base}/${i}` })
      }
    }
    if (next.length > prev.length) {
      for (let i = prev.length; i < next.length; i++) {
        ops.push({ op: 'add', path: `${base}/${i}`, value: next[i] })
      }
    }
    return
  }
  const a = prev as Record<string, unknown>
  const b = next as Record<string, unknown>
  for (const k in a) {
    if (!(k in b)) ops.push({ op: 'remove', path: `${base}/${escapeSeg(k)}` })
  }
  for (const k in b) {
    const path = `${base}/${escapeSeg(k)}`
    if (!(k in a)) ops.push({ op: 'add', path, value: b[k] })
    else walk(a[k], b[k], path, ops)
  }
}

function escapeSeg(s: string): string {
  return s.replace(/~/g, '~0').replace(/\//g, '~1')
}
