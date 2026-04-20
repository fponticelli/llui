# LLui Agent — Plan 1 of 6: `@llui/agent` Foundation + Protocol Types

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `@llui/agent` package in the monorepo with build/test/lint plumbing, and define all shared protocol types (LAP endpoint contracts, relay WS frames, annotation schema, log entries) in a single `@llui/agent/protocol` subpath export that every subsequent plan will import from.

**Architecture:** Single new package `packages/agent/` publishing `@llui/agent`, configured for dual subpath exports (`./server`, `./client`, `./protocol`). Only `./protocol` has content after this plan — the entry points for `./server` and `./client` exist but are empty shells pending Plans 3 and 4. Spec §13 is also amended to remove the `@llui/mcp-core` extraction (superseded by shared types living in `@llui/agent/protocol`).

**Tech Stack:** TypeScript, pnpm workspaces, Turborepo, vitest, ESLint (flat config), Prettier.

**Spec section coverage after this plan:** §7 (LAP types), §8 (tool surface types), §9 (state/msg/effect types referenced), §10.5 (relay frames), §13 (package layout — amended).

---

## File Structure

- `packages/agent/package.json` — package manifest with subpath exports
- `packages/agent/tsconfig.json` — test/edit-time config extending workspace root
- `packages/agent/tsconfig.build.json` — build config producing `dist/`
- `packages/agent/vitest.config.ts` — test runner config (jsdom env)
- `packages/agent/src/protocol.ts` — **THE** shared protocol module: LAP types, frame types, annotations, log entry
- `packages/agent/src/server/index.ts` — placeholder shell export
- `packages/agent/src/client/index.ts` — placeholder shell export
- `packages/agent/test/protocol.test.ts` — sample-value assertions against the protocol types
- `packages/agent/README.md` — minimal placeholder

Spec amendment (same plan): `docs/superpowers/specs/2026-04-19-llui-agent-design.md` §13 + §13.2 — drop mcp-core rows.

---

## Task 1: Create package manifest

**Files:**
- Create: `packages/agent/package.json`

- [ ] **Step 1: Create the package.json**

Write `packages/agent/package.json`:
```json
{
  "name": "@llui/agent",
  "version": "0.0.0",
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./server": {
      "types": "./dist/server/index.d.ts",
      "import": "./dist/server/index.js"
    },
    "./client": {
      "types": "./dist/client/index.d.ts",
      "import": "./dist/client/index.js"
    },
    "./protocol": {
      "types": "./dist/protocol.d.ts",
      "import": "./dist/protocol.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "check": "tsc --noEmit",
    "lint": "eslint src",
    "test": "vitest run"
  },
  "dependencies": {
    "@llui/dom": "workspace:*",
    "@llui/effects": "workspace:*",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.13"
  },
  "description": "LLui Agent — LAP server + browser client runtime for driving LLui apps from LLM clients",
  "keywords": ["llui", "agent", "llm", "mcp", "lap"],
  "author": "Franco Ponticelli <franco.ponticelli@gmail.com>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/fponticelli/llui.git",
    "directory": "packages/agent"
  },
  "bugs": { "url": "https://github.com/fponticelli/llui/issues" },
  "homepage": "https://github.com/fponticelli/llui/tree/main/packages/agent#readme"
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/agent/package.json
git commit -m "feat(agent): package manifest scaffold"
```

---

## Task 2: Create tsconfig files

**Files:**
- Create: `packages/agent/tsconfig.json`
- Create: `packages/agent/tsconfig.build.json`

- [ ] **Step 1: Write tsconfig.json**

`packages/agent/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "include": ["src", "test"],
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node"]
  }
}
```

- [ ] **Step 2: Write tsconfig.build.json**

`packages/agent/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "include": ["src"],
  "compilerOptions": {
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "inlineSources": true
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/agent/tsconfig.json packages/agent/tsconfig.build.json
git commit -m "feat(agent): tsconfig scaffolding"
```

---

## Task 3: Create vitest config

**Files:**
- Create: `packages/agent/vitest.config.ts`

- [ ] **Step 1: Write vitest.config.ts**

Mirror `packages/mcp/vitest.config.ts` structure but drop the `fileParallelism: false` (we have no workspace-root marker file collisions):
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'jsdom',
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add packages/agent/vitest.config.ts
git commit -m "feat(agent): vitest config"
```

---

## Task 4: Write placeholder source files so the package builds

**Files:**
- Create: `packages/agent/src/server/index.ts`
- Create: `packages/agent/src/client/index.ts`

- [ ] **Step 1: Create server shell**

`packages/agent/src/server/index.ts`:
```ts
// Placeholder. Implementation lands in Plan 3.
export {}
```

- [ ] **Step 2: Create client shell**

`packages/agent/src/client/index.ts`:
```ts
// Placeholder. Implementation lands in Plan 4.
export {}
```

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/server/index.ts packages/agent/src/client/index.ts
git commit -m "feat(agent): empty server + client entry shells"
```

---

## Task 5: Write failing test for LAP request/response envelope types

