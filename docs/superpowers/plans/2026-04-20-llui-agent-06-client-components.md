# LLui Agent — Plan 6 of 9: Client Headless Components

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `@llui/agent/client`'s three headless state-machine components — `agentConnect`, `agentConfirm`, `agentLog` — following the `@llui/components` convention (`init` / `update` / `connect`). Also define the `AgentEffect` union (effect handler wiring lands in Plan 7 alongside the WS client).

**Architecture:** One file per component (matching the dialog.ts pattern). Pure reducers — updates never return effects for the component state itself. External side effects (network calls from agentConnect) are signalled via the `AgentEffect` union and handled in Plan 7. Connect helpers return prop bags with pre-wired `onClick` handlers that close over the parent's `send`.

**Tech Stack:** `@llui/dom` types, vitest, existing `@llui/components` patterns.

**Spec section coverage after this plan:** §9.1 agentConnect, §9.2 agentConfirm, §9.3 agentLog, §9.5 (AgentEffect union only — handler in Plan 7).

Deferred to Plan 7: `@llui/agent/client/ws-client.ts` (the WebSocket client that consumes these components + drives the browser-side rpc handlers), `effects` handler, integration with app state.

---

## File Structure

```
packages/agent/src/client/
  index.ts                    — public entry (already a shell from Plan 1; replace)
  agentConnect.ts             — state/msgs/init/update/connect + types
  agentConfirm.ts             — state/msgs/init/update/connect + types
  agentLog.ts                 — state/msgs/init/update/connect + types
  effects.ts                  — AgentEffect union (handler in Plan 7)

packages/agent/test/client/
  agentConnect.test.ts
  agentConfirm.test.ts
  agentLog.test.ts
```

Reference: mirror `packages/components/src/components/dialog.ts` structure — single file per component, typed `State`/`Msg`, `init()`, `update(state, msg): [State, never[]]`, `connect<S>(get, send, opts): Parts`.

---

## Task 1: agentConnect — failing tests

**Files:**

- Create: `packages/agent/test/client/agentConnect.test.ts`

Minimum test coverage (write comprehensively; 10+ cases):

- `init` yields the idle state with empty sessions/resumable.
- `Mint` transitions `idle → minting`, emits an `AgentMintRequest` effect.
- `MintSucceeded` populates `pendingToken` (token, tid, lapUrl, derived `connectSnippet`), transitions to `pending-claude`, emits an `AgentOpenWS` effect with `{token, wsUrl}`.
- `MintFailed(err)` transitions to `error` with the error payload; emits no effect.
- `WsOpened` transitions `pending-claude → active`.
- `WsClosed` transitions `active → idle` (pending token cleared).
- `ResumeList(tids)` emits `AgentResumeCheck` with the tids.
- `ResumeListLoaded(sessions)` populates `resumable`.
- `Resume(tid)` emits `AgentResumeClaim` for that tid.
- `Revoke(tid)` emits `AgentRevoke` for that tid; also optimistically removes the tid from `sessions` (keeps UI snappy).
- `RefreshSessions` emits `AgentSessionsList`.
- `SessionsLoaded(sessions)` replaces `sessions`.
- `ClearError` nulls out `error`.

Use inline fixtures:

```ts
const token = 'llui-agent_abc.def'
const tid = '11111111-1111-1111-1111-111111111111'
const lapUrl = 'https://app.example/agent/lap/v1'
const wsUrl = 'wss://app.example/agent/ws'
const expiresAt = 9_999_999_999
```

The effect assertions compare against `AgentEffect` shapes (see Task 7). Since effects.ts doesn't exist yet, the test imports cascade: write tests against `../../src/client/effects.js` types and expect the TDD cycle to fail on missing module until Tasks 2 + 7 land.

Actually simpler: for this task, assume effects.ts lands TOGETHER with agentConnect (Task 2). Tests import from `../../src/client/agentConnect.js` and from `../../src/client/effects.js`. Both files get created in Task 2.

- [ ] **Step 1: Write the test file** (your judgment on exact assertions; hit every Msg above). See spec §9.1 for the exact state/msg shapes.

- [ ] **Step 2: Run — expect FAIL**

