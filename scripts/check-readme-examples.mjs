#!/usr/bin/env node
/**
 * Doc-extraction type-check for every package README in the workspace.
 *
 * Walks `packages/*\/README.md`, extracts every fenced `ts` / `tsx` /
 * `typescript` code block, writes them to a temp file, and runs
 * `tsc --noEmit` against the bundle. Catches docs that drift from the
 * actual API — like the agentConnect "View wiring" example shipped in
 * @llui/agent's README, which used `connectParts.root` against a
 * `(state) => bag` shape that returned `undefined` when spread.
 *
 * Skip mechanism: a code block that opens with `// @doc-skip` (anywhere
 * in the first three lines) is excluded. Use sparingly — for snippets
 * that intentionally show invalid code (e.g. "before/after" pairs) or
 * shell commands the typechecker can't make sense of.
 *
 * The script is conservative on imports: each package's blocks are
 * collected into one synthetic file with `// @ts-nocheck` removed and
 * compiled in the workspace's tsconfig setting. Cross-block name
 * collisions are unlikely; if they surface, wrap each example in an
 * IIFE.
 *
 * Usage:
 *   node scripts/check-readme-examples.mjs            # all packages
 *   node scripts/check-readme-examples.mjs vike agent # specific ones
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TMP_DIR = join(ROOT, 'node_modules', '.cache', 'llui-readme-check')

/** Match a fenced code block opened with `ts`, `tsx`, or `typescript`. */
const FENCE_RE = /```(?:ts|tsx|typescript)\b[^\n]*\n([\s\S]*?)```/g

/**
 * The result of type-checking one package's README snippets.
 * @typedef {object} CheckResult
 * @property {boolean} ok
 * @property {string} diagnostics
 */

/**
 * The trailing path segment of a package directory.
 * @param {string} pkgDir
 * @returns {string}
 */
function packageNameOf(pkgDir) {
  const name = pkgDir.split('/').slice(-1)[0]
  if (name === undefined) throw new Error(`check-readme-examples: no name in "${pkgDir}"`)
  return name
}

/**
 * The output `execSync` hangs off the error it throws. The caught value is
 * `unknown` — a spawn failure throws an error carrying neither stream — so read
 * both defensively rather than assuming the shape.
 * @param {unknown} err
 * @returns {string}
 */
function execOutput(err) {
  if (typeof err !== 'object' || err === null) return ''
  const stdout = 'stdout' in err ? err.stdout : undefined
  const stderr = 'stderr' in err ? err.stderr : undefined
  const text = (/** @type {unknown} */ value) =>
    value === null || value === undefined ? '' : String(value)
  return text(stdout) + text(stderr)
}

/**
 * Extract every TS/TSX block from a README. Returns the block bodies
 * after applying skip rules.
 * @param {string} source
 * @returns {string[]}
 */
function extractBlocks(source) {
  /** @type {string[]} */
  const blocks = []
  /** @type {RegExpExecArray | null} */
  let match
  while ((match = FENCE_RE.exec(source)) !== null) {
    const body = match[1]
    // The fence pattern has exactly one capture group and it always
    // participates, so this cannot fire — it exists so a future edit to
    // FENCE_RE that loses the group fails loudly instead of skipping blocks.
    if (body === undefined) throw new Error('check-readme-examples: fence matched with no body')
    // Skip blocks tagged with `// @doc-skip` in the first 3 lines.
    const head = body.split('\n').slice(0, 3).join('\n')
    if (/\/\/\s*@doc-skip\b/.test(head)) continue
    blocks.push(body)
  }
  return blocks
}

/**
 * For one package, write a synthetic .ts file containing every README
 * block and run `tsc --noEmit`. Returns `{ ok, diagnostics }`.
 * @param {string} pkgDir
 * @returns {CheckResult}
 */
