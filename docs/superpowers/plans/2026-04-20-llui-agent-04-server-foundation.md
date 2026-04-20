# LLui Agent — Plan 4 of 8: Server Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the non-LAP, non-WS half of `@llui/agent/server` — token crypto, the `TokenStore` / `AuditSink` / `IdentityResolver` / `RateLimiter` interfaces with in-memory defaults, the HTTP endpoints (`/agent/mint`, `/agent/resume/list`, `/agent/resume/claim`, `/agent/revoke`, `/agent/sessions`), and the `createLluiAgentServer({...})` factory that stitches them into a Web-standards `Request -> Response` router. The WS `/agent/ws` upgrade handler and the LAP `/agent/lap/v1/*` dispatch routes land in Plan 5.

**Architecture:** One library package entry at `packages/agent/src/server/index.ts` re-exporting all public API. Internally split by responsibility — each file ~50-150 lines, one clear purpose. Token format is HMAC-SHA256 signed payload per spec §6.1. Tests use vitest with a fake identity resolver and an in-memory store; Web `Request`/`Response` as the boundary (framework-neutral). Node adapters left to users for v1.

**Tech Stack:** Node 22+, `node:crypto`, Web `Request`/`Response`, vitest.

**Spec section coverage after this plan:**

- §6.1 Token shape
- §6.2 Mint flow (HTTP side)
- §6.3 Resume flow (HTTP side)
- §6.5 Revocation (HTTP side)
- §6.6 Security
- §10.1 Public API (except `wsUpgrade`, which lands in Plan 5)
- §10.2 Endpoints (non-LAP, non-WS subset)
- §10.3 Interfaces (`TokenStore`, `AuditSink`, `IdentityResolver`, `RateLimiter`)
- §10.6 Reference implementations (in-memory defaults only)

Deferred to Plan 5: `wsUpgrade`, LAP endpoints (§10.4 dispatch), relay frames, `hello` handling.

---

## File Structure

```
packages/agent/src/server/
  index.ts                  — public re-exports (createLluiAgentServer + types)
  options.ts                — ServerOptions type + defaults
  token.ts                  — signToken / verifyToken / AgentToken brand helpers
  token-store.ts            — TokenStore interface + InMemoryTokenStore class
  identity.ts               — IdentityResolver type + defaultIdentityResolver (signed cookie)
  audit.ts                  — AuditSink type + consoleAuditSink
  rate-limit.ts             — RateLimiter type + defaultRateLimiter (token bucket)
  http/
    mint.ts                 — POST /agent/mint handler
    resume.ts               — POST /agent/resume/list + /agent/resume/claim handlers
    revoke.ts               — POST /agent/revoke handler
    sessions.ts             — GET /agent/sessions handler
    router.ts               — combined Request -> Response | null dispatcher
  factory.ts                — createLluiAgentServer — composes all of the above

packages/agent/test/server/
  token.test.ts
  token-store.test.ts
  identity.test.ts
  audit.test.ts
  rate-limit.test.ts
  mint.test.ts
  resume.test.ts
  revoke.test.ts
  sessions.test.ts
  factory.test.ts           — integration: full router lifecycle via `new Request(...)`
```

---

## Task 1: Scaffold the server module

**Files:**

- Modify: `packages/agent/src/server/index.ts` (currently an empty shell)
- Create: `packages/agent/src/server/options.ts`

- [ ] **Step 1: Replace the server/index.ts placeholder**

```ts
export { createLluiAgentServer } from './factory.js'
export type { ServerOptions, AgentServerHandle } from './options.js'
export { InMemoryTokenStore } from './token-store.js'
export type { TokenStore } from './token-store.js'
export { defaultIdentityResolver } from './identity.js'
export type { IdentityResolver } from './identity.js'
export { consoleAuditSink } from './audit.js'
export type { AuditSink } from './audit.js'
export { defaultRateLimiter } from './rate-limit.js'
export type { RateLimiter } from './rate-limit.js'
```

- [ ] **Step 2: Create options.ts**

```ts
import type { TokenStore } from './token-store.js'
import type { IdentityResolver } from './identity.js'
import type { AuditSink } from './audit.js'
import type { RateLimiter } from './rate-limit.js'

/**
 * Options accepted by `createLluiAgentServer`. All values except
 * `signingKey` are optional and fall back to in-memory defaults.
 * See spec §10.1.
 */
export type ServerOptions = {
  /** HMAC key for signing tokens. ≥32 bytes; rotation invalidates all tokens. */
  signingKey: string | Uint8Array

  /** Token store. Defaults to an `InMemoryTokenStore`. */
  tokenStore?: TokenStore

  /** Identity resolver. Defaults to `defaultIdentityResolver` (cookie-off). */
  identityResolver?: IdentityResolver

  /** Audit sink. Defaults to `consoleAuditSink`. */
  auditSink?: AuditSink

  /** Rate limiter. Defaults to `defaultRateLimiter`. */
  rateLimiter?: RateLimiter

  /** Base path prefix for LAP endpoints. Defaults to `/agent/lap/v1`. */
  lapBasePath?: string

  /** Pairing grace window after a tab closes, in ms. Default 15 min. */
  pairingGraceMs?: number

  /** Sliding TTL for active tokens, in ms. Default 1 h. */
  slidingTtlMs?: number

  /** Allowed origins for the HTTP surface (CORS). Empty = any. */
  corsOrigins?: readonly string[]
}

/**
 * Value returned by `createLluiAgentServer`. `router` matches any
 * `/agent/*` request and returns a Response (or null to fall through).
 * `wsUpgrade` lands in Plan 5.
 */