```bash
cd packages/agent && pnpm vitest run test/client/agentConnect.test.ts
```

---

## Task 2: agentConnect — implementation + effects.ts

**Files:**

- Create: `packages/agent/src/client/agentConnect.ts`
- Create: `packages/agent/src/client/effects.ts`

### effects.ts

```ts
import type { AgentSession, AgentToken } from '../protocol.js'

export type AgentEffect =
  | { type: 'AgentMintRequest'; mintUrl: string }
  | { type: 'AgentOpenWS'; token: AgentToken; wsUrl: string }
  | { type: 'AgentCloseWS' }
  | { type: 'AgentResumeCheck'; tids: string[] }
  | { type: 'AgentResumeClaim'; tid: string }
  | { type: 'AgentRevoke'; tid: string }
  | { type: 'AgentSessionsList' }

// Handler implementation lands in Plan 7 alongside the WS client.
export type AgentEffectHandler = (effect: AgentEffect) => Promise<void>
```

### agentConnect.ts

```ts
import type { AgentSession, AgentToken } from '../protocol.js'
import type { AgentEffect } from './effects.js'

export type AgentConnectStatus = 'idle' | 'minting' | 'pending-claude' | 'active' | 'error'

export type AgentConnectPendingToken = {
  token: AgentToken
  tid: string
  lapUrl: string
  connectSnippet: string // "/llui-connect <lapUrl> <token>"
  expiresAt: number
}

export type AgentConnectState = {
  status: AgentConnectStatus
  pendingToken: AgentConnectPendingToken | null
  sessions: AgentSession[]
  resumable: AgentSession[]
  error: { code: string; detail: string } | null
}

export type AgentConnectMsg =
  | { type: 'Mint' }
  | {
      type: 'MintSucceeded'
      token: AgentToken
      tid: string
      lapUrl: string
      wsUrl: string
      expiresAt: number
    }
  | { type: 'MintFailed'; error: { code: string; detail: string } }
  | { type: 'WsOpened' }
  | { type: 'WsClosed' }
  | { type: 'ResumeList'; tids: string[] }
  | { type: 'ResumeListLoaded'; sessions: AgentSession[] }
  | { type: 'Resume'; tid: string }
  | { type: 'Revoke'; tid: string }
  | { type: 'ClearError' }
  | { type: 'SessionsLoaded'; sessions: AgentSession[] }
  | { type: 'RefreshSessions' }

export type AgentConnectInitOpts = { mintUrl: string }

/** Component shape is [State, Effect[]] — consistent with @llui/components. */
export function init(_opts: AgentConnectInitOpts): [AgentConnectState, AgentEffect[]] {
  return [
    {
      status: 'idle',
      pendingToken: null,
      sessions: [],
      resumable: [],
      error: null,
    },
    [],
  ]
}

export function update(
  state: AgentConnectState,
  msg: AgentConnectMsg,
  opts: AgentConnectInitOpts,
): [AgentConnectState, AgentEffect[]] {
  switch (msg.type) {
    case 'Mint':
      return [
        { ...state, status: 'minting' },
        [{ type: 'AgentMintRequest', mintUrl: opts.mintUrl }],
      ]
    case 'MintSucceeded': {
      const pending: AgentConnectPendingToken = {
        token: msg.token,
        tid: msg.tid,
        lapUrl: msg.lapUrl,
        connectSnippet: `/llui-connect ${msg.lapUrl} ${msg.token}`,
        expiresAt: msg.expiresAt,
      }
      return [
        { ...state, status: 'pending-claude', pendingToken: pending, error: null },
        [{ type: 'AgentOpenWS', token: msg.token, wsUrl: msg.wsUrl }],
      ]
    }
    case 'MintFailed':
      return [{ ...state, status: 'error', error: msg.error }, []]
    case 'WsOpened':
      return [{ ...state, status: 'active' }, []]
    case 'WsClosed':
      return [{ ...state, status: 'idle', pendingToken: null }, []]
    case 'ResumeList':
      return [state, [{ type: 'AgentResumeCheck', tids: msg.tids }]]
    case 'ResumeListLoaded':
      return [{ ...state, resumable: msg.sessions }, []]
    case 'Resume':
      return [state, [{ type: 'AgentResumeClaim', tid: msg.tid }]]
    case 'Revoke': {
      // Optimistically remove from sessions + resumable.
      return [
        {
          ...state,
          sessions: state.sessions.filter((s) => s.tid !== msg.tid),
          resumable: state.resumable.filter((s) => s.tid !== msg.tid),
        },
        [{ type: 'AgentRevoke', tid: msg.tid }],
      ]
    }
    case 'ClearError':
      return [{ ...state, error: null }, []]
    case 'SessionsLoaded':
      return [{ ...state, sessions: msg.sessions }, []]
    case 'RefreshSessions':
      return [state, [{ type: 'AgentSessionsList' }]]
  }
}
```

