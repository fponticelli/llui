# LLui Agent — Plan 7 of 9: Client WS + Effect Handler + Factory

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Wire the three headless components from Plan 6 into a live browser-side agent: HTTP-backed effect handler (mint/resume/revoke/sessions/forward), WebSocket client that speaks the `hello`/`rpc`/`rpc-reply`/`rpc-error`/`confirm-resolved` protocol with the server, browser-side rpc handlers for all 6 LAP tools, and a `createAgentClient(...)` factory the app developer mounts to wire everything together.

**Architecture:** `createAgentClient(handle, def, opts)` receives the `AppHandle` from `mountApp`, the raw `ComponentDef` (to read `__msgAnnotations`, `__bindingDescriptors`, `__schemaHash`, `agentAffordances`, `agentDocs`, `agentContext`), and slice accessors. It returns an effect handler that the developer chains into their `onEffect`, plus a `start()` method. On receiving `AgentOpenWS`, it instantiates a WebSocket, sends a `hello` frame, wires `message` handlers, and begins serving rpc requests. RPC handlers are a flat switch on `tool` name.

**Tech Stack:** Browser `fetch`, browser `WebSocket`, `@llui/dom`'s `AppHandle`, `AgentEffect` union.

**Spec section coverage after this plan:** §6.2 mint flow (client side), §6.3 resume flow (client side), §6.5 revocation (client side), §7.3 transport, §9.4 WS client wiring, §9.5 AgentEffect handler, §9.6 host app integration, §10.5 browser-to-server frames (client side of every variant except `state-update` — see deferred).

**Explicitly deferred:**
- `state-update` frame emission on every state change. The `@llui/dom` runtime doesn't expose a state-change subscription today — adding one is a Plan 9 (polish) task that touches `mountApp`. Without it, `/lap/v1/wait` LAP calls just time out (returning `{status: 'timeout'}`). Claude still gets correct behavior; just no long-poll optimization.
- `log-append` frame mirroring to `agentLog`. Plan 9.
- Host-app integration docs + example app. Plan 9.

---

## File Structure

```
packages/agent/src/client/
  ws-client.ts          — WebSocket wiring, hello frame, rpc dispatch
  effect-handler.ts     — AgentEffect handler (HTTP + WS lifecycle)
  rpc/
    get-state.ts
    send-message.ts     — annotation gating + agentConfirm propose path
    list-actions.ts     — binding descriptors + annotations + agentAffordances
    query-dom.ts
    describe-visible-content.ts
    describe-context.ts
  factory.ts            — createAgentClient({...}) — composes everything
  index.ts              — already re-exports agentConnect/Confirm/Log; append createAgentClient + types

packages/agent/test/client/
  ws-client.test.ts
  effect-handler.test.ts
  rpc/
    get-state.test.ts
    send-message.test.ts
    list-actions.test.ts
    query-dom.test.ts
    describe-visible-content.test.ts
    describe-context.test.ts
  factory.test.ts       — end-to-end integration: real server (via createLluiAgentServer) + real WS
```

---

## Task 1: `get_state` rpc handler (the simplest one)

Starts with the easiest to establish the pattern.

**Files:**
- Create: `packages/agent/src/client/rpc/get-state.ts`
- Create: `packages/agent/test/client/rpc/get-state.test.ts`

### Impl

```ts
export type GetStateArgs = { path?: string }
export type GetStateResult = { state: unknown }
export type GetStateHost = { getState(): unknown }

/**
 * Spec §8.2: get_state returns a JSON-pointer-scoped slice of the
 * app's current state, or the whole root state if no path is given.
 */
export function handleGetState(host: GetStateHost, args: GetStateArgs): GetStateResult {
  const state = host.getState()
  if (!args.path) return { state }
  return { state: resolveJsonPointer(state, args.path) }
}

function resolveJsonPointer(root: unknown, pointer: string): unknown {
  if (pointer === '' || pointer === '/') return root
  // Accept either "/a/b" or "a/b"
  const parts = pointer.split('/').filter((p) => p !== '')
  let cur: unknown = root
  for (const raw of parts) {
    // RFC 6901 escaping: ~1 → /, ~0 → ~
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (cur === null || cur === undefined) return undefined
    if (Array.isArray(cur)) {
      const idx = Number(key)
      if (!Number.isInteger(idx)) return undefined
      cur = cur[idx]
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[key]
    } else {
      return undefined
    }
  }
  return cur
}
```