export type AgentServerHandle = {
  router: (req: Request) => Promise<Response | null>
  // wsUpgrade: coming in Plan 5
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/server/index.ts packages/agent/src/server/options.ts
git commit -m "$(cat <<'COMMIT'
feat(agent): server scaffold — options types + re-export surface

Public entry re-exports the factory + type interfaces. ServerOptions
covers signingKey (required), pluggable store/identity/audit/rate
limit, and tuning knobs for grace/TTL/CORS.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 2: Token crypto — failing tests

**Files:**

- Create: `packages/agent/test/server/token.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { signToken, verifyToken, type TokenPayload } from '../../src/server/token.js'

const key = 'x'.repeat(32) // 32-byte HMAC key

describe('signToken / verifyToken', () => {
  it('round-trips a payload', () => {
    const payload: TokenPayload = {
      tid: '11111111-1111-1111-1111-111111111111',
      iat: 1700000000,
      exp: 1700086400,
      scope: 'agent',
    }
    const tok = signToken(payload, key)
    expect(tok).toMatch(/^llui-agent_/)
    const verified = verifyToken(tok, key)
    expect(verified).toEqual({ kind: 'ok', payload })
  })

  it('rejects a token signed with a different key', () => {
    const payload: TokenPayload = { tid: 't1', iat: 0, exp: 86400, scope: 'agent' }
    const tok = signToken(payload, key)
    const verified = verifyToken(tok, 'y'.repeat(32))
    expect(verified).toEqual({ kind: 'invalid', reason: 'bad-signature' })
  })

  it('rejects a tampered payload', () => {
    const payload: TokenPayload = { tid: 't1', iat: 0, exp: 86400, scope: 'agent' }
    const tok = signToken(payload, key)
    // Swap the payload portion; signature no longer matches.
    const tampered = 'llui-agent_eyJ0aWQiOiJoYWNrZXIifQ.' + tok.split('.')[1]
    expect(verifyToken(tampered, key)).toEqual({ kind: 'invalid', reason: 'bad-signature' })
  })

  it('reports expired tokens distinctly from bad-signature', () => {
    const past: TokenPayload = { tid: 't1', iat: 0, exp: 1, scope: 'agent' }
    const tok = signToken(past, key)
    // verifyToken takes now() in seconds as an arg for deterministic testing.
    const verified = verifyToken(tok, key, /* nowSec */ 100)
    expect(verified).toEqual({ kind: 'invalid', reason: 'expired' })
  })

  it('rejects a malformed token string', () => {
    expect(verifyToken('not-a-token', key)).toEqual({ kind: 'invalid', reason: 'malformed' })
    expect(verifyToken('llui-agent_abc', key)).toEqual({ kind: 'invalid', reason: 'malformed' })
  })

  it('rejects an empty/short HMAC key', () => {
    const payload: TokenPayload = { tid: 't1', iat: 0, exp: 86400, scope: 'agent' }
    expect(() => signToken(payload, 'short')).toThrow(/32 bytes/)
  })
})
```

- [ ] **Step 2: Run, expect fail**

```bash
cd packages/agent && pnpm vitest run test/server/token.test.ts
```

Expected: FAIL (module not found).

---

## Task 3: Token crypto — implementation

**Files:**

- Create: `packages/agent/src/server/token.ts`

- [ ] **Step 1: Implement**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { AgentToken } from '../protocol.js'

export type TokenPayload = {
  tid: string
  iat: number
  exp: number
  scope: 'agent'
}

export type VerifyResult =
  | { kind: 'ok'; payload: TokenPayload }
  | { kind: 'invalid'; reason: 'malformed' | 'bad-signature' | 'expired' }

const PREFIX = 'llui-agent_'

function toKeyBuffer(key: string | Uint8Array): Buffer {
  const buf = typeof key === 'string' ? Buffer.from(key, 'utf8') : Buffer.from(key)
  if (buf.length < 32) throw new Error('signingKey must be at least 32 bytes')
  return buf
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

function b64urlDecode(s: string): Buffer | null {
  try {
    return Buffer.from(s, 'base64url')
  } catch {
    return null
  }
}

/**
 * Serialize a payload to `llui-agent_<base64url(json)>.<base64url(hmac)>`.
 * See spec §6.1.
 */
export function signToken(payload: TokenPayload, key: string | Uint8Array): AgentToken {
  const keyBuf = toKeyBuffer(key)
  const jsonBuf = Buffer.from(JSON.stringify(payload), 'utf8')
  const payloadPart = b64url(jsonBuf)
  const mac = createHmac('sha256', keyBuf).update(payloadPart).digest()
  const sigPart = b64url(mac)
  return (PREFIX + payloadPart + '.' + sigPart) as AgentToken
}

/**
 * Verify the signature, parse the payload, and check expiry. Pure
 * function; `nowSec` is injectable for deterministic testing.
 */
export function verifyToken(
  token: string,
  key: string | Uint8Array,
  nowSec: number = Math.floor(Date.now() / 1000),
): VerifyResult {
  if (!token.startsWith(PREFIX)) return { kind: 'invalid', reason: 'malformed' }
  const body = token.slice(PREFIX.length)
  const dot = body.indexOf('.')
  if (dot < 0) return { kind: 'invalid', reason: 'malformed' }

  const payloadPart = body.slice(0, dot)
  const sigPart = body.slice(dot + 1)
  const sigBuf = b64urlDecode(sigPart)
  if (!sigBuf) return { kind: 'invalid', reason: 'malformed' }

  const keyBuf = toKeyBuffer(key)
  const expected = createHmac('sha256', keyBuf).update(payloadPart).digest()
  if (expected.length !== sigBuf.length || !timingSafeEqual(expected, sigBuf)) {
    return { kind: 'invalid', reason: 'bad-signature' }
  }

  const jsonBuf = b64urlDecode(payloadPart)
  if (!jsonBuf) return { kind: 'invalid', reason: 'malformed' }
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonBuf.toString('utf8'))
  } catch {
    return { kind: 'invalid', reason: 'malformed' }
  }

  if (!isTokenPayload(parsed)) return { kind: 'invalid', reason: 'malformed' }
  if (parsed.exp <= nowSec) return { kind: 'invalid', reason: 'expired' }
  return { kind: 'ok', payload: parsed }
}

function isTokenPayload(x: unknown): x is TokenPayload {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.tid === 'string' &&
    typeof o.iat === 'number' &&
    typeof o.exp === 'number' &&
    o.scope === 'agent'
  )
}
```

- [ ] **Step 2: Run tests**

```bash
cd packages/agent && pnpm vitest run test/server/token.test.ts
cd packages/agent && pnpm check
```

Expected: 6 tests pass; check silent.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/server/token.ts packages/agent/test/server/token.test.ts
git commit -m "$(cat <<'COMMIT'
feat(agent): signToken / verifyToken — HMAC-SHA256 token crypto

Spec §6.1 token format (llui-agent_<payload>.<sig>) with timing-safe
signature comparison, malformed/bad-signature/expired discrimination,
and explicit 32-byte key minimum.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 4: TokenStore — failing tests

**Files:**

- Create: `packages/agent/test/server/token-store.test.ts`

- [ ] **Step 1: Write**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryTokenStore } from '../../src/server/token-store.js'
import type { TokenRecord } from '../../src/protocol.js'

let store: InMemoryTokenStore
beforeEach(() => {
  store = new InMemoryTokenStore()
})

const baseRecord = (overrides: Partial<TokenRecord> = {}): TokenRecord => ({
  tid: 't1',
  uid: 'u1',
  status: 'awaiting-ws',
  createdAt: 1000,
  lastSeenAt: 1000,
  pendingResumeUntil: null,
  origin: 'https://app.example',
  label: null,
  ...overrides,
})

describe('InMemoryTokenStore', () => {
  it('create + findByTid round-trip', async () => {
    await store.create(baseRecord())
    const got = await store.findByTid('t1')
    expect(got).toEqual(baseRecord())
  })

  it('findByTid returns null for unknown tid', async () => {
    expect(await store.findByTid('missing')).toBeNull()
  })

  it('listByIdentity filters by uid and excludes other uids', async () => {
    await store.create(baseRecord({ tid: 't1', uid: 'u1' }))
    await store.create(baseRecord({ tid: 't2', uid: 'u2' }))
    await store.create(baseRecord({ tid: 't3', uid: 'u1' }))
    const got = await store.listByIdentity('u1')
    expect(got.map((r) => r.tid).sort()).toEqual(['t1', 't3'])
  })

  it('listByIdentity excludes null uid entries', async () => {
    await store.create(baseRecord({ tid: 't1', uid: 'u1' }))
    await store.create(baseRecord({ tid: 't2', uid: null }))
    const got = await store.listByIdentity('u1')
    expect(got.map((r) => r.tid)).toEqual(['t1'])
  })

  it('touch updates lastSeenAt', async () => {
    await store.create(baseRecord())
    await store.touch('t1', 2000)
    const got = await store.findByTid('t1')
    expect(got?.lastSeenAt).toBe(2000)
    expect(got?.createdAt).toBe(1000)
  })

  it('markActive flips status and sets label', async () => {
    await store.create(baseRecord({ status: 'awaiting-claude' }))
    await store.markActive('t1', 'Claude Desktop · Opus', 2000)
    const got = await store.findByTid('t1')
    expect(got?.status).toBe('active')
    expect(got?.label).toBe('Claude Desktop · Opus')
    expect(got?.lastSeenAt).toBe(2000)
  })

  it('markPendingResume flips status and sets pendingResumeUntil', async () => {
    await store.create(baseRecord({ status: 'active' }))
    await store.markPendingResume('t1', 9999)
    const got = await store.findByTid('t1')
    expect(got?.status).toBe('pending-resume')
    expect(got?.pendingResumeUntil).toBe(9999)
  })

  it('revoke flips status and clears pendingResumeUntil', async () => {
    await store.create(baseRecord({ status: 'active', pendingResumeUntil: 9999 }))
    await store.revoke('t1')
    const got = await store.findByTid('t1')
    expect(got?.status).toBe('revoked')
    expect(got?.pendingResumeUntil).toBeNull()
  })

  it('mutations on a missing tid are no-ops (do not throw)', async () => {
    await store.touch('missing', 1)
    await store.markActive('missing', 'x', 1)
    await store.markPendingResume('missing', 1)
    await store.revoke('missing')
    expect(await store.findByTid('missing')).toBeNull()
  })
})
```