**Files:**
- Create: `packages/agent/test/protocol.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/agent/test/protocol.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import type {
  LapDescribeResponse,
  LapStateRequest,
  LapStateResponse,
  LapActionsResponse,
  LapMessageRequest,
  LapMessageResponse,
  LapConfirmResultRequest,
  LapConfirmResultResponse,
  LapWaitRequest,
  LapWaitResponse,
  LapQueryDomRequest,
  LapQueryDomResponse,
  LapDescribeVisibleResponse,
  LapError,
} from '../src/protocol.js'

describe('LAP types — sample value conformance', () => {
  it('describe response', () => {
    const sample: LapDescribeResponse = {
      name: 'Counter',
      version: '0.0.0',
      stateSchema: { type: 'object' },
      messages: {
        inc: {
          payloadSchema: { type: 'object' },
          intent: 'Increment',
          alwaysAffordable: false,
          requiresConfirm: false,
          humanOnly: false,
        },
      },
      conventions: {
        dispatchModel: 'TEA',
        confirmationModel: 'runtime-mediated',
        readSurfaces: ['state', 'query_dom', 'describe_visible_content'],
      },
      schemaHash: 'abc123',
    }
    expect(sample.conventions.dispatchModel).toBe('TEA')
  })

  it('state request + response', () => {
    const req: LapStateRequest = { path: '/user/name' }
    const res: LapStateResponse = { state: { user: { name: 'Franco' } } }
    expect(req.path).toBe('/user/name')
    expect(res.state).toBeDefined()
  })

  it('actions response', () => {
    const sample: LapActionsResponse = {
      actions: [
        {
          variant: 'inc',
          intent: 'Increment',
          requiresConfirm: false,
          source: 'binding',
          selectorHint: 'button.inc',
          payloadHint: null,
        },
        {
          variant: 'nav',
          intent: 'Navigate',
          requiresConfirm: false,
          source: 'always-affordable',
          selectorHint: null,
          payloadHint: { to: 'reports' },
        },
      ],
    }
    expect(sample.actions).toHaveLength(2)
  })

  it('message request + discriminated response', () => {
    const req: LapMessageRequest = {
      msg: { type: 'delete', id: 'abc' },
      reason: 'user asked me to delete this',
      waitFor: 'idle',
      timeoutMs: 15000,
    }
    const dispatched: LapMessageResponse = { status: 'dispatched', stateAfter: {} }
    const pending: LapMessageResponse = { status: 'pending-confirmation', confirmId: 'c1' }
    const confirmed: LapMessageResponse = { status: 'confirmed', stateAfter: {} }
    const rejected: LapMessageResponse = { status: 'rejected', reason: 'humanOnly' }
    expect(req.msg.type).toBe('delete')
    expect(dispatched.status).toBe('dispatched')
    expect(pending.status).toBe('pending-confirmation')
    expect(confirmed.status).toBe('confirmed')
    expect(rejected.status).toBe('rejected')
  })

  it('confirm-result types', () => {
    const req: LapConfirmResultRequest = { confirmId: 'c1', timeoutMs: 5000 }
    const a: LapConfirmResultResponse = { status: 'confirmed', stateAfter: {} }
    const b: LapConfirmResultResponse = { status: 'rejected', reason: 'user-cancelled' }
    const c: LapConfirmResultResponse = { status: 'still-pending' }
    expect(req.confirmId).toBe('c1')
    expect([a.status, b.status, c.status]).toEqual(['confirmed', 'rejected', 'still-pending'])
  })

  it('wait types', () => {
    const req: LapWaitRequest = { path: '/count', timeoutMs: 10000 }
    const changed: LapWaitResponse = { status: 'changed', stateAfter: {} }
    const timeout: LapWaitResponse = { status: 'timeout', stateAfter: {} }
    expect(req.path).toBe('/count')
    expect([changed.status, timeout.status]).toEqual(['changed', 'timeout'])
  })

  it('query-dom types', () => {
    const req: LapQueryDomRequest = { name: 'email-list', multiple: true }
    const res: LapQueryDomResponse = {
      elements: [{ text: 'Hello', attrs: { class: 'a' }, path: [0, 1] }],
    }
    expect(req.name).toBe('email-list')
    expect(res.elements).toHaveLength(1)
  })

  it('describe-visible types', () => {
    const res: LapDescribeVisibleResponse = {
      outline: [
        { kind: 'heading', level: 1, text: 'Inbox' },
        { kind: 'button', text: 'Compose', disabled: false, actionVariant: 'compose' },
      ],
    }
    expect(res.outline).toHaveLength(2)
  })

  it('error envelope', () => {
    const err: LapError = {
      error: { code: 'revoked', detail: 'token revoked by user' },
    }
    expect(err.error.code).toBe('revoked')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/agent && pnpm vitest run test/protocol.test.ts
```
Expected: FAIL with "Cannot find module '../src/protocol.js'" or similar.

---

## Task 6: Implement LAP types in protocol.ts

**Files:**
- Create: `packages/agent/src/protocol.ts`

- [ ] **Step 1: Write the protocol module — LAP types**

