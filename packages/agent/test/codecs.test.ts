import { describe, it, expect } from 'vitest'
import {
  CodecRegistry,
  isoDateCodec,
  epochMillisCodec,
  makeDefaultCodecs,
  encodeForWire,
  decodeFromWire,
  WIRE_TAG,
  WIRE_VALUE,
  type AgentCodec,
} from '../src/codecs.js'

describe('codecs — iso-date round-trip', () => {
  it('encodes Date as ISO string', () => {
    const d = new Date('2026-04-25T12:00:00.000Z')
    expect(isoDateCodec.encode(d)).toBe('2026-04-25T12:00:00.000Z')
  })

  it('decodes ISO string back to Date', () => {
    const d = isoDateCodec.decode('2026-04-25T12:00:00.000Z')
    expect(d).toBeInstanceOf(Date)
    expect(d.getTime()).toBe(new Date('2026-04-25T12:00:00.000Z').getTime())
  })

  it('matchesRuntime claims valid Date', () => {
    expect(isoDateCodec.matchesRuntime(new Date())).toBe(true)
    expect(isoDateCodec.matchesRuntime('2026-04-25')).toBe(false)
    expect(isoDateCodec.matchesRuntime(null)).toBe(false)
  })

  it('matchesRuntime rejects invalid Date', () => {
    expect(isoDateCodec.matchesRuntime(new Date('not-a-date'))).toBe(false)
  })
})

describe('codecs — epoch-millis', () => {
  it('encodes Date as epoch millis', () => {
    const d = new Date('2026-04-25T12:00:00.000Z')
    expect(epochMillisCodec.encode(d)).toBe(d.getTime())
  })

  it('matchesRuntime returns false by default (yields to iso-date)', () => {
    expect(epochMillisCodec.matchesRuntime(new Date())).toBe(false)
  })
})

describe('encodeForWire / decodeFromWire — universal walker', () => {
  it('wraps a top-level Date', () => {
    const r = makeDefaultCodecs()
    const out = encodeForWire(new Date('2026-04-25T00:00:00.000Z'), r)
    expect(out).toEqual({
      [WIRE_TAG]: 'iso-date',
      [WIRE_VALUE]: '2026-04-25T00:00:00.000Z',
    })
  })

  it('wraps a Date nested in an object', () => {
    const r = makeDefaultCodecs()
    const out = encodeForWire({ name: 'x', when: new Date('2026-01-01T00:00:00.000Z') }, r)
    expect(out).toEqual({
      name: 'x',
      when: { [WIRE_TAG]: 'iso-date', [WIRE_VALUE]: '2026-01-01T00:00:00.000Z' },
    })
  })

  it('wraps Dates inside arrays', () => {
    const r = makeDefaultCodecs()
    const out = encodeForWire([new Date('2026-01-01T00:00:00.000Z'), 'b'], r)
    expect(out).toEqual([{ [WIRE_TAG]: 'iso-date', [WIRE_VALUE]: '2026-01-01T00:00:00.000Z' }, 'b'])
  })

  it('preserves null and primitives', () => {
    const r = makeDefaultCodecs()
    expect(encodeForWire(null, r)).toBeNull()
    expect(encodeForWire(undefined, r)).toBeUndefined()
    expect(encodeForWire(42, r)).toBe(42)
    expect(encodeForWire('hello', r)).toBe('hello')
    expect(encodeForWire(true, r)).toBe(true)
  })

  it('round-trips a complex shape', () => {
    const r = makeDefaultCodecs()
    const original = {
      events: [
        { name: 'a', when: new Date('2026-04-25T00:00:00.000Z') },
        { name: 'b', when: null },
      ],
      meta: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
    }
    const wire = encodeForWire(original, r)
    const wireJson = JSON.parse(JSON.stringify(wire))
    const decoded = decodeFromWire(wireJson, r) as typeof original
    const ev0 = decoded.events[0]!
    const ev1 = decoded.events[1]!
    expect(ev0.when).toBeInstanceOf(Date)
    expect((ev0.when as Date).getTime()).toBe(original.events[0]!.when!.getTime())
    expect(ev1.when).toBeNull()
    expect(decoded.meta.createdAt).toBeInstanceOf(Date)
    expect((decoded.meta.createdAt as Date).getTime()).toBe(original.meta.createdAt.getTime())
  })

  it('passes unknown codec tags through untouched', () => {
    const r = makeDefaultCodecs()
    const tagged = { [WIRE_TAG]: 'unknown-codec', [WIRE_VALUE]: 'whatever' }
    const out = decodeFromWire(tagged, r)
    expect(out).toEqual(tagged)
  })

  it('does not mutate the input', () => {
    const r = makeDefaultCodecs()
    const d = new Date('2026-04-25T00:00:00.000Z')
    const original = { when: d }
    encodeForWire(original, r)
    expect(original.when).toBe(d)
  })
})

describe('CodecRegistry — custom codecs', () => {
  it('register replaces existing codec by name', () => {
    const r = new CodecRegistry()
    r.register(isoDateCodec)
    const replacement: AgentCodec = {
      ...isoDateCodec,
      encode: (v) => `OVERRIDDEN:${(v as Date).toISOString()}`,
    }
    r.register(replacement)
    const out = encodeForWire(new Date('2026-01-01T00:00:00.000Z'), r) as Record<string, unknown>
    expect(out[WIRE_VALUE]).toBe('OVERRIDDEN:2026-01-01T00:00:00.000Z')
  })

  it('explicit registration order determines match precedence', () => {
    // A consumer who prefers epoch-millis over iso-date registers a
    // millis codec with active matchesRuntime FIRST.
    const r = new CodecRegistry()
    r.register({
      ...epochMillisCodec,
      matchesRuntime: (v) => v instanceof Date,
    })
    r.register(isoDateCodec)
    const out = encodeForWire(new Date('2026-01-01T00:00:00.000Z'), r) as Record<string, unknown>
    expect(out[WIRE_TAG]).toBe('epoch-millis')
    expect(typeof out[WIRE_VALUE]).toBe('number')
  })

  it('clone produces an independent registry', () => {
    const r1 = makeDefaultCodecs()
    const r2 = r1.clone()
    // Override iso-date in r2 so it produces an "OVERRIDDEN" wire form;
    // r1 must continue producing the standard ISO string.
    r2.register({
      ...isoDateCodec,
      encode: (v) => `OVERRIDDEN:${(v as Date).toISOString()}`,
    })
    const d = new Date('2026-01-01T00:00:00.000Z')
    const out1 = encodeForWire(d, r1) as Record<string, unknown>
    const out2 = encodeForWire(d, r2) as Record<string, unknown>
    expect(out1[WIRE_VALUE]).toBe('2026-01-01T00:00:00.000Z')
    expect(out2[WIRE_VALUE]).toBe('OVERRIDDEN:2026-01-01T00:00:00.000Z')
  })
})