### Tests (~6 cases)

- no path → full state
- `/count` → state.count
- `/user/name` → nested
- empty string → full state
- missing key → undefined
- array index `/items/0`

Commit:
```
feat(agent): get_state rpc handler with JSON-pointer resolution
```

---

## Task 2: `describe_context` rpc handler

**Files:**
- Create: `packages/agent/src/client/rpc/describe-context.ts`
- Create: `packages/agent/test/client/rpc/describe-context.test.ts`

```ts
import type { AgentContext } from '../../protocol.js'

export type DescribeContextHost = {
  getState(): unknown
  getAgentContext(): ((state: unknown) => AgentContext) | null
}
export type DescribeContextResult = { context: AgentContext }

const EMPTY: AgentContext = { summary: '', hints: [], cautions: [] }

export function handleDescribeContext(host: DescribeContextHost): DescribeContextResult {
  const fn = host.getAgentContext()
  if (!fn) return { context: EMPTY }
  return { context: fn(host.getState()) }
}
```

Tests: ~3 — missing fn returns EMPTY; present fn returns its output; state is passed.

Commit:
```
feat(agent): describe_context rpc handler
```

---

## Task 3: `list_actions` rpc handler

**Files:**
- Create: `packages/agent/src/client/rpc/list-actions.ts`
- Create: `packages/agent/test/client/rpc/list-actions.test.ts`

Combines the component's static `__bindingDescriptors` (from Plan 3) with the dynamic `agentAffordances(state)`, filters out `@humanOnly`, and enriches each entry with intent / requiresConfirm from `__msgAnnotations`.

```ts
import type { MessageAnnotations } from '../../protocol.js'

type Binding = { variant: string }
type Annotations = Record<string, MessageAnnotations>

export type ListActionsHost = {
  getState(): unknown
  getBindingDescriptors(): Binding[] | null
  getMsgAnnotations(): Annotations | null
  getAgentAffordances(): ((state: unknown) => Array<{ type: string; [k: string]: unknown }>) | null
}

export type ListActionsResult = {
  actions: Array<{
    variant: string
    intent: string
    requiresConfirm: boolean
    source: 'binding' | 'always-affordable'
    selectorHint: string | null
    payloadHint: object | null
  }>
}

export function handleListActions(host: ListActionsHost): ListActionsResult {
  const annotations = host.getMsgAnnotations() ?? {}
  const state = host.getState()
  const descriptors = host.getBindingDescriptors() ?? []
  const affordances = host.getAgentAffordances()?.(state) ?? []

  const out: ListActionsResult['actions'] = []

  // From bindings
  for (const d of descriptors) {
    const ann = annotations[d.variant]
    if (ann?.humanOnly) continue
    out.push({
      variant: d.variant,
      intent: ann?.intent ?? d.variant,
      requiresConfirm: ann?.requiresConfirm ?? false,
      source: 'binding',
      selectorHint: null,
      payloadHint: null,
    })
  }

  // From always-affordable
  for (const msg of affordances) {
    const ann = annotations[msg.type]
    if (ann?.humanOnly) continue
    const { type, ...rest } = msg
    out.push({
      variant: type,
      intent: ann?.intent ?? type,
      requiresConfirm: ann?.requiresConfirm ?? false,
      source: 'always-affordable',
      selectorHint: null,
      payloadHint: Object.keys(rest).length > 0 ? rest : null,
    })
  }

  return { actions: out }
}
```

Tests: ~6 cases — empty bindings/affordances, humanOnly filtering, intent fallback, affordances with payload, missing annotations.

Commit:
```
feat(agent): list_actions rpc handler — bindings + affordances + annotations
```

---

## Task 4: `query_dom` + `describe_visible_content`

**Files:**
- Create: `packages/agent/src/client/rpc/query-dom.ts`
- Create: `packages/agent/src/client/rpc/describe-visible-content.ts`
- Create test files.

### query-dom.ts