- [ ] **Step 2: Run**

```bash
cd packages/agent && pnpm vitest run test/server/token-store.test.ts
```

Expected: FAIL (module not found).

---

## Task 5: TokenStore — implementation

**Files:**

- Create: `packages/agent/src/server/token-store.ts`

- [ ] **Step 1: Implement**

```ts
import type { TokenRecord } from '../protocol.js'

/**
 * Append-only, read-friendly storage for token records. Implementations
 * must handle missing tids gracefully on mutations — callers race under
 * realistic conditions. Spec §10.3.
 */
export interface TokenStore {
  create(record: TokenRecord): Promise<void>
  findByTid(tid: string): Promise<TokenRecord | null>
  listByIdentity(uid: string): Promise<TokenRecord[]>
  touch(tid: string, now: number): Promise<void>
  markPendingResume(tid: string, until: number): Promise<void>
  markActive(tid: string, label: string, now: number): Promise<void>
  revoke(tid: string): Promise<void>
}

export class InMemoryTokenStore implements TokenStore {
  private byTid = new Map<string, TokenRecord>()

  async create(record: TokenRecord): Promise<void> {
    this.byTid.set(record.tid, { ...record })
  }

  async findByTid(tid: string): Promise<TokenRecord | null> {
    const r = this.byTid.get(tid)
    return r ? { ...r } : null
  }

  async listByIdentity(uid: string): Promise<TokenRecord[]> {
    const out: TokenRecord[] = []
    for (const r of this.byTid.values()) {
      if (r.uid === uid) out.push({ ...r })
    }
    return out
  }

  async touch(tid: string, now: number): Promise<void> {
    const r = this.byTid.get(tid)
    if (!r) return
    this.byTid.set(tid, { ...r, lastSeenAt: now })
  }

  async markPendingResume(tid: string, until: number): Promise<void> {
    const r = this.byTid.get(tid)
    if (!r) return
    this.byTid.set(tid, { ...r, status: 'pending-resume', pendingResumeUntil: until })
  }

  async markActive(tid: string, label: string, now: number): Promise<void> {
    const r = this.byTid.get(tid)
    if (!r) return
    this.byTid.set(tid, {
      ...r,
      status: 'active',
      label,
      lastSeenAt: now,
      pendingResumeUntil: null,
    })
  }

  async revoke(tid: string): Promise<void> {
    const r = this.byTid.get(tid)
    if (!r) return
    this.byTid.set(tid, { ...r, status: 'revoked', pendingResumeUntil: null })
  }
}
```

- [ ] **Step 2: Verify**

```bash
cd packages/agent && pnpm vitest run test/server/token-store.test.ts
cd packages/agent && pnpm check
```

Expected: all tests pass; check silent.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/server/token-store.ts packages/agent/test/server/token-store.test.ts
git commit -m "$(cat <<'COMMIT'
feat(agent): TokenStore interface + InMemoryTokenStore

Spec §10.3 TokenStore interface + a Map-backed reference impl. Clones
on read/write so callers can mutate returned records without
corrupting the store. Missing-tid mutations are no-ops.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 6: IdentityResolver — failing tests + impl

**Files:**

- Create: `packages/agent/test/server/identity.test.ts`
- Create: `packages/agent/src/server/identity.ts`

- [ ] **Step 1: Test file**

```ts
import { describe, it, expect } from 'vitest'
import {
  defaultIdentityResolver,
  signCookieValue,
  type IdentityResolver,
} from '../../src/server/identity.js'

const key = 'x'.repeat(32)

function mkReq(cookieHeader: string | null): Request {
  const h = new Headers()
  if (cookieHeader) h.set('cookie', cookieHeader)
  return new Request('https://app.example/agent/mint', { method: 'POST', headers: h })
}

describe('defaultIdentityResolver', () => {
  it('returns null when the cookie is absent (no auth configured)', async () => {
    const resolver: IdentityResolver = defaultIdentityResolver({
      name: 'llui-agent-uid',
      signingKey: key,
    })
    expect(await resolver(mkReq(null))).toBeNull()
  })

  it('returns null when the cookie is present but signature invalid', async () => {
    const resolver = defaultIdentityResolver({ name: 'llui-agent-uid', signingKey: key })
    expect(await resolver(mkReq('llui-agent-uid=bogus.signature'))).toBeNull()
  })

  it('returns the uid when the signed cookie validates', async () => {
    const signed = signCookieValue('user-42', key)
    const resolver = defaultIdentityResolver({ name: 'llui-agent-uid', signingKey: key })
    expect(await resolver(mkReq(`llui-agent-uid=${signed}`))).toBe('user-42')
  })

  it('ignores cookies other than the configured name', async () => {
    const signed = signCookieValue('user-42', key)
    const resolver = defaultIdentityResolver({ name: 'llui-agent-uid', signingKey: key })
    expect(await resolver(mkReq(`session=abc; llui-agent-uid=${signed}; csrf=xyz`))).toBe('user-42')
  })

  it('factory throws when constructed without a signing key', () => {
    expect(() => defaultIdentityResolver({ name: 'llui-agent-uid', signingKey: '' })).toThrow()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd packages/agent && pnpm vitest run test/server/identity.test.ts
```

- [ ] **Step 3: Implementation**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * A function that extracts a stable user identifier from an inbound
 * request. Returns null for anonymous/unknown requests. See spec §6.4.
 */
export type IdentityResolver = (req: Request) => Promise<string | null>

export type IdentityCookieConfig = {
  /** Cookie name to read (the app sets this cookie elsewhere). */
  name: string
  /** HMAC signing key; must be ≥32 bytes. Use the same key when setting. */
  signingKey: string | Uint8Array
}

/**
 * Reads a `${name}=<value>.<hmac>` cookie, verifies the signature, and
 * returns the value as `uid`. Apps that don't want this can omit the
 * `identityCookie` option on createLluiAgentServer — then uid is always null.
 */
export function defaultIdentityResolver(cfg: IdentityCookieConfig): IdentityResolver {
  if (!cfg.signingKey || (typeof cfg.signingKey === 'string' && cfg.signingKey.length < 32)) {
    throw new Error('IdentityCookie signingKey must be at least 32 bytes')
  }
  const keyBuf =
    typeof cfg.signingKey === 'string'
      ? Buffer.from(cfg.signingKey, 'utf8')
      : Buffer.from(cfg.signingKey)

  return async (req) => {
    const cookie = req.headers.get('cookie')
    if (!cookie) return null
    const pairs = cookie.split(';').map((s) => s.trim())
    for (const pair of pairs) {
      const eq = pair.indexOf('=')
      if (eq < 0) continue
      const name = pair.slice(0, eq)
      const value = pair.slice(eq + 1)
      if (name !== cfg.name) continue
      const dot = value.indexOf('.')
      if (dot < 0) return null
      const rawValue = value.slice(0, dot)
      const sigPart = value.slice(dot + 1)
      const sigBuf = Buffer.from(sigPart, 'base64url')
      const expected = createHmac('sha256', keyBuf).update(rawValue).digest()
      if (expected.length !== sigBuf.length || !timingSafeEqual(expected, sigBuf)) return null
      return rawValue
    }
    return null
  }
}

/**
 * Helper for developer apps: produces a `<value>.<hmac>` string to set
 * as the cookie value when signing in a user. The app's login flow is
 * the canonical setter — this helper just enforces the same format
 * the resolver will accept.
 */
