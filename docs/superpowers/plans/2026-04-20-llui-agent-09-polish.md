# LLui Agent — Plan 9 of 9: Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Close the gaps deferred through Plans 1-8. After this plan, the LLui Agent epic is v1-complete: users can install `llui-agent`, developers can ship apps with `@llui/agent`, Claude Desktop can drive them end-to-end including `wait_for_change` long-poll semantics, and the author ergonomics (lint + docs) are in place.

**Scope:**
- Runtime **state-change subscription** in `@llui/dom` → emit `state-update` frames so `/lap/v1/wait` actually resolves.
- `log-append` frame emission from ws-client for every rpc dispatch (mirrors to audit sink server-side).
- Server-side rate-limit application inside LAP handlers.
- Three `@llui/lint-idiomatic` rules for agent annotations.
- Host-app integration docs: updated `@llui/agent` README + `docs/designs/10 Agent Protocol.md`.
- Updated `docs/designs/09 API Reference.md`.

**Non-goals for this plan:**
- Playwright-based E2E test across real browser + real MCP client. Significant infra; track as follow-up.
- `examples/agent-demo/` scaffolded app. Defer — the README snippet is enough for v1.
- Bridge `--http` transport, `--doctor`, persistent bindings. Already marked deferred in earlier plans.

---

## File Structure

```
packages/dom/src/
  types.ts             — AppHandle gains subscribe()
  mount.ts             — listener set + emit after every update cycle
packages/dom/test/
  subscribe.test.ts    — verify subscribe fires correctly

packages/agent/src/client/
  ws-client.ts         — emit state-update + log-append frames
  factory.ts           — wire up handle.subscribe

packages/agent/src/server/lap/
  forward.ts           — apply rateLimiter.check before forwarding
  message.ts           — apply rateLimiter.check
  wait.ts              — apply rateLimiter.check
  confirm-result.ts    — apply rateLimiter.check

packages/lint-idiomatic/src/
  rules/agent-intent.ts             — missing @intent
  rules/agent-exclusive-tags.ts     — humanOnly combined with others
  rules/agent-handler-pattern.ts    — non-extractable send() call

packages/agent/README.md                            — fuller integration docs
docs/designs/10 Agent Protocol.md                   — new
docs/designs/09 API Reference.md                    — append agent exports
```

---

## Task 1: `@llui/dom` AppHandle.subscribe

**Files:**
- Modify: `packages/dom/src/types.ts`
- Modify: `packages/dom/src/mount.ts`
- Create: `packages/dom/test/subscribe.test.ts`

### 1a — Extend the `AppHandle` interface

In `packages/dom/src/types.ts`, find the `AppHandle` interface (around line 175-217):

```ts
export interface AppHandle {
  dispose(): void
  flush(): void
  send(msg: unknown): void
  getState(): unknown
  /**
   * Register a listener called synchronously after every update cycle
   * completes. The listener receives the NEW state. Returns an
   * unsubscribe function. Safe after dispose (no-op; returns a no-op
   * unsubscribe). See agent spec §10.5 (state-update frames).
   */
  subscribe(listener: (state: unknown) => void): () => void
}
```

### 1b — Wire the listener set in `mount.ts`

Find `mountApp`'s implementation (the function returning `AppHandle`). Add a `listeners: Set<Listener>` in scope; return a `subscribe` method that adds/removes from it. Find where the update loop settles (where new state becomes current) and iterate listeners there.

The exact hook location depends on internal structure. Likely somewhere in the update-loop/runtime module a `commit(newState)` is called — add `for (const l of listeners) l(newState)` immediately after. If the update loop is in `packages/dom/src/update-loop.ts` or similar, this change may span two files.

Read the existing `mountApp` body to find the state-commit point. If uncertain, check `packages/dom/src/runtime.ts` or `packages/dom/src/update-loop.ts`. Add a listener-notification helper that the runtime calls.

Guard: listeners added DURING a notification should not fire until the NEXT commit (classic observer pitfall). Snapshot the list before iterating.