```ts
export type QueryDomArgs = { name: string; multiple?: boolean }
export type QueryDomResult = {
  elements: Array<{ text: string; attrs: Record<string, string>; path: number[] }>
}

export type QueryDomHost = {
  getRootElement(): Element | null
}

/**
 * Spec §7.7 / §8.2: reads only elements explicitly tagged
 * `data-agent="<name>"`. No full-DOM access in v1.
 */
export function handleQueryDom(host: QueryDomHost, args: QueryDomArgs): QueryDomResult {
  const root = host.getRootElement()
  if (!root) return { elements: [] }
  const selector = `[data-agent="${cssEscape(args.name)}"]`
  const nodes = args.multiple
    ? Array.from(root.querySelectorAll(selector))
    : [root.querySelector(selector)].filter(Boolean) as Element[]

  return {
    elements: nodes.map((n) => ({
      text: (n.textContent ?? '').trim(),
      attrs: Object.fromEntries(Array.from(n.attributes).map((a) => [a.name, a.value])),
      path: computePath(root, n),
    })),
  }
}

function cssEscape(s: string): string {
  // Simple escape for double-quotes; most data-agent names won't need it.
  return s.replace(/"/g, '\\"')
}

function computePath(root: Element, target: Element): number[] {
  const out: number[] = []
  let cur: Element | null = target
  while (cur && cur !== root) {
    const parent = cur.parentElement
    if (!parent) break
    out.unshift(Array.from(parent.children).indexOf(cur))
    cur = parent
  }
  return out
}
```

### describe-visible-content.ts

```ts
import type { OutlineNode } from '../../protocol.js'

export type DescribeVisibleArgs = {}
export type DescribeVisibleResult = { outline: OutlineNode[] }

export type DescribeVisibleHost = {
  getRootElement(): Element | null
  getBindingDescriptors(): Array<{ variant: string }> | null
  getMsgAnnotations(): Record<string, { intent: string | null; humanOnly: boolean }> | null
}

/**
 * Walk data-agent-tagged subtrees and produce a structured outline.
 * Buttons cross-reference __bindingDescriptors so Claude can tie
 * visible text to variant names.
 */
export function handleDescribeVisibleContent(host: DescribeVisibleHost): DescribeVisibleResult {
  const root = host.getRootElement()
  if (!root) return { outline: [] }
  const out: OutlineNode[] = []
  const zones = root.querySelectorAll('[data-agent]')
  for (const zone of Array.from(zones)) {
    walk(zone, out)
  }
  return { outline: out }
}

function walk(el: Element, out: OutlineNode[]): void {
  const tag = el.tagName.toLowerCase()
  const text = (el.textContent ?? '').trim()
  if (/^h[1-6]$/.test(tag)) {
    out.push({ kind: 'heading', level: Number(tag[1]), text })
    return
  }
  if (tag === 'button') {
    out.push({
      kind: 'button',
      text,
      disabled: (el as HTMLButtonElement).disabled,
      actionVariant: el.getAttribute('data-agent') ?? null,
    })
    return
  }
  if (tag === 'a' && el.getAttribute('href')) {
    out.push({ kind: 'link', text, href: el.getAttribute('href') ?? '' })
    return
  }
  if (tag === 'input') {
    out.push({
      kind: 'input',
      label: el.getAttribute('aria-label') ?? el.getAttribute('name') ?? null,
      value: (el as HTMLInputElement).value ?? null,
      type: (el as HTMLInputElement).type ?? 'text',
    })
    return
  }
  if (tag === 'ul' || tag === 'ol') {
    const items: OutlineNode[] = []
    for (const child of Array.from(el.children)) {
      if (child.tagName.toLowerCase() === 'li') {
        items.push({ kind: 'item', text: (child.textContent ?? '').trim() })
      }
    }
    out.push({ kind: 'list', items })
    return
  }
  if (text.length > 0 && el.children.length === 0) {
    out.push({ kind: 'text', text })
    return
  }
  for (const child of Array.from(el.children)) {
    walk(child, out)
  }
}
```

Tests: ~8 total (4 per file). Use `jsdom` to build test DOMs.

Commit:
```
feat(agent): query_dom + describe_visible_content rpc handlers
```

---

## Task 5: `send_message` rpc handler — annotation gating + confirm propose

**Files:**
- Create: `packages/agent/src/client/rpc/send-message.ts`
- Create: `packages/agent/test/client/rpc/send-message.test.ts`

