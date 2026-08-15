import { relative } from 'node:path'

/**
 * The slow-test signal that replaces the canary #180 removed (#193).
 *
 * WHAT WAS LOST. The workspace `testTimeout` used to be vitest's 5 s default,
 * which doubled as a crude performance alarm: a unit test that silently got 6x
 * slower went red. At 30 s it passes in silence. The 5 s cliff was a bad
 * instrument anyway — it conflated "too slow" with "hung", and it only ever
 * fired on a saturated machine, where it could not tell a regression from CPU
 * contention. But "the old signal was bad" is not "no signal is needed".
 *
 * WHY AN ABSOLUTE THRESHOLD CANNOT WORK HERE, which is the whole design
 * constraint. The measured landscape spans four orders of magnitude:
 *
 *     lexical-loro   harden.test.ts          33.0 s   (200-op 3-peer burst)
 *     @llui/mcp      playwright teardown     30.2 s
 *     @llui/mcp      doctor.test.ts          10.8 s   (spawns dist/cli.js)
 *     md-editor      typing-loop.test.ts      6.4 s   (480 keystrokes)
 *     …several hundred unit files             < 50 ms
 *
 * Any absolute number high enough not to scream at the first four is far too
 * high to notice a 5 ms unit test becoming 30 ms — and the thing #193 asks to
 * catch is precisely that, "a 6x regression detectable even when the absolute
 * number is under any budget". So the comparison has to be RELATIVE to what the
 * file cost before, i.e. against a recorded baseline.
 *
 * WHY THE BASELINE IS SAFE TO COMPARE ACROSS MACHINES. A baseline of raw
 * milliseconds recorded on one machine would be meaningless on another, and
 * meaningless on the SAME machine under a different load — which is exactly how
 * the old canary cried wolf. `compareDurations` therefore never compares raw
 * numbers: it first derives a SCALE from the run itself (the median of every
 * file's current/baseline ratio) and divides it out. A machine 4x slower moves
 * every ratio to ~4 and the median with it, so nothing is reported; a single
 * file that got 6x slower moves ONE ratio and leaves the median where it was, so
 * it still reads as 6x. The median, not the mean, is the estimator for exactly
 * that reason — a mean lets an outlier inflate the reference it is judged
 * against, and a file 400x slower would hide itself.
 *
 * THE METHOD'S LIMIT, stated because it is real: the median is a trustworthy
 * reference only while fewer than half the compared files moved together. With
 * 600+ files that is a safe assumption for a code change and a WRONG one for,
 * say, a vitest upgrade that slows everything by different amounts — which such
 * a run would report as "no regressions" plus a shifted scale. The scale is
 * printed on every run for that reason: it is the number to read when the
 * verdict looks too clean. Below ~5 comparable files the estimator is not
 * meaningful at all (measured: two files at [6x, 1x] median to 3.5x and the
 * regression vanishes).
 */

/** Median of a numeric array. Returns 0 for an empty one. */
export function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Nearest-rank percentile (0–1). Returns 0 for an empty array. */
export function percentile(values, q) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))
  return sorted[index]
}

/**
 * Fold vitest `json` reports into per-file totals, keyed by repo-relative path.
 *
 * The metric is the SUM OF TEST DURATIONS, not the file's wall clock. Hooks are
 * deliberately excluded: the heaviest hooks in this workspace are a Chromium
 * launch and its 30 s non-configurable shutdown floor, whose cost is a property
 * of the machine rather than of any change, and folding them in would put the
 * noisiest number in the workspace into every comparison. Hook cost is what
 * `hookTimeout` is for; this is the test-work signal.
 *
 * @param {readonly unknown[]} reports Parsed vitest json reports.
 * @param {string} repoRoot
 * @returns {Record<string, number>}
 */
export function aggregateDurations(reports, repoRoot) {
  /** @type {Record<string, number>} */
  const totals = {}
  for (const report of reports) {
    const results = /** @type {{ testResults?: unknown[] }} */ (report)?.testResults
    if (!Array.isArray(results)) continue
    for (const file of results) {
      const { name, assertionResults } = /** @type {Record<string, unknown>} */ (file)
      if (typeof name !== 'string' || !Array.isArray(assertionResults)) continue
      const key = relative(repoRoot, name).split('\\').join('/')
      let total = 0
      for (const test of assertionResults) {
        const duration = /** @type {Record<string, unknown>} */ (test)?.['duration']
        if (typeof duration === 'number' && Number.isFinite(duration)) total += duration
      }
      totals[key] = (totals[key] ?? 0) + total
    }
  }
  // Round to 0.1 ms: the baseline is a committed artifact and full float noise
  // would make every re-record a large diff for no information.
  for (const key of Object.keys(totals)) totals[key] = Math.round(totals[key] * 10) / 10
  return totals
}

/**
 * @typedef {object} CompareOptions
 * @property {number} [factor]  How much slower than baseline (after de-scaling)
 *   counts as a regression. Default 3.
 * @property {number} [floorMs] Files cheaper than this on BOTH sides are ignored.
 *   Default 200.
 * @property {number} [maxSpread] Decline to compare when the run's interquartile
 *   ratio spread (p75/p25) exceeds this — too noisy to support a verdict.
 *   Default 3.
 * @property {number} [minSample] Fewest comparable files for the median scale to
 *   mean anything. Default 5.
 */

/**
 * @typedef {object} DurationComparison
 * @property {number} scale     The run's load factor relative to the baseline.
 * @property {number | null} spread  p75/p25 of the ratios; null when unmeasurable.
 * @property {boolean} comparable    False when the run was too noisy to judge.
 * @property {number} compared  How many files took part in the comparison.
 * @property {{ file: string, baselineMs: number, currentMs: number, normalizedMs: number, ratio: number }[]} regressions
 * @property {string[]} added
 * @property {string[]} removed
 */

