/**
 * Run both bench suites end-to-end.
 *
 * Sequence:
 *   1. Standard jfb (`benchmarks/run-jfb.ts --all`): the 9 CPU + 3 memory +
 *      2 size benchmarks from krausest/js-framework-benchmark against
 *      `keyed/llui` + competitors.
 *   2. Ticker (`scripts/run-ticker.ts`): the 8 ticker benchmarks against
 *      `keyed/llui-ticker` + competitors.
 *
 * All CLI args after the script name are passed through verbatim to both
 * runners. Each runner ignores flags it doesn't recognise.
 *
 * Usage:
 *   pnpm bench:all                 # full suite, both bench types
 *   pnpm bench:all --runs 3        # 3 passes (median-of-medians)
 *   pnpm bench:all --runs 3 --save # persist results to both baselines
 *   pnpm bench:all --framework llui --runs 1   # llui only, 1 pass
 *
 * The ticker suite is wired to the same jfb harness via patches managed
 * by `scripts/setup-ticker.ts`; `pnpm bench:ticker:setup` must have been
 * run at least once.
 */

import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'

const ROOT = dirname(import.meta.dirname)
const argsRaw = process.argv.slice(2)
const args = argsRaw.join(' ')

// Default the standard runner to `--all` (include competitors) unless the
// caller already restricted via --framework. This matches the ticker
// runner's default behaviour of running every registered framework.
const standardArgs =
  argsRaw.includes('--framework') || argsRaw.includes('--all') ? args : `--all ${args}`

function run(label: string, cmd: string) {
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`  ${label}`)
  console.log(`${'═'.repeat(70)}\n`)
  console.log(`$ ${cmd}\n`)
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' })
}

run('STANDARD JFB BENCH', `tsx ${resolve(ROOT, 'benchmarks/run-jfb.ts')} ${standardArgs}`)
run('TICKER BENCH', `tsx ${resolve(ROOT, 'scripts/run-ticker.ts')} ${args}`)

console.log(`\n${'═'.repeat(70)}`)
console.log('  ALL BENCHMARKS COMPLETE')
console.log(`${'═'.repeat(70)}`)