This is the most nuanced handler. Behaviors:
1. Validate `msg.type` is a string.
2. Look up annotations for `msg.type`.
3. If `humanOnly` → return `{ status: 'rejected', reason: 'humanOnly' }`.
4. If `requiresConfirm` → push a `ConfirmEntry` onto `agentConfirm.pending` (via a caller-supplied callback), return `{ status: 'pending-confirmation', confirmId: <uuid> }`.
5. Otherwise → dispatch via caller-supplied `send`, return `{ status: 'dispatched', stateAfter: getState() }`.

`waitFor: 'idle'` — caller runs a microtask flush before reading stateAfter. Since the microtask model means the dispatch queue settles on the next tick, a simple `Promise.resolve().then(...)` before reading state works for 'idle'.

```ts
import { randomUUID } from '../uuid.js'  // tiny shim: prefer crypto.randomUUID, fallback
import type { LapMessageResponse, MessageAnnotations } from '../../protocol.js'

export type SendMessageArgs = {
  msg: { type: string; [k: string]: unknown }
  reason?: string
  waitFor?: 'idle' | 'none'
  timeoutMs?: number
}

export type SendMessageHost = {
  getState(): unknown
  send(msg: unknown): void
  flush(): void
  getMsgAnnotations(): Record<string, MessageAnnotations> | null
  /** Called when @requiresConfirm; caller stores a ConfirmEntry in state. */
  proposeConfirm(entry: {
    id: string
    variant: string
    payload: unknown
    intent: string
    reason: string | null
    proposedAt: number
  }): void
}

export async function handleSendMessage(
  host: SendMessageHost,
  args: SendMessageArgs,
): Promise<LapMessageResponse> {
  if (!args.msg || typeof args.msg.type !== 'string') {
    return { status: 'rejected', reason: 'invalid' }
  }
  const annotations = host.getMsgAnnotations() ?? {}
  const ann = annotations[args.msg.type]
  if (ann?.humanOnly) {
    return { status: 'rejected', reason: 'humanOnly' }
  }
  if (ann?.requiresConfirm) {
    const id = randomUUID()
    const { type: _type, ...payload } = args.msg
    host.proposeConfirm({
      id,
      variant: args.msg.type,
      payload,
      intent: ann?.intent ?? args.msg.type,
      reason: args.reason ?? null,
      proposedAt: Date.now(),
    })
    return { status: 'pending-confirmation', confirmId: id }
  }

  host.send(args.msg)
  if (args.waitFor !== 'none') {
    host.flush()
    // Let the microtask queue settle:
    await Promise.resolve()
  }
  return { status: 'dispatched', stateAfter: host.getState() }
}
```

Create `packages/agent/src/client/uuid.ts`:
```ts
export function randomUUID(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  // Simple v4 fallback for environments without crypto.randomUUID
  const chars = '0123456789abcdef'
  let s = ''
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      s += '-'
    } else if (i === 14) {
      s += '4'
    } else if (i === 19) {
      s += chars[(Math.random() * 4) | 0 + 8]
    } else {
      s += chars[(Math.random() * 16) | 0]
    }
  }
  return s
}
```

Tests: ~8 cases — invalid msg, humanOnly → rejected, requiresConfirm → propose + pending-confirmation, dispatch normal, waitFor: 'none' skips flush, getState in stateAfter reflects post-dispatch, annotation fallback when msg type absent from annotations.

Commit:
```
feat(agent): send_message rpc handler — annotation gating + confirm propose
```

---

## Task 6: HTTP effect handler (mint/resume/revoke/sessions)

**Files:**
- Create: `packages/agent/src/client/effect-handler.ts`
- Create: `packages/agent/test/client/effect-handler.test.ts`

