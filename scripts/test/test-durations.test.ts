import { describe, it, expect } from 'vitest'

import {
  aggregateDurations,
  compareDurations,
  formatComparison,
  median,
} from '../lib/test-durations.mjs'

/**
 * Cover for the slow-test signal (#193).
 *
 * The two properties that matter are opposite failure directions, and a test
 * suite that only checks "it reports a regression" gets the second one wrong:
 *
 *   - it MUST report a single file that got much slower, even when the absolute
 *     number is far under any timeout budget (the case the old 5 s canary lost);
 *   - it MUST NOT report anything when the whole machine is slower, which is
 *     the case the old canary got wrong in the other direction and why it was
 *     removed.
 */

const root = '/repo'

function report(files: Record<string, number[]>) {
  return {
    testResults: Object.entries(files).map(([name, durations]) => ({
      name: `${root}/${name}`,
      assertionResults: durations.map((duration, i) => ({ title: `t${i}`, duration })),
    })),
  }
}

describe('median', () => {
  it('handles odd, even and empty', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBe(0)
  })
})

describe('aggregateDurations', () => {
  it('sums a file’s test durations and keys by repo-relative path', () => {
    expect(
      aggregateDurations([report({ 'packages/dom/test/a.test.ts': [1.5, 2.25] })], root),
    ).toEqual({ 'packages/dom/test/a.test.ts': 3.8 })
  })

  it('merges the same file appearing in more than one report', () => {
    const totals = aggregateDurations(
      [report({ 'packages/a/test/x.test.ts': [10] }), report({ 'packages/a/test/x.test.ts': [5] })],
      root,
    )
    expect(totals['packages/a/test/x.test.ts']).toBe(15)
  })

  it('ignores malformed entries rather than throwing on them', () => {
    const totals = aggregateDurations(
      [
        null,
        { testResults: 'nope' },
        { testResults: [{ name: 42 }, { name: `${root}/ok.test.ts`, assertionResults: [{}] }] },
      ],
      root,
    )
    expect(totals).toEqual({ 'ok.test.ts': 0 })
  })
})

