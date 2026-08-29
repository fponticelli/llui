import { describe, it, expect } from 'vitest'
import {
  CHIP_HUES,
  CHIP_HUE_SLOT_COUNT,
  RESERVED_HUE_ARCS,
  chipHue,
  chipHueAt,
  isReservedHue,
} from '../../src/styles/chip-hue.js'

/**
 * The chip scale makes three claims that are cheap to assert and worth
 * measuring: the hash spreads, the outputs stay off the status hues, and two
 * different chips are far enough apart to look different. Each is checked
 * against a NAIVE baseline as well, because none of them is free — `hash % 360`
 * satisfies exactly none, and without the comparison a green suite says only
 * that the current implementation is self-consistent.
 */

/** Circular distance, degrees. */
const dist = (a: number, b: number): number => {
  const raw = (((a - b) % 360) + 360) % 360
  return Math.min(raw, 360 - raw)
}

/** Names of the kind that actually end up in a chip: event kinds, source tags,
 * document types, log levels, release channels, workflow states. */
const CORPUS = `
lab visit imaging note vitals medication allergy immunization procedure referral
encounter observation condition careplan diagnosis discharge admission triage
email sms push webhook slack teams pagerduty jira github gitlab linear notion
invoice receipt contract nda proposal quote statement payslip w2 1099 k1
pdf docx xlsx pptx csv json xml yaml png jpg svg mp4 mp3 zip tar
error warn info debug trace fatal audit security compliance privacy
alpha beta stable canary nightly lts eol deprecated experimental preview
frontend backend infra data ml design product marketing sales support finance
todo doing done blocked review merged closed reopened stale duplicate
android ios web desktop cli sdk api docs runbook postmortem
`
  .split(/\s+/)
  .filter((s) => s.length > 0)

/** Java's `String.hashCode`, the hash the proposal warns about. */
const javaHashCode = (s: string): number => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h >>> 0
}

describe('RESERVED_HUE_ARCS', () => {
  it('is disjoint and does not wrap past 0 or 360', () => {
    // `CHIP_HUES` derives the allowed arcs by walking the GAPS between these
    // bands, which is only correct while they are separate and in range.
    const bands = RESERVED_HUE_ARCS.map((a) => [
      a.center - a.halfWidth,
      a.center + a.halfWidth,
    ]).sort((x, y) => x[0]! - y[0]!)
    for (const [start, end] of bands) {
      expect(start).toBeGreaterThan(0)
      expect(end).toBeLessThan(360)
    }
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i]![0]).toBeGreaterThan(bands[i - 1]![1]!)
    }
  })

  it('classifies the traffic-light hues as reserved and the chip slots as not', () => {
    expect(isReservedHue(25)).toBe(true) // --destructive, both themes
    expect(isReservedHue(85)).toBe(true) // amber
    expect(isReservedHue(150)).toBe(true) // green
    expect(isReservedHue(230)).toBe(false) // blue
    // The boundary is exclusive at exactly halfWidth: the band is the hues that
    // read AS the status colour, and its edge is the first hue that does not.
    expect(isReservedHue(43)).toBe(false)
    expect(isReservedHue(42.9)).toBe(true)
  })
})

describe('CHIP_HUES', () => {
  it('has the declared slot count, none reserved', () => {
    expect(CHIP_HUES).toHaveLength(CHIP_HUE_SLOT_COUNT)
    expect(CHIP_HUES.filter(isReservedHue)).toEqual([])
  })

  it('separates every pair of slots by at least 21 degrees', () => {
    // The guarantee the quantisation exists to buy. A continuous hash over the
    // same 252-degree arc has an expected smallest gap of about A/n^2 — under
    // two degrees for twelve categories — so "different colour" would not mean
    // "distinguishable colour".
    let min = 360
    for (let i = 0; i < CHIP_HUES.length; i++)
      for (let j = i + 1; j < CHIP_HUES.length; j++)
        min = Math.min(min, dist(CHIP_HUES[i]!, CHIP_HUES[j]!))
    expect(min).toBeCloseTo(21, 6)
  })

  it('is stable — the palette is a wire format', () => {
    // A chip's colour is expected to be the same across sessions, machines and
    // releases; changing these values recolours every category in every app at
    // once. That is allowed, but it must be a decision, not a refactor.
    expect([...CHIP_HUES]).toEqual([
      53.5, 110.5, 131.5, 188.5, 209.5, 230.5, 251.5, 272.5, 293.5, 314.5, 335.5, 356.5,
    ])
  })
})

