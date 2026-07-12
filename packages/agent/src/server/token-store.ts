import type { TokenRecord } from '../protocol.js'

/**
 * Append-only, read-friendly storage for token records.
 *
 * Tokens are looked up by `tokenHash` (SHA-256 of the presented bearer
 * value) on every authenticated request. The `tid` index is kept for
 * the resume / revoke / sessions surfaces — those operate on session
 * IDs the user can see and copy.
 */
export interface TokenStore {
  create(record: TokenRecord): Promise<void>
  findByTid(tid: string): Promise<TokenRecord | null>
  /**
   * Look up a record by the SHA-256 hash of its bearer token. Returns
   * `null` when the hash isn't in the store (the typical "this token
   * isn't ours / has been revoked / never existed" case).
   */
  findByTokenHash(tokenHash: string): Promise<TokenRecord | null>
  listByIdentity(uid: string): Promise<TokenRecord[]>
  touch(tid: string, now: number): Promise<void>
  markPendingResume(tid: string, until: number): Promise<void>
  /** Transition to awaiting-claude: browser WS is connected, waiting for Claude's first call. */
  markAwaitingClaude(tid: string, now: number): Promise<void>
  markActive(tid: string, label: string, now: number): Promise<void>
  revoke(tid: string): Promise<void>
  /**
   * Replace the bearer token's hash and bump expiry. Used by the
   * resume-claim flow: the old token is invalidated (its hash is no
   * longer indexed) and a freshly-minted opaque token takes its
   * place. The `tid` stays stable so existing audit / pairing state
   * carries over.
   */
  rotateTokenHash(tid: string, newTokenHash: string, expiresAt: number): Promise<void>
  /**
   * Evict records whose hard expiry lapsed more than `retentionMs` ago —
   * bounding memory for long-lived, high-churn deployments (every mint
   * creates a record; nothing removed them before). Optional: stores
   * backed by a database with row-level TTL manage this themselves and
   * can leave it unimplemented. Returns the number of records evicted.
   */
  sweepExpired?(now: number, retentionMs: number): Promise<number>
}

export class InMemoryTokenStore implements TokenStore {
  private byTid = new Map<string, TokenRecord>()
  // Secondary index for the auth hot path. Kept in sync with `byTid`
  // on `create`. Persistent stores would index this column at schema
  // time; the in-memory map is the same idea minus the DB.
  private tidByTokenHash = new Map<string, string>()

  async create(record: TokenRecord): Promise<void> {
    this.byTid.set(record.tid, { ...record })
    this.tidByTokenHash.set(record.tokenHash, record.tid)
  }

  async findByTid(tid: string): Promise<TokenRecord | null> {
    const r = this.byTid.get(tid)
    return r ? { ...r } : null
  }

  async findByTokenHash(tokenHash: string): Promise<TokenRecord | null> {
    const tid = this.tidByTokenHash.get(tokenHash)
    if (!tid) return null
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
    // Only transition from a live state. Don't lift `revoked` back
    // to `pending-resume` if a stale WS-close fires after a deliberate
    // revoke — and don't bring an already-`expired`/`pending-resume`
    // record back to a fresh grace window when the close handler
    // re-fires for any reason.
    if (r.status !== 'active' && r.status !== 'awaiting-claude') return
    this.byTid.set(tid, { ...r, status: 'pending-resume', pendingResumeUntil: until })
  }

  async markAwaitingClaude(tid: string, now: number): Promise<void> {
    const r = this.byTid.get(tid)
    if (!r) return
    this.byTid.set(tid, { ...r, status: 'awaiting-claude', lastSeenAt: now })
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
    // Drop the hash index entry so revoked tokens fail at the auth
    // boundary even if the bearer leaks. The byTid record stays for
    // audit / replay purposes.
    this.tidByTokenHash.delete(r.tokenHash)
  }

  async rotateTokenHash(tid: string, newTokenHash: string, expiresAt: number): Promise<void> {
    const r = this.byTid.get(tid)
    if (!r) return
    this.tidByTokenHash.delete(r.tokenHash)
    this.byTid.set(tid, { ...r, tokenHash: newTokenHash, expiresAt })
    this.tidByTokenHash.set(newTokenHash, tid)
  }

  async sweepExpired(now: number, retentionMs: number): Promise<number> {
    let evicted = 0
    for (const [tid, r] of this.byTid) {
      // Keep records until they're past hard expiry PLUS a retention
      // window — the window lets `/resume/list` and audit lookups still
      // find a just-expired session for a while after it lapses.
      if (r.expiresAt + retentionMs <= now) {
        this.byTid.delete(tid)
        this.tidByTokenHash.delete(r.tokenHash)
        evicted++
      }
    }
    return evicted
  }
}
