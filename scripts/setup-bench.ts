/**
 * One-time setup of the local js-framework-benchmark ("jfb") harness that BOTH
 * bench suites run on (`pnpm bench` and `pnpm bench:ticker`).
 *
 * This replaces the former `bench:setup` one-liner
 *
 *   git clone … 2>/dev/null || true && cd … && npm ci && cd server && npm ci && …
 *
 * whose `&&` chain stopped at the FIRST failing step and reported the breakage
 * three directories away. The step that fails is upstream's ROOT `npm ci`: jfb's
 * own root manifest pins `eslint@^10` while `eslint-plugin-react` peers at
 * `<=9`, so npm aborts with ERESOLVE. The mechanism is plain: resolution fails
 * BEFORE reify, so the root `node_modules` is simply never created — npm
 * 11.11.0 leaves an existing tree untouched (measured: 350 entries before a
 * failing `npm ci`, 350 after) — and `&&` then stops the chain before `server/`
 * and `webdriver-ts/` are ever reached. Those two, the only trees the harness
 * actually needs, were never installed at all, surfacing much later as
 * `Cannot find module 'yargs'` from `bench:ticker:setup` or
 * `jfb server failed to start on port 8080`.
 *
 * So: every step here is NAMED, its failure is CHECKED, and each install is
 * VERIFIED afterwards against its LOCKFILE — every `node_modules/...` path the
 * lock declares must physically exist. npm's exit code alone is not evidence
 * (`npm ci --omit=dev` exits 0 on a tree missing every devDependency), and
 * neither is a direct-dependency check: a missing TRANSITIVE dep leaves all
 * direct ones in place and reproduces `jfb server failed to start on port 8080`
 * exactly. Any failure exits non-zero naming the step and printing the command
 * to reproduce it. The clone's errors are reported too; nothing is `|| true`d.
 *
 * Steps:
 *   1. Clone (or reuse) the upstream repo
 *   2. `npm ci --legacy-peer-deps` at the repo root (required by the pinned
 *      revision's known eslint peer conflict, see above).
 *      Upstream's root `postinstall` is `cd server && npm install`, so on a
 *      fresh clone this step also populates `server/`.
 *   3. `server/` — fastify + tsx, the :8080 bench server. Usually already
 *      installed by step 2's postinstall, in which case this only VERIFIES it
 *      against `server/package-lock.json`; `npm ci` runs when it doesn't match.
 *   4. `npm ci` in `webdriver-ts/`  — the benchmark runner
 *   5. Patch Chrome 150 traces to honor `TracingStartedInBrowser`; otherwise
 *      buffered warm-up clicks can enter the measured event set
 *   6. `npm run compile` in `webdriver-ts/` and verify the patch with a fixture
 *   7. Build the five ticker apps (`benchmarks/jfb-ticker/frameworks/*`) so
 *      `pnpm bench:ticker:setup` finds the `dist/main.js` bundles it symlinks
 *
 * Idempotent: an install is skipped when its tree matches the lockfile and is
 * no older than it; an existing clone is reused. `--force` reinstalls/rebuilds
 * unconditionally.
 *
 * Usage:
 *   pnpm bench:setup
 *   pnpm bench:setup --force              # reinstall/rebuild even if complete
 *   pnpm bench:setup --skip-ticker-apps   # harness only, don't build ticker apps
 *   JFB_REPO=/path/to/js-framework-benchmark pnpm bench:setup
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import {
  directDependencies,
  expectedPackages,
  installState,
  missingPackages,
} from './lib/verify-install'
import { assertJfbRevision, currentJfbRevision, readPinnedJfbRevision } from './lib/jfb-revision'
import { environmentForNpm } from './lib/npm-environment'
import { patchJfbTimelineSource } from './lib/jfb-trace-start'

const ROOT = dirname(import.meta.dirname)
const BENCH_DIR = resolve(ROOT, 'benchmarks')
const TICKER_DIR = resolve(BENCH_DIR, 'jfb-ticker')
const REPO_URL = 'https://github.com/krausest/js-framework-benchmark.git'
const JFB_REVISION = readPinnedJfbRevision(ROOT)
const JFB_REPO = process.env.JFB_REPO
  ? resolve(process.env.JFB_REPO)
  : resolve(BENCH_DIR, 'js-framework-benchmark-repo')

// Kept in sync with scripts/setup-ticker.ts and scripts/run-ticker.ts.
const TICKER_FRAMEWORKS = ['llui', 'vanillajs', 'solid', 'react', 'svelte'] as const

// The llui ticker app bundles these from their built `dist/`, so they must
// exist before `vite build` runs. Turbo pulls in their own deps via `^build`.
const TICKER_LIB_FILTERS = ['--filter=@llui/dom', '--filter=@llui/vite-plugin'] as const

const args = process.argv.slice(2)
const force = args.includes('--force')
const skipTickerApps = args.includes('--skip-ticker-apps')
const unknownArgs = args.filter((a) => a !== '--force' && a !== '--skip-ticker-apps')
if (unknownArgs.length > 0) {
  console.error(`Unknown argument(s): ${unknownArgs.join(' ')}`)
  console.error('Usage: pnpm bench:setup [--force] [--skip-ticker-apps]')
  process.exit(2)
}

const TOTAL_STEPS = skipTickerApps ? 6 : 7
let stepIndex = 0
let currentStep = 'startup'

// Remedies must carry the env var the user is running under, or following them
// silently targets the default clone instead of theirs.
const SETUP_CMD =
  process.env.JFB_REPO === undefined ? 'pnpm bench:setup' : `JFB_REPO=${JFB_REPO} pnpm bench:setup`

// ── Reporting ────────────────────────────────────────────────────

function short(path: string): string {
  const rel = relative(ROOT, path)
  return rel === '' ? '.' : rel.startsWith('..') ? path : rel
}

function step(title: string): void {
  stepIndex++
  currentStep = title
  console.log(
    `\n── [${stepIndex}/${TOTAL_STEPS}] ${title} ${'─'.repeat(Math.max(0, 52 - title.length))}`,
  )
}

/** Abort naming the step that broke and how to reproduce/repair it. */
function fail(reason: string, remedy: readonly string[]): never {
  console.error(`\n✗ bench:setup FAILED at step ${stepIndex}/${TOTAL_STEPS}: ${currentStep}`)
  console.error(`  ${reason}`)
  for (const line of remedy) console.error(`  ${line}`)
  process.exit(1)
}

