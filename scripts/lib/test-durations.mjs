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

/**
 * The shipped thresholds, stated ONCE.
 *
 * They were duplicated across `compareDurations` and `formatComparison` for
 * about ten minutes, and in that time they silently diverged — the comparison
 * ran at the calibrated 4x/+400ms while the header it printed still claimed
 * 3x/+40ms, i.e. the tool reported a resolution it was not using. Same fact,
 * one place.
 */
export const DEFAULTS = Object.freeze({
  factor: 4,
  maxScale: 8,
  scaleFloorMs: 200,
  minDeltaMs: 400,
  maxSpread: 3,
  minSample: 5,
})

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
 * @property {number} [scaleFloorMs] Only files at least this costly on BOTH
 *   sides take part in estimating the run's scale and spread. Small files are
 *   dominated by fixed overheads that do not track load, so their ratios are
 *   noise as far as a LOAD estimate is concerned. Default 200.
 * @property {number} [minDeltaMs] A file must have grown by at least this many
 *   milliseconds (after de-scaling) to be reported at all. This is the noise
 *   floor, and it replaces the old clamped denominator — see the note on
 *   `compareDurations`. Default 400, CALIBRATED (not guessed) — see below.
 * @property {number} [maxSpread] Decline to compare when the run's interquartile
 *   ratio spread (p75/p25) exceeds this — too noisy to support a verdict.
 *   Default 3.
 * @property {number} [maxScale] Decline when the run's load factor is further
 *   than this from the baseline in either direction. Default 8.
 * @property {number} [minSample] Fewest comparable files for the median scale to
 *   mean anything. Default 5.
 */