describe('compareDurations', () => {
  // Six files clear the 200ms floor on purpose: the median scale needs at least
  // `minSample` (5) comparable files before it will give a verdict at all.
  const baseline = {
    'a.test.ts': 1_000,
    'b.test.ts': 2_000,
    'c.test.ts': 500,
    'd.test.ts': 4_000,
    'e.test.ts': 800,
    'f.test.ts': 1_500,
    'tiny.test.ts': 5,
  }

  it('reports a single file that got 6x slower', () => {
    const result = compareDurations(
      baseline,
      { ...baseline, 'b.test.ts': 12_000 },
      { factor: 3, floorMs: 200 },
    )
    expect(result.regressions.map((r) => r.file)).toEqual(['b.test.ts'])
    expect(result.regressions[0]?.ratio).toBeCloseTo(6, 1)
  })

  it('reports NOTHING when the whole machine is 4x slower', () => {
    const loaded = Object.fromEntries(Object.entries(baseline).map(([k, v]) => [k, v * 4]))
    const result = compareDurations(baseline, loaded, { factor: 3, floorMs: 200 })
    expect(result.scale).toBeCloseTo(4, 3)
    expect(result.regressions).toEqual([])
  })

  it('still finds the regression when the machine is ALSO 4x slower', () => {
    const loaded = Object.fromEntries(Object.entries(baseline).map(([k, v]) => [k, v * 4]))
    loaded['b.test.ts'] = 2_000 * 4 * 6
    const result = compareDurations(baseline, loaded, { factor: 3, floorMs: 200 })
    expect(result.scale).toBeCloseTo(4, 3)
    expect(result.regressions.map((r) => r.file)).toEqual(['b.test.ts'])
  })

  it('uses the MEDIAN so one outlier cannot inflate its own reference', () => {
    // With a mean, a file 400x slower would drag the scale up and hide itself.
    const current = { ...baseline, 'a.test.ts': 400_000 }
    const result = compareDurations(baseline, current, { factor: 3, floorMs: 200 })
    expect(result.scale).toBeCloseTo(1, 3)
    expect(result.regressions.map((r) => r.file)).toEqual(['a.test.ts'])
  })

  it('ignores files under the floor, in both directions', () => {
    // 5ms -> 60ms is 12x and pure timer noise; it must not be reported.
    const noise = compareDurations(baseline, { ...baseline, 'tiny.test.ts': 60 }, { floorMs: 200 })
    expect(noise.regressions).toEqual([])
    // …but 5ms -> 5s is a real regression and the floor must not hide it.
    const real = compareDurations(
      baseline,
      { ...baseline, 'tiny.test.ts': 5_000 },
      { floorMs: 200 },
    )
    expect(real.regressions.map((r) => r.file)).toEqual(['tiny.test.ts'])
  })

  it('declines to judge a run whose ratios are smeared rather than shifted', () => {
    // Every file slower by a DIFFERENT amount: a 4-core box running the baseline
    // machine's fan-out, not a code change. Reporting the worst of these as a
    // regression is exactly the wolf-crying that got the 5 s canary removed.
    const smeared = {
      'a.test.ts': 1_000 * 1.1,
      'b.test.ts': 2_000 * 8,
      'c.test.ts': 500 * 1.2,
      'd.test.ts': 4_000 * 9,
      'e.test.ts': 800 * 1.05,
      'f.test.ts': 1_500 * 7,
      'tiny.test.ts': 5,
    }
    const result = compareDurations(baseline, smeared)
    expect(result.comparable).toBe(false)
    expect(result.regressions).toEqual([])
    expect(formatComparison(result)).toContain('NOT comparable')
  })

  it('is NOT silenced by the outlier it exists to find', () => {
    // The guard must measure dispersion with QUARTILES: a p90-based spread is
    // inflated by the top tail, i.e. by the regression itself, and the tool
    // would decline to report every single-file regression it ever sees.
    const result = compareDurations(baseline, { ...baseline, 'd.test.ts': 4_000 * 9 })
    expect(result.comparable).toBe(true)
    expect(result.regressions.map((r) => r.file)).toEqual(['d.test.ts'])
  })

  it('declines when too few files clear the floor to estimate a scale', () => {
    const result = compareDurations({ 'a.test.ts': 1_000 }, { 'a.test.ts': 9_000 })
    expect(result.comparable).toBe(false)
    expect(result.regressions).toEqual([])
  })

  it('lists added and removed files without failing on them', () => {
    const { 'c.test.ts': _dropped, ...rest } = baseline
    const result = compareDurations(baseline, { ...rest, 'new.test.ts': 900 })
    expect(result.added).toEqual(['new.test.ts'])
    expect(result.removed).toEqual(['c.test.ts'])
    expect(result.regressions).toEqual([])
  })

  it('falls back to a scale of 1 when nothing clears the floor', () => {
    const result = compareDurations({ 'tiny.test.ts': 5 }, { 'tiny.test.ts': 9 }, { floorMs: 200 })
    expect(result.scale).toBe(1)
    expect(result.comparable).toBe(false)
    expect(result.regressions).toEqual([])
  })
})

describe('formatComparison', () => {
  it('says so plainly when nothing regressed', () => {
    const flat = Object.fromEntries(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => [`${n}.test.ts`, 1_000]),
    )
    const text = formatComparison(compareDurations(flat, { ...flat, 'a.test.ts': 1_100 }))
    expect(text).toContain('no duration regressions')
  })

  it('names the file, both numbers and the de-scaled ratio', () => {
    // Five files, not two: the median is only a robust reference while fewer
    // than half the sample moved, and with two files an outlier drags the very
    // scale it is judged against (measured: [6x, 1x] medians to 3.5x and the
    // regression disappears). The real suite has 600+, so this is a property of
    // the test data, not of the method — but it IS the method's limit and the
    // fixture states it rather than papering over it.
    const flat = {
      'b.test.ts': 1_000,
      'c.test.ts': 1_000,
      'd.test.ts': 1_000,
      'e.test.ts': 1_000,
      'f.test.ts': 1_000,
    }
    const text = formatComparison(
      compareDurations({ 'a.test.ts': 1_000, ...flat }, { 'a.test.ts': 6_000, ...flat }),
    )
    expect(text).toContain('a.test.ts: 1000ms → 6000ms')
    expect(text).toMatch(/6x\)/)
  })
})