interface ExecOutcome {
  readonly ok: boolean
  /** Killed by a signal (Ctrl-C, SIGKILL) rather than exiting on its own. */
  readonly signal: NodeJS.Signals | null
}

function exec(cmd: string, cmdArgs: readonly string[], cwd: string): ExecOutcome {
  console.log(`$ ${[cmd, ...cmdArgs].join(' ')}   (in ${short(cwd)})`)
  const result = spawnSync(cmd, [...cmdArgs], {
    cwd,
    env: cmd === 'npm' ? environmentForNpm(process.env) : process.env,
    stdio: 'inherit',
  })
  if (result.error !== undefined) {
    console.error(`  could not run ${cmd}: ${result.error.message}`)
    return { ok: false, signal: null }
  }
  return { ok: result.status === 0, signal: result.signal }
}

// ── Install verification ─────────────────────────────────────────

/** Missing-package lists can be long; name enough to act on. */
function summarize(paths: readonly string[], limit = 8): string {
  const shown = paths.slice(0, limit).join(', ')
  return paths.length > limit ? `${shown} (+${paths.length - limit} more)` : shown
}

/**
 * `npm ci` in `pkgDir`, then verify the tree. `installArgs` records any
 * revision-specific resolution policy explicitly; the pinned JFB root requires
 * `--legacy-peer-deps` because its lockfile's eslint peers do not resolve under
 * npm's strict mode.
 */
function installStep(label: string, pkgDir: string, installArgs: readonly string[]): void {
  if (!existsSync(resolve(pkgDir, 'package.json'))) {
    fail(`${label}: no package.json in ${short(pkgDir)}`, [
      'The jfb clone looks incomplete. Remove it and re-run:',
      `  rm -rf ${short(JFB_REPO)} && ${SETUP_CMD}`,
    ])
  }
  if (!existsSync(resolve(pkgDir, 'package-lock.json'))) {
    fail(`${label}: no package-lock.json in ${short(pkgDir)} — \`npm ci\` needs one`, [
      'The jfb clone looks incomplete. Remove it and re-run:',
      `  rm -rf ${short(JFB_REPO)} && ${SETUP_CMD}`,
    ])
  }

  const npmCiArgs = ['ci', '--no-audit', '--no-fund', ...installArgs]
  const state = force ? 'absent' : installState(pkgDir)
  if (state === 'ok') {
    console.log(
      `${label}: up to date (${expectedPackages(pkgDir).length} lockfile packages present) — skipping`,
    )
  } else {
    if (state !== 'absent') console.log(`${label}: node_modules is ${state} — reinstalling`)
    const outcome = exec('npm', npmCiArgs, pkgDir)
    if (!outcome.ok) {
      const cause =
        outcome.signal === null
          ? `\`npm ci\` failed in ${short(pkgDir)}`
          : `\`npm ci\` in ${short(pkgDir)} was killed by ${outcome.signal}`
      fail(`${label}: ${cause}`, [
        'Reproduce with:',
        `  cd ${short(pkgDir)} && npm ${npmCiArgs.join(' ')}`,
        `Then re-run \`${SETUP_CMD}\` — it re-checks this tree against the lockfile.`,
      ])
    }
  }

  // Trust the tree, not the exit code.
  const missing = missingPackages(pkgDir)
  if (missing.length > 0) {
    const expected = expectedPackages(pkgDir).length
    fail(
      `${label}: install reported success but ${missing.length} of ${expected} packages ` +
        `in ${short(pkgDir)}/package-lock.json are missing from node_modules: ` +
        summarize(missing),
      [
        'Reproduce with:',
        `  rm -rf ${short(pkgDir)}/node_modules && cd ${short(pkgDir)} && ` +
          `npm ${npmCiArgs.join(' ')}`,
      ],
    )
  }
  console.log(
    `✓ ${label}: ${expectedPackages(pkgDir).length} lockfile packages present ` +
      `(${directDependencies(pkgDir).length} direct)`,
  )
}