Run tests — expect 13+ passing.

Commit:

```
feat(agent): agentConnect headless component + AgentEffect union

State machine for the user-facing "Connect with Claude" flow: mint
token, pair pending, WS open/close, revoke, resume-list/claim,
sessions refresh. Effects emitted as AgentEffect values; handler
lands in Plan 7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Task 3: agentConnect — connect-helper (prop bags)

Add to the same `agentConnect.ts` file below `update`:

```ts
import { type Send } from '@llui/dom' // or wherever Send<M> lives — check via packages/components for reference

export type AgentConnectConnectOptions = {
  id?: string // optional DOM id prefix
}

type ConnectBag = {
  root: { 'data-scope': string; 'data-state': string }
  mintTrigger: { onClick: () => void; disabled: boolean }
  pendingTokenBox: { 'data-part': string; 'data-visible': boolean }
  copyConnectSnippetButton: { onClick: () => void; disabled: boolean }
  sessionsList: { 'data-part': string }
  sessionItem: (tid: string) => { 'data-part': string; 'data-tid': string }
  revokeButton: (tid: string) => { onClick: () => void }
  resumeBanner: { 'data-part': string; 'data-visible': boolean }
  resumeItem: (tid: string) => { 'data-part': string; 'data-tid': string }
  resumeButton: (tid: string) => { onClick: () => void }
  dismissButton: (tid: string) => { onClick: () => void }
  error: { 'data-part': string; 'data-visible': boolean; onClick: () => void }
}

/**
 * Builds prop bags for the view. See spec §9.1 and the @llui/components
 * dialog.ts pattern.
 */
export function connect<S>(
  get: (s: S) => AgentConnectState,
  send: Send<AgentConnectMsg>,
  _opts: AgentConnectConnectOptions = {},
): (state: S) => ConnectBag {
  return (state) => {
    const s = get(state)
    return {
      root: { 'data-scope': 'agent-connect', 'data-state': s.status },
      mintTrigger: {
        onClick: () => send({ type: 'Mint' }),
        disabled: s.status === 'minting' || s.status === 'pending-claude' || s.status === 'active',
      },
      pendingTokenBox: { 'data-part': 'pending-token', 'data-visible': s.pendingToken !== null },
      copyConnectSnippetButton: {
        onClick: () => {
          if (s.pendingToken && typeof navigator !== 'undefined' && 'clipboard' in navigator) {
            void navigator.clipboard.writeText(s.pendingToken.connectSnippet)
          }
        },
        disabled: s.pendingToken === null,
      },
      sessionsList: { 'data-part': 'sessions-list' },
      sessionItem: (tid) => ({ 'data-part': 'session-item', 'data-tid': tid }),
      revokeButton: (tid) => ({ onClick: () => send({ type: 'Revoke', tid }) }),
      resumeBanner: { 'data-part': 'resume-banner', 'data-visible': s.resumable.length > 0 },
      resumeItem: (tid) => ({ 'data-part': 'resume-item', 'data-tid': tid }),
      resumeButton: (tid) => ({ onClick: () => send({ type: 'Resume', tid }) }),
      dismissButton: (tid) => ({
        // For dismiss, we currently just remove the resumable record locally.
        // A "dismiss forever" flag could land in a follow-up; for v1, dismiss
        // is a client-side-only state prune by reusing the Revoke Msg path
        // with intent-split; for now Emit Revoke which both revokes server-side
        // AND removes locally. Alternative: emit a new DismissResume msg —
        // spec §9.1 lists dismissButton but doesn't spell out the emitted msg.
        // V1 pragmatic choice: same as revoke (mark revoked on server).
        onClick: () => send({ type: 'Revoke', tid }),
      }),
      error: {
        'data-part': 'error',
        'data-visible': s.error !== null,
        onClick: () => send({ type: 'ClearError' }),
      },
    }
  }
}
```

NOTE on `Send<M>`: the exact import path for `Send` in `@llui/dom` — check `packages/dom/src/index.ts` or the components package for precedent. If `Send<M>` is exported from a sub-path, adjust. If it doesn't exist, define a minimal local alias: `type Send<M> = (msg: M) => void`.

Add tests to `agentConnect.test.ts`:

- Connect bag returns a function taking parent state and returning the parts.
- `mintTrigger.onClick` calls `send({type: 'Mint'})`.
- `mintTrigger.disabled` reflects status (true in minting / pending-claude / active, false in idle / error).
- `revokeButton(tid).onClick` dispatches `Revoke` with that tid.
- `error.onClick` dispatches `ClearError`.

Run + commit:

```
feat(agent): agentConnect.connect — prop bags for user-facing UI