describe('chipHue', () => {
  it('is deterministic and pinned', () => {
    expect(chipHue('lab')).toBe(chipHue('lab'))
    // Same reason as the palette pin: these are the colours users have learned.
    expect(chipHue('lab')).toBe(188.5)
    expect(chipHue('visit')).toBe(230.5)
    expect(chipHue('imaging')).toBe(131.5)
    expect(chipHue('')).toBe(356.5)
  })

  it('never returns a reserved hue, for any input', () => {
    const inputs = [...CORPUS, ...Array.from({ length: 5000 }, (_, i) => `category-${i}`), '']
    const offenders = inputs.filter((v) => isReservedHue(chipHue(v)))
    expect(offenders).toEqual([])
  })

  it('only ever returns a declared slot', () => {
    const slots = new Set(CHIP_HUES)
    for (const value of CORPUS) expect(slots.has(chipHue(value))).toBe(true)
  })

  it('spreads uniformly over the slots', () => {
    const counts = new Array<number>(CHIP_HUE_SLOT_COUNT).fill(0)
    for (let i = 0; i < 12_000; i++) counts[CHIP_HUES.indexOf(chipHue(`k${i}`))]! += 1
    const expected = 12_000 / CHIP_HUE_SLOT_COUNT
    const chi2 = counts.reduce((t, o) => t + (o - expected) ** 2 / expected, 0)
    // df = 11; the 0.01 critical value is 24.725. Measured: 7.32.
    expect(chi2).toBeLessThan(24.725)
    expect(Math.min(...counts)).toBeGreaterThan(0)
  })

  it('avalanches — a one-character suffix change re-rolls the slot', () => {
    // The `fmix32` finaliser is here for this. FNV-1a alone leaves structure in
    // the low bits, which is exactly what a modulo reads.
    let collisions = 0
    const pairs = 2000
    for (let i = 0; i < pairs; i++) if (chipHue(`tag-${i}`) === chipHue(`tag-${i}x`)) collisions++
    // Chance is pairs / slots = 167. A hash that carried the suffix through
    // would sit far from it in either direction.
    expect(collisions).toBeGreaterThan(120)
    expect(collisions).toBeLessThan(220)
  })

  it('improves on `hashCode % 360` on both counts it claims to', () => {
    // Without this the suite proves only that the implementation agrees with
    // itself. Measured on the corpus above: the naive mapping puts 28 of 107
    // real category names on a STATUS hue, and brings two of them within one
    // degree of each other.
    const naive = CORPUS.map((v) => javaHashCode(v) % 360)
    expect(naive.filter(isReservedHue).length / naive.length).toBeGreaterThan(0.2)
    let min = 360
    const distinct = [...new Set(naive)]
    for (let i = 0; i < distinct.length; i++)
      for (let j = i + 1; j < distinct.length; j++)
        min = Math.min(min, dist(distinct[i]!, distinct[j]!))
    expect(min).toBeLessThan(2)

    const ours = CORPUS.map(chipHue)
    expect(ours.filter(isReservedHue)).toEqual([])
    const oursDistinct = [...new Set(ours)]
    let oursMin = 360
    for (let i = 0; i < oursDistinct.length; i++)
      for (let j = i + 1; j < oursDistinct.length; j++)
        oursMin = Math.min(oursMin, dist(oursDistinct[i]!, oursDistinct[j]!))
    expect(oursMin).toBeCloseTo(21, 6)
  })
})

describe('chipHueAt', () => {
  it('visits every slot once per cycle', () => {
    const cycle = Array.from({ length: CHIP_HUE_SLOT_COUNT }, (_, i) => chipHueAt(i))
    expect(new Set(cycle).size).toBe(CHIP_HUE_SLOT_COUNT)
  })

  it('puts consecutive indices far apart — this is where the golden angle lives', () => {
    // The sequential case is the one a golden-angle stride actually helps: a
    // chart legend allocating colours by position wants series 1 and 2 to look
    // nothing alike. (After an avalanching hash the same trick is a no-op,
    // which is why `chipHue` does not use it.)
    for (let i = 0; i < 24; i++) {
      expect(dist(chipHueAt(i), chipHueAt(i + 1))).toBeGreaterThanOrEqual(100)
    }
  })

  it('wraps, and normalises an index that is not a natural number', () => {
    expect(chipHueAt(CHIP_HUE_SLOT_COUNT)).toBe(chipHueAt(0))
    expect(chipHueAt(-1)).toBe(chipHueAt(CHIP_HUE_SLOT_COUNT - 1))
    expect(chipHueAt(2.7)).toBe(chipHueAt(2))
    // A caller passing a computed index should get a colour, not a crash — the
    // value is decoration, and throwing here would take the page with it.
    expect(CHIP_HUES).toContain(chipHueAt(Number.NaN))
    expect(CHIP_HUES).toContain(chipHueAt(Number.POSITIVE_INFINITY))
  })

  it('never returns a reserved hue', () => {
    for (let i = -50; i < 50; i++) expect(isReservedHue(chipHueAt(i))).toBe(false)
  })
})