/**
 * @typedef {object} DurationComparison
 * @property {number} scale     The run's load factor relative to the baseline.
 * @property {number | null} spread  p75/p25 of the ratios; null when unmeasurable.
 * @property {boolean} comparable    False when the run was too noisy to judge.
 * @property {number} compared  How many files took part in the comparison.
 * @property {number} judgeable How many of those are costly enough that a
 *   `factor`-fold regression would clear the noise floor — i.e. the tool's real
 *   coverage, printed so it is never an unstated property.
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
  const {
    factor = DEFAULTS.factor,
    scaleFloorMs = DEFAULTS.scaleFloorMs,
    minDeltaMs = DEFAULTS.minDeltaMs,
    maxSpread = DEFAULTS.maxSpread,
    maxScale = DEFAULTS.maxScale,
    minSample = DEFAULTS.minSample,
  } = options

  const common = Object.keys(baseline).filter((file) => file in current)
  // The scale estimator uses only files big enough for their ratio to mean
  // something. A 0.4 ms file reading 1.2 ms is a 3x ratio made of timer
  // granularity, and a few hundred of those would dominate the median.
  const scaleSample = common
    .filter((file) => baseline[file] >= scaleFloorMs && current[file] >= scaleFloorMs)
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
  // A SCALE FAR FROM 1 IS ITSELF A REFUSAL, independently of spread. De-scaling
  // assumes every file's cost moves with machine load; the further the run is
  // from the baseline, the less that holds — a browser launch or a process spawn
  // is dominated by fixed overheads that do NOT scale, so those files deviate
  // systematically rather than randomly and the spread never notices. Measured:
  // a run at scale 15.5x with spread 2.7 (under the spread threshold, so no
  // decline) reported five "regressions", every one of them a playwright or
  // agent-e2e browser file. 8x is generous — a loaded CI container against a
  // quiet baseline sits well inside it — and it is the difference between "this
  // machine is slower" and "these runs are not the same experiment".
  const scaleSane = scale >= 1 / maxScale && scale <= maxScale
  const comparable = scaleSample.length >= minSample && spread <= maxSpread && scaleSane

  /** @type {DurationComparison['regressions']} */
  const regressions = []
  if (!comparable) {
    return {
      scale: Math.round(scale * 1000) / 1000,
      spread: Number.isFinite(spread) ? Math.round(spread * 100) / 100 : null,
      comparable: false,
      compared: common.length,
      judgeable: 0,
      regressions,
      added: Object.keys(current)
        .filter((file) => !(file in baseline))
        .sort(),
      removed: Object.keys(baseline)
        .filter((file) => !(file in current))
        .sort(),
    }
  }
  // THE NOISE FLOOR IS AN ABSOLUTE DELTA, NOT A CLAMPED DENOMINATOR, and the
  // difference is the whole reach of this tool. The first version computed
  // `ratio = normalized / max(baseline, floorMs)`, which silently rebased every
  // cheap file against the floor: with floorMs = 200 a 4 ms file first reported
  // at 150x — measured, on a quiet run, 6x/20x/100x/124x all missed. That made
  // ~70% of the workspace (430 of 618 files) unreachable and, worse, made
  // unreachable the exact case `vitest.shared.ts` names as the thing #193 asks
  // to catch: "a 5 ms unit test becoming 30 ms".
  //
  // Requiring a real RATIO and a real absolute GROWTH instead lets the two
  // thresholds be set from MEASURED noise rather than from a number that happens
  // to hide it.
  //
  // THE CALIBRATION, and the honest limit it establishes. Two full suite runs of
  // IDENTICAL code, back to back on an 18-core machine at load ~300 (twelve
  // parallel agent lanes), compared against each other:
  //
  //     factor  minDelta   false positives   files within resolution
  //        3       40ms          39                    346
  //        3      100ms           9                    218
  //        4      100ms           5                    264
  //        4      200ms           2                    187
  //        4      400ms           0                    145   <- shipped
  //        5      400ms           0                    164
  //        3      800ms           0                     88
  //
  // So the run-to-run noise on THIS workspace's small files is tens of
  // milliseconds and the 39-false-positive row is what a naive floor buys. The
  // shipped pair is the cheapest one with zero measured false positives that
  // still catches the 6x case #193 names.
  //
  // BE STRAIGHT ABOUT WHAT THAT COSTS: at +400 ms a file must cost roughly 133 ms
  // for a 4x regression to clear the floor, so "a 5 ms unit test becoming 30 ms"
  // — the example `vitest.shared.ts` cites — IS NOT DETECTABLE HERE. That is not
  // a threshold that can be tuned away; +25 ms is below this machine's noise, so
  // no setting recovers it, and the old clamped denominator did not detect it
  // either — it merely hid the fact. `judgeable` is reported on every run so the
  // coverage is stated rather than assumed. On quieter hardware, lower
  // `--min-delta` and the resolution improves; the printed false-positive
  // behaviour is how you check that you have gone too far.
  let judgeable = 0
  for (const file of common) {
    const baselineMs = baseline[file]
    const currentMs = current[file]
    const normalizedMs = currentMs / scale
    const growthMs = normalizedMs - baselineMs
    // A file can only ever be reported if a `factor`-fold growth would clear the
    // noise floor; anything cheaper than that is outside this tool's resolution
    // and is counted so the output can say so honestly.
    if (baselineMs * (factor - 1) >= minDeltaMs) judgeable++
    if (growthMs < minDeltaMs) continue
    const ratio = normalizedMs / Math.max(baselineMs, 0.1)
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
    judgeable,
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
export function formatComparison(
  comparison,
  {
    factor = DEFAULTS.factor,
    minDeltaMs = DEFAULTS.minDeltaMs,
    maxSpread = DEFAULTS.maxSpread,
    maxScale = DEFAULTS.maxScale,
  } = {},
) {
  const lines = []
  lines.push(
    `compared ${comparison.compared} test files ` +
      `(${comparison.judgeable ?? 0} within resolution at ${factor}x / +${minDeltaMs}ms); ` +
      `run scale vs baseline = ${comparison.scale}x, ` +
      `ratio spread (p75/p25) = ${comparison.spread ?? 'n/a'}`,
  )
  if (comparison.comparable === false) {
    const why =
      comparison.spread !== null && comparison.spread > maxSpread
        ? `spread > ${maxSpread}`
        : `scale is further than ${maxScale}x from the baseline`
    lines.push(
      `run is NOT comparable with the baseline (${why}); no verdict. ` +
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