export function signCookieValue(value: string, signingKey: string | Uint8Array): string {
  const keyBuf =
    typeof signingKey === 'string' ? Buffer.from(signingKey, 'utf8') : Buffer.from(signingKey)
  const mac = createHmac('sha256', keyBuf).update(value).digest('base64url')
  return `${value}.${mac}`
}
```

- [ ] **Step 4: Verify + commit**

```bash
cd packages/agent && pnpm vitest run test/server/identity.test.ts
cd packages/agent && pnpm check
git add packages/agent/src/server/identity.ts packages/agent/test/server/identity.test.ts
git commit -m "$(cat <<'COMMIT'
feat(agent): defaultIdentityResolver — signed cookie identity

Reads a <value>.<hmac-base64url> cookie and returns the value as uid.
Apps that don't need identity simply omit the option — null is fine.
signCookieValue helper exposed for developer auth flows. Spec §6.4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 7: AuditSink + RateLimiter — combined TDD

**Files:**

- Create: `packages/agent/src/server/audit.ts`
- Create: `packages/agent/src/server/rate-limit.ts`
- Create: `packages/agent/test/server/audit.test.ts`
- Create: `packages/agent/test/server/rate-limit.test.ts`

- [ ] **Step 1: audit.test.ts**

```ts
import { describe, it, expect, vi } from 'vitest'
import { consoleAuditSink } from '../../src/server/audit.js'
import type { AuditEntry } from '../../src/protocol.js'

describe('consoleAuditSink', () => {
  it('writes JSONL to stdout via process.stdout.write by default', () => {
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const entry: AuditEntry = {
      at: 12345,
      tid: 't1',
      uid: 'u1',
      event: 'mint',
      detail: { foo: 'bar' },
    }
    consoleAuditSink.write(entry)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('"event":"mint"'))
    expect(spy).toHaveBeenCalledWith(expect.stringMatching(/\n$/))
    spy.mockRestore()
  })
})
```

- [ ] **Step 2: audit.ts**

```ts
import type { AuditEntry } from '../protocol.js'

export type AuditSink = {
  write: (entry: AuditEntry) => void | Promise<void>
}

export const consoleAuditSink: AuditSink = {
  write(entry) {
    process.stdout.write(JSON.stringify(entry) + '\n')
  },
}
```

- [ ] **Step 3: rate-limit.test.ts**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { defaultRateLimiter } from '../../src/server/rate-limit.js'

let clock = 0
const now = () => clock
beforeEach(() => {
  clock = 0
})

describe('defaultRateLimiter — token bucket', () => {
  it('allows under-limit calls', async () => {
    const rl = defaultRateLimiter({ perBucket: '5/second' }, now)
    for (let i = 0; i < 5; i++) {
      const res = await rl.check('t1', 'token')
      expect(res.allowed).toBe(true)
    }
  })

  it('blocks and returns retryAfterMs when over limit', async () => {
    const rl = defaultRateLimiter({ perBucket: '2/second' }, now)
    await rl.check('t1', 'token')
    await rl.check('t1', 'token')
    const over = await rl.check('t1', 'token')
    expect(over.allowed).toBe(false)
    expect(over.retryAfterMs).toBeGreaterThan(0)
  })

  it('refills as time passes', async () => {
    const rl = defaultRateLimiter({ perBucket: '2/second' }, now)
    await rl.check('t1', 'token')
    await rl.check('t1', 'token')
    expect((await rl.check('t1', 'token')).allowed).toBe(false)
    clock = 1000 // 1 second — fully refilled
    expect((await rl.check('t1', 'token')).allowed).toBe(true)
  })

  it('token and identity buckets are independent', async () => {
    const rl = defaultRateLimiter({ perBucket: '1/second' }, now)
    expect((await rl.check('t1', 'token')).allowed).toBe(true)
    expect((await rl.check('t1', 'token')).allowed).toBe(false)
    expect((await rl.check('u1', 'identity')).allowed).toBe(true)
  })
})
```

- [ ] **Step 4: rate-limit.ts**

```ts
export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterMs: number }

export interface RateLimiter {
  check(key: string, bucket: 'token' | 'identity'): Promise<RateLimitResult>
}

export type RateLimitConfig = {
  /** e.g. `'30/minute'`, `'5/second'`, `'300/hour'` — applied to EACH bucket. */
  perBucket: string
}

const UNIT_MS: Record<string, number> = {
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
}

function parseRate(spec: string): { count: number; windowMs: number } {
  const m = spec.match(/^(\d+)\/(second|minute|hour)$/)
  if (!m) throw new Error(`invalid rate spec: ${spec}`)
  const count = Number(m[1])
  const windowMs = UNIT_MS[m[2] as keyof typeof UNIT_MS]
  return { count, windowMs }
}

export function defaultRateLimiter(
  cfg: RateLimitConfig,
  now: () => number = () => Date.now(),
): RateLimiter {
  const { count, windowMs } = parseRate(cfg.perBucket)
  const refillPerMs = count / windowMs

  type BucketState = { tokens: number; lastCheck: number }
  const state = new Map<string, BucketState>()

  return {
    async check(key, bucket) {
      const k = `${bucket}:${key}`
      const nowMs = now()
      let b = state.get(k)
      if (!b) {
        b = { tokens: count, lastCheck: nowMs }
        state.set(k, b)
      } else {
        const delta = nowMs - b.lastCheck
        b.tokens = Math.min(count, b.tokens + delta * refillPerMs)
        b.lastCheck = nowMs
      }
      if (b.tokens >= 1) {
        b.tokens -= 1
        return { allowed: true }
      }
      const retryAfterMs = Math.ceil((1 - b.tokens) / refillPerMs)
      return { allowed: false, retryAfterMs }
    },
  }
}
```

- [ ] **Step 5: Verify + commit**

```bash
cd packages/agent && pnpm vitest run test/server/audit.test.ts test/server/rate-limit.test.ts
cd packages/agent && pnpm check
git add packages/agent/src/server/audit.ts packages/agent/src/server/rate-limit.ts packages/agent/test/server/audit.test.ts packages/agent/test/server/rate-limit.test.ts
git commit -m "$(cat <<'COMMIT'
feat(agent): consoleAuditSink + defaultRateLimiter

JSONL audit sink writes to stdout by default; rate limiter is an
in-memory token bucket keyed by (bucket, key) with linear refill.
Spec §10.3, §10.6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 8: Mint endpoint — failing integration test

**Files:**