```ts
import type { AgentEffect } from './effects.js'
import type { MintResponse, ResumeListResponse, ResumeClaimResponse, SessionsResponse } from '../protocol.js'

export type EffectHandlerHost = {
  send(msg: unknown): void  // root app send; wraps agent sub-msgs into the app Msg envelope
  /** Wraps an agentConnect msg into an app-Msg. */
  wrapAgentConnect(m: unknown): unknown
  /** Called for AgentForwardMsg — the payload is re-dispatched via send. */
  forward(payload: unknown): void
  /** fetch for HTTP effects; override in tests. */
  fetch?: typeof fetch
  /** Called before opening WS / on WS lifecycle events. */
  openWs(token: string, wsUrl: string): void
  closeWs(): void
}

export function createEffectHandler(host: EffectHandlerHost) {
  const doFetch = host.fetch ?? fetch.bind(globalThis)

  return async function handle(effect: AgentEffect): Promise<void> {
    switch (effect.type) {
      case 'AgentMintRequest': {
        try {
          const res = await doFetch(effect.mintUrl, { method: 'POST', credentials: 'include' })
          if (!res.ok) {
            const detail = await safeText(res)
            host.send(host.wrapAgentConnect({ type: 'MintFailed', error: { code: `http-${res.status}`, detail } }))
            return
          }
          const body = (await res.json()) as MintResponse
          host.send(host.wrapAgentConnect({
            type: 'MintSucceeded',
            token: body.token, tid: body.tid,
            lapUrl: body.lapUrl, wsUrl: body.wsUrl,
            expiresAt: body.expiresAt,
          }))
        } catch (e) {
          host.send(host.wrapAgentConnect({ type: 'MintFailed', error: { code: 'network', detail: String(e) } }))
        }
        return
      }
      case 'AgentOpenWS': {
        host.openWs(effect.token, effect.wsUrl)
        return
      }
      case 'AgentCloseWS': {
        host.closeWs()
        return
      }
      case 'AgentResumeCheck': {
        // For v1 we call /agent/resume/list via the mint URL's origin; the mintUrl is a POST
        // endpoint at `/agent/mint`, so we derive the origin and hit `/agent/resume/list`.
        const origin = deriveOrigin(host)
        if (!origin) return
        try {
          const res = await doFetch(`${origin}/agent/resume/list`, {
            method: 'POST', credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ tids: effect.tids }),
          })
          if (!res.ok) return
          const body = (await res.json()) as ResumeListResponse
          host.send(host.wrapAgentConnect({ type: 'ResumeListLoaded', sessions: body.sessions }))
        } catch { /* quiet failure; user can retry */ }
        return
      }
      case 'AgentResumeClaim': {
        const origin = deriveOrigin(host)
        if (!origin) return
        try {
          const res = await doFetch(`${origin}/agent/resume/claim`, {
            method: 'POST', credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ tid: effect.tid }),
          })
          if (!res.ok) return
          const body = (await res.json()) as ResumeClaimResponse
          host.openWs(body.token, body.wsUrl)
          host.send(host.wrapAgentConnect({ type: 'WsOpened' }))
        } catch { /* quiet */ }
        return
      }
      case 'AgentRevoke': {
        const origin = deriveOrigin(host)
        if (!origin) return
        try {
          await doFetch(`${origin}/agent/revoke`, {
            method: 'POST', credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ tid: effect.tid }),
          })
        } catch { /* quiet */ }
        return
      }
      case 'AgentSessionsList': {
        const origin = deriveOrigin(host)
        if (!origin) return
        try {
          const res = await doFetch(`${origin}/agent/sessions`, { method: 'GET', credentials: 'include' })
          if (!res.ok) return
          const body = (await res.json()) as SessionsResponse
          host.send(host.wrapAgentConnect({ type: 'SessionsLoaded', sessions: body.sessions }))
        } catch { /* quiet */ }
        return
      }
      case 'AgentForwardMsg': {
        host.forward(effect.payload)
        return
      }
    }
  }
}

async function safeText(res: Response): Promise<string> {
  try { return await res.text() } catch { return '' }
}

function deriveOrigin(_host: EffectHandlerHost): string | null {
  // When running in the browser, `location.origin` is correct (the agent endpoints
  // are same-origin with the app per spec §6.2). When not in a browser (tests),
  // the test-side host can override by monkeypatching in its own effect handler.
  if (typeof location !== 'undefined') return location.origin
  return null
}
```

Tests: ~10 cases using fetch-mocks. Mint success/failure, resume list, resume claim → opens WS, revoke, sessions load, AgentForwardMsg.

Commit:
```
feat(agent): HTTP + AgentForwardMsg effect handler
```

---

## Task 7: `ws-client.ts` — WS lifecycle + hello + rpc dispatch

**Files:**
- Create: `packages/agent/src/client/ws-client.ts`
- Create: `packages/agent/test/client/ws-client.test.ts`

Core job: given a WebSocket (injectable for tests), send `hello`, listen for `rpc` frames, dispatch to the per-tool handler, send `rpc-reply`/`rpc-error` back. Also exposes `resolveConfirm(confirmId, outcome, stateAfter?)` for the factory to invoke when agentConfirm entries resolve.