// ── Step 1: clone (or reuse) the upstream repo ───────────────────

step('clone js-framework-benchmark')

const repoMarker = resolve(JFB_REPO, 'webdriver-ts/package.json')
if (existsSync(JFB_REPO)) {
  if (!existsSync(repoMarker)) {
    fail(`${short(JFB_REPO)} exists but is not a js-framework-benchmark checkout`, [
      `(no webdriver-ts/package.json). Remove it and re-run:`,
      `  rm -rf ${short(JFB_REPO)} && ${SETUP_CMD}`,
    ])
  }
  console.log(`reusing existing clone at ${short(JFB_REPO)}`)
  const actualRevision = currentJfbRevision(JFB_REPO)
  if (actualRevision !== JFB_REVISION) {
    if (!force) {
      fail(`jfb checkout is at ${actualRevision}, expected pinned ${JFB_REVISION}`, [
        `Run \`${SETUP_CMD} --force\` to fetch and check out the repository pin.`,
      ])
    }
    if (!exec('git', ['fetch', '--depth=1', 'origin', JFB_REVISION], JFB_REPO).ok) {
      fail(`could not fetch pinned jfb revision ${JFB_REVISION}`, [
        `Reproduce with: git -C ${short(JFB_REPO)} fetch --depth=1 origin ${JFB_REVISION}`,
      ])
    }
    if (!exec('git', ['checkout', '--detach', '--force', JFB_REVISION], JFB_REPO).ok) {
      fail(`could not check out pinned jfb revision ${JFB_REVISION}`, [
        `Reproduce with: git -C ${short(JFB_REPO)} checkout --detach --force ${JFB_REVISION}`,
      ])
    }
  }
} else {
  mkdirSync(JFB_REPO, { recursive: true })
  if (!exec('git', ['init', '--quiet'], JFB_REPO).ok) {
    fail(`git init failed in ${short(JFB_REPO)}`, [`Remove ${short(JFB_REPO)} and re-run.`])
  }
  if (!exec('git', ['remote', 'add', 'origin', REPO_URL], JFB_REPO).ok) {
    fail(`could not add jfb origin ${REPO_URL}`, [`Remove ${short(JFB_REPO)} and re-run.`])
  }
  if (!exec('git', ['fetch', '--depth=1', 'origin', JFB_REVISION], JFB_REPO).ok) {
    fail(`could not fetch pinned jfb revision ${JFB_REVISION}`, [
      `Remove ${short(JFB_REPO)} and re-run.`,
    ])
  }
  if (!exec('git', ['checkout', '--detach', JFB_REVISION], JFB_REPO).ok) {
    fail(`could not check out pinned jfb revision ${JFB_REVISION}`, [
      `Remove ${short(JFB_REPO)} and re-run.`,
    ])
  }
  if (!existsSync(repoMarker)) {
    fail(`git clone reported success but ${short(repoMarker)} is missing`, [
      `  rm -rf ${short(JFB_REPO)} && ${SETUP_CMD}`,
    ])
  }
  console.log(`✓ cloned into ${short(JFB_REPO)}`)
}
assertJfbRevision(JFB_REPO, JFB_REVISION)
console.log(`✓ pinned jfb revision: ${JFB_REVISION}`)

// ── Steps 2-4: the three installs ────────────────────────────────

step('install jfb root deps')
// This revision's root devDeps do not resolve under npm's strict peer checking
// (eslint@^10 vs eslint-plugin-react's `<=9` peer). The JFB revision is pinned,
// so attempting a known-to-fail strict install adds noise without information.
installStep('jfb root', JFB_REPO, ['--legacy-peer-deps'])

step('install jfb server deps')
installStep('server', resolve(JFB_REPO, 'server'), [])

step('install webdriver-ts deps')
installStep('webdriver-ts', resolve(JFB_REPO, 'webdriver-ts'), [])

// ── Step 5: Chrome trace-boundary compatibility ─────────────────

