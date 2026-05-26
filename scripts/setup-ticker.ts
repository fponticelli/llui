/**
 * Wires the ticker benchmarks into the local js-framework-benchmark
 * clone. Idempotent — re-run any time, including after `pnpm bench:setup`
 * has refreshed the upstream clone.
 *
 * Steps:
 *   1. Verify each ticker framework app is built (`dist/main.js` present).
 *   2. Symlink each app into <jfb-repo>/frameworks/keyed/<name>-ticker.
 *   3. Inject the 8 CPU benchmark infos into webdriver-ts/src/benchmarksCommon.ts.
 *   4. Inject the 8 benchmark classes + array entries into
 *      webdriver-ts/src/benchmarksWebdriverCDP.ts.
 *   5. Run `npm install` + `npm run compile` in webdriver-ts.
 *
 * The injections use begin/end markers so a second run replaces the
 * block in place instead of duplicating it.
 *
 * Usage:
 *   pnpm bench:ticker:setup            # uses default jfb-repo location
 *   JFB_REPO=/path/to/jfb-repo pnpm bench:ticker:setup
 *   pnpm bench:ticker:setup --skip-build  # don't rebuild webdriver-ts
 */

import { execSync } from 'node:child_process'
import {
  existsSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  lstatSync,
  unlinkSync,
} from 'node:fs'
import { resolve, dirname, relative } from 'node:path'

const ROOT = dirname(import.meta.dirname)
const BENCH_DIR = resolve(ROOT, 'benchmarks')
const TICKER_DIR = resolve(BENCH_DIR, 'jfb-ticker')
const PATCHES_DIR = resolve(TICKER_DIR, 'jfb-patches')
const WORKSPACE_REPO = resolve(BENCH_DIR, 'js-framework-benchmark-repo')

const FRAMEWORKS = ['llui', 'vanillajs', 'solid', 'react', 'svelte'] as const
const args = process.argv.slice(2)
const skipBuild = args.includes('--skip-build')

function detectJfbRepo(): string {
  if (process.env.JFB_REPO) return resolve(process.env.JFB_REPO)
  if (existsSync(resolve(WORKSPACE_REPO, 'webdriver-ts/src/benchmarksCommon.ts'))) {
    return WORKSPACE_REPO
  }
  // Fall back to the main checkout's clone (covers worktree use).
  const fallback = resolve(ROOT, '..', 'benchmarks', 'js-framework-benchmark-repo')
  if (existsSync(resolve(fallback, 'webdriver-ts/src/benchmarksCommon.ts'))) {
    return fallback
  }
  return WORKSPACE_REPO
}

const JFB_REPO = detectJfbRepo()

if (!existsSync(resolve(JFB_REPO, 'webdriver-ts/src/benchmarksCommon.ts'))) {
  console.error(`jfb-repo not found at ${JFB_REPO}`)
  console.error('Run `pnpm bench:setup` first, or set JFB_REPO env var.')
  process.exit(1)
}
console.log(`Using jfb-repo at ${JFB_REPO}`)

// ── Step 1+2: verify built bundles, then symlink ─────────────────

for (const fw of FRAMEWORKS) {
  const src = resolve(TICKER_DIR, 'frameworks', fw)
  const dist = resolve(src, 'dist/main.js')
  if (!existsSync(dist)) {
    console.error(`Missing build: ${dist}`)
    console.error(`Run \`pnpm --filter jfb-ticker-${fw} build-prod\` first.`)
    process.exit(1)
  }
}

const keyedDir = resolve(JFB_REPO, 'frameworks', 'keyed')

// jfb's framework discovery requires a package-lock.json in each
// framework dir. Our apps use pnpm workspaces so there's no real lock
// file; we synthesize a minimal one whose `packages` entry matches the
// installed version of the framework's signature package. The shape
// matches what `buildFrameworkVersionString` expects.
const LOCK_PACKAGES: Record<string, string | null> = {
  llui: '@llui/dom',
  vanillajs: null,
  solid: 'solid-js',
  react: 'react',
  svelte: 'svelte',
}

function readVersion(fw: string, pkg: string): string {
  const candidate = resolve(TICKER_DIR, 'frameworks', fw, 'node_modules', pkg, 'package.json')
  if (existsSync(candidate)) {
    return JSON.parse(readFileSync(candidate, 'utf8')).version ?? ''
  }
  // For workspace deps like @llui/dom, fall back to the source package's package.json.
  if (pkg === '@llui/dom') {
    return JSON.parse(readFileSync(resolve(ROOT, 'packages/dom/package.json'), 'utf8')).version
  }
  return ''
}

function writeLockFile(fwDir: string, fw: string): void {
  const pkg = LOCK_PACKAGES[fw]
  const lockPath = resolve(fwDir, 'package-lock.json')
  if (pkg == null) {
    // vanillajs has no signature package — minimal lock just to pass
    // the existence check.
    if (!existsSync(lockPath)) {
      writeFileSync(
        lockPath,
        JSON.stringify(
          { name: `jfb-ticker-${fw}`, version: '1.0.0', lockfileVersion: 3 },
          null,
          2,
        ) + '\n',
      )
    }
    return
  }
  const version = readVersion(fw, pkg)
  writeFileSync(
    lockPath,
    JSON.stringify(
      {
        name: `jfb-ticker-${fw}`,
        version: '1.0.0',
        lockfileVersion: 3,
        packages: {
          [`node_modules/${pkg}`]: { version },
        },
      },
      null,
      2,
    ) + '\n',
  )
}

