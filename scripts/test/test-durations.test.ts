import { describe, it, expect } from 'vitest'

import {
  DEFAULTS,
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
  // THE NOISE-FLOOR OPTION IS `minDeltaMs`, AND IT IS NOT SPELLED `floorMs`.
  // Four cases below passed `{ factor: 3, floorMs: 200 }` — `floorMs` was the
  // OLD clamped-denominator design that `minDeltaMs` replaced — so the object
  // carried a key `compareDurations` never reads and every one of them silently
  // ran at the DEFAULT 400 ms floor while its source claimed 200. An untyped
  // `.mjs` boundary is what let that sit: the excess-property check only fires
  // once the options parameter has a declared type (#252).
  //
  // Six files clear the 200ms SCALE floor on purpose: the median scale needs at
  // least `minSample` (5) comparable files before it will give a verdict at all.
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
      { factor: 3, minDeltaMs: 200 },
    )
    expect(result.regressions.map((r) => r.file)).toEqual(['b.test.ts'])
    expect(result.regressions[0]?.ratio).toBeCloseTo(6, 1)
  })

  it('reports NOTHING when the whole machine is 4x slower', () => {
    const loaded = Object.fromEntries(Object.entries(baseline).map(([k, v]) => [k, v * 4]))
    const result = compareDurations(baseline, loaded, { factor: 3, minDeltaMs: 200 })
    expect(result.scale).toBeCloseTo(4, 3)
    expect(result.regressions).toEqual([])
  })

  it('still finds the regression when the machine is ALSO 4x slower', () => {
    const loaded = Object.fromEntries(Object.entries(baseline).map(([k, v]) => [k, v * 4]))
    loaded['b.test.ts'] = 2_000 * 4 * 6
    const result = compareDurations(baseline, loaded, { factor: 3, minDeltaMs: 200 })
    expect(result.scale).toBeCloseTo(4, 3)
    expect(result.regressions.map((r) => r.file)).toEqual(['b.test.ts'])
  })

  it('uses the MEDIAN so one outlier cannot inflate its own reference', () => {
    // With a mean, a file 400x slower would drag the scale up and hide itself.
    const current = { ...baseline, 'a.test.ts': 400_000 }
    const result = compareDurations(baseline, current, { factor: 3, minDeltaMs: 200 })
    expect(result.scale).toBeCloseTo(1, 3)
    expect(result.regressions.map((r) => r.file)).toEqual(['a.test.ts'])
  })

  /**
   * The MECHANISM can reach a small file — an absolute delta floor, unlike the
   * clamped denominator it replaced, does not rebase cheap files against a
   * constant. Whether the SHIPPED DEFAULTS reach one is a separate question with
   * an uncomfortable answer, pinned in the test below this.
   */
  it('can catch a 5ms unit test becoming 30ms when the noise floor allows it', () => {
    const result = compareDurations(
      { ...baseline, 'unit.test.ts': 5 },
      { ...baseline, 'unit.test.ts': 30 },
      { factor: 3, minDeltaMs: 20 },
    )
    expect(result.regressions.map((r) => r.file)).toEqual(['unit.test.ts'])
    expect(result.regressions[0]?.ratio).toBeCloseTo(6, 1)
  })

  /**
   * THE HONEST LIMIT, asserted so nobody re-reads the docs as a stronger promise
   * than the measurements support. `vitest.shared.ts` cites "a 5 ms unit test
   * becoming 30 ms" as the case #193 wants caught. At the SHIPPED defaults it is
   * NOT caught: two identical back-to-back full runs produced 39 such
   * "regressions" at a +40 ms floor.
   *
   * State the limit accurately rather than absolutely — +25 ms is not "far below"
   * the noise, it is at roughly its p97 edge (per-file drift p50 2.1 ms, p90
   * 26.3 ms; only 1.7% of sub-50 ms files drift by >= +25 ms). A much tighter
   * `6x / +25 ms` DOES catch it on a quiet machine at 0-2 false positives. It is
   * not recoverable at zero false-positive cost, it flips with run order, and it
   * is hopeless under load. The previous clamped-denominator design did not catch
   * it either; it only hid that it did not.
   */
  it('does NOT reach a 5ms→30ms change at the shipped defaults, and says so via judgeable', () => {
    const result = compareDurations(
      { ...baseline, 'unit.test.ts': 5 },
      { ...baseline, 'unit.test.ts': 30 },
    )
    expect(result.regressions).toEqual([])
    // The file is outside the tool's resolution, and `judgeable` counts only
    // files a `factor`-fold regression could actually clear the floor for.
    const reachable = (ms: number) => ms * (DEFAULTS.factor - 1) >= DEFAULTS.minDeltaMs
    expect(reachable(5)).toBe(false)
    expect(result.judgeable).toBe(Object.values(baseline).filter(reachable).length)
  })

  it('still refuses to shout about timer granularity', () => {
    // 4ms -> 12ms is a 3x ratio made of scheduling jitter: +8ms is under the
    // noise floor, so it must stay silent.
    const result = compareDurations(
      { ...baseline, 'tiny.test.ts': 4 },
      { ...baseline, 'tiny.test.ts': 12 },
      { factor: 3, minDeltaMs: 40 },
    )
    expect(result.regressions).toEqual([])
  })

  it('reports its own resolution rather than leaving it implicit', () => {
    // Only files where a `factor`-fold growth clears the noise floor can ever be
    // reported; saying how many there are is the difference between a signal and
    // a signal that quietly covers 30% of the workspace.
    const result = compareDurations(baseline, baseline, { factor: 3, minDeltaMs: 40 })
    const reachable = Object.values(baseline).filter((ms) => ms * 2 >= 40).length
    expect(result.judgeable).toBe(reachable)
    expect(formatComparison(result, { factor: 3, minDeltaMs: 40 })).toContain('within resolution')
    // The header must state the SETTINGS ACTUALLY USED. These lived as separate
    // literals in two functions and silently diverged, so the tool printed a
    // resolution it was not running at.
    expect(formatComparison(compareDurations(baseline, baseline))).toContain(
      `at ${DEFAULTS.factor}x / +${DEFAULTS.minDeltaMs}ms`,
    )
  })

  it('pins the calibrated factor, not just the noise floor', () => {
    // `minDeltaMs` is pinned implicitly through `judgeable`, but `factor` was
    // not: mutating it 4 -> 2 left every test green. It is the difference between
    // reporting a 2x wobble and the 6x case #193 names, so assert the value AND
    // what it buys.
    expect(DEFAULTS.factor).toBe(4)
    const flat = Object.fromEntries('abcdefgh'.split('').map((n) => [`${n}.test.ts`, 1_000]))
    // A 3x growth on a file well clear of the floor stays silent at factor 4…
    expect(compareDurations(flat, { ...flat, 'a.test.ts': 3_000 }).regressions).toEqual([])
    // …and the 6x case is reported.
    expect(
      compareDurations(flat, { ...flat, 'a.test.ts': 6_000 }).regressions.map((r) => r.file),
    ).toEqual(['a.test.ts'])
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

  it('declines a run whose SCALE is far from the baseline, whatever the spread', () => {
    // Measured: a run at scale 15.5x with spread 2.7 — under the spread
    // threshold, so no decline — reported five "regressions", every one a
    // browser/e2e file whose cost is dominated by fixed overheads that do not
    // move with machine load. Spread cannot see that, because the deviation is
    // systematic rather than random.
    const uniform = Object.fromEntries(Object.entries(baseline).map(([k, v]) => [k, v * 15.5]))
    const result = compareDurations(baseline, uniform)
    expect(result.scale).toBeGreaterThan(8)
    expect(result.comparable).toBe(false)
    expect(result.regressions).toEqual([])
    expect(formatComparison(result)).toContain('scale is further than')
  })

  it('still compares a merely-slower machine', () => {
    const slower = Object.fromEntries(Object.entries(baseline).map(([k, v]) => [k, v * 4]))
    const result = compareDurations(baseline, slower)
    expect(result.comparable).toBe(true)
    expect(result.regressions).toEqual([])
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

  it('falls back to a scale of 1 when nothing clears the scale floor', () => {
    const result = compareDurations({ 'tiny.test.ts': 5 }, { 'tiny.test.ts': 9 }, {})
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