Also: call listeners with the POST-update state; do NOT call them for the initial mount (subscribers weren't registered yet). Do NOT call after `dispose()` — clear the set in `dispose()`.

### 1c — Test

```ts
import { describe, it, expect } from 'vitest'
import { mountApp, component } from '../src/index.js'

type S = { n: number }
type M = { type: 'inc' } | { type: 'set'; value: number }

const Counter = component<S, M, never>({
  name: 'Counter',
  init: () => [{ n: 0 }, []],
  update: (s, m) => {
    switch (m.type) {
      case 'inc': return [{ ...s, n: s.n + 1 }, []]
      case 'set': return [{ ...s, n: m.value }, []]
    }
  },
  view: () => [],
})

describe('AppHandle.subscribe', () => {
  it('fires after a send-driven update with the new state', () => {
    const root = document.createElement('div')
    const handle = mountApp(root, Counter)
    const seen: unknown[] = []
    handle.subscribe((s) => seen.push(s))
    handle.send({ type: 'inc' })
    handle.flush()
    expect(seen).toEqual([{ n: 1 }])
    handle.dispose()
  })

  it('returns an unsubscribe that stops further notifications', () => {
    const root = document.createElement('div')
    const handle = mountApp(root, Counter)
    const seen: unknown[] = []
    const off = handle.subscribe((s) => seen.push(s))
    handle.send({ type: 'inc' })
    handle.flush()
    off()
    handle.send({ type: 'inc' })
    handle.flush()
    expect(seen).toEqual([{ n: 1 }])
    handle.dispose()
  })

  it('does not fire for the initial mount', () => {
    const root = document.createElement('div')
    const handle = mountApp(root, Counter)
    const seen: unknown[] = []
    handle.subscribe((s) => seen.push(s))
    // No send yet — listener should not have fired.
    expect(seen).toEqual([])
    handle.dispose()
  })

  it('is a no-op after dispose', () => {
    const root = document.createElement('div')
    const handle = mountApp(root, Counter)
    const seen: unknown[] = []
    handle.subscribe((s) => seen.push(s))
    handle.dispose()
    // send after dispose should no-op, including notifications
    handle.send({ type: 'inc' })
    expect(seen).toEqual([])
  })

  it('supports multiple listeners', () => {
    const root = document.createElement('div')
    const handle = mountApp(root, Counter)
    const a: unknown[] = []
    const b: unknown[] = []
    handle.subscribe((s) => a.push(s))
    handle.subscribe((s) => b.push(s))
    handle.send({ type: 'set', value: 5 })
    handle.flush()
    expect(a).toEqual([{ n: 5 }])
    expect(b).toEqual([{ n: 5 }])
    handle.dispose()
  })
})
```

Run:
```bash
cd packages/dom && pnpm vitest run test/subscribe.test.ts
cd packages/dom && pnpm check
```

Commit:
```
feat(dom): AppHandle.subscribe — post-update state-change listener

Registers a callback fired synchronously after every update cycle
commits new state. Returns an unsubscribe. Used by @llui/agent/client
to emit state-update frames for /lap/v1/wait long-polls. See agent
spec §10.5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Task 2: Wire state-update + log-append in `@llui/agent/client`

**Files:**
- Modify: `packages/agent/src/client/ws-client.ts`
- Modify: `packages/agent/src/client/factory.ts`
- Modify: `packages/agent/test/client/ws-client.test.ts`

### 2a — ws-client emits state-update + log-append

Add two new methods to the `WsClient` return shape:

```ts
export type WsClient = {
  resolveConfirm(confirmId: string, outcome: 'confirmed' | 'user-cancelled', stateAfter?: unknown): void
  emitStateUpdate(path: string, stateAfter: unknown): void
  emitLogAppend(entry: import('../protocol.js').LogEntry): void
  close(): void
}
```

Implementations are one-liners that send the respective `ClientFrame` variant.

### 2b — factory subscribes to handle.subscribe

In `createAgentClient`, after construction:
```ts
const unsub = opts.handle.subscribe((state) => {
  wsClient?.emitStateUpdate('/', state)
})
```

Also on `stop()`: `unsub()` + `confirmPollTimer` cleanup.

For `log-append`: wrap the rpc dispatcher in ws-client to emit a log-append after every successful/failed rpc — tool name + timestamp + status. Derive `LogKind` from the result (`dispatched`/`rejected` for send_message; `read` for query tools; `error` on rpc-error reply).

### 2c — Tests

Extend `ws-client.test.ts` with:
- `emitStateUpdate('/', state)` sends a `state-update` frame
- `emitLogAppend(entry)` sends a `log-append` frame
- After dispatching get_state successfully, a log-append frame is sent with `kind: 'read'`

Commit:
```
feat(agent): state-update + log-append frame emission in ws-client

Factory now subscribes to AppHandle.subscribe and emits state-update
frames on every commit. Every rpc dispatch also emits a log-append
frame for server-side audit mirroring. Closes Plan 7 deferred items.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Task 3: log-append → audit mirror on the server

**Files:**
- Modify: `packages/agent/src/server/ws/pairing-registry.ts`

The registry's `handleClientFrame` currently skips `log-append`. Route it to the audit sink:

```ts
case 'log-append': {
  if (this.onLogAppend) {
    this.onLogAppend(tid, frame.entry)
  }
  break
}
```

Add a constructor option:
```ts
constructor(opts: { now?: () => number; onLogAppend?: (tid: string, entry: LogEntry) => void } = {}) {
  this.now = opts.now ?? (() => Date.now())
  this.onLogAppend = opts.onLogAppend ?? null
}
```

In the factory (`src/server/factory.ts`), construct the registry with:
```ts
const registry = new WsPairingRegistry({
  onLogAppend: (tid, entry) => {
    auditSink.write({
      at: entry.at,
      tid,
      uid: null,  // server-side we don't re-resolve uid for each frame; log carries its own kind
      event: 'lap-call',
      detail: { source: 'client-log', kind: entry.kind, variant: entry.variant, intent: entry.intent },
    })
  },
})
```

Add a test to `packages/agent/test/server/ws/pairing-registry.test.ts`:
- Emit a `log-append` frame; verify `onLogAppend` was called with `(tid, entry)`.

Commit:
```
feat(agent): log-append frames → audit sink mirror

Server-side registry optionally forwards log-append client frames
to an onLogAppend callback; the factory wires it to the audit sink
so client-observed actions are captured alongside server-observed
ones. Spec §9.3 completes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Task 4: Rate-limit application in LAP handlers

**Files:**
- Modify: `packages/agent/src/server/lap/forward.ts`, `message.ts`, `wait.ts`, `confirm-result.ts`
- Modify: `packages/agent/src/server/lap/router.ts` and `factory.ts` to pass `rateLimiter` through

Extend the common `ForwardDeps` (and ad-hoc `LapMessageDeps`, `LapWaitDeps`, `LapConfirmResultDeps`) to accept `rateLimiter: RateLimiter`. Before forwarding the rpc, call:

```ts
const check = await deps.rateLimiter.check(auth.tid, 'token')
if (!check.allowed) {
  return json(
    { error: { code: 'rate-limited', retryAfterMs: check.retryAfterMs } },
    429,
  )
}
```

Wire `rateLimiter` through `createLapRouter` and the factory. The factory already constructs a `defaultRateLimiter` — pass it into the LAP deps.

Add regression tests — one each — that triggers the rate limit and asserts 429 + `retryAfterMs`.

Commit:
```
feat(agent): apply rate limiter inside LAP handlers

Each LAP dispatch checks rateLimiter.check(tid, 'token') before
forwarding. Exceeded → 429 with retryAfterMs. Default 30/minute per
token. Spec §6.6, §10.4 step 7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

## Task 5: Lint rule — missing @intent

**Files:**
- Create: `packages/lint-idiomatic/src/rules/agent-intent.ts`
- Create: `packages/lint-idiomatic/test/rules/agent-intent.test.ts`
- Modify: the lint-idiomatic package entry to register the rule (look at existing rules for the registration pattern)

Scope: warn when a Msg union variant has no JSDoc `@intent("...")` tag. Use the same extractor approach as `@llui/vite-plugin/src/msg-annotations.ts` — read the TypeScript AST, find union members, check for `@intent`.

Rule output: one diagnostic per variant missing `@intent`, at the variant's position, with severity `warning`, rule code `agent-missing-intent`.

Tests: file with 3 annotated, 1 unannotated → 1 diagnostic. File with no Msg → 0 diagnostics. File with non-object variants → skipped.

Commit:
```
feat(lint-idiomatic): rule agent-missing-intent

Warns when a Msg union variant lacks a JSDoc @intent("..."). Falls
back to a synthesized intent at runtime; the lint catches authoring
drift before the agent surface becomes opaque.
```

---

## Task 6: Lint rule — forbidden annotation combinations

**Files:**
- Create: `packages/lint-idiomatic/src/rules/agent-exclusive-tags.ts`
- Create: `packages/lint-idiomatic/test/rules/agent-exclusive-tags.test.ts`

Scope: `@humanOnly` is mutually exclusive with `@requiresConfirm` and `@alwaysAffordable`. Warn when both appear on the same variant. Severity: warning; rule code `agent-exclusive-annotations`.

Commit:
```
feat(lint-idiomatic): rule agent-exclusive-annotations

@humanOnly dominates — combining with @requiresConfirm or
@alwaysAffordable is redundant and often a mistake.
```

---

## Task 7: Lint rule — non-extractable send() handler

**Files:**
- Create: `packages/lint-idiomatic/src/rules/agent-handler-pattern.ts`
- Create: `packages/lint-idiomatic/test/rules/agent-handler-pattern.test.ts`

Scope: find any `send(...)` call inside a component view whose first argument is NOT an object literal with a string-literal `type` field. These aren't picked up by `__bindingDescriptors` extraction, so the agent's `list_actions` won't advertise them. Warn; rule code `agent-nonextractable-handler`.

Uses the same walker as `@llui/vite-plugin/src/binding-descriptors.ts`, but flips: emit a diagnostic when a call looks send-like but doesn't match.

Commit:
```
feat(lint-idiomatic): rule agent-nonextractable-handler

Flags send({type: dynamicVar}) or send(nonObject) call sites in
views — these aren't registered in __bindingDescriptors, so Claude
won't know about them. Authors get a warning with the enclosing
component name.
```

---

## Task 8: Host-app integration docs — `@llui/agent` README

**Files:**
- Modify: `packages/agent/README.md`

Current README is a placeholder. Replace with:

```markdown
# @llui/agent

Server and browser-client libraries for the [LLui Agent Protocol (LAP)](../../docs/superpowers/specs/2026-04-19-llui-agent-design.md).

## What this buys you

Your app's users can install the `llui-agent` bridge into Claude Desktop once, paste a token you mint for them, and drive your LLui app from Claude. Same Msgs and State you're already using — Claude dispatches like a remote user.

## Install

```bash
pnpm add @llui/agent @llui/effects ws
pnpm add -D @llui/vite-plugin  # if not already present
```

Enable agent-metadata emission in `vite.config.ts`:

```ts
import llui from '@llui/vite-plugin'
export default { plugins: [llui({ agent: true })] }
```

## Server

```ts
import { createLluiAgentServer } from '@llui/agent/server'
import express from 'express'

const agent = createLluiAgentServer({
  signingKey: process.env.LLUI_AGENT_KEY!,
  identityResolver: async (req) => req.cookies.user_id ?? null,
})

const app = express()
// The router is Web-standards; adapt it:
app.use('/agent', async (req, res) => {
  const webReq = expressToWebRequest(req)  // adapter
  const webRes = await agent.router(webReq)
  if (!webRes) { res.status(404).end(); return }
  webRes.headers.forEach((v, k) => res.setHeader(k, v))
  res.status(webRes.status).send(await webRes.text())
})

const server = app.listen(8787)
server.on('upgrade', agent.wsUpgrade)
```

## Client

```ts
import { mountApp } from '@llui/dom'
import { createAgentClient, agentConnect, agentConfirm, agentLog } from '@llui/agent/client'
import { handleEffects } from '@llui/effects'
import { App } from './App'

const root = document.getElementById('app')!
const handle = mountApp(root, App)

const client = createAgentClient({
  handle,
  def: App,
  rootElement: root,
  slices: {
    getConnect: (s) => s.agent.connect,
    getConfirm: (s) => s.agent.confirm,
    wrapConnectMsg: (m) => ({ type: 'agent', sub: 'connect', msg: m }),
    wrapConfirmMsg: (m) => ({ type: 'agent', sub: 'confirm', msg: m }),
  },
})
client.start()

// Chain client.effectHandler into your onEffect:
const onEffect = handleEffects<MyEffect | AgentEffect>()
  .when('http', ...)
  .else(client.effectHandler)
```

## App-side annotations

```ts
type Msg =
  /** @intent("Increment the counter") */
  | { type: 'inc' }
  /** @intent("Delete item") @requiresConfirm */
  | { type: 'delete', id: string }
  /** @intent("Place order") @humanOnly */
  | { type: 'checkout' }
  /** @intent("Navigate") @alwaysAffordable */
  | { type: 'nav', to: 'reports' | 'settings' | 'home' }

export const App = component<State, Msg, Effect>({
  name: 'App',
  init: ...,
  update: ...,
  view: ...,
  agentAffordances: (state) => [
    { type: 'nav', to: 'reports' },
    ...(state.user ? [{ type: 'signOut' }] : []),
  ],
  agentDocs: {
    purpose: 'Kanban for a 3-person design team.',
    overview: 'Columns: To do / Doing / Done. Cards carry owner, due date, tags.',
    cautions: ['Moving to Done locks edits — reopen first.'],
  },
  agentContext: (state) => ({
    summary: `Viewing board "${state.boardName}", ${state.cards.length} cards visible.`,
    hints: state.selectedCard
      ? ['Card focused; enter advances status.']
      : ['Tab to list, arrow to select.'],
  }),
})
```

## Annotations reference

| Tag                  | Semantics                                                                  |
| -------------------- | -------------------------------------------------------------------------- |
| `@intent("...")`     | Human-readable label for Claude + confirmation UI + log                   |
| `@alwaysAffordable`  | Surfaces to Claude even when no binding is currently visible              |
| `@requiresConfirm`   | Claude must propose; user approves before dispatch                        |
| `@humanOnly`         | Claude cannot dispatch; not in `list_actions`                             |

See the [design spec](../../docs/superpowers/specs/2026-04-19-llui-agent-design.md) and [Agent Protocol doc](../../docs/designs/10%20Agent%20Protocol.md).
```

Commit:
```
docs(agent): README with full host-app integration guide
```

---

## Task 9: `docs/designs/10 Agent Protocol.md`

**Files:**
- Create: `docs/designs/10 Agent Protocol.md`

Cover:
- Topology overview (Claude → bridge → server → browser)
- LAP endpoint catalog (copy from spec §7.1)
- WS frame types (ClientFrame, ServerFrame — condensed)
- Token format + security model
- Resume flow state diagram
- Rate limiting
- Threat model: what a malicious Claude can/can't do, what a malicious developer can/can't do

Target: ~500 lines. Reuse content from the design spec where appropriate; this doc is the authoritative implementation reference.

Commit:
```
docs(designs): 10 Agent Protocol — implementation reference doc
```

---

## Task 10: Update `docs/designs/09 API Reference.md`

**Files:**
- Modify: `docs/designs/09 API Reference.md`

Append a section for the agent packages. Cover the public exports:

- `@llui/agent/protocol` — all type exports (LAP types, frames, tokens, audit, docs)
- `@llui/agent/server` — `createLluiAgentServer`, `ServerOptions`, `AgentServerHandle`, interfaces + reference impls
- `@llui/agent/client` — `createAgentClient`, `agentConnect`, `agentConfirm`, `agentLog`, `AgentEffect`
- `llui-agent` — CLI (not programmatically imported, but listed for completeness)
- New `LluiPluginOptions.agent`
- New `ComponentDef.agentAffordances`, `agentDocs`, `agentContext`
- New `AppHandle.subscribe`

Commit:
```
docs(designs): update 09 API Reference with agent exports
```

---

## Task 11: Workspace verify

```bash
cd /Users/franco/projects/llui
pnpm install
pnpm turbo build
pnpm turbo check
pnpm turbo lint
pnpm turbo test
```

All green. Confirm `@llui/dom` gains ~5 tests, `@llui/agent` gains ~10 tests, `@llui/lint-idiomatic` gains ~15 tests. Total ~30 new tests across the plan.

No commit.

---

## Task 12: Plan commit + epic wrap-up

Commit the plan file:
```
docs(agent): Plan 9 polish — implementation plan document

Closes deferred items from Plans 1-8: runtime state subscription,
state-update + log-append frame emission, rate-limit application,
three lint rules, host-app docs, full protocol design doc, updated
API reference.

Completes the LLui Agent v1 implementation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Then produce an epic-completion summary (stdout, no commit):
- Total commits across the 9 plans
- Total test count in each package
- List of public exports per package
- Known deferred items (Playwright E2E, examples/agent-demo, bridge --http/--doctor, stateful bindings)

---

## Completion Criteria

- `AppHandle.subscribe` exists; state-update frames flow end-to-end.
- `/lap/v1/wait` long-poll resolves when browser state changes.
- `log-append` mirrors to audit sink.
- Rate limit enforced on LAP dispatches; 429 responses on burst.
- Three new lint rules active in `@llui/lint-idiomatic`.
- `@llui/agent` README has full integration guide.
- `docs/designs/10 Agent Protocol.md` exists.
- `docs/designs/09 API Reference.md` has agent section.
- Workspace turbo green.