- Create: `packages/agent/test/server/mint.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { handleMint } from '../../src/server/http/mint.js'
import { InMemoryTokenStore } from '../../src/server/token-store.js'
import { verifyToken } from '../../src/server/token.js'
import type { MintResponse } from '../../src/protocol.js'

const key = 'x'.repeat(32)
let store: InMemoryTokenStore
let auditLog: unknown[]
let clock = 1_700_000_000

const now = () => clock
beforeEach(() => {
  store = new InMemoryTokenStore()
  auditLog = []
  clock = 1_700_000_000
})

const audit = {
  write: (e: unknown) => {
    auditLog.push(e)
  },
}

describe('handleMint', () => {
  it('creates a pairing record and returns a signed token + wsUrl + lapUrl', async () => {
    const req = new Request('https://app.example/agent/mint', { method: 'POST' })
    const res = await handleMint(req, {
      signingKey: key,
      tokenStore: store,
      identityResolver: async () => 'u1',
      auditSink: audit,
      lapBasePath: '/agent/lap/v1',
      now: () => clock * 1000, // ms-resolution wall clock
      uuid: () => '11111111-1111-1111-1111-111111111111',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as MintResponse
    expect(body.tid).toBe('11111111-1111-1111-1111-111111111111')
    expect(body.lapUrl).toBe('https://app.example/agent/lap/v1')
    expect(body.wsUrl).toMatch(/^wss?:\/\/app\.example\/agent\/ws$/)
    expect(body.expiresAt).toBeGreaterThan(clock)

    const stored = await store.findByTid(body.tid)
    expect(stored?.uid).toBe('u1')
    expect(stored?.status).toBe('awaiting-ws')
    expect(stored?.origin).toBe('https://app.example')

    const verified = verifyToken(body.token, key, clock)
    expect(verified.kind).toBe('ok')
  })

  it('tolerates a null identity (anonymous app)', async () => {
    const req = new Request('https://app.example/agent/mint', { method: 'POST' })
    const res = await handleMint(req, {
      signingKey: key,
      tokenStore: store,
      identityResolver: async () => null,
      auditSink: audit,
      lapBasePath: '/agent/lap/v1',
      now: () => clock * 1000,
      uuid: () => 't-null',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as MintResponse
    const stored = await store.findByTid(body.tid)
    expect(stored?.uid).toBeNull()
  })

  it('writes a mint audit entry', async () => {
    const req = new Request('https://app.example/agent/mint', { method: 'POST' })
    await handleMint(req, {
      signingKey: key,
      tokenStore: store,
      identityResolver: async () => 'u1',
      auditSink: audit,
      lapBasePath: '/agent/lap/v1',
      now: () => clock * 1000,
      uuid: () => 'tid-audit',
    })
    expect(auditLog).toHaveLength(1)
    expect((auditLog[0] as { event: string }).event).toBe('mint')
  })

  it('rejects non-POST methods', async () => {
    const req = new Request('https://app.example/agent/mint', { method: 'GET' })
    const res = await handleMint(req, {
      signingKey: key,
      tokenStore: store,
      identityResolver: async () => null,
      auditSink: audit,
      lapBasePath: '/agent/lap/v1',
      now: () => clock * 1000,
      uuid: () => 'x',
    })
    expect(res.status).toBe(405)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd packages/agent && pnpm vitest run test/server/mint.test.ts
```

---

## Task 9: Mint endpoint — implementation

**Files:**

- Create: `packages/agent/src/server/http/mint.ts`

- [ ] **Step 1: Implement**

```ts
import type { TokenStore } from '../token-store.js'
import type { IdentityResolver } from '../identity.js'
import type { AuditSink } from '../audit.js'
import { signToken } from '../token.js'
import type { MintResponse, TokenPayload, TokenRecord } from '../../protocol.js'
import { randomUUID } from 'node:crypto'

export type MintDeps = {
  signingKey: string | Uint8Array
  tokenStore: TokenStore
  identityResolver: IdentityResolver
  auditSink: AuditSink
  lapBasePath: string
  /** Wall-clock in milliseconds; injectable for tests. */
  now?: () => number
  /** UUID generator; injectable for tests. */
  uuid?: () => string
  /** Hard-expiry window, default 24 h. */
  hardExpiryMs?: number
}

/**
 * POST /agent/mint — creates a pairing record and returns the mint
 * response. See spec §6.2. The caller is responsible for routing
 * `/agent/mint` requests to this handler; `router.ts` composes that.
 */
export async function handleMint(req: Request, deps: MintDeps): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: { code: 'method-not-allowed' } }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    })
  }

  const now = deps.now ?? (() => Date.now())
  const uuid = deps.uuid ?? randomUUID
  const hardExpiryMs = deps.hardExpiryMs ?? 24 * 60 * 60 * 1000

  const uid = await deps.identityResolver(req)
  const tid = uuid()
  const nowMs = now()
  const iat = Math.floor(nowMs / 1000)
  const exp = Math.floor((nowMs + hardExpiryMs) / 1000)
  const origin = new URL(req.url).origin

  const payload: TokenPayload = { tid, iat, exp, scope: 'agent' }
  const token = signToken(payload, deps.signingKey)

  const record: TokenRecord = {
    tid,
    uid,
    status: 'awaiting-ws',
    createdAt: nowMs,
    lastSeenAt: nowMs,
    pendingResumeUntil: null,
    origin,
    label: null,
  }
  await deps.tokenStore.create(record)

  await deps.auditSink.write({
    at: nowMs,
    tid,
    uid,
    event: 'mint',
    detail: { origin },
  })

  const wsUrl = toWsUrl(new URL(req.url).origin) + '/agent/ws'
  const lapUrl = new URL(deps.lapBasePath, origin).toString()

  const body: MintResponse = {
    token,
    tid,
    wsUrl,
    lapUrl,
    expiresAt: exp,
  }
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function toWsUrl(httpOrigin: string): string {
  return httpOrigin.startsWith('https://')
    ? 'wss://' + httpOrigin.slice('https://'.length)
    : 'ws://' + httpOrigin.slice('http://'.length)
}
```

- [ ] **Step 2: Run tests + check + commit**

```bash
cd packages/agent && pnpm vitest run test/server/mint.test.ts
cd packages/agent && pnpm check
git add packages/agent/src/server/http/mint.ts packages/agent/test/server/mint.test.ts
git commit -m "$(cat <<'COMMIT'
feat(agent): POST /agent/mint endpoint

Resolves identity, creates a TokenRecord, signs a token, returns
{token, tid, wsUrl, lapUrl, expiresAt}. Writes a mint audit entry.
All time/uuid sources are injectable for deterministic tests.
Spec §6.2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 10: Resume endpoints (list + claim) — combined TDD

**Files:**

- Create: `packages/agent/test/server/resume.test.ts`
- Create: `packages/agent/src/server/http/resume.ts`

- [ ] **Step 1: Test file**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { handleResumeList, handleResumeClaim } from '../../src/server/http/resume.js'
import { InMemoryTokenStore } from '../../src/server/token-store.js'
import { verifyToken } from '../../src/server/token.js'
import type { TokenRecord, ResumeListResponse, ResumeClaimResponse } from '../../src/protocol.js'

const key = 'x'.repeat(32)
let store: InMemoryTokenStore
let audit: { write: (e: unknown) => void }
let log: unknown[]

beforeEach(() => {
  store = new InMemoryTokenStore()
  log = []
  audit = {
    write: (e) => {
      log.push(e)
    },
  }
})

const seedPendingResume = async (tid: string, uid: string | null, origin: string) => {
  const rec: TokenRecord = {
    tid,
    uid,
    status: 'pending-resume',
    createdAt: 1000,
    lastSeenAt: 1000,
    pendingResumeUntil: 9999,
    origin,
    label: 'Claude · Opus',
  }
  await store.create(rec)
}

describe('handleResumeList', () => {
  it('returns only pending-resume pairings for the current identity', async () => {
    await seedPendingResume('t1', 'u1', 'https://app.example')
    await seedPendingResume('t2', 'u1', 'https://app.example')
    await seedPendingResume('t3', 'u2', 'https://app.example')
    const req = new Request('https://app.example/agent/resume/list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tids: ['t1', 't2', 't3'] }),
    })
    const res = await handleResumeList(req, {
      tokenStore: store,
      identityResolver: async () => 'u1',
      auditSink: audit,
      now: () => 5000,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as ResumeListResponse
    expect(body.sessions.map((s) => s.tid).sort()).toEqual(['t1', 't2'])
  })

  it('filters out records past pendingResumeUntil', async () => {
    await seedPendingResume('t1', 'u1', 'https://app.example')
    const rec = (await store.findByTid('t1'))!
    // grace expired
    await store.markPendingResume('t1', 500)
    const req = new Request('https://app.example/agent/resume/list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tids: ['t1'] }),
    })
    const res = await handleResumeList(req, {
      tokenStore: store,
      identityResolver: async () => 'u1',
      auditSink: audit,
      now: () => 10_000,
    })
    const body = (await res.json()) as ResumeListResponse
    expect(body.sessions).toEqual([])
  })
})

describe('handleResumeClaim', () => {
  it('returns a fresh token + wsUrl and flips the record to active', async () => {
    await seedPendingResume('t1', 'u1', 'https://app.example')
    const req = new Request('https://app.example/agent/resume/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tid: 't1' }),
    })
    const res = await handleResumeClaim(req, {
      tokenStore: store,
      identityResolver: async () => 'u1',
      auditSink: audit,
      signingKey: key,
      now: () => 5000,
      hardExpiryMs: 3600_000,
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as ResumeClaimResponse
    expect(body.token).toBeDefined()
    expect(body.wsUrl).toMatch(/\/agent\/ws$/)
    const verified = verifyToken(body.token, key, 5)
    expect(verified.kind).toBe('ok')

    const stored = await store.findByTid('t1')
    expect(stored?.status).toBe('active')
  })

  it('rejects when the identity does not own the tid', async () => {
    await seedPendingResume('t1', 'u1', 'https://app.example')
    const req = new Request('https://app.example/agent/resume/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tid: 't1' }),
    })
    const res = await handleResumeClaim(req, {
      tokenStore: store,
      identityResolver: async () => 'u-someone-else',
      auditSink: audit,
      signingKey: key,
      now: () => 5000,
      hardExpiryMs: 3600_000,
    })
    expect(res.status).toBe(403)
  })

  it('rejects when the origin differs from the minted origin', async () => {
    await seedPendingResume('t1', 'u1', 'https://app.example')
    const req = new Request('https://other.example/agent/resume/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tid: 't1' }),
    })
    const res = await handleResumeClaim(req, {
      tokenStore: store,
      identityResolver: async () => 'u1',
      auditSink: audit,
      signingKey: key,
      now: () => 5000,
      hardExpiryMs: 3600_000,
    })
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implementation**

```ts
import type { TokenStore } from '../token-store.js'
import type { IdentityResolver } from '../identity.js'
import type { AuditSink } from '../audit.js'
import { signToken } from '../token.js'
import type {
  ResumeListRequest,
  ResumeListResponse,
  ResumeClaimRequest,
  ResumeClaimResponse,
  TokenPayload,
  AgentSession,
} from '../../protocol.js'

