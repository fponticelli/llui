import { describe, it, expect } from 'vitest'
import { defaultSecretRedactor } from '../src/redact.js'
import type { NoteBody } from '../src/note-types.js'

describe('defaultSecretRedactor (DA2 opt-in helper)', () => {
  const redact = defaultSecretRedactor()

  it('masks common secret shapes in the state snapshot', () => {
    const body: NoteBody = {
      stateSnapshot: {
        auth: 'Bearer abc123.def-456_GHI',
        apiKey: 'sk-ABCDEFGHIJKLMNOPQRSTUV',
        gh: 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
        jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc-DEF_123',
        user: { email: 'alice@example.com', name: 'Alice' },
        count: 3,
      },
    }
    const out = redact(body)
    const s = JSON.stringify(out.stateSnapshot)
    expect(s).not.toContain('abc123')
    expect(s).not.toContain('sk-ABCDEFGHIJKLMNOPQRSTUV')
    expect(s).not.toContain('ghp_')
    expect(s).not.toContain('alice@example.com')
    // Non-secret values survive.
    expect(s).toContain('Alice')
    expect(s).toContain('3')
  })

  it('does not mutate the input body', () => {
    const body: NoteBody = { stateSnapshot: { token: 'sk-ABCDEFGHIJKLMNOPQRSTUV' } }
    const before = JSON.stringify(body)
    redact(body)
    expect(JSON.stringify(body)).toBe(before)
  })

  it('leaves a body with no state snapshot untouched', () => {
    const body: NoteBody = { repro: [{ type: 'click', t: 0, selector: '#x' }] }
    expect(redact(body)).toEqual(body)
  })

  it('does not pollute Object.prototype via a __proto__ key in state', () => {
    const body: NoteBody = { stateSnapshot: JSON.parse('{"__proto__": {"polluted": true}}') }
    redact(body)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('honors a custom pattern and mask token', () => {
    const custom = defaultSecretRedactor({ patterns: [/SECRET-\d+/g], mask: '***' })
    const out = custom({ stateSnapshot: { x: 'value SECRET-42 end' } })
    expect((out.stateSnapshot as { x: string }).x).toBe('value *** end')
  })

  // Finding 10 — the effects channel was previously skipped by the deep walk.
  it('scrubs secrets inside pending + recent effects (Bearer header)', () => {
    const body: NoteBody = {
      effects: {
        pending: [
          {
            id: 'e1',
            component: 'App',
            effect: {
              type: 'http',
              url: '/api',
              headers: { Authorization: 'Bearer abc123.def-456_GHI' },
            },
            sinceMs: 12,
          },
        ],
        recent: [
          {
            ts: '2026-01-01T00:00:00.000Z',
            component: 'App',
            effect: { type: 'http' },
            outcome: 'error',
            error: 'failed with token sk-ABCDEFGHIJKLMNOPQRSTUV',
          },
        ],
      },
    }
    const out = redact(body)
    const s = JSON.stringify(out.effects)
    expect(s).not.toContain('Bearer abc123')
    expect(s).not.toContain('sk-ABCDEFGHIJKLMNOPQRSTUV')
    expect(s).toContain('[redacted]')
    // Structural fields survive the scrub.
    expect(out.effects!.pending[0]!.id).toBe('e1')
    expect(out.effects!.recent[0]!.outcome).toBe('error')
  })
})