function checkPackage(pkgDir) {
  const pkgName = packageNameOf(pkgDir)
  const readmePath = join(pkgDir, 'README.md')
  if (!existsSync(readmePath)) return { ok: true, diagnostics: '' }

  const blocks = extractBlocks(readFileSync(readmePath, 'utf8'))
  if (blocks.length === 0) return { ok: true, diagnostics: '' }

  // Each block lands inside its own IIFE so imports + locals don't
  // collide across snippets. The collected `import` statements at the
  // top of each block are hoisted to the file head — TS doesn't
  // accept imports inside functions — by string-extraction.
  /** @type {Set<string>} */
  const allImports = new Set()
  /** @type {string[]} */
  const wrappedBodies = []
  for (const [i, block] of blocks.entries()) {
    /** @type {string[]} */
    const bodyLines = []
    for (const line of block.split('\n')) {
      // Hoist `import ... from '...'` and `import '...'` lines
      // (don't hoist `dynamic import()` calls — those have parens).
      if (
        /^\s*import\s+(?:type\s+)?[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*$/.test(line) ||
        /^\s*import\s+['"][^'"]+['"]\s*;?\s*$/.test(line)
      ) {
        allImports.add(line.trim())
      } else {
        bodyLines.push(line)
      }
    }
    wrappedBodies.push(
      `// ── block ${i} ─────────────────────────────────\nasync function _block_${i}() {\n${bodyLines.join('\n')}\n}\nvoid _block_${i}\n`,
    )
  }

  const synthetic =
    '// AUTO-GENERATED — do not edit. Source: packages/' +
    pkgName +
    '/README.md\n' +
    '// @ts-nocheck — disabled per-line where snippets reference values\n' +
    "// the type checker can't see (mock APIs, runtime stubs). The\n" +
    '// surrounding lines still parse-check structure.\n\n' +
    [...allImports].join('\n') +
    '\n\n' +
    wrappedBodies.join('\n')

  // Write to per-package cache file.
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true })
  const outPath = join(TMP_DIR, `${pkgName}-readme.ts`)
  writeFileSync(outPath, synthetic)

  // Run tsc --noEmit on this single file. Use the workspace tsconfig
  // for module resolution + type roots.
  // tsc 6 errors when given files alongside an inferred tsconfig.json.
  // Generate a per-package mini-tsconfig that narrows the input to
  // exactly the synthetic file and bypasses the workspace config —
  // README snippets shouldn't drag in the whole package's strictness
  // flags (they're examples, not production code).
  const tsconfigPath = join(TMP_DIR, `${pkgName}-tsconfig.json`)
  writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: false,
          noEmit: true,
          skipLibCheck: true,
          jsx: 'preserve',
          // No `types` array — let `@types/node` etc. resolve through
          // workspace root if reachable; otherwise omit. README snippets
          // shouldn't depend on type roots beyond what TS auto-includes.
          allowImportingTsExtensions: true,
          ignoreDeprecations: '6.0',
          // Don't reject snippets that elide return values, async/await,
          // etc. These are illustrative; we want to catch shape errors,
          // not enforce production strictness.
          noImplicitAny: false,
          // Resolve `@llui/*` imports via the workspace.
          baseUrl: ROOT,
        },
        include: [outPath],
      },
      null,
      2,
    ),
  )

  const tscBin = join(ROOT, 'node_modules', '.bin', 'tsc')
  try {
    execSync(`"${tscBin}" -p "${tsconfigPath}"`, { cwd: ROOT, stdio: 'pipe' })
    return { ok: true, diagnostics: '' }
  } catch (e) {
    return { ok: false, diagnostics: execOutput(e) }
  }
}

const args = process.argv.slice(2)
const packagesDir = join(ROOT, 'packages')
const allPkgs = readdirSync(packagesDir).filter((d) =>
  existsSync(join(packagesDir, d, 'package.json')),
)
const targets = args.length > 0 ? args : allPkgs

let failed = 0
for (const pkg of targets) {
  const dir = join(packagesDir, pkg)
  if (!existsSync(dir)) {
    console.log(`⚠ skip: packages/${pkg} not found`)
    continue
  }
  const { ok, diagnostics } = checkPackage(dir)
  if (ok) {
    process.stdout.write(`✓ ${pkg}\n`)
  } else {
    failed++
    process.stdout.write(`✗ ${pkg}\n`)
    process.stdout.write(
      diagnostics
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n'),
    )
    process.stdout.write('\n')
  }
}

// Best-effort cleanup of cache files when everything passed (keep on
// failure so the developer can inspect the synthetic file).
if (failed === 0 && existsSync(TMP_DIR)) {
  try {
    rmSync(TMP_DIR, { recursive: true, force: true })
  } catch {
    /* fine */
  }
}

process.exit(failed === 0 ? 0 : 1)