export type ResumeDeps = {
  tokenStore: TokenStore
  identityResolver: IdentityResolver
  auditSink: AuditSink
  signingKey?: string | Uint8Array
  now?: () => number
  hardExpiryMs?: number
}

export async function handleResumeList(req: Request, deps: ResumeDeps): Promise<Response> {
  if (req.method !== 'POST') return methodNotAllowed()
  const body = (await req.json().catch(() => null)) as ResumeListRequest | null
  if (!body || !Array.isArray(body.tids)) return badRequest()

  const uid = await deps.identityResolver(req)
  const nowMs = (deps.now ?? (() => Date.now()))()
  const out: AgentSession[] = []
  for (const tid of body.tids) {
    const rec = await deps.tokenStore.findByTid(tid)
    if (!rec) continue
    if (rec.uid !== uid) continue
    if (rec.status !== 'pending-resume') continue
    if (rec.pendingResumeUntil === null || rec.pendingResumeUntil < nowMs) continue
    out.push({
      tid: rec.tid,
      label: rec.label ?? '(unknown)',
      status: 'pending-resume',
      createdAt: rec.createdAt,
      lastSeenAt: rec.lastSeenAt,
    })
  }

  const payload: ResumeListResponse = { sessions: out }
  return jsonResponse(payload, 200)
}

export async function handleResumeClaim(req: Request, deps: ResumeDeps): Promise<Response> {
  if (req.method !== 'POST') return methodNotAllowed()
  if (!deps.signingKey) return new Response(null, { status: 500 })

  const body = (await req.json().catch(() => null)) as ResumeClaimRequest | null
  if (!body || typeof body.tid !== 'string') return badRequest()

  const uid = await deps.identityResolver(req)
  const rec = await deps.tokenStore.findByTid(body.tid)
  if (!rec) return forbidden()
  if (rec.uid !== uid) return forbidden()
  if (rec.status !== 'pending-resume') return forbidden()

  const origin = new URL(req.url).origin
  if (rec.origin !== origin) return forbidden()

  const nowMs = (deps.now ?? (() => Date.now()))()
  const hardExpiryMs = deps.hardExpiryMs ?? 24 * 60 * 60 * 1000
  const iat = Math.floor(nowMs / 1000)
  const exp = Math.floor((nowMs + hardExpiryMs) / 1000)
  const payload: TokenPayload = { tid: rec.tid, iat, exp, scope: 'agent' }
  const token = signToken(payload, deps.signingKey)

  await deps.tokenStore.markActive(rec.tid, rec.label ?? '(resumed)', nowMs)

  await deps.auditSink.write({
    at: nowMs,
    tid: rec.tid,
    uid: rec.uid,
    event: 'claim',
    detail: { origin },
  })

  const wsUrl = toWsUrl(origin) + '/agent/ws'
  const out: ResumeClaimResponse = { token, wsUrl }
  return jsonResponse(out, 200)
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function methodNotAllowed(): Response {
  return jsonResponse({ error: { code: 'method-not-allowed' } }, 405)
}

function badRequest(): Response {
  return jsonResponse({ error: { code: 'invalid' } }, 400)
}

function forbidden(): Response {
  return jsonResponse({ error: { code: 'revoked' } }, 403)
}

function toWsUrl(httpOrigin: string): string {
  return httpOrigin.startsWith('https://')
    ? 'wss://' + httpOrigin.slice('https://'.length)
    : 'ws://' + httpOrigin.slice('http://'.length)
}
```

- [ ] **Step 4: Verify + commit**

```bash
cd packages/agent && pnpm vitest run test/server/resume.test.ts
cd packages/agent && pnpm check
git add packages/agent/src/server/http/resume.ts packages/agent/test/server/resume.test.ts
git commit -m "$(cat <<'COMMIT'
feat(agent): POST /agent/resume/list + /agent/resume/claim

resume/list: filters to the caller's identity, pending-resume status,
unexpired grace. resume/claim: enforces identity match, origin pin,
pending-resume state → signs a fresh token, flips record to active,
writes a claim audit entry. Spec §6.3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 11: Revoke + Sessions endpoints

**Files:**

- Create: `packages/agent/test/server/revoke.test.ts`
- Create: `packages/agent/test/server/sessions.test.ts`
- Create: `packages/agent/src/server/http/revoke.ts`
- Create: `packages/agent/src/server/http/sessions.ts`

- [ ] **Step 1: revoke.test.ts**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { handleRevoke } from '../../src/server/http/revoke.js'
import { InMemoryTokenStore } from '../../src/server/token-store.js'
import type { TokenRecord } from '../../src/protocol.js'

let store: InMemoryTokenStore
let log: unknown[]
const audit = { write: (e: unknown) => log.push(e) }

beforeEach(() => {
  store = new InMemoryTokenStore()
  log = []
})

const seed = async (tid: string, uid: string | null) => {
  const rec: TokenRecord = {
    tid,
    uid,
    status: 'active',
    createdAt: 0,
    lastSeenAt: 0,
    pendingResumeUntil: null,
    origin: 'https://app.example',
    label: null,
  }
  await store.create(rec)
}

describe('handleRevoke', () => {
  it('flips status to revoked for caller-owned tokens', async () => {
    await seed('t1', 'u1')
    const req = new Request('https://app.example/agent/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tid: 't1' }),
    })
    const res = await handleRevoke(req, {
      tokenStore: store,
      identityResolver: async () => 'u1',
      auditSink: audit,
      now: () => 1000,
    })
    expect(res.status).toBe(200)
    const stored = await store.findByTid('t1')
    expect(stored?.status).toBe('revoked')
    expect(log).toHaveLength(1)
  })

  it('refuses to revoke tokens owned by someone else', async () => {
    await seed('t1', 'u1')
    const req = new Request('https://app.example/agent/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tid: 't1' }),
    })
    const res = await handleRevoke(req, {
      tokenStore: store,
      identityResolver: async () => 'attacker',
      auditSink: audit,
      now: () => 1000,
    })
    expect(res.status).toBe(403)
    const stored = await store.findByTid('t1')
    expect(stored?.status).toBe('active')
  })
})
```

- [ ] **Step 2: revoke.ts**

```ts
import type { TokenStore } from '../token-store.js'
import type { IdentityResolver } from '../identity.js'
import type { AuditSink } from '../audit.js'
import type { RevokeRequest, RevokeResponse } from '../../protocol.js'