step('patch Chrome trace boundary')

const webdriverDir = resolve(JFB_REPO, 'webdriver-ts')
const timelineFile = resolve(webdriverDir, 'src/timeline.ts')
try {
  const source = readFileSync(timelineFile, 'utf8')
  writeFileSync(timelineFile, patchJfbTimelineSource(source))
} catch (error) {
  fail(`could not apply the Chrome trace-start patch: ${String(error)}`, [
    `The pinned JFB timeline shape changed or ${short(timelineFile)} is not writable.`,
    `Verify ${short(timelineFile)} against revision ${JFB_REVISION}.`,
  ])
}
console.log(`✓ patched ${short(timelineFile)}`)

// ── Step 6: compile and verify the harness ───────────────────────

step('compile webdriver-ts')

const runnerJs = resolve(webdriverDir, 'dist/benchmarkRunner.js')
if (!exec('npm', ['run', 'compile'], webdriverDir).ok) {
  fail('`npm run compile` failed in webdriver-ts', [
    'Reproduce with:',
    `  cd ${short(webdriverDir)} && npm run compile`,
    'If the errors point at ticker benchmarks, re-apply the patches:',
    '  pnpm bench:ticker:setup',
  ])
}
if (!existsSync(runnerJs)) {
  fail(`compile reported success but ${short(runnerJs)} is missing`, [
    `  cd ${short(webdriverDir)} && npm run compile`,
  ])
}
console.log(`✓ harness compiled: ${short(runnerJs)}`)

const traceFixture = resolve(BENCH_DIR, 'jfb-patches/chrome-trace-start.fixture.json')
const verifyTracePatch = `
  const { computeResultsCPU } = await import('./dist/timeline.js');
  const result = await computeResultsCPU(process.argv[1]);
  if (result.duration !== 0.045) {
    throw new Error('trace-start fixture duration: expected 0.045, found ' + result.duration);
  }
`
if (
  !exec('node', ['--input-type=module', '--eval', verifyTracePatch, traceFixture], webdriverDir).ok
) {
  fail('compiled harness did not exclude buffered events before TracingStartedInBrowser', [
    `Re-run \`${SETUP_CMD}\`; the Chrome compatibility patch must pass before benchmarking.`,
  ])
}
console.log('✓ Chrome trace boundary verified with a stale-event fixture')

// ── Step 7: build the ticker apps ────────────────────────────────
// `bench:ticker:setup` symlinks each app into the jfb repo and refuses to run
// until every one has a `dist/main.js`. Building them here is what makes
// `bench:setup` → `bench:ticker:setup` work with no manual step in between;
// `run-ticker.ts` rebuilds all five on every run anyway, so a bundle built
// here can never go stale in a way that reaches a measurement.

if (skipTickerApps) {
  console.log('\nSkipping ticker app builds (--skip-ticker-apps).')
  console.log(`\`pnpm bench:ticker:setup\` needs them — run \`${SETUP_CMD}\` without the flag.`)
} else {
  step('build ticker benchmark apps')

  if (!exec('pnpm', ['turbo', 'run', 'build', ...TICKER_LIB_FILTERS], ROOT).ok) {
    fail('building the workspace libraries the ticker apps bundle failed', [
      'Reproduce with:',
      `  pnpm turbo run build ${TICKER_LIB_FILTERS.join(' ')}`,
    ])
  }

  const failedApps: string[] = []
  for (const fw of TICKER_FRAMEWORKS) {
    const appDir = resolve(TICKER_DIR, 'frameworks', fw)
    const bundle = resolve(appDir, 'dist/main.js')
    if (!force && existsSync(bundle)) {
      console.log(`jfb-ticker-${fw}: dist/main.js present — skipping`)
      continue
    }
    if (!exec('pnpm', ['--filter', `jfb-ticker-${fw}`, 'build-prod'], ROOT).ok) {
      failedApps.push(fw)
      continue
    }
    if (!existsSync(bundle)) failedApps.push(fw)
  }

  // Report every broken app at once — rediscovering them one run at a time is
  // exactly the failure mode this script exists to remove.
  if (failedApps.length > 0) {
    fail(
      `${failedApps.length} ticker app(s) did not produce dist/main.js: ${failedApps.join(', ')}`,
      ['Reproduce with:', ...failedApps.map((fw) => `  pnpm --filter jfb-ticker-${fw} build-prod`)],
    )
  }
  console.log(`✓ ${TICKER_FRAMEWORKS.length} ticker apps built`)
}

console.log('\n✓ bench:setup complete.')
console.log(`  jfb repo:  ${short(JFB_REPO)}`)
console.log('  Next:      pnpm bench                # standard jfb suite')
console.log('             pnpm bench:ticker:setup   # one-time, ticker suite only')
console.log('             pnpm bench:ticker         # ticker suite')