```ts
import type { ClientFrame, ServerFrame, HelloFrame, MessageAnnotations, MessageSchemaEntry, AgentDocs } from '../protocol.js'
import { handleGetState, type GetStateHost } from './rpc/get-state.js'
import { handleSendMessage, type SendMessageHost } from './rpc/send-message.js'
import { handleListActions, type ListActionsHost } from './rpc/list-actions.js'
import { handleQueryDom, type QueryDomHost } from './rpc/query-dom.js'
import { handleDescribeVisibleContent, type DescribeVisibleHost } from './rpc/describe-visible-content.js'
import { handleDescribeContext, type DescribeContextHost } from './rpc/describe-context.js'

export interface WsLike {
  send(data: string): void
  close(): void
  addEventListener(event: 'message', h: (e: { data: string | ArrayBuffer }) => void): void
  addEventListener(event: 'open' | 'close', h: () => void): void
}

export type RpcHosts = GetStateHost & SendMessageHost & ListActionsHost & QueryDomHost & DescribeVisibleHost & DescribeContextHost

export type HelloBuilder = () => HelloFrame

export type WsClient = {
  /** Resolve a pending confirmation; emits confirm-resolved frame to the server. */
  resolveConfirm(confirmId: string, outcome: 'confirmed' | 'user-cancelled', stateAfter?: unknown): void
  /** Close the socket cleanly. */
  close(): void
}

/**
 * Wires up a WebSocket to serve rpc requests from the server. See spec §9.4.
 */
export function attachWsClient(ws: WsLike, rpc: RpcHosts, hello: HelloBuilder): WsClient {
  ws.addEventListener('open', () => {
    ws.send(JSON.stringify(hello()))
  })
  ws.addEventListener('message', async (ev) => {
    let frame: ServerFrame
    try {
      const raw = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data)
      frame = JSON.parse(raw) as ServerFrame
    } catch {
      return
    }
    if (frame.t === 'revoked') {
      ws.close()
      return
    }
    if (frame.t !== 'rpc') return
    try {
      const result = await dispatch(frame.tool, frame.args, rpc)
      const reply: ClientFrame = { t: 'rpc-reply', id: frame.id, result }
      ws.send(JSON.stringify(reply))
    } catch (e: unknown) {
      const err = e as { code?: string; detail?: string }
      const errFrame: ClientFrame = {
        t: 'rpc-error', id: frame.id,
        code: err.code ?? 'internal',
        detail: err.detail,
      }
      ws.send(JSON.stringify(errFrame))
    }
  })

  return {
    resolveConfirm(confirmId, outcome, stateAfter) {
      const frame: ClientFrame = {
        t: 'confirm-resolved', confirmId, outcome, stateAfter,
      }
      ws.send(JSON.stringify(frame))
    },
    close() {
      ws.close()
    },
  }
}

async function dispatch(tool: string, args: unknown, rpc: RpcHosts): Promise<unknown> {
  switch (tool) {
    case 'get_state': return handleGetState(rpc, (args ?? {}) as { path?: string })
    case 'list_actions': return handleListActions(rpc)
    case 'send_message': return handleSendMessage(rpc, args as never)
    case 'query_dom': return handleQueryDom(rpc, args as never)
    case 'describe_visible_content': return handleDescribeVisibleContent(rpc)
    case 'describe_context': return handleDescribeContext(rpc)
    default: throw { code: 'invalid', detail: `unknown tool: ${tool}` }
  }
}
```

Tests: ~6 cases using a fake `WsLike` (event emitter). hello emission on open, rpc-reply on valid tool call, rpc-error on unknown tool, revoked → close, resolveConfirm emits frame.

Commit:
```
feat(agent): ws-client — hello + rpc dispatch + confirm-resolved
```

---

## Task 8: `createAgentClient` factory

**Files:**
- Create: `packages/agent/src/client/factory.ts`
- Create: `packages/agent/test/client/factory.test.ts`

The factory is the developer's single entry point. It receives:
- `AppHandle` from `mountApp`
- The `ComponentDef` (for compiler-emitted metadata + agentAffordances/agentDocs/agentContext)
- Slice accessors: connect / confirm / log + Msg-wrappers to re-dispatch sub-msgs

