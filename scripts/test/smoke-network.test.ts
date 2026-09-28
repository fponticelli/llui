import { describe, expect, it } from 'vitest'

import { ICONIFY_FIXTURE } from '../lib/smoke-iconify-fixture'
import {
  decideRequest,
  declaredIconifyEntries,
  requestedIconifyEntries,
  staleIconifyEntries,
  type NetworkDecision,
} from '../lib/smoke-network'

const ORIGIN = 'http://127.0.0.1:4173'

function fixturePayload(decision: NetworkDecision): Record<string, unknown> {
  if (decision.kind !== 'fixture') throw new Error(`expected a fixture, got ${decision.kind}`)
  const parsed: unknown = JSON.parse(decision.body)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('payload is not an object')
  return parsed as Record<string, unknown>
}

describe('smoke-examples network policy (hermetic)', () => {
  it("passes the example's own origin through", () => {
    expect(decideRequest(`${ORIGIN}/assets/index.js`, ORIGIN)).toEqual({ kind: 'local' })
  })

  it('treats another port on the same host as off-origin', () => {
    expect(decideRequest('http://127.0.0.1:9999/x.js', ORIGIN).kind).toBe('unexpected')
  })

  it('fails every undeclared off-origin request, naming it', () => {
    const decision = decideRequest('https://fonts.googleapis.com/css2?family=Inter', ORIGIN)
    expect(decision.kind).toBe('unexpected')
    expect(decision.kind === 'unexpected' && decision.message).toContain(
      'https://fonts.googleapis.com/css2?family=Inter',
    )
  })

  it('fails example.invalid deterministically as a declared failure', () => {
    expect(decideRequest('https://example.invalid/not-an-avatar.png', ORIGIN).kind).toBe(
      'declared-failure',
    )
    // Only that exact reserved host: a lookalike is an undeclared dependency.
    expect(decideRequest('https://example.invalid.example.com/a.png', ORIGIN).kind).toBe(
      'unexpected',
    )
  })

  it("answers an Iconify batch in the API's shape, found and not_found", () => {
    const decision = decideRequest(
      'https://api.iconify.design/lucide.json?icons=check,not-a-real-icon,star',
      ORIGIN,
    )
    const payload = fixturePayload(decision)
    expect(payload.prefix).toBe('lucide')
    expect(payload.width).toBe(24)
    expect(payload.height).toBe(24)
    expect(Object.keys(payload.icons as object).sort()).toEqual(['check', 'star'])
    expect(payload.not_found).toEqual(['not-a-real-icon'])
    expect(
      requestedIconifyEntries(
        'https://api.iconify.design/lucide.json?icons=check,not-a-real-icon,star',
      ),
    ).toEqual(['lucide:check', 'lucide:not-a-real-icon', 'lucide:star'])
  })

  it('omits not_found when every requested glyph exists', () => {
    const payload = fixturePayload(
      decideRequest('https://api.iconify.design/simple-icons.json?icons=github', ORIGIN),
    )
    expect(payload).not.toHaveProperty('not_found')
  })

  it('fails a glyph the fixture does not declare, instead of guessing', () => {
    const decision = decideRequest(
      'https://api.iconify.design/lucide.json?icons=check,brand-new-glyph',
      ORIGIN,
    )
    expect(decision.kind).toBe('unexpected')
    expect(decision.kind === 'unexpected' && decision.message).toContain('"lucide:brand-new-glyph"')
    // Still counted as REQUESTED, so `check` is not reported stale beside it.
    expect(
      requestedIconifyEntries('https://api.iconify.design/lucide.json?icons=check,brand-new-glyph'),
    ).toEqual(['lucide:check', 'lucide:brand-new-glyph'])
    expect(requestedIconifyEntries('https://example.com/lucide.json?icons=check')).toEqual([])
  })

  it('fails an Iconify set the fixture does not have, and a malformed request', () => {
    expect(decideRequest('https://api.iconify.design/tabler.json?icons=home', ORIGIN).kind).toBe(
      'unexpected',
    )
    expect(decideRequest('https://api.iconify.design/lucide.json', ORIGIN).kind).toBe('unexpected')
    expect(decideRequest('https://api.iconify.design/collections', ORIGIN).kind).toBe('unexpected')
  })

  it('keeps every fixture set internally consistent', () => {
    for (const [prefix, set] of Object.entries(ICONIFY_FIXTURE)) {
      for (const name of set.notFound) {
        expect(set.icons, `${prefix}:${name} is both found and not_found`).not.toHaveProperty(name)
      }
      for (const [name, body] of Object.entries(set.icons)) {
        expect(body, `${prefix}:${name}`).toMatch(/^<(g|path) /)
      }
    }
  })

  it('reports exactly the fixture entries no example requested', () => {
    const all = new Set(declaredIconifyEntries())
    expect(staleIconifyEntries(all)).toEqual([])
    all.delete('mdi:language-typescript')
    all.delete('lucide:not-a-real-icon')
    expect(staleIconifyEntries(all)).toEqual(['lucide:not-a-real-icon', 'mdi:language-typescript'])
  })
})