`packages/agent/src/protocol.ts` (part 1 — LAP request/response types; more sections appended in later tasks):
```ts
// ── LAP — LLui Agent Protocol ────────────────────────────────────
// JSON over HTTPS between the llui-agent bridge (MCP side) and the
// @llui/agent server library mounted in the developer's backend.
// See docs/superpowers/specs/2026-04-19-llui-agent-design.md §7.

export type LapErrorCode =
  | 'auth-failed'
  | 'revoked'
  | 'paused'
  | 'rate-limited'
  | 'invalid'
  | 'schema-error'
  | 'timeout'
  | 'internal'

export type LapError = {
  error: {
    code: LapErrorCode
    detail?: string
    retryAfterMs?: number
  }
}

export type MessageAnnotations = {
  intent: string | null
  alwaysAffordable: boolean
  requiresConfirm: boolean
  humanOnly: boolean
}

export type MessageSchemaEntry = {
  payloadSchema: object
  intent: string | null
  alwaysAffordable: boolean
  requiresConfirm: boolean
  humanOnly: boolean
}

export type LapDescribeResponse = {
  name: string
  version: string
  stateSchema: object
  messages: Record<string, MessageSchemaEntry>
  conventions: {
    dispatchModel: 'TEA'
    confirmationModel: 'runtime-mediated'
    readSurfaces: Array<'state' | 'query_dom' | 'describe_visible_content'>
  }
  schemaHash: string
}

export type LapStateRequest = { path?: string }
export type LapStateResponse = { state: unknown }

export type LapActionsResponse = {
  actions: Array<{
    variant: string
    intent: string
    requiresConfirm: boolean
    source: 'binding' | 'always-affordable'
    selectorHint: string | null
    payloadHint: object | null
  }>
}

export type LapMessageRequest = {
  msg: { type: string; [k: string]: unknown }
  reason?: string
  waitFor?: 'idle' | 'none'
  timeoutMs?: number
}

export type LapMessageRejectReason =
  | 'humanOnly'
  | 'user-cancelled'
  | 'timeout'
  | 'invalid'
  | 'schema-error'
  | 'revoked'
  | 'paused'

export type LapMessageResponse =
  | { status: 'dispatched'; stateAfter: unknown }
  | { status: 'pending-confirmation'; confirmId: string }
  | { status: 'confirmed'; stateAfter: unknown }
  | { status: 'rejected'; reason: LapMessageRejectReason; detail?: string }

export type LapConfirmResultRequest = { confirmId: string; timeoutMs?: number }
export type LapConfirmResultResponse =
  | { status: 'confirmed'; stateAfter: unknown }
  | { status: 'rejected'; reason: 'user-cancelled' | 'timeout' }
  | { status: 'still-pending' }

export type LapWaitRequest = { path?: string; timeoutMs?: number }
export type LapWaitResponse =
  | { status: 'changed'; stateAfter: unknown }
  | { status: 'timeout'; stateAfter: unknown }

export type LapQueryDomRequest = { name: string; multiple?: boolean }
export type LapQueryDomResponse = {
  elements: Array<{ text: string; attrs: Record<string, string>; path: number[] }>
}

export type OutlineNode =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'text'; text: string }
  | { kind: 'list'; items: OutlineNode[] }
  | { kind: 'item'; text: string; children?: OutlineNode[] }
  | { kind: 'button'; text: string; disabled: boolean; actionVariant: string | null }
  | { kind: 'input'; label: string | null; value: string | null; type: string }
  | { kind: 'link'; text: string; href: string }

export type LapDescribeVisibleResponse = { outline: OutlineNode[] }

// LAP endpoint catalog — a compile-time map binding each path to its
// request/response shape. Useful for the bridge's dispatcher and for
// typed test helpers.
export type LapEndpointMap = {
  '/lap/v1/describe': { req: null; res: LapDescribeResponse }
  '/lap/v1/state': { req: LapStateRequest; res: LapStateResponse }
  '/lap/v1/actions': { req: null; res: LapActionsResponse }
  '/lap/v1/message': { req: LapMessageRequest; res: LapMessageResponse }
  '/lap/v1/confirm-result': { req: LapConfirmResultRequest; res: LapConfirmResultResponse }
  '/lap/v1/wait': { req: LapWaitRequest; res: LapWaitResponse }
  '/lap/v1/query-dom': { req: LapQueryDomRequest; res: LapQueryDomResponse }
  '/lap/v1/describe-visible': { req: null; res: LapDescribeVisibleResponse }
}

export type LapPath = keyof LapEndpointMap
export type LapRequest<P extends LapPath> = LapEndpointMap[P]['req']
export type LapResponse<P extends LapPath> = LapEndpointMap[P]['res']
```

- [ ] **Step 2: Run test to verify it passes**