It returns:
- `effectHandler: (effect: AgentEffect) => Promise<void>` — developer chains into their `onEffect`
- `start()` — subscribes to agentConfirm state transitions to emit `confirm-resolved` (MVP: poll the slice on each call since no state-change subscription exists — see Plan 9 deferred note)
- `stop()`

Spec §9.6 for host-app integration shape.

Implementation outline (stubbed details since this is the most integration-heavy piece):

```ts
import type { AppHandle } from '@llui/dom'
import type { AgentEffect } from './effects.js'
import type { AgentConfirmState } from './agentConfirm.js'
import type { AgentDocs, AgentContext, MessageAnnotations, MessageSchemaEntry } from '../protocol.js'
import { attachWsClient, type RpcHosts } from './ws-client.js'
import { createEffectHandler } from './effect-handler.js'

type ComponentMetadata = {
  __msgSchema?: unknown
  __stateSchema?: unknown
  __msgAnnotations?: Record<string, MessageAnnotations>
  __bindingDescriptors?: Array<{ variant: string }>
  __schemaHash?: string
  name: string
  agentAffordances?: (state: unknown) => Array<{ type: string; [k: string]: unknown }>
  agentDocs?: AgentDocs
  agentContext?: (state: unknown) => AgentContext
}

export type CreateAgentClientOpts<State, Msg> = {
  handle: AppHandle
  def: ComponentMetadata
  appVersion?: string
  rootElement: Element | null
  slices: {
    getConnect: (s: State) => unknown
    getConfirm: (s: State) => AgentConfirmState
    wrapConnectMsg: (m: unknown) => Msg
    wrapConfirmMsg: (m: unknown) => Msg
  }
}

export type AgentClient = {
  effectHandler: (effect: AgentEffect) => Promise<void>
  start(): void
  stop(): void
}

export function createAgentClient<State, Msg>(
  opts: CreateAgentClientOpts<State, Msg>,
): AgentClient {
  let ws: WebSocket | null = null
  let wsClient: ReturnType<typeof attachWsClient> | null = null
  let confirmPollTimer: ReturnType<typeof setInterval> | null = null
  const resolvedConfirms = new Set<string>()

  const rpcHost: RpcHosts = {
    getState: () => opts.handle.getState(),
    send: (m) => opts.handle.send(m),
    flush: () => opts.handle.flush(),
    getMsgAnnotations: () => opts.def.__msgAnnotations ?? null,
    getBindingDescriptors: () => opts.def.__bindingDescriptors ?? null,
    getAgentAffordances: () => opts.def.agentAffordances ?? null,
    getAgentContext: () => opts.def.agentContext ?? null,
    getRootElement: () => opts.rootElement,
    proposeConfirm: (entry) => {
      opts.handle.send(opts.slices.wrapConfirmMsg({ type: 'Propose', entry }))
    },
  }

  const helloBuilder = () => ({
    t: 'hello' as const,
    appName: opts.def.name,
    appVersion: opts.appVersion ?? '0.0.0',
    msgSchema: (opts.def.__msgSchema ?? {}) as Record<string, MessageSchemaEntry>,
    stateSchema: (opts.def.__stateSchema ?? {}) as object,
    affordancesSample: opts.def.agentAffordances ? opts.def.agentAffordances(opts.handle.getState()) : [],
    docs: opts.def.agentDocs ?? null,
    schemaHash: opts.def.__schemaHash ?? '',
  })

  const effectHandler = createEffectHandler({
    send: (m) => opts.handle.send(m),
    wrapAgentConnect: (m) => opts.slices.wrapConnectMsg(m),
    forward: (payload) => opts.handle.send(payload),
    openWs: (token, wsUrl) => {
      if (ws) ws.close()
      ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`)
      wsClient = attachWsClient(ws as unknown as import('./ws-client.js').WsLike, rpcHost, helloBuilder)
    },
    closeWs: () => {
      wsClient?.close()
      ws = null
      wsClient = null
    },
  })

  const pollConfirms = () => {
    const state = opts.handle.getState() as State
    const confirm = opts.slices.getConfirm(state)
    for (const entry of confirm.pending) {
      if (entry.status === 'pending') continue
      if (resolvedConfirms.has(entry.id)) continue
      resolvedConfirms.add(entry.id)
      if (entry.status === 'approved') {
        wsClient?.resolveConfirm(entry.id, 'confirmed', opts.handle.getState())
      } else if (entry.status === 'rejected') {
        wsClient?.resolveConfirm(entry.id, 'user-cancelled')
      }
    }
  }

  return {
    effectHandler,
    start() {
      // V1: poll agentConfirm state at 200ms intervals to emit confirm-resolved.
      // Plan 9 will replace with a proper state-change subscription once
      // @llui/dom exposes one.
      if (!confirmPollTimer) confirmPollTimer = setInterval(pollConfirms, 200)
    },
    stop() {
      if (confirmPollTimer) clearInterval(confirmPollTimer)
      confirmPollTimer = null
      wsClient?.close()
    },
  }
}
```

Tests: ~4 cases at the factory level — createAgentClient returns effectHandler + start/stop; start() begins polling for confirm resolutions; AgentOpenWS → opens WS; AgentForwardMsg → calls handle.send.

Commit:
```
feat(agent): createAgentClient factory — composes effect handler + WS client
```

---

## Task 9: Update `client/index.ts` to re-export the factory

**Files:**
- Modify: `packages/agent/src/client/index.ts`

```ts
export * as agentConnect from './agentConnect.js'
export * as agentConfirm from './agentConfirm.js'
export * as agentLog from './agentLog.js'
export type { AgentEffect, AgentEffectHandler } from './effects.js'
export { createAgentClient } from './factory.js'
export type { CreateAgentClientOpts, AgentClient } from './factory.js'
```

Commit:
```
feat(agent): client/index.ts exposes createAgentClient
```

---

## Task 10: End-to-end integration test

**Files:**
- Create: `packages/agent/test/client/integration.test.ts`

Pattern:
1. Spin up a real agent server via `createLluiAgentServer` bound to a Node http server on an ephemeral port.
2. Use `fetch` to POST `/agent/mint`.
3. Open a WebSocket to the returned `wsUrl` with the token; wire it to `attachWsClient` with a fake rpc host that returns deterministic values.
4. POST `/agent/lap/v1/describe` via fetch; assert the browser sent its `hello` payload and the server returned it as `LapDescribeResponse`.
5. POST `/agent/lap/v1/state` and assert get_state is invoked on the rpc host.
6. Test send_message dispatched path.
7. Test send_message with a `@requiresConfirm` variant: server gets `pending-confirmation` back; browser-side simulates the user approving; server's polled `/confirm-result` returns `confirmed`.

This is a significant test; ~100 lines. Use the ws-upgrade.test.ts pattern from Plan 5 Task 3 as reference.

Commit:
```
test(agent): integration — mint → ws → describe → state → message round-trip
```

---

## Task 11: Workspace verify (no commit)

```bash
cd /Users/franco/projects/llui
pnpm install
pnpm turbo build
pnpm turbo check
pnpm turbo lint
pnpm turbo test
```

All must pass. `@llui/agent` test count should be **~215+** after Plan 7 (was 176).

---

## Task 12: Commit plan file

```bash
git add docs/superpowers/plans/2026-04-20-llui-agent-07-client-wiring.md
git commit -m "$(cat <<'COMMIT'
docs(agent): Plan 7 client-wiring — implementation plan document

12-task plan for @llui/agent/client's runtime layer: 6 rpc handlers
(get_state, describe_context, list_actions, query_dom,
describe_visible_content, send_message with annotation gating +
confirm propose), HTTP effect handler, ws-client with hello +
rpc dispatch + confirm-resolved emission, and the createAgentClient
factory. state-update frame emission + host-app integration docs
deferred to Plan 9.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Completion Criteria

- All 6 rpc handlers implemented and unit-tested.
- HTTP effect handler + AgentForwardMsg path.
- ws-client with hello + rpc dispatch + confirm-resolved.
- createAgentClient factory composes everything behind a clean API.
- Integration test exercises mint → ws-pair → describe → state → message happy path.
- @llui/agent reaches ~215+ tests, full workspace green.

## Explicitly deferred (Plan 9)

- `state-update` frame emission (requires a state-change subscription in @llui/dom).
- `log-append` mirror of every rpc call to `agentLog`.
- Host-app integration docs + `examples/agent-demo/` scaffold.
- Rate-limit header propagation to the client.
- Better error shapes for network-level failures.