/**
 * @param {Record<string, number>} baseline
 * @param {Record<string, number>} current
 * @param {CompareOptions} [options]
 * @returns {DurationComparison}
 */
export function compareDurations(baseline, current, options = {}) {
  const { factor = 3, floorMs = 200, maxSpread = 3, minSample = 5 } = options

  const common = Object.keys(baseline).filter((file) => file in current)
  // The scale estimator uses only files big enough for their ratio to mean
  // something. A 0.4 ms file reading 1.2 ms is a 3x ratio made of timer
  // granularity, and a few hundred of those would dominate the median.
  const scaleSample = common
    .filter((file) => baseline[file] >= floorMs && current[file] >= floorMs)
    .map((file) => current[file] / baseline[file])
  const scale = scaleSample.length > 0 ? median(scaleSample) : 1

  // THE NOISE GUARD, and the reason this can be a CI gate at all. De-scaling
  // handles a machine that is uniformly slower; it does NOT handle a machine
  // where files are slower by wildly DIFFERENT amounts — different core count,
  // different worker fan-out, a neighbour hogging the box. In that run the
  // ratios are not a shifted distribution but a smeared one, and any single
  // file's ratio says more about scheduling than about the code. Rather than
  // report confident nonsense, measure the smear and DECLINE to compare when it
  // is too wide.
  //
  // The measure is the INTERQUARTILE ratio (p75/p25), not p90/p10, and the
  // difference decides whether the guard works at all: the regressions this
  // tool exists to find live in the top tail, so a p90-based spread is inflated
  // by the very outlier being looked for and silences itself. Quartiles are
  // untouched by a handful of outliers and still widen under real load smear.
  //
  // A run that cannot support a verdict gets an explicit "not comparable", never
  // a false alarm — a signal that screams on every loaded CI run is worse than no
  // signal, which is precisely why the 5 s timeout canary was removed.
  const spread =
    scaleSample.length >= minSample
      ? percentile(scaleSample, 0.75) / Math.max(percentile(scaleSample, 0.25), 1e-9)
      : Infinity
  const comparable = scaleSample.length >= minSample && spread <= maxSpread

  /** @type {DurationComparison['regressions']} */
  const regressions = []
  if (!comparable) {
    return {
      scale: Math.round(scale * 1000) / 1000,
      spread: Number.isFinite(spread) ? Math.round(spread * 100) / 100 : null,
      comparable: false,
      compared: common.length,
      regressions,
      added: Object.keys(current)
        .filter((file) => !(file in baseline))
        .sort(),
      removed: Object.keys(baseline)
        .filter((file) => !(file in current))
        .sort(),
    }
  }
  for (const file of common) {
    const baselineMs = baseline[file]
    const currentMs = current[file]
    // Both sides must clear the floor. Requiring it of the BASELINE alone would
    // miss a file that went from 5 ms to 5 s; requiring it of the CURRENT alone
    // would report every cheap file whose baseline rounded to nothing.
    if (Math.max(baselineMs, currentMs) < floorMs) continue
    const normalizedMs = currentMs / scale
    const ratio = normalizedMs / Math.max(baselineMs, floorMs)
    if (ratio >= factor) {
      regressions.push({
        file,
        baselineMs,
        currentMs: Math.round(currentMs * 10) / 10,
        normalizedMs: Math.round(normalizedMs * 10) / 10,
        ratio: Math.round(ratio * 100) / 100,
      })
    }
  }
  regressions.sort((a, b) => b.ratio - a.ratio)

  return {
    scale: Math.round(scale * 1000) / 1000,
    spread: Math.round(spread * 100) / 100,
    comparable: true,
    compared: common.length,
    regressions,
    added: Object.keys(current)
      .filter((file) => !(file in baseline))
      .sort(),
    removed: Object.keys(baseline)
      .filter((file) => !(file in current))
      .sort(),
  }
}

/** Human-readable rendering of a comparison, used by the CLI and by its test. */
export function formatComparison(comparison, { factor = 3, floorMs = 200, maxSpread = 3 } = {}) {
  const lines = []
  lines.push(
    `compared ${comparison.compared} test files; run scale vs baseline = ${comparison.scale}x, ` +
      `ratio spread (p75/p25) = ${comparison.spread ?? 'n/a'} ` +
      `(threshold ${factor}x after de-scaling, files under ${floorMs}ms ignored)`,
  )
  if (comparison.comparable === false) {
    lines.push(
      `run is NOT comparable with the baseline (spread > ${maxSpread}); no verdict. ` +
        `Re-record with \`pnpm test:durations\` on a quiet machine if this persists.`,
    )
    return lines.join('\n')
  }
  if (comparison.added.length > 0) {
    lines.push(`  ${comparison.added.length} new file(s) with no baseline entry`)
  }
  if (comparison.removed.length > 0) {
    lines.push(`  ${comparison.removed.length} baseline file(s) not in this run`)
  }
  if (comparison.regressions.length === 0) {
    lines.push('no duration regressions')
    return lines.join('\n')
  }
  lines.push(`${comparison.regressions.length} duration regression(s):`)
  for (const r of comparison.regressions) {
    lines.push(
      `  ${r.file}: ${r.baselineMs}ms → ${r.currentMs}ms ` +
        `(${r.normalizedMs}ms de-scaled, ${r.ratio}x)`,
    )
  }
  return lines.join('\n')
}