export type RevokeDeps = {
  tokenStore: TokenStore
  identityResolver: IdentityResolver
  auditSink: AuditSink
  now?: () => number
}

export async function handleRevoke(req: Request, deps: RevokeDeps): Promise<Response> {
  if (req.method !== 'POST') {
    return json({ error: { code: 'method-not-allowed' } }, 405)
  }
  const body = (await req.json().catch(() => null)) as RevokeRequest | null
  if (!body || typeof body.tid !== 'string') return json({ error: { code: 'invalid' } }, 400)

  const uid = await deps.identityResolver(req)
  const rec = await deps.tokenStore.findByTid(body.tid)
  if (!rec || rec.uid !== uid) return json({ error: { code: 'revoked' } }, 403)

  const nowMs = (deps.now ?? (() => Date.now()))()
  await deps.tokenStore.revoke(body.tid)
  await deps.auditSink.write({ at: nowMs, tid: body.tid, uid, event: 'revoke', detail: {} })

  const out: RevokeResponse = { status: 'revoked' }
  return json(out, 200)
}

function json(b: unknown, s: number): Response {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { 'content-type': 'application/json' },
  })
}
```

- [ ] **Step 3: sessions.test.ts**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { handleSessions } from '../../src/server/http/sessions.js'
import { InMemoryTokenStore } from '../../src/server/token-store.js'
import type { TokenRecord, SessionsResponse } from '../../src/protocol.js'

let store: InMemoryTokenStore
beforeEach(() => {
  store = new InMemoryTokenStore()
})

const base = (o: Partial<TokenRecord> = {}): TokenRecord => ({
  tid: 't',
  uid: 'u1',
  status: 'active',
  createdAt: 1,
  lastSeenAt: 1,
  pendingResumeUntil: null,
  origin: 'https://app',
  label: null,
  ...o,
})

describe('handleSessions', () => {
  it('returns active + pending-resume sessions for the caller, excludes revoked', async () => {
    await store.create(base({ tid: 't1', status: 'active' }))
    await store.create(
      base({ tid: 't2', status: 'pending-resume', pendingResumeUntil: 9999, label: 'Claude' }),
    )
    await store.create(base({ tid: 't3', status: 'revoked' }))
    await store.create(base({ tid: 't4', uid: 'other', status: 'active' }))
    const req = new Request('https://app/agent/sessions', { method: 'GET' })
    const res = await handleSessions(req, {
      tokenStore: store,
      identityResolver: async () => 'u1',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as SessionsResponse
    expect(body.sessions.map((s) => s.tid).sort()).toEqual(['t1', 't2'])
  })

  it('returns an empty list when identity resolves to null', async () => {
    await store.create(base({ tid: 't1', uid: 'u1' }))
    const req = new Request('https://app/agent/sessions', { method: 'GET' })
    const res = await handleSessions(req, {
      tokenStore: store,
      identityResolver: async () => null,
    })
    const body = (await res.json()) as SessionsResponse
    expect(body.sessions).toEqual([])
  })
})
```

- [ ] **Step 4: sessions.ts**

```ts
import type { TokenStore } from '../token-store.js'
import type { IdentityResolver } from '../identity.js'
import type { AgentSession, SessionsResponse } from '../../protocol.js'

export type SessionsDeps = {
  tokenStore: TokenStore
  identityResolver: IdentityResolver
}

export async function handleSessions(req: Request, deps: SessionsDeps): Promise<Response> {
  if (req.method !== 'GET') {
    return json({ error: { code: 'method-not-allowed' } }, 405)
  }
  const uid = await deps.identityResolver(req)
  if (uid === null) {
    return json({ sessions: [] } satisfies SessionsResponse, 200)
  }
  const records = await deps.tokenStore.listByIdentity(uid)
  const sessions: AgentSession[] = records
    .filter((r) => r.status === 'active' || r.status === 'pending-resume')
    .map((r) => ({
      tid: r.tid,
      label: r.label ?? '(unknown)',
      status: r.status as 'active' | 'pending-resume',
      createdAt: r.createdAt,
      lastSeenAt: r.lastSeenAt,
    }))
  return json({ sessions } satisfies SessionsResponse, 200)
}

function json(b: unknown, s: number): Response {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { 'content-type': 'application/json' },
  })
}
```

- [ ] **Step 5: Verify + commit**

```bash
cd packages/agent && pnpm vitest run test/server/revoke.test.ts test/server/sessions.test.ts
cd packages/agent && pnpm check
git add packages/agent/src/server/http/revoke.ts packages/agent/src/server/http/sessions.ts packages/agent/test/server/revoke.test.ts packages/agent/test/server/sessions.test.ts
git commit -m "$(cat <<'COMMIT'
feat(agent): POST /agent/revoke + GET /agent/sessions

revoke enforces identity ownership; writes revoke audit entry.
sessions filters to active+pending-resume for the caller, empty when
unauthenticated. Spec §6.5, §10.2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 12: Router — combining HTTP handlers

**Files:**

- Create: `packages/agent/src/server/http/router.ts`
- Create: `packages/agent/test/server/router.test.ts`

- [ ] **Step 1: router.ts**

```ts
import { handleMint, type MintDeps } from './mint.js'
import { handleResumeList, handleResumeClaim, type ResumeDeps } from './resume.js'
import { handleRevoke, type RevokeDeps } from './revoke.js'
import { handleSessions, type SessionsDeps } from './sessions.js'

export type RouterDeps = MintDeps & ResumeDeps & RevokeDeps & SessionsDeps

/**
 * Matches any /agent/* request and returns the appropriate Response.
 * Returns `null` when the request doesn't match any known path — caller
 * can fall through to their framework's 404 handling. LAP and WS paths
 * are NOT handled here (they land in Plan 5 + factory composition).
 */
export function createHttpRouter(deps: RouterDeps): (req: Request) => Promise<Response | null> {
  return async (req) => {
    const url = new URL(req.url)
    const path = url.pathname

    if (path === '/agent/mint') return handleMint(req, deps)
    if (path === '/agent/resume/list') return handleResumeList(req, deps)
    if (path === '/agent/resume/claim') return handleResumeClaim(req, deps)
    if (path === '/agent/revoke') return handleRevoke(req, deps)
    if (path === '/agent/sessions') return handleSessions(req, deps)

    return null
  }
}
```

- [ ] **Step 2: router.test.ts — integration over the full router surface**

```ts
import { describe, it, expect } from 'vitest'
import { createHttpRouter } from '../../src/server/http/router.js'
import { InMemoryTokenStore } from '../../src/server/token-store.js'

const key = 'x'.repeat(32)

const mkRouter = () => {
  const store = new InMemoryTokenStore()
  const audit = { write: () => {} }
  return createHttpRouter({
    signingKey: key,
    tokenStore: store,
    identityResolver: async () => 'u1',
    auditSink: audit,
    lapBasePath: '/agent/lap/v1',
  })
}

