#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { aggregateDurations, compareDurations, formatComparison } from './lib/test-durations.mjs'

/**
 * The slow-test signal (#193). Two modes:
 *
 *   pnpm test:durations         run the suite, record a fresh baseline
 *   pnpm check:test-durations   run the suite, diff it against the baseline
 *
 * Both drive the workspace's ordinary test task with `LLUI_TEST_DURATIONS` set,
 * so the numbers come from the SAME run everyone else does rather than from a
 * bespoke measurement harness that could drift away from it. See
 * `lib/test-durations.mjs` for why the comparison de-scales by a same-run load
 * factor instead of trusting wall-clock milliseconds across machines.
 *
 * Pass `--no-run` to reuse the reports already in the output directory (the
 * intended use in CI, where the ordinary test step has already produced them).
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const save = args.includes('--save')
const noRun = args.includes('--no-run')
const factor = numberFlag('--factor', 3)
const floorMs = numberFlag('--floor', 200)
const maxSpread = numberFlag('--max-spread', 3)
const baselinePath = join(repoRoot, 'test-durations.baseline.json')
const outDir = process.env['LLUI_TEST_DURATIONS'] ?? join(repoRoot, '.test-durations')

function numberFlag(name, fallback) {
  const index = args.indexOf(name)
  if (index < 0) return fallback
  const value = Number(args[index + 1])
  return Number.isFinite(value) ? value : fallback
}

if (!noRun) {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  // `pnpm -r`, matching what CI runs. `turbo test` would replay cached tasks and
  // emit no report for them, which would silently shrink the comparison set to
  // whatever happened to be uncached.
  const result = spawnSync('pnpm', ['-r', '--workspace-concurrency=2', 'run', 'test'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, LLUI_TEST_DURATIONS: outDir },
  })
  if (result.status !== 0) {
    process.stderr.write('\ntest run failed; durations not recorded\n')
    process.exit(result.status ?? 1)
  }
}

if (!existsSync(outDir)) {
  process.stderr.write(`no duration reports in ${outDir}\n`)
  process.exit(1)
}

const reports = readdirSync(outDir)
  .filter((name) => name.endsWith('.json'))
  .map((name) => JSON.parse(readFileSync(join(outDir, name), 'utf8')))
const current = aggregateDurations(reports, repoRoot)
const fileCount = Object.keys(current).length
if (fileCount === 0) {
  process.stderr.write(
    `no test files found in ${reports.length} report(s) under ${outDir} — ` +
      `did the run use LLUI_TEST_DURATIONS?\n`,
  )
  process.exit(1)
}

if (save) {
  writeFileSync(
    baselinePath,
    JSON.stringify(
      {
        // Recorded for the reader, never read by the comparison — the whole
        // point of de-scaling is that the recording machine does not matter.
        recordedOn: `${process.platform}/${process.arch}`,
        recordedAt: new Date().toISOString().slice(0, 10),
        metric: 'sum of test durations per file, milliseconds (hooks excluded)',
        files: Object.fromEntries(Object.entries(current).sort(([a], [b]) => (a < b ? -1 : 1))),
      },
      null,
      2,
    ) + '\n',
  )
  process.stdout.write(`recorded ${fileCount} test files to ${baselinePath}\n`)
  process.exit(0)
}

if (!existsSync(baselinePath)) {
  process.stderr.write(`no baseline at ${baselinePath}; run \`pnpm test:durations\` first\n`)
  process.exit(1)
}
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).files ?? {}
const comparison = compareDurations(baseline, current, { factor, floorMs, maxSpread })
process.stdout.write(formatComparison(comparison, { factor, floorMs, maxSpread }) + '\n')
process.exit(comparison.regressions.length > 0 ? 1 : 0)
