/**
 * Effect timeline + pending-effects list + mock registry — the three
 * trackers that back the `llui_pending_effects`, `llui_effect_timeline`,
 * `llui_mock_effect`, and `llui_resolve_effect` MCP tools.
 *
 * Dev-only — populated on `ComponentInstance` when `installDevTools`
 * runs. Zero cost in production (the `dispatchEffectDev` wrapper in
 * `update-loop.ts` short-circuits when `_effectTimeline` is undefined).
 *
 * The mock registry stores match-to-response pairs; the actual
 * response delivery (i.e., converting a mocked response back into a
 * Msg via the effect's `onSuccess` callback) is the responsibility of
 * the MCP `llui_resolve_effect` tool — not this module.
 */
import { createRingBuffer, type RingBuffer } from './each-diff.js'

export interface EffectTimelineEntry {
  effectId: string
  type: string
  phase: 'dispatched' | 'in-flight' | 'resolved' | 'resolved-mocked' | 'cancelled'
  timestamp: number
  /** Populated on `resolved` / `resolved-mocked` / `cancelled` entries; undefined on open phases. */
  durationMs?: number
}

export interface PendingEffect {
  id: string
  type: string
  dispatchedAt: number
  status: 'queued' | 'in-flight'
  payload: unknown
}

/**
 * Match predicate for the mock registry. All provided fields must
 * match for the mock to fire:
 * - `type`: exact-match against the effect's `type` discriminant.
 * - `payloadPath`: dotted path into the effect object (e.g. `'url'` or
 *   `'body.key'`). When present without `payloadEquals`, presence of
 *   the path is sufficient.
 * - `payloadEquals`: strict (`===`) equality check at `payloadPath`.
 *
 * An empty match (no fields) matches every effect — callers should
 * set at least `type` to avoid accidental catch-all.
 */
export interface EffectMatch {
  type?: string
  payloadPath?: string
  payloadEquals?: unknown
}

export interface EffectMock {
  mockId: string
  match: EffectMatch
  response: unknown
  /** When false, the mock is removed after the first match (one-shot). */
  persist: boolean
}

export interface MockRegistry {
  add(match: EffectMatch, response: unknown, persist: boolean): string
  match(effect: unknown): { response: unknown; mockId: string } | null
  clear(): void
  list(): EffectMock[]
}

export function createMockRegistry(): MockRegistry {
  const mocks: EffectMock[] = []
  let nextId = 1

  function resolvePath(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.')
    let v: unknown = obj
    for (const p of parts) {
      if (v == null || typeof v !== 'object') return undefined
      v = (v as Record<string, unknown>)[p]
    }
    return v
  }

  function matches(m: EffectMock, effect: unknown): boolean {
    if (effect == null || typeof effect !== 'object') return false
    const eff = effect as Record<string, unknown>
    if (m.match.type !== undefined && eff.type !== m.match.type) return false
    if (m.match.payloadPath !== undefined) {
      const v = resolvePath(eff, m.match.payloadPath)
      if (m.match.payloadEquals !== undefined && v !== m.match.payloadEquals) return false
      // Presence-only check: path must resolve to something other than undefined.
      if (m.match.payloadEquals === undefined && v === undefined) return false
    }
    return true
  }

  return {
    add(match, response, persist) {
      const mockId = `mock-${nextId++}`
      mocks.push({ mockId, match, response, persist })
      return mockId
    },
    match(effect) {
      for (let i = 0; i < mocks.length; i++) {
        const m = mocks[i]!
        if (matches(m, effect)) {
          const response = m.response
          const mockId = m.mockId
          if (!m.persist) mocks.splice(i, 1)
          return { response, mockId }
        }
      }
      return null
    },
    clear() {
      mocks.length = 0
      nextId = 1
    },
    list() {
      return mocks.slice()
    },
  }
}

export interface PendingEffectsList {
  push(p: PendingEffect): void
  findById(id: string): PendingEffect | undefined
  remove(id: string): void
  list(): PendingEffect[]
}

export function createPendingEffectsList(): PendingEffectsList {
  const items: PendingEffect[] = []
  return {
    push(p) {
      items.push(p)
    },
    findById: (id) => items.find((p) => p.id === id),
    remove(id) {
      const i = items.findIndex((p) => p.id === id)
      if (i >= 0) items.splice(i, 1)
    },
    list: () => items.slice(),
  }
}

export { createRingBuffer, type RingBuffer }