describe('createHttpRouter', () => {
  it('routes /agent/mint', async () => {
    const r = mkRouter()
    const res = await r(new Request('https://app/agent/mint', { method: 'POST' }))
    expect(res?.status).toBe(200)
  })

  it('returns null for unknown paths', async () => {
    const r = mkRouter()
    const res = await r(new Request('https://app/unknown', { method: 'GET' }))
    expect(res).toBeNull()
  })

  it('routes /agent/sessions', async () => {
    const r = mkRouter()
    const res = await r(new Request('https://app/agent/sessions', { method: 'GET' }))
    expect(res?.status).toBe(200)
  })
})
```

- [ ] **Step 3: Verify + commit**

```bash
cd packages/agent && pnpm vitest run test/server/router.test.ts
cd packages/agent && pnpm check
git add packages/agent/src/server/http/router.ts packages/agent/test/server/router.test.ts
git commit -m "$(cat <<'COMMIT'
feat(agent): HTTP router — combined /agent/* dispatcher

Request -> Response | null for the 5 non-LAP endpoints. Unknown paths
return null so callers can fall through to their framework's 404.
LAP and WS routing composed in factory.ts + Plan 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 13: createLluiAgentServer factory

**Files:**

- Create: `packages/agent/src/server/factory.ts`
- Create: `packages/agent/test/server/factory.test.ts`

- [ ] **Step 1: factory.ts**

```ts
import type { ServerOptions, AgentServerHandle } from './options.js'
import { InMemoryTokenStore } from './token-store.js'
import { consoleAuditSink } from './audit.js'
import { defaultRateLimiter } from './rate-limit.js'
import { createHttpRouter } from './http/router.js'

const ANONYMOUS_RESOLVER = async () => null

/**
 * Compose the server from its (defaulted) parts. Returns a handle whose
 * `router` matches any /agent/* request. `wsUpgrade` lands in Plan 5.
 *
 * Spec §10.1.
 */
export function createLluiAgentServer(opts: ServerOptions): AgentServerHandle {
  if (!opts.signingKey) {
    throw new Error('createLluiAgentServer: signingKey is required')
  }

  const tokenStore = opts.tokenStore ?? new InMemoryTokenStore()
  const identityResolver = opts.identityResolver ?? ANONYMOUS_RESOLVER
  const auditSink = opts.auditSink ?? consoleAuditSink
  const rateLimiter = opts.rateLimiter ?? defaultRateLimiter({ perBucket: '30/minute' })
  const lapBasePath = opts.lapBasePath ?? '/agent/lap/v1'

  const router = createHttpRouter({
    signingKey: opts.signingKey,
    tokenStore,
    identityResolver,
    auditSink,
    lapBasePath,
  })

  // Silence unused-until-Plan-5 warnings:
  void rateLimiter

  return {
    router,
  }
}
```

- [ ] **Step 2: factory.test.ts — lifecycle integration**

```ts
import { describe, it, expect } from 'vitest'
import { createLluiAgentServer, InMemoryTokenStore } from '../../src/server/index.js'
import { verifyToken } from '../../src/server/token.js'
import type { MintResponse, SessionsResponse } from '../../src/protocol.js'

const key = 'x'.repeat(32)

describe('createLluiAgentServer — full HTTP lifecycle', () => {
  it('mints then lists then revokes through the public handle', async () => {
    const store = new InMemoryTokenStore()
    const agent = createLluiAgentServer({
      signingKey: key,
      tokenStore: store,
      identityResolver: async () => 'u1',
      auditSink: { write: () => {} },
    })

    const mintRes = await agent.router(new Request('https://app/agent/mint', { method: 'POST' }))
    expect(mintRes?.status).toBe(200)
    const mintBody = (await mintRes!.json()) as MintResponse
    expect(verifyToken(mintBody.token, key).kind).toBe('ok')

    const listRes = await agent.router(new Request('https://app/agent/sessions'))
    expect(listRes?.status).toBe(200)
    const listBody = (await listRes!.json()) as SessionsResponse
    expect(listBody.sessions.map((s) => s.tid)).toContain(mintBody.tid)

    const revokeRes = await agent.router(
      new Request('https://app/agent/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tid: mintBody.tid }),
      }),
    )
    expect(revokeRes?.status).toBe(200)

    const postRevokeList = await agent.router(new Request('https://app/agent/sessions'))
    const postRevokeBody = (await postRevokeList!.json()) as SessionsResponse
    expect(postRevokeBody.sessions.map((s) => s.tid)).not.toContain(mintBody.tid)
  })

  it('throws when signingKey is missing', () => {
    expect(() => createLluiAgentServer({ signingKey: '' } as any)).toThrow()
  })

  it('uses sensible defaults when only signingKey is provided', () => {
    const agent = createLluiAgentServer({ signingKey: key })
    expect(typeof agent.router).toBe('function')
  })
})
```

- [ ] **Step 3: Verify + commit**

```bash
cd packages/agent && pnpm vitest run test/server/factory.test.ts
cd packages/agent && pnpm check
git add packages/agent/src/server/factory.ts packages/agent/test/server/factory.test.ts
git commit -m "$(cat <<'COMMIT'
feat(agent): createLluiAgentServer factory

Composes tokenStore / identityResolver / auditSink / rateLimiter with
sensible in-memory defaults; exposes a Web-standards Request -> Response
router matching /agent/*. wsUpgrade lands in Plan 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Task 14: Workspace verification

**Files:** none — verification.

- [ ] **Step 1: Full workspace**

```bash
cd /Users/franco/projects/llui
pnpm install
pnpm turbo build
pnpm turbo check
pnpm turbo lint
pnpm turbo test
```

All green. Report summary per command.

- [ ] **Step 2: Per-package test counts**

```bash
pnpm --filter @llui/agent test 2>&1 | tail -15
```

Expect: protocol tests (33) + server tests (~40 across 9 files) = ~70+ tests.

- [ ] **Step 3: No commit for this task.**

---

## Task 15: Commit Plan 4 plan file

```bash
cd /Users/franco/projects/llui
git add docs/superpowers/plans/2026-04-20-llui-agent-04-server-foundation.md
git commit -m "$(cat <<'COMMIT'
docs(agent): Plan 4 server-foundation — implementation plan document

Records the 15-task plan for @llui/agent/server's HTTP half: token
crypto, stores, identity, audit, rate-limit, mint/resume/revoke/
sessions endpoints, and the createLluiAgentServer factory. WS +
LAP dispatch explicitly deferred to Plan 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT
)"
```

---

## Completion Criteria

- `@llui/agent/server` exports: `createLluiAgentServer`, `ServerOptions`, `AgentServerHandle`, `InMemoryTokenStore`, `TokenStore`, `IdentityResolver`, `defaultIdentityResolver`, `AuditSink`, `consoleAuditSink`, `RateLimiter`, `defaultRateLimiter`.
- Token crypto: signToken / verifyToken round-trip; timing-safe; distinguishes malformed / bad-signature / expired.
- TokenStore: InMemoryTokenStore passes all CRUD + state-transition tests.
- Identity: signed cookie resolver passes all its tests; `signCookieValue` helper exported.
- Audit: consoleAuditSink writes JSONL to stdout.
- Rate limit: token-bucket refill works; separate buckets for token vs identity.
- Endpoints: mint / resume-list / resume-claim / revoke / sessions all pass integration tests using Web `Request`/`Response`.
- Factory: lifecycle test exercises mint → sessions → revoke → sessions round-trip.
- Workspace: all turbo tasks green.
- ~70+ tests in `@llui/agent`.

---

## Explicitly deferred (Plan 5)

- `wsUpgrade` handler for `/agent/ws`.
- Browser `hello` frame parsing + caching.
- LAP endpoints `/lap/v1/*` (describe, state, actions, message, confirm-result, wait, query-dom, describe-visible, context).
- RPC frame dispatcher forwarding to the paired WS channel.
- `describe_app` cache keyed on `schemaHash`.
