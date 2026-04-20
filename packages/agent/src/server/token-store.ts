import type { TokenRecord } from '../protocol.js'

/**
 * Append-only, read-friendly storage for token records. See spec §10.3.
 */
export interface TokenStore {
  create(record: TokenRecord): Promise<void>
  findByTid(tid: string): Promise<TokenRecord | null>
  listByIdentity(uid: string): Promise<TokenRecord[]>
  touch(tid: string, now: number): Promise<void>
  markPendingResume(tid: string, until: number): Promise<void>
  /** Transition to awaiting-claude: browser WS is connected, waiting for Claude's first call. */
  markAwaitingClaude(tid: string, now: number): Promise<void>
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
  }
}