Run:
```bash
cd packages/agent && pnpm vitest run test/protocol.test.ts
```
Expected: PASS (8 passing assertions so far).

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/protocol.ts packages/agent/test/protocol.test.ts
git commit -m "feat(agent): LAP request/response protocol types"
```

---

## Task 6.5: App + context documentation types (TDD cycle)

Per the spec §5.4 addition, the protocol carries two new author-facing authoring surfaces:

- `AgentDocs` — static prose about the app (purpose, overview, cautions).
- `AgentContext` — dynamic per-state prose (summary, hints, cautions).
- `LapContextResponse` — response type for the new `/lap/v1/context` endpoint.
- `LapDescribeResponse` grows a new `docs: AgentDocs | null` field and updates its `readSurfaces` to include `describe_context`.

**Files:**
- Modify: `packages/agent/test/protocol.test.ts`
- Modify: `packages/agent/src/protocol.ts`

- [ ] **Step 1: Append failing test**

Add to `packages/agent/test/protocol.test.ts`:

```ts
import type {
  AgentDocs,
  AgentContext,
  LapContextResponse,
} from '../src/protocol.js'

describe('Documentation types', () => {
  it('AgentDocs minimal', () => {
    const d: AgentDocs = { purpose: 'Kanban for a small team.' }
    expect(d.purpose).toContain('Kanban')
  })

  it('AgentDocs with overview + cautions', () => {
    const d: AgentDocs = {
      purpose: 'Kanban for a small team.',
      overview: 'Columns are To do / Doing / Done. Cards carry owner, due date, tags.',
      cautions: [
        'Do not delete a card with unfinished subtasks.',
        'Moving to Done locks edits.',
      ],
    }
    expect(d.cautions).toHaveLength(2)
  })

  it('AgentContext minimal', () => {
    const c: AgentContext = { summary: 'Viewing the board; no card focused.' }
    expect(c.summary).toBeDefined()
  })

  it('AgentContext with hints + cautions', () => {
    const c: AgentContext = {
      summary: "Viewing 'Q1 Design' filtered to owner='Ana'. 6 cards visible.",
      hints: ['Tab to list, arrow to select.', 'Enter on a focused card advances status.'],
      cautions: ['Card 42 is locked; reopen first before editing.'],
    }
    expect(c.hints).toHaveLength(2)
  })

  it('LapContextResponse envelope', () => {
    const r: LapContextResponse = {
      context: { summary: 'Empty dashboard.', hints: [], cautions: [] },
    }
    expect(r.context.summary).toBe('Empty dashboard.')
  })
})

describe('LapDescribeResponse — docs block + describe_context read surface', () => {
  it('docs populated', () => {
    // Re-import to satisfy the TS compiler that the existing type accepts `docs`.
    // Defined as a separate describe() so prior LAP test remains untouched.
    const sample: import('../src/protocol.js').LapDescribeResponse = {
      name: 'x',
      version: '0',
      stateSchema: {},
      messages: {},
      docs: { purpose: 'demo' },
      conventions: {
        dispatchModel: 'TEA',
        confirmationModel: 'runtime-mediated',
        readSurfaces: ['state', 'query_dom', 'describe_visible_content', 'describe_context'],
      },
      schemaHash: 'h',
    }
    expect(sample.docs?.purpose).toBe('demo')
  })

  it('docs null is allowed', () => {
    const sample: import('../src/protocol.js').LapDescribeResponse = {
      name: 'x',
      version: '0',
      stateSchema: {},
      messages: {},
      docs: null,
      conventions: {
        dispatchModel: 'TEA',
        confirmationModel: 'runtime-mediated',
        readSurfaces: ['state', 'query_dom', 'describe_visible_content', 'describe_context'],
      },
      schemaHash: 'h',
    }
    expect(sample.docs).toBeNull()
  })
})
```

- [ ] **Step 2: Verify it fails**

Run `cd packages/agent && pnpm vitest run test/protocol.test.ts`. Expected: new tests fail (type resolution error — `AgentDocs`, `AgentContext`, `LapContextResponse` not exported, and the existing `LapDescribeResponse` lacks `docs` / expanded `readSurfaces`). Also run `cd packages/agent && pnpm check` — expect type errors for the same reasons.

- [ ] **Step 3: Implement — amend `protocol.ts`**

Two edits to `packages/agent/src/protocol.ts`:

**3a.** Update the existing `LapDescribeResponse` to add `docs` and widen `readSurfaces`:

Replace:
```ts
export type LapDescribeResponse = {
  name: string
  version: string
  stateSchema: object
  messages: Record<string, MessageSchemaEntry>
  conventions: {
    dispatchModel: 'TEA'
    confirmationModel: 'runtime-mediated'
    readSurfaces: Array<'state' | 'query_dom' | 'describe_visible_content'>
  }
  schemaHash: string
}
```

With:
```ts
export type LapDescribeResponse = {
  name: string
  version: string
  stateSchema: object
  messages: Record<string, MessageSchemaEntry>
  docs: AgentDocs | null
  conventions: {
    dispatchModel: 'TEA'
    confirmationModel: 'runtime-mediated'
    readSurfaces: Array<'state' | 'query_dom' | 'describe_visible_content' | 'describe_context'>
  }
  schemaHash: string
}
```

**3b.** Append a new section at the end of the LAP block (before the `LapEndpointMap`):

```ts

