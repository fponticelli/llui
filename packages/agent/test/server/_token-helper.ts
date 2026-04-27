/**
 * Test helper: mint an opaque token and stash a TokenRecord in the
 * given store so authenticated requests round-trip in tests. The
 * pre-0.0.35 JWT-style flow let tests fabricate tokens with arbitrary
 * payloads via `signToken({...}, key)`; the new opaque flow doesn't
 * synthesise tokens — it mints them and binds them to a record.
 *
 * Most tests want a "valid token paired to this tid" — that's what
 * this helper produces.
 */
import { mintToken } from '../../src/server/token.js'
import type { TokenStore } from '../../src/server/token-store.js'
import type { TokenRecord, TokenStatus } from '../../src/protocol.js'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export type SeedTokenOpts = {
  tid: string
  uid?: string | null
  status?: TokenStatus
  /** Wall-clock ms; defaults to now. */
  now?: number
  /** Hard-expiry ms-since-epoch; defaults to now + 24h. */
  expiresAt?: number
  origin?: string
  label?: string | null
  pendingResumeUntil?: number | null
}

export async function seedToken(
  store: TokenStore,
  opts: SeedTokenOpts,
): Promise<{ token: string; tokenHash: string; tid: string; record: TokenRecord }> {
  const { token, tokenHash } = await mintToken()
  const now = opts.now ?? Date.now()
  const record: TokenRecord = {
    tid: opts.tid,
    tokenHash,
    uid: opts.uid ?? null,
    status: opts.status ?? 'active',
    createdAt: now,
    expiresAt: opts.expiresAt ?? now + DAY_MS,
    lastSeenAt: now,
    pendingResumeUntil: opts.pendingResumeUntil ?? null,
    origin: opts.origin ?? 'http://localhost',
    label: opts.label ?? null,
  }
  await store.create(record)
  return { token, tokenHash, tid: opts.tid, record }
}