Connect helper returns a state-dependent bag of data-part attrs and
pre-wired onClick handlers. Follows @llui/components/dialog.ts
convention. Spec §9.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Task 4: agentConfirm — failing tests + impl

**Files:**

- Create: `packages/agent/test/client/agentConfirm.test.ts`
- Create: `packages/agent/src/client/agentConfirm.ts`

Test coverage: ~8 cases — `Propose` appends; `Approve(id)` marks entry approved + returns the underlying Msg as an output (see note); `Reject(id)` marks rejected; `ExpireStale(now)` drops entries older than a threshold.

### Critical design note — how does Approve dispatch the underlying Msg?

The spec §9.2 says:

> On `Approve`, `agentConfirm.update` emits a side-output naming the original Msg; the root `update` re-dispatches.

This means `update` returns a third slot: a list of "emitted parent msgs." But `@llui/components/dialog.ts` returns `[State, never[]]` — no such slot. Choose one of:

- (a) Use an effect: `Approve` returns `[state, [{ type: 'AgentForwardPayload', payload: entry.payload }]]` where `AgentForwardPayload` is a new effect kind. The effect handler (Plan 7) re-dispatches. **Simpler**.
- (b) Return `[State, AgentEffect[], unknown[]]` — custom triple. Breaks pattern.
- (c) Pass in the root `send` via a closure and dispatch directly from inside `update`. Violates purity.

**Pick (a)** — add to `AgentEffect`:

```ts
| { type: 'AgentForwardMsg'; payload: unknown }
```

The Plan 7 handler calls the app's root `send` with this payload. Clean, testable.

### agentConfirm.ts

