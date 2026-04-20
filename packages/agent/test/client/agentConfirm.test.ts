import { describe, it, expect, vi } from 'vitest'
import { init, update, connect } from '../../src/client/agentConfirm.js'
import type { ConfirmEntry, AgentConfirmState } from '../../src/client/agentConfirm.js'

// Inline fixtures
const makeEntry = (overrides: Partial<ConfirmEntry> = {}): ConfirmEntry => ({
  id: 'entry-1',
  variant: 'SubmitOrder',
  payload: { orderId: '42' },
  intent: 'Submit the order',
  reason: null,
  proposedAt: 1_000_000,
  status: 'pending',
  ...overrides,
})

describe('agentConfirm: init', () => {
  it('returns empty pending list and no effects', () => {
    const [state, effects] = init()
    expect(state).toEqual({ pending: [] })
    expect(effects).toHaveLength(0)
  })
})

describe('agentConfirm: Propose', () => {
  it('appends entry to pending list', () => {
    const [s0] = init()
    const entry = makeEntry()
    const [s1, effects] = update(s0, { type: 'Propose', entry })
    expect(s1.pending).toHaveLength(1)
    expect(s1.pending[0]).toEqual(entry)
    expect(effects).toHaveLength(0)
  })

  it('appends multiple entries preserving order', () => {
    const [s0] = init()
    const e1 = makeEntry({ id: 'a' })
    const e2 = makeEntry({ id: 'b' })
    const [s1] = update(s0, { type: 'Propose', entry: e1 })
    const [s2] = update(s1, { type: 'Propose', entry: e2 })
    expect(s2.pending.map((e) => e.id)).toEqual(['a', 'b'])
  })
})

describe('agentConfirm: Approve', () => {
  it('marks entry approved and emits AgentForwardMsg with payload', () => {
    const [s0] = init()
    const entry = makeEntry({ id: 'e1', variant: 'SubmitOrder', payload: { orderId: '42' } })
    const [s1] = update(s0, { type: 'Propose', entry })
    const [s2, effects] = update(s1, { type: 'Approve', id: 'e1' })
    expect(s2.pending[0]?.status).toBe('approved')
    expect(effects).toHaveLength(1)
    expect(effects[0]).toEqual({
      type: 'AgentForwardMsg',
      payload: { type: 'SubmitOrder', orderId: '42' },
    })
  })

  it('Approve on non-pending (already approved) is a no-op — no effect emitted', () => {
    const [s0] = init()
    const entry = makeEntry({ id: 'e1' })
    const [s1] = update(s0, { type: 'Propose', entry })
    const [s2] = update(s1, { type: 'Approve', id: 'e1' })
    // approve again
    const [s3, effects] = update(s2, { type: 'Approve', id: 'e1' })
    expect(s3.pending[0]?.status).toBe('approved')
    expect(effects).toHaveLength(0)
  })

  it('Approve on non-pending (rejected) is a no-op — no effect emitted', () => {
    const [s0] = init()
    const entry = makeEntry({ id: 'e1' })
    const [s1] = update(s0, { type: 'Propose', entry })
    const [s2] = update(s1, { type: 'Reject', id: 'e1' })
    const [s3, effects] = update(s2, { type: 'Approve', id: 'e1' })
    expect(s3.pending[0]?.status).toBe('rejected')
    expect(effects).toHaveLength(0)
  })

  it('Approve on missing id is a no-op', () => {
    const [s0] = init()
    const [s1, effects] = update(s0, { type: 'Approve', id: 'does-not-exist' })
    expect(s1.pending).toHaveLength(0)
    expect(effects).toHaveLength(0)
  })
})

describe('agentConfirm: Reject', () => {
  it('marks entry rejected and emits no effect', () => {
    const [s0] = init()
    const entry = makeEntry({ id: 'e1' })
    const [s1] = update(s0, { type: 'Propose', entry })
    const [s2, effects] = update(s1, { type: 'Reject', id: 'e1' })
    expect(s2.pending[0]?.status).toBe('rejected')
    expect(effects).toHaveLength(0)
  })
})