for (const fw of FRAMEWORKS) {
  const src = resolve(TICKER_DIR, 'frameworks', fw)
  const dest = resolve(keyedDir, `${fw}-ticker`)

  // If the destination exists and isn't a symlink to our app, abort —
  // don't trample a real framework folder.
  if (existsSync(dest)) {
    const stat = lstatSync(dest)
    if (!stat.isSymbolicLink()) {
      console.error(`Refusing to overwrite non-symlink ${dest}`)
      process.exit(1)
    }
    unlinkSync(dest)
  }
  symlinkSync(src, dest, 'dir')
  writeLockFile(src, fw)
  console.log(`symlink frameworks/keyed/${fw}-ticker → ${relative(JFB_REPO, src)}`)
}

// ── Step 3: inject CPU benchmark infos ───────────────────────────

// Strip own-marker comments — readPatch returns the body only; the
// caller adds the marker lines back when writing.
function readPatch(name: string, markerBase: string): string {
  const raw = readFileSync(resolve(PATCHES_DIR, name), 'utf8')
  return raw
    .split('\n')
    .filter((l) => !l.includes(`${markerBase}:begin`) && !l.includes(`${markerBase}:end`))
    .join('\n')
    .trim()
}

// Inject `body` between `<beginMarker>\n` and `\n<endMarker>` into
// `filePath`. If the markers already exist, replace between them. If
// not, find a regex match in the source whose first capture group ends
// at the desired insertion point, and insert the block there.
function patch(
  filePath: string,
  beginMarker: string,
  endMarker: string,
  body: string,
  freshAnchor: RegExp,
): void {
  const source = readFileSync(filePath, 'utf8')
  const stripRe = new RegExp(
    `\\n?${escapeRegex(beginMarker)}[\\s\\S]*?${escapeRegex(endMarker)}\\n?`,
    'g',
  )
  const cleaned = source.replace(stripRe, '\n')
  const m = freshAnchor.exec(cleaned)
  if (!m || m[1] === undefined) throw new Error(`anchor regex did not match in ${filePath}`)
  const insertPos = m.index + m[1].length
  const insertion = `\n${beginMarker}\n${body}\n${endMarker}\n`
  const next = cleaned.slice(0, insertPos) + insertion + cleaned.slice(insertPos)
  writeFileSync(filePath, next)
  console.log(`patched ${relative(JFB_REPO, filePath)}`)
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const cpuInfosFile = resolve(JFB_REPO, 'webdriver-ts/src/benchmarksCommon.ts')
patch(
  cpuInfosFile,
  '// === ticker-bench:begin ===',
  '// === ticker-bench:end ===',
  readPatch('cpu-benchmark-infos.ts.tmpl', 'ticker-bench'),
  // First capture group ends right before `\n];` — that's where we
  // insert so the new entries land inside the array literal.
  /(export const cpuBenchmarkInfosArray[\s\S]*?)(\n\];)/,
)

// ── Step 4: inject CDP classes + array entries ───────────────────

const cdpFile = resolve(JFB_REPO, 'webdriver-ts/src/benchmarksWebdriverCDP.ts')

// 4a. Add ticker entries inside the existing `benchmarks` array.
patch(
  cdpFile,
  '  // === ticker-bench:array:begin ===',
  '  // === ticker-bench:array:end ===',
  readPatch('benchmarks-array.ts.tmpl', 'ticker-bench:array'),
  /(export const benchmarks = \[[\s\S]*?)(\n\];)/,
)

// 4b. Insert the class definitions BEFORE the `export const benchmarks = [`
// line. They must precede the array because the array (already patched in
// step 4a) references them by identifier.
patch(
  cdpFile,
  '// === ticker-bench:classes:begin ===',
  '// === ticker-bench:classes:end ===',
  readPatch('webdriver-cdp-classes.ts.tmpl', 'ticker-bench:classes'),
  // First capture: everything up to (but not including) the line that
  // begins the benchmarks array.
  /([\s\S]*?)(export const benchmarks = \[)/,
)

// ── Step 5: rebuild webdriver-ts ─────────────────────────────────

if (skipBuild) {
  console.log('Skipping webdriver-ts compile (--skip-build).')
} else {
  const wdDir = resolve(JFB_REPO, 'webdriver-ts')
  console.log(`Compiling webdriver-ts (${wdDir})...`)
  try {
    execSync('npm run compile', { cwd: wdDir, stdio: 'inherit' })
  } catch (e) {
    console.error('webdriver-ts compile failed. Inspect the patched files for errors.')
    process.exit(1)
  }
}

console.log('\nSetup complete. Run `pnpm bench:ticker` to measure.')