// ── App + context documentation ──────────────────────────────────
// Static app-level docs (authored once on the component record) and
// dynamic per-state context docs (pure function of state, served by
// `/lap/v1/context`). See spec §5.4.

export type AgentDocs = {
  purpose: string
  overview?: string
  cautions?: string[]
}

export type AgentContext = {
  summary: string
  hints?: string[]
  cautions?: string[]
}

export type LapContextResponse = { context: AgentContext }
```

**3c.** Extend `LapEndpointMap` with the new endpoint:

Replace:
```ts
  '/lap/v1/describe-visible': { req: null; res: LapDescribeVisibleResponse }
}
```

With:
```ts
  '/lap/v1/describe-visible': { req: null; res: LapDescribeVisibleResponse }
  '/lap/v1/context': { req: null; res: LapContextResponse }
}
```

- [ ] **Step 4: Verify passes**

Run `cd packages/agent && pnpm vitest run test/protocol.test.ts`. Expected: all tests pass (existing + new).
Run `cd packages/agent && pnpm check`. Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/protocol.ts packages/agent/test/protocol.test.ts
git commit -m "$(cat <<'COMMIT'
feat(agent): app + context documentation types

Add AgentDocs (static) and AgentContext (dynamic per-state) plus
/lap/v1/context endpoint. Extend LapDescribeResponse with docs field
and describe_context read surface. See spec §5.4, §7.1, §7.5, §8.2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 7: Write failing test for relay WS frame types

**Files:**
- Modify: `packages/agent/test/protocol.test.ts`

- [ ] **Step 1: Append failing test**

Add to `packages/agent/test/protocol.test.ts`:
```ts
import type {
  ClientFrame,
  ServerFrame,
  HelloFrame,
  RpcReplyFrame,
  RpcErrorFrame,
  ConfirmResolvedFrame,
  StateUpdateFrame,
  LogAppendFrame,
  RpcFrame,
  RevokedFrame,
} from '../src/protocol.js'