describe('agentConfirm: ExpireStale', () => {
  it('drops stale pending entries beyond maxAgeMs', () => {
    const [s0] = init()
    const stale = makeEntry({ id: 'old', proposedAt: 1_000, status: 'pending' })
    const fresh = makeEntry({ id: 'new', proposedAt: 5_000, status: 'pending' })
    const [s1] = update(s0, { type: 'Propose', entry: stale })
    const [s2] = update(s1, { type: 'Propose', entry: fresh })
    const [s3, effects] = update(s2, { type: 'ExpireStale', now: 10_000, maxAgeMs: 6_000 })
    // stale: 10000 - 1000 = 9000 > 6000 → dropped
    // fresh: 10000 - 5000 = 5000 <= 6000 → kept
    expect(s3.pending.map((e) => e.id)).toEqual(['new'])
    expect(effects).toHaveLength(0)
  })

  it('keeps approved and rejected entries regardless of age', () => {
    const [s0] = init()
    const approved = makeEntry({ id: 'a', proposedAt: 1_000, status: 'approved' })
    const rejected = makeEntry({ id: 'b', proposedAt: 1_000, status: 'rejected' })
    const stale = makeEntry({ id: 'c', proposedAt: 1_000, status: 'pending' })
    const [s1] = update(s0, { type: 'Propose', entry: approved })
    const [s2] = update(s1, { type: 'Propose', entry: rejected })
    const [s3] = update(s2, { type: 'Propose', entry: stale })
    const [s4] = update(s3, { type: 'ExpireStale', now: 100_000, maxAgeMs: 1_000 })
    expect(s4.pending.map((e) => e.id)).toEqual(['a', 'b'])
  })
})

describe('agentConfirm: connect', () => {
  const buildBag = (state: AgentConfirmState, send = vi.fn()) => {
    const connector = connect<AgentConfirmState>((s) => s, send)
    return { bag: connector(state), send }
  }

  it('entry(id) returns null for missing id', () => {
    const [s0] = init()
    const { bag } = buildBag(s0)
    expect(bag.entry('nonexistent')).toBeNull()
  })

  it('entry(id) returns card, buttons, texts for existing entry', () => {
    const [s0] = init()
    const entry = makeEntry({ id: 'e1', intent: 'Do the thing', reason: 'because' })
    const [s1] = update(s0, { type: 'Propose', entry })
    const { bag } = buildBag(s1)
    const e = bag.entry('e1')
    expect(e).not.toBeNull()
    expect(e!.card).toEqual({ 'data-part': 'entry', 'data-status': 'pending', 'data-id': 'e1' })
    expect(e!.intentText).toBe('Do the thing')
    expect(e!.reasonText).toBe('because')
    expect(e!.payloadText).toBe(JSON.stringify(entry.payload, null, 2))
  })

  it('approveButton.onClick dispatches Approve with correct id', () => {
    const [s0] = init()
    const entry = makeEntry({ id: 'e1' })
    const [s1] = update(s0, { type: 'Propose', entry })
    const { bag, send } = buildBag(s1)
    bag.entry('e1')!.approveButton.onClick()
    expect(send).toHaveBeenCalledWith({ type: 'Approve', id: 'e1' })
  })

  it('rejectButton.onClick dispatches Reject with correct id', () => {
    const [s0] = init()
    const entry = makeEntry({ id: 'e1' })
    const [s1] = update(s0, { type: 'Propose', entry })
    const { bag, send } = buildBag(s1)
    bag.entry('e1')!.rejectButton.onClick()
    expect(send).toHaveBeenCalledWith({ type: 'Reject', id: 'e1' })
  })

  it('approveButton and rejectButton are disabled when entry is not pending', () => {
    const [s0] = init()
    const entry = makeEntry({ id: 'e1' })
    const [s1] = update(s0, { type: 'Propose', entry })
    const [s2] = update(s1, { type: 'Approve', id: 'e1' })
    const { bag } = buildBag(s2)
    expect(bag.entry('e1')!.approveButton.disabled).toBe(true)
    expect(bag.entry('e1')!.rejectButton.disabled).toBe(true)
  })

  it('empty is visible when pending list is empty', () => {
    const [s0] = init()
    const { bag } = buildBag(s0)
    expect(bag.empty['data-visible']).toBe(true)
  })

  it('empty is not visible when there are pending entries', () => {
    const [s0] = init()
    const entry = makeEntry({ id: 'e1' })
    const [s1] = update(s0, { type: 'Propose', entry })
    const { bag } = buildBag(s1)
    expect(bag.empty['data-visible']).toBe(false)
  })
})