```ts
import type { AgentEffect } from './effects.js'

export type ConfirmEntry = {
  id: string
  variant: string
  payload: unknown
  intent: string
  reason: string | null
  proposedAt: number
  status: 'pending' | 'approved' | 'rejected'
}

export type AgentConfirmState = { pending: ConfirmEntry[] }

export type AgentConfirmMsg =
  | { type: 'Propose'; entry: ConfirmEntry }
  | { type: 'Approve'; id: string }
  | { type: 'Reject'; id: string }
  | { type: 'ExpireStale'; now: number; maxAgeMs: number }

export function init(): [AgentConfirmState, AgentEffect[]] {
  return [{ pending: [] }, []]
}

export function update(
  state: AgentConfirmState,
  msg: AgentConfirmMsg,
): [AgentConfirmState, AgentEffect[]] {
  switch (msg.type) {
    case 'Propose':
      return [{ pending: [...state.pending, msg.entry] }, []]
    case 'Approve': {
      const entry = state.pending.find((e) => e.id === msg.id)
      if (!entry || entry.status !== 'pending') return [state, []]
      return [
        { pending: state.pending.map((e) => (e.id === msg.id ? { ...e, status: 'approved' } : e)) },
        [
          {
            type: 'AgentForwardMsg',
            payload: { type: entry.variant, ...(entry.payload as object) },
          },
        ],
      ]
    }
    case 'Reject':
      return [
        { pending: state.pending.map((e) => (e.id === msg.id ? { ...e, status: 'rejected' } : e)) },
        [],
      ]
    case 'ExpireStale':
      return [
        {
          pending: state.pending.filter(
            (e) => msg.now - e.proposedAt <= msg.maxAgeMs || e.status !== 'pending',
          ),
        },
        [],
      ]
  }
}

// Connect bag:
import { type Send } from '@llui/dom'

type ConnectBag = {
  root: { 'data-scope': string }
  entry: (id: string) => {
    card: { 'data-part': string; 'data-status': string; 'data-id': string }
    approveButton: { onClick: () => void; disabled: boolean }
    rejectButton: { onClick: () => void; disabled: boolean }
    intentText: string
    reasonText: string | null
    payloadText: string
  } | null
  empty: { 'data-part': string; 'data-visible': boolean }
}

export function connect<S>(
  get: (s: S) => AgentConfirmState,
  send: Send<AgentConfirmMsg>,
): (state: S) => ConnectBag {
  return (state) => {
    const s = get(state)
    return {
      root: { 'data-scope': 'agent-confirm' },
      entry: (id) => {
        const e = s.pending.find((x) => x.id === id)
        if (!e) return null
        return {
          card: { 'data-part': 'entry', 'data-status': e.status, 'data-id': e.id },
          approveButton: {
            onClick: () => send({ type: 'Approve', id }),
            disabled: e.status !== 'pending',
          },
          rejectButton: {
            onClick: () => send({ type: 'Reject', id }),
            disabled: e.status !== 'pending',
          },
          intentText: e.intent,
          reasonText: e.reason,
          payloadText: JSON.stringify(e.payload, null, 2),
        }
      },
      empty: { 'data-part': 'empty', 'data-visible': s.pending.length === 0 },
    }
  }
}
```

Also update `effects.ts` to add `AgentForwardMsg`:

```ts
export type AgentEffect =
  | { type: 'AgentMintRequest'; mintUrl: string }
  | { type: 'AgentOpenWS'; token: AgentToken; wsUrl: string }
  | { type: 'AgentCloseWS' }
  | { type: 'AgentResumeCheck'; tids: string[] }
  | { type: 'AgentResumeClaim'; tid: string }
  | { type: 'AgentRevoke'; tid: string }
  | { type: 'AgentSessionsList' }
  | { type: 'AgentForwardMsg'; payload: unknown } // NEW
```

Verify + commit.

---

## Task 5: agentLog — TDD + impl

**Files:**

- Create: `packages/agent/test/client/agentLog.test.ts`
- Create: `packages/agent/src/client/agentLog.ts`

### agentLog.ts

```ts
import type { AgentEffect } from './effects.js'
import type { LogEntry, LogKind } from '../protocol.js'

export type AgentLogFilter = { kinds?: LogKind[]; since?: number }

export type AgentLogState = {
  entries: LogEntry[]
  filter: AgentLogFilter
}

export type AgentLogInitOpts = { maxEntries?: number } // default 100

export type AgentLogMsg =
  | { type: 'Append'; entry: LogEntry }
  | { type: 'Clear' }
  | { type: 'SetFilter'; filter: AgentLogFilter }

const DEFAULT_MAX = 100

export function init(_opts: AgentLogInitOpts = {}): [AgentLogState, AgentEffect[]] {
  return [{ entries: [], filter: {} }, []]
}

export function update(
  state: AgentLogState,
  msg: AgentLogMsg,
  opts: AgentLogInitOpts = {},
): [AgentLogState, AgentEffect[]] {
  const max = opts.maxEntries ?? DEFAULT_MAX
  switch (msg.type) {
    case 'Append': {
      const next = [...state.entries, msg.entry]
      // Ring-buffer cap
      if (next.length > max) next.splice(0, next.length - max)
      return [{ ...state, entries: next }, []]
    }
    case 'Clear':
      return [{ ...state, entries: [] }, []]
    case 'SetFilter':
      return [{ ...state, filter: msg.filter }, []]
  }
}

// Connect bag:
import { type Send } from '@llui/dom'

type ConnectBag = {
  root: { 'data-scope': string }
  list: { 'data-part': string; 'data-count': number }
  entryItem: (id: string) => { 'data-part': string; 'data-id': string; 'data-kind': string } | null
  filterControls: {
    clearButton: { onClick: () => void; disabled: boolean }
    setFilter: (filter: AgentLogFilter) => void
  }
  /** Filtered view of entries — respects state.filter. */
  visibleEntries: LogEntry[]
}

export function connect<S>(
  get: (s: S) => AgentLogState,
  send: Send<AgentLogMsg>,
): (state: S) => ConnectBag {
  return (state) => {
    const s = get(state)
    const visible = s.entries.filter((e) => {
      if (s.filter.kinds && !s.filter.kinds.includes(e.kind)) return false
      if (s.filter.since !== undefined && e.at < s.filter.since) return false
      return true
    })
    return {
      root: { 'data-scope': 'agent-log' },
      list: { 'data-part': 'list', 'data-count': visible.length },
      entryItem: (id) => {
        const e = visible.find((x) => x.id === id)
        if (!e) return null
        return { 'data-part': 'entry', 'data-id': e.id, 'data-kind': e.kind }
      },
      filterControls: {
        clearButton: {
          onClick: () => send({ type: 'Clear' }),
          disabled: s.entries.length === 0,
        },
        setFilter: (filter) => send({ type: 'SetFilter', filter }),
      },
      visibleEntries: visible,
    }
  }
}
```