describe('Relay WS frame types', () => {
  it('hello frame', () => {
    const f: HelloFrame = {
      t: 'hello',
      appName: 'App',
      appVersion: '1.0',
      msgSchema: { inc: { payload: {}, annotations: { intent: null, alwaysAffordable: false, requiresConfirm: false, humanOnly: false } } },
      stateSchema: { type: 'object' },
      affordancesSample: [{ type: 'inc' }],
      docs: null,
      schemaHash: 'h1',
    }
    expect(f.t).toBe('hello')
  })

  it('hello frame with populated docs', () => {
    const f: HelloFrame = {
      t: 'hello',
      appName: 'App',
      appVersion: '1.0',
      msgSchema: {},
      stateSchema: { type: 'object' },
      affordancesSample: [],
      docs: { purpose: 'Demo app', overview: 'Counter', cautions: ['Don\u2019t reset mid-flow'] },
      schemaHash: 'h2',
    }
    expect(f.docs?.purpose).toBe('Demo app')
  })

  it('rpc reply + error frames', () => {
    const ok: RpcReplyFrame = { t: 'rpc-reply', id: 'r1', result: { state: {} } }
    const err: RpcErrorFrame = { t: 'rpc-error', id: 'r1', code: 'invalid', detail: 'bad path' }
    expect(ok.t).toBe('rpc-reply')
    expect(err.t).toBe('rpc-error')
  })

  it('confirm-resolved frame', () => {
    const f: ConfirmResolvedFrame = {
      t: 'confirm-resolved',
      confirmId: 'c1',
      outcome: 'confirmed',
      stateAfter: {},
    }
    expect(f.outcome).toBe('confirmed')
  })

  it('state-update frame', () => {
    const f: StateUpdateFrame = { t: 'state-update', path: '/count', stateAfter: { count: 1 } }
    expect(f.t).toBe('state-update')
  })

  it('log-append frame', () => {
    const f: LogAppendFrame = {
      t: 'log-append',
      entry: { id: 'e1', at: 0, kind: 'dispatched', variant: 'inc', intent: 'Increment' },
    }
    expect(f.entry.kind).toBe('dispatched')
  })

  it('rpc (server→client) frame', () => {
    const f: RpcFrame = { t: 'rpc', id: 'r1', tool: 'get_state', args: { path: null } }
    expect(f.t).toBe('rpc')
  })

  it('revoked frame', () => {
    const f: RevokedFrame = { t: 'revoked' }
    expect(f.t).toBe('revoked')
  })

  it('ClientFrame union is inhabited by all expected variants', () => {
    const frames: ClientFrame[] = [
      { t: 'hello', appName: 'x', appVersion: '1', msgSchema: {}, stateSchema: {}, affordancesSample: [], docs: null, schemaHash: 'h' },
      { t: 'rpc-reply', id: 'r', result: null },
      { t: 'rpc-error', id: 'r', code: 'invalid' },
      { t: 'confirm-resolved', confirmId: 'c', outcome: 'user-cancelled' },
      { t: 'state-update', path: '/', stateAfter: null },
      { t: 'log-append', entry: { id: 'e', at: 0, kind: 'read' } },
    ]
    expect(frames).toHaveLength(6)
  })

  it('ServerFrame union is inhabited', () => {
    const frames: ServerFrame[] = [
      { t: 'rpc', id: 'r', tool: 'get_state', args: {} },
      { t: 'revoked' },
    ]
    expect(frames).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/agent && pnpm vitest run test/protocol.test.ts
```
Expected: FAIL — frame types not exported.

---

## Task 8: Implement relay frame types

**Files:**
- Modify: `packages/agent/src/protocol.ts`

- [ ] **Step 1: Append frame types to protocol.ts**

Append to `packages/agent/src/protocol.ts`:
```ts

// ── Relay WS frames ──────────────────────────────────────────────
// Bidirectional framing between the LLui runtime in the browser and
// the @llui/agent server over /agent/ws. See spec §10.5.

export type LogKind =
  | 'proposed'
  | 'dispatched'
  | 'confirmed'
  | 'rejected'
  | 'blocked'
  | 'read'
  | 'error'

export type LogEntry = {
  id: string
  at: number
  kind: LogKind
  variant?: string
  intent?: string
  detail?: string
}

export type HelloFrame = {
  t: 'hello'
  appName: string
  appVersion: string
  msgSchema: object
  stateSchema: object
  affordancesSample: object[]
  docs: AgentDocs | null
  schemaHash: string
}

export type RpcReplyFrame = { t: 'rpc-reply'; id: string; result: unknown }
export type RpcErrorFrame = { t: 'rpc-error'; id: string; code: string; detail?: string }
export type ConfirmResolvedFrame = {
  t: 'confirm-resolved'
  confirmId: string
  outcome: 'confirmed' | 'user-cancelled'
  stateAfter?: unknown
}
export type StateUpdateFrame = { t: 'state-update'; path: string; stateAfter: unknown }
export type LogAppendFrame = { t: 'log-append'; entry: LogEntry }

export type ClientFrame =
  | HelloFrame
  | RpcReplyFrame
  | RpcErrorFrame
  | ConfirmResolvedFrame
  | StateUpdateFrame
  | LogAppendFrame

export type RpcFrame = { t: 'rpc'; id: string; tool: string; args: unknown }
export type RevokedFrame = { t: 'revoked' }

export type ServerFrame = RpcFrame | RevokedFrame
```

- [ ] **Step 2: Run test to verify it passes**

Run:
```bash
cd packages/agent && pnpm vitest run test/protocol.test.ts
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/protocol.ts packages/agent/test/protocol.test.ts
git commit -m "feat(agent): relay WS frame types"
```

---

## Task 9: Write failing test for token + pairing types

**Files:**
- Modify: `packages/agent/test/protocol.test.ts`

- [ ] **Step 1: Append failing test**

Append to `packages/agent/test/protocol.test.ts`:
```ts
import type {
  AgentToken,
  TokenPayload,
  TokenRecord,
  TokenStatus,
  AgentSession,
  MintResponse,
  ResumeListResponse,
  ResumeClaimResponse,
  SessionsResponse,
} from '../src/protocol.js'

describe('Token + pairing types', () => {
  it('token brand and payload', () => {
    const t: AgentToken = 'llui-agent_payload.signature' as AgentToken
    const p: TokenPayload = {
      tid: '11111111-1111-1111-1111-111111111111',
      iat: 0,
      exp: 86400,
      scope: 'agent',
    }
    expect(typeof t).toBe('string')
    expect(p.scope).toBe('agent')
  })

  it('token record status values', () => {
    const statuses: TokenStatus[] = [
      'awaiting-ws',
      'awaiting-claude',
      'active',
      'pending-resume',
      'revoked',
    ]
    expect(statuses).toHaveLength(5)
    const rec: TokenRecord = {
      tid: 't1',
      uid: 'u1',
      status: 'active',
      createdAt: 0,
      lastSeenAt: 0,
      pendingResumeUntil: null,
      origin: 'https://app.example',
      label: null,
    }
    expect(rec.status).toBe('active')
  })

  it('agent session', () => {
    const s: AgentSession = {
      tid: 't1',
      label: 'Claude Desktop · Opus 4.7',
      status: 'active',
      createdAt: 0,
      lastSeenAt: 0,
    }
    expect(s.status).toBe('active')
  })

  it('mint + resume response shapes', () => {
    const mint: MintResponse = {
      token: 'llui-agent_x.y' as AgentToken,
      tid: 't1',
      wsUrl: 'wss://app/agent/ws',
      lapUrl: 'https://app/agent/lap/v1',
      expiresAt: 86400,
    }
    const resumeList: ResumeListResponse = {
      sessions: [{ tid: 't1', label: 'x', status: 'pending-resume', createdAt: 0, lastSeenAt: 0 }],
    }
    const resumeClaim: ResumeClaimResponse = {
      token: 'llui-agent_new.sig' as AgentToken,
      wsUrl: 'wss://app/agent/ws',
    }
    const sessions: SessionsResponse = {
      sessions: [{ tid: 't1', label: 'x', status: 'active', createdAt: 0, lastSeenAt: 0 }],
    }
    expect(mint.lapUrl).toContain('/agent/lap/v1')
    expect(resumeList.sessions).toHaveLength(1)
    expect(resumeClaim.token).toBeDefined()
    expect(sessions.sessions).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/agent && pnpm vitest run test/protocol.test.ts
```
Expected: FAIL — token types not exported.

---

## Task 10: Implement token + pairing types

**Files:**
- Modify: `packages/agent/src/protocol.ts`

- [ ] **Step 1: Append token + pairing types**

Append to `packages/agent/src/protocol.ts`:
```ts

// ── Tokens + pairing ─────────────────────────────────────────────

declare const TokenBrand: unique symbol
export type AgentToken = string & { readonly [TokenBrand]: 'AgentToken' }

export type TokenPayload = {
  tid: string
  iat: number
  exp: number
  scope: 'agent'
}

export type TokenStatus =
  | 'awaiting-ws'
  | 'awaiting-claude'
  | 'active'
  | 'pending-resume'
  | 'revoked'

export type TokenRecord = {
  tid: string
  uid: string | null
  status: TokenStatus
  createdAt: number
  lastSeenAt: number
  pendingResumeUntil: number | null
  origin: string
  label: string | null
}

export type AgentSession = {
  tid: string
  label: string
  status: 'active' | 'pending-resume' | 'revoked'
  createdAt: number
  lastSeenAt: number
}

// HTTP envelopes for the mint/resume/revoke/sessions endpoints (non-LAP).

export type MintRequest = Record<string, never>
export type MintResponse = {
  token: AgentToken
  tid: string
  wsUrl: string
  lapUrl: string
  expiresAt: number
}

export type ResumeListRequest = { tids: string[] }
export type ResumeListResponse = { sessions: AgentSession[] }

export type ResumeClaimRequest = { tid: string }
export type ResumeClaimResponse = { token: AgentToken; wsUrl: string }

export type RevokeRequest = { tid: string }
export type RevokeResponse = { status: 'revoked' }

export type SessionsResponse = { sessions: AgentSession[] }
```

- [ ] **Step 2: Run test to verify it passes**

Run:
```bash
cd packages/agent && pnpm vitest run test/protocol.test.ts
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/protocol.ts packages/agent/test/protocol.test.ts
git commit -m "feat(agent): token + pairing types"
```

---

## Task 11: Write failing test for audit entry types

**Files:**
- Modify: `packages/agent/test/protocol.test.ts`

- [ ] **Step 1: Append failing test**

Append to `packages/agent/test/protocol.test.ts`:
```ts
import type { AuditEntry, AuditEvent } from '../src/protocol.js'

describe('Audit entry types', () => {
  it('audit event enumeration', () => {
    const events: AuditEvent[] = [
      'mint',
      'claim',
      'resume',
      'revoke',
      'lap-call',
      'msg-dispatched',
      'msg-blocked',
      'confirm-proposed',
      'confirm-approved',
      'confirm-rejected',
      'rate-limited',
      'auth-failed',
    ]
    expect(events).toHaveLength(12)
  })

  it('audit entry shape', () => {
    const e: AuditEntry = {
      at: Date.now(),
      tid: 't1',
      uid: 'u1',
      event: 'msg-dispatched',
      detail: { variant: 'inc' },
    }
    expect(e.event).toBe('msg-dispatched')
  })

  it('audit entry allows null tid/uid', () => {
    const e: AuditEntry = {
      at: 0,
      tid: null,
      uid: null,
      event: 'rate-limited',
      detail: { bucket: 'global' },
    }
    expect(e.tid).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd packages/agent && pnpm vitest run test/protocol.test.ts
```
Expected: FAIL — audit types not exported.

---

## Task 12: Implement audit entry types

**Files:**
- Modify: `packages/agent/src/protocol.ts`

- [ ] **Step 1: Append audit types**

Append to `packages/agent/src/protocol.ts`:
```ts

// ── Audit ────────────────────────────────────────────────────────

export type AuditEvent =
  | 'mint'
  | 'claim'
  | 'resume'
  | 'revoke'
  | 'lap-call'
  | 'msg-dispatched'
  | 'msg-blocked'
  | 'confirm-proposed'
  | 'confirm-approved'
  | 'confirm-rejected'
  | 'rate-limited'
  | 'auth-failed'

export type AuditEntry = {
  at: number
  tid: string | null
  uid: string | null
  event: AuditEvent
  detail: object
}
```

- [ ] **Step 2: Run test to verify it passes**

Run:
```bash
cd packages/agent && pnpm vitest run test/protocol.test.ts
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/protocol.ts packages/agent/test/protocol.test.ts
git commit -m "feat(agent): audit entry types"
```

---

## Task 13: Wire up protocol export + verify workspace build

**Files:**
- Verify: `packages/agent/package.json` (already has `./protocol` export from Task 1)
- Verify: root `turbo.json` (should already pick up new package via globs — no edit expected)

- [ ] **Step 1: Install workspace deps**

Run from repo root:
```bash
pnpm install
```
Expected: `@llui/agent` is picked up (you'll see the new package in the install summary). No errors.

- [ ] **Step 2: Build the package**

Run:
```bash
pnpm --filter @llui/agent build
```
Expected: `dist/protocol.js`, `dist/protocol.d.ts`, `dist/server/index.js`, `dist/client/index.js` produced. No errors.

- [ ] **Step 3: Run full workspace build to ensure nothing else broke**

Run from repo root:
```bash
pnpm turbo build
```
Expected: All packages build. `@llui/agent` appears in the completion list.

- [ ] **Step 4: Run full workspace check + lint + test**

Run from repo root:
```bash
pnpm turbo check && pnpm turbo lint && pnpm turbo test
```
Expected: All pass.

- [ ] **Step 5: Commit**

If any lockfile / generated files changed during `pnpm install`:
```bash
git add pnpm-lock.yaml
git commit -m "chore: refresh lockfile after @llui/agent scaffold"
```
Otherwise skip.

---

## Task 14: Add a placeholder README

**Files:**
- Create: `packages/agent/README.md`

- [ ] **Step 1: Write minimal README**

`packages/agent/README.md`:
```markdown
# @llui/agent

Server and browser-client libraries for the [LLui Agent Protocol (LAP)](../../docs/superpowers/specs/2026-04-19-llui-agent-design.md).

Under construction. Install is not yet recommended.

## Entry points

- `@llui/agent/protocol` — shared types for LAP, relay WS frames, tokens, audit.
- `@llui/agent/server` — LAP server + mint/resume/revoke/sessions endpoints (in development).
- `@llui/agent/client` — browser runtime: `agentConnect`, `agentConfirm`, `agentLog` (in development).

See the [design spec](../../docs/superpowers/specs/2026-04-19-llui-agent-design.md) for the full picture.
```

- [ ] **Step 2: Commit**

```bash
git add packages/agent/README.md
git commit -m "docs(agent): placeholder README"
```

---

## Task 15: Amend the spec — drop `@llui/mcp-core`

**Files:**
- Modify: `docs/superpowers/specs/2026-04-19-llui-agent-design.md` (§13 package layout, §13.2 dep graph, §2 non-goals)

- [ ] **Step 1: Remove the mcp-core tree entry from §13**

Locate in `docs/superpowers/specs/2026-04-19-llui-agent-design.md`:
```
packages/
  mcp-core/                           (new)
    src/
      schema/                         (moved: serialize/deserialize msg/state schemas)
      validator.ts                    (moved: validateMessage)
      relay-protocol.ts               (new: shared WS frame types)
      lap-protocol.ts                 (new: LAP endpoint & payload types)
  mcp/                                (existing, trimmed)
```

Replace with:
```
packages/
  mcp/                                (existing, unchanged)
```

- [ ] **Step 2: Remove the `(existing, trimmed)` note for `@llui/mcp`**

In the same listing, the `packages/mcp/` entry no longer gets trimmed — shared types live in `@llui/agent/protocol`.

- [ ] **Step 3: Update the `packages/agent/` subtree**

Replace:
```
  agent/                              (new, publishes @llui/agent)
    src/
      server/
        ...
      client/
        ...
      protocol.ts                     — re-exports from mcp-core
```

With:
```
  agent/                              (new, publishes @llui/agent)
    src/
      server/
        ...
      client/
        ...
      protocol.ts                     — LAP types, relay frame types, tokens, audit
```

- [ ] **Step 4: Update §13.2 dependency graph**

Replace the graph with:
```
@llui/agent/client    →  @llui/dom, @llui/effects, @llui/agent/protocol
@llui/agent/server    →  @llui/agent/protocol, ws                                (no MCP SDK)
llui-agent (bridge)   →  @llui/agent/protocol,                                   (the only MCP SDK consumer in the new work)
                         @modelcontextprotocol/sdk
@llui/mcp             →  @llui/dom, @llui/lint-idiomatic,
                         @modelcontextprotocol/sdk, ws                           (unchanged)
```

- [ ] **Step 5: Remove mcp-core from §17 (Open questions) if present, and add a one-line note**

At the end of §13, insert:
```
Rationale: the originally-planned `@llui/mcp-core` extraction was dropped. Inspection showed the actual shared code between `@llui/mcp` and `@llui/agent` is small enough — protocol types only — to live in `@llui/agent/protocol`. `validateMessage` already ships in `@llui/dom/devtools` and is not duplicated.
```

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-04-19-llui-agent-design.md
git commit -m "docs(agent): drop @llui/mcp-core extraction from spec"
```

---

## Completion Criteria

- `packages/agent/` package exists with `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`.
- `packages/agent/src/protocol.ts` exports LAP types, relay frame types, tokens, audit. Test file asserts each one.
- `@llui/agent/protocol` is importable from other workspace packages.
- `pnpm turbo build && pnpm turbo check && pnpm turbo lint && pnpm turbo test` passes at the workspace root.
- Spec amended; no stale mcp-core references remain.

Next plan: **Plan 2 of 6 — Vite plugin extensions** (JSDoc annotation extraction, binding-descriptor emission, `schemaHash`).
