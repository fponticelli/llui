#!/usr/bin/env node
// Fail when the repo's GENERATED site content is stale relative to its sources.
//
// `site/` mixes hand-written pages with files produced by the four generators in
// `site/src/generate-*.ts` (wired together as the site's `generate` script). The
// generated ones are committed — the docs site builds from the repo — so a change
// to an exported type signature or an example silently drifts them until someone
// runs a full build. Nothing else catches that: the generators only run under
// `site#build`, so `turbo check lint test` is green with stale output.
//
// This regenerates, then fails if anything moved. Two modes:
//   (default)  diff only the known generated paths — safe on a dirty working tree,
//              so it can run in `pnpm verify` while you have edits in flight.
//   --strict   diff ALL of `site/`. Correct only from a clean checkout (CI), where
//              anything that moved after regenerating is BY DEFINITION generated.
//              This is what keeps GENERATED_PATHS below from silently going stale:
//              a new generator output fails the build until it is listed here.

import { execFileSync } from 'node:child_process'

// Every path the site's `generate` script writes. Keep in sync with
// `site/src/generate-{api,llms,examples,benchmarks}.ts` — `--strict` enforces it.
const GENERATED_PATHS = [
  'site/content/api',
  'site/content/examples',
  'site/content/examples.md',
  'site/content/benchmarks.md',
  'site/public/llms.txt',
  'site/public/llms-full.txt',
  'site/public/benchmark-data.json',
]

const strict = process.argv.includes('--strict')

/** Paths under `pathspecs` that differ from HEAD, tracked or not. */
function changed(pathspecs) {
  const tracked = execFileSync('git', ['diff', '--name-only', '--', ...pathspecs], {
    encoding: 'utf8',
  })
  const untracked = execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', '--', ...pathspecs],
    { encoding: 'utf8' },
  )
  return [...tracked.split('\n'), ...untracked.split('\n')].filter(Boolean).sort()
}

// The generators read each package's BUILT types, so the caller must have built
// first (both `pnpm verify` and the CI drift job do).
console.log('Regenerating site content…')
execFileSync('pnpm', ['--filter', '@llui/site', 'run', 'generate'], { stdio: 'inherit' })

const drifted = changed(strict ? ['site'] : GENERATED_PATHS)

if (drifted.length === 0) {
  console.log(`✓ generated site content is up to date${strict ? ' (strict: whole site/)' : ''}`)
  process.exit(0)
}

// Under --strict, anything outside GENERATED_PATHS means a generator grew a new
// output that this script doesn't know about — report that separately, because the
// fix is to edit GENERATED_PATHS, not just to commit the file.
const unlisted = strict
  ? drifted.filter((f) => !GENERATED_PATHS.some((p) => f === p || f.startsWith(`${p}/`)))
  : []

console.error('\n✗ generated site content is STALE:\n')
for (const f of drifted) console.error(`    ${f}${unlisted.includes(f) ? '   (unlisted)' : ''}`)

if (unlisted.length > 0) {
  console.error(
    '\n  The paths marked (unlisted) are written by a generator but are NOT in\n' +
      '  GENERATED_PATHS in scripts/check-generated.mjs. Add them — otherwise the\n' +
      '  non-strict check (pnpm verify) will keep missing them.',
  )
}

console.error(
  '\n  Fix: run `pnpm --filter @llui/site run generate` and commit the result\n' +
    '  alongside the source change that caused it.\n',
)
process.exit(1)