Tests: ~6-8 cases covering Append/Clear/SetFilter, ring buffer cap, filter by kinds, filter by since.

Verify + commit.

---

## Task 6: Update `client/index.ts` entry + small re-exports

**Files:**

- Modify: `packages/agent/src/client/index.ts`

```ts
export * as agentConnect from './agentConnect.js'
export * as agentConfirm from './agentConfirm.js'
export * as agentLog from './agentLog.js'
export type { AgentEffect, AgentEffectHandler } from './effects.js'
```

Commit:

```
feat(agent): client/index.ts re-exports agentConnect / agentConfirm / agentLog

Consumers import via:
  import { agentConnect, agentConfirm, agentLog } from '@llui/agent/client'

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Task 7: Workspace verify + plan commit

```bash
cd /Users/franco/projects/llui
pnpm install
pnpm turbo build
pnpm turbo check
pnpm turbo lint
pnpm turbo test
```

All green. No commit.

Commit the plan file:

```bash
git add docs/superpowers/plans/2026-04-20-llui-agent-06-client-components.md
git commit -m "$(cat <<'COMMIT'
docs(agent): Plan 6 client-components — implementation plan document

7-task plan for @llui/agent/client's headless components:
agentConnect (token mint/resume/revoke UI), agentConfirm (pending-
confirm queue with approve/reject flow), agentLog (ring-buffer of
agent actions), and the AgentEffect union. ws-client + effect
handler deferred to Plan 7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Completion Criteria

- Three components land as `packages/agent/src/client/{agentConnect,agentConfirm,agentLog}.ts`.
- `effects.ts` defines the `AgentEffect` union (8 variants including `AgentForwardMsg` for the agentConfirm → parent re-dispatch path).
- `client/index.ts` namespaces them for import via `import { agentConnect } from '@llui/agent/client'`.
- ~30 new tests across 3 files; all pass.
- Workspace stays green.

---

## Explicitly deferred (Plan 7)

- `ws-client.ts` — WebSocket client that:
  - Opens on `AgentOpenWS` effect, closes on `AgentCloseWS`.
  - Sends the `hello` frame populated from the component def's `__msgSchema` / `__stateSchema` / `__msgAnnotations` / `__schemaHash` / `agentDocs`.
  - Handles incoming `rpc` frames by dispatching per-tool handlers (`get_state` / `send_message` / `list_actions` / `query_dom` / `describe_visible_content` / `describe_context`).
  - Emits `state-update` frames when app state changes.
  - Emits `confirm-resolved` when user resolves entries in `agentConfirm`.
  - Emits `log-append` for audit mirroring.
- `AgentEffectHandler` concrete implementation that wires HTTP fetches for mint/resume/revoke/sessions and WS lifecycle.
- Host-app integration examples + docs.
