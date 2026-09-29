import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { AFTER_FIRST_PAINT, ICONIFY_FIXTURE } from '../lib/iconify-fixture.mjs'
import {
  decideRequest as decide,
  declaredIconifyEntries,
  loopback,
  misfiledAfterFirstPaintEntries,
  requestedIconifyEntries,
  sameOrigin,
  staleIconifyEntries,
  type NetworkDecision,
} from '../lib/network-policy.mjs'

const ORIGIN = 'http://127.0.0.1:4173'

/** The smoke's policy: exactly one origin is local. */
function decideRequest(url: string, origin: string): NetworkDecision {
  return decide(url, sameOrigin(origin))
}

function fixturePayload(decision: NetworkDecision): Record<string, unknown> {
  if (decision.kind !== 'fixture') throw new Error(`expected a fixture, got ${decision.kind}`)
  const parsed: unknown = JSON.parse(decision.body)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('payload is not an object')
  return parsed as Record<string, unknown>
}

describe("hermetic network policy — the smoke's single-origin policy", () => {
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

describe('local policies', () => {
  it("folds a WebSocket onto its HTTP twin for the smoke's origin", () => {
    expect(decideRequest(`ws://127.0.0.1:4173/hmr`, ORIGIN).kind).toBe('local')
    expect(decideRequest(`wss://127.0.0.1:4173/hmr`, ORIGIN).kind).toBe('unexpected')
    expect(decideRequest(`ws://127.0.0.1:4174/hmr`, ORIGIN).kind).toBe('unexpected')
  })

  it('treats every loopback port as local for the test suites, and nothing else', () => {
    for (const url of [
      'http://127.0.0.1:1/a.js',
      'http://127.0.0.1:65535/',
      'http://localhost:5173/src/main.ts',
      'ws://localhost:24678/',
      'http://[::1]:8080/',
    ]) {
      expect(decide(url, loopback), url).toEqual({ kind: 'local' })
    }
    for (const url of [
      'http://127.0.0.2:80/',
      'http://localhost.example.com/',
      'https://registry.npmjs.org/',
      'http://10.0.0.1/',
      'ftp://127.0.0.1/',
    ]) {
      expect(decide(url, loopback).kind, url).toBe('unexpected')
    }
  })

  it('never routes a non-network scheme off the machine', () => {
    for (const url of ['data:text/plain,hi', 'blob:http://127.0.0.1:1/uuid', 'about:blank']) {
      expect(decide(url, loopback), url).toEqual({ kind: 'local' })
      expect(decide(url, sameOrigin(ORIGIN)), url).toEqual({ kind: 'local' })
    }
  })

  it('applies the same Iconify fixture and declared failures under both policies', () => {
    const url = 'https://api.iconify.design/lucide.json?icons=check'
    expect(decide(url, loopback)).toEqual(decideRequest(url, ORIGIN))
    expect(decide('https://example.invalid/a.png', loopback).kind).toBe('declared-failure')
    const refused = decide('https://api.iconify.design/lucide.json?icons=nope', loopback)
    expect(refused.kind === 'unexpected' && refused.message).toContain('"lucide:nope"')
  })
})

describe("the fixture's after-first-paint entries", () => {
  const ROOT = path.resolve(__dirname, '../..')

  it('are declared entries', () => {
    const declared = new Set(declaredIconifyEntries())
    for (const entry of AFTER_FIRST_PAINT) expect(declared.has(entry), entry).toBe(true)
  })

  it("are exempt from the smoke's first-paint staleness, and only they are", () => {
    const firstPaint = new Set(
      declaredIconifyEntries().filter((entry) => !AFTER_FIRST_PAINT.has(entry)),
    )
    expect(staleIconifyEntries(firstPaint)).toEqual([])
    const late = [...AFTER_FIRST_PAINT].sort()[0]
    expect(late).toBeDefined()
    if (late === undefined) return
    // Listed as after-first-paint, yet requested at first paint: misfiled.
    expect(misfiledAfterFirstPaintEntries(new Set([late, 'lucide:check']))).toEqual([late])
    expect(misfiledAfterFirstPaintEntries(firstPaint)).toEqual([])
  })

  it('are each NAMED in the shipped source that renders them (the stale direction the smoke cannot see)', () => {
    // Shipped UI source only: a TEST naming a glyph does not make a page ask for it.
    const listed = execFileSync(
      'git',
      [
        'ls-files',
        '--cached',
        '--others',
        '--exclude-standard',
        '--',
        'examples',
        'registry/llui',
        'packages',
      ],
      { cwd: ROOT, encoding: 'utf8' },
    )
    const sources = listed
      .split('\n')
      .filter((file) => /\.tsx?$/.test(file) && /(?:^|\/)(?:src|llui)\//.test(file))
      .filter((file) => !/(?:^|\/)test\//.test(file))
      .map((file) => readFileSync(path.join(ROOT, file), 'utf8'))
    for (const entry of AFTER_FIRST_PAINT) {
      const named = sources.some(
        (text) => text.includes(`'${entry}'`) || text.includes(`"${entry}"`),
      )
      expect(named, `${entry} is named by no shipped source — drop it from the fixture`).toBe(true)
    }
  })
})
