#!/usr/bin/env node
// Verify the PUBLISHED shape of each package's build output. Five invariants
// that are invisible in-repo (everything resolves fine from the workspace) and
// only break once a consumer installs the tarball:
//
//   1. Every relative import in `dist/**/*.js` carries a `.js` extension. Node's
//      ESM resolver does not guess — an extensionless specifier is a hard
//      ERR_MODULE_NOT_FOUND for every consumer. `scripts/add-js-extensions.mjs`
//      adds them post-tsc; if that pass breaks, nothing else notices.
//
//   2. Every sourcemap's `sources` resolve to a file that is actually SHIPPED.
//      These packages deliberately do NOT set `inlineSources`: `files` already
//      includes `src`, so the .ts sources ship verbatim and the maps point at
//      them relatively (`../../src/signals/mount.ts`). Embedding them too would
//      duplicate ~340KB per package for nothing. But that arrangement is
//      load-bearing — drop `src` from `files`, or move `outDir`, and every
//      published sourcemap silently resolves to nothing.
//
//   3. No ORPHANED artifacts: `tsc` never deletes the output of a source that
//      was removed, so a stale `dist/` ships dead modules (a documented landmine
//      — `scripts/publish.sh` `rm -rf dist` before building for exactly this
//      reason). A map whose source is gone is the cheapest way to detect it.
//
//   4. Every type name an emitted `.d.ts` REFERENCES is BOUND, and no source
//      file in a `stripInternal` package mentions the internal JSDoc tag as
//      prose. Two arms of one guard (#253) — see
//      `scripts/lib/dist-type-bindings.mjs` for why neither can replace the
//      other.
//
//   5. Every emitted `.d.ts` in a publishable package TYPE-CHECKS, in one
//      `ts.Program` with `skipLibCheck: false` (#257) — the check a consumer
//      that does not skip lib checking actually runs against our published
//      types. This is what closes the hole invariant 4 leaves open by
//      construction: a BINDING check cannot see an unresolvable module
//      SPECIFIER, and that is how six `import("rolldown").X` and one
//      side-effect CSS import shipped under a green gate. Verdict is scoped
//      STRUCTURALLY to `packages/*/dist/**` (a third-party `.d.ts` we merely
//      pull in is what `skipLibCheck` exists for); the one approved diagnostic
//      in our own output is in `SEMANTIC_ALLOWED`, closed at both ends.
//
// Imports are found by PARSING with the TypeScript compiler, not by regex: this
// repo's own compiler sources quote `export { X } from './y'` inside comments
// and doc strings, and a text scan reports those as violations. A release gate
// that cries wolf gets disabled.
//
// Lives here rather than as a snippet in the /publish skill because inline doc
// snippets rot — the previous versions of these checks pointed at
// `packages/dom/dist/mount.js`, a path that had not existed for some time, so
// one passed vacuously and the other could never have passed at all.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname, relative, normalize } from 'node:path'
import { createRequire } from 'node:module'
import {
  INTERNAL_TAG,
  MIN_TAG_MENTIONS,
  PROBE_SIDE_EFFECT_TARGET,
  SEMANTIC_ALLOWED,
  distSemanticDiagnostics,
  freeTypeNames,
  globalTypeNames,
  misplacedInternalTags,
  stripInternalPackages,
  walkDts,
  walkTs,
} from './lib/dist-type-bindings.mjs'

// `createRequire(...)(...)` is typed `any`, so the annotation has to land on a
// SECOND binding: a JSDoc cast is invisible to typescript-eslint (the rule
// resolves the inner expression and still sees `any` — observed, cause unread),
// while `any` -> `unknown` on a declaration is accepted by both gates.
/** @type {unknown} */
const tsModule = createRequire(import.meta.url)('typescript')
const ts = /** @type {typeof import('typescript')} */ (tsModule)

/**
 * The subset of a package manifest this check reads.
 * @typedef {object} PackageManifest
 * @property {boolean} [private]
 * @property {string[]} [files]
 */

/**
 * The subset of a sourcemap this check reads.
 * @typedef {object} SourceMap
 * @property {string[]} [sources]
 */

/**
 * The first path segment of a relative path. `split` always yields at least one
 * element, so the throw is unreachable — it is here because
 * `noUncheckedIndexedAccess` cannot know that, and a silent `undefined` would
 * make `shipped.has(...)` answer for a path nobody looked at.
 * @param {string} p
 * @returns {string}
 */
function firstSegment(p) {
  const first = p.split('/')[0]
  if (first === undefined) throw new Error(`check-dist: cannot split path "${p}"`)
  return first
}

/**
 * Publishable package dirs (no `private: true`), or the ones named on argv.
 * @returns {string[]}
 */
function targets() {
  const named = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  if (named.length) return named
  return readdirSync('packages').filter((d) => {
    const p = `packages/${d}/package.json`
    if (!existsSync(p)) return false
    /** @type {unknown} */
    const parsed = JSON.parse(readFileSync(p, 'utf8'))
    const manifest = /** @type {PackageManifest} */ (parsed)
    return !manifest.private
  })
}

/**
 * Every file under `dir`, recursively.
 * @param {string} dir
 * @param {string[]} [out]
 * @returns {string[]}
 */
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e)
    if (statSync(f).isDirectory()) walk(f, out)
    else out.push(f)
  }
  return out
}

/** Relative module specifiers this file really imports/exports from — static,
 * `export … from`, and dynamic `import()`. Comments and unrelated strings are
 * not reachable from these nodes, so they cannot produce a false hit.
 * @param {string} file
 * @param {string} text
 * @returns {string[]}
 */
function relativeSpecifiers(file, text) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS)
  /** @type {string[]} */
  const out = []
  /** @param {import('typescript').Node | undefined} node */
  const add = (node) => {
    if (node && ts.isStringLiteral(node) && node.text.startsWith('.')) out.push(node.text)
  }
  /** @param {import('typescript').Node} node */
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier)
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      add(node.arguments[0])
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      add(node.argument.literal)
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** @type {string[]} */
const problems = []

// INDEPENDENT CORPUS ORACLE. Invariants 1-3 walk `dist` with `walk()`; arms 4
// and 5 walk it again with `walkDts()`. Counting `.d.ts` here costs nothing and
// gives the exact-set assertion below a THIRD enumeration to agree with, so a
// narrowing that touches one walk cannot pass by narrowing the other too
// (CLAUDE.md: "assert an EXACT set size — a floor only detects
// under-collection").
let integrityDts = 0

for (const pkgDir of targets()) {
  const root = `packages/${pkgDir}`
  const dist = `${root}/dist`
  if (!existsSync(dist)) {
    problems.push(`${pkgDir}: no dist/ — build before running this check`)
    continue
  }
  /** @type {unknown} */
  const parsedPkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'))
  const pkg = /** @type {PackageManifest} */ (parsedPkg)
  // Top-level names in `files` decide what ships. A map source outside them is
  // dangling in the tarball even though it resolves here in the workspace.
  const shipped = new Set((pkg.files ?? []).map((f) => firstSegment(f.replace(/^\.\//, ''))))

  for (const file of walk(dist)) {
    if (file.endsWith('.d.ts')) integrityDts++
    if (file.endsWith('.js')) {
      for (const spec of relativeSpecifiers(file, readFileSync(file, 'utf8'))) {
        if (!spec.endsWith('.js')) problems.push(`${file}: extensionless import "${spec}"`)
      }
    } else if (file.endsWith('.map')) {
      /** @type {unknown} */
      const parsedMap = JSON.parse(readFileSync(file, 'utf8'))
      const map = /** @type {SourceMap} */ (parsedMap)
      for (const s of map.sources ?? []) {
        const abs = normalize(join(dirname(file), s))
        const pkgRelative = relative(root, abs)
        if (!existsSync(abs)) {
          problems.push(
            `${file}: source "${s}" is gone — ORPHANED artifact of a deleted source; run a clean build (rm -rf ${dist})`,
          )
        } else if (pkgRelative.startsWith('..')) {
          problems.push(`${file}: source "${s}" escapes the package root`)
        } else if (!shipped.has(firstSegment(pkgRelative))) {
          problems.push(
            `${file}: source "${s}" is not shipped — "${firstSegment(pkgRelative)}" missing from package.json "files" (${[...shipped].join(', ')})`,
          )
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. stripInternal guard (#253), both arms.
// ---------------------------------------------------------------------------
const repoRoot = process.cwd()
/** True when the caller named packages on argv, so corpus floors do not apply. */
const scoped = process.argv.slice(2).filter((a) => !a.startsWith('-')).length > 0

// INSTRUMENT CHECK, before any verdict. A count floor only proves the walk
// visited files; it cannot prove either arm is still capable of REPORTING. Both
// analyzers are therefore run against a known-bad input first, and a guard that
// stays silent on that is broken rather than reassuring.
{
  const probeGlobals = new Set(['string'])
  const bad = 'export interface P { f: Gone }\n'
  if (freeTypeNames(repoRoot, 'probe.d.ts', bad, probeGlobals).free.length !== 1)
    problems.push('dist type bindings: the free-name probe did not report a known unbound name.')
  const good = "import type { Gone } from 'x'\nexport interface P { f: Gone }\n"
  if (freeTypeNames(repoRoot, 'probe.d.ts', good, probeGlobals).free.length !== 0)
    problems.push('dist type bindings: the free-name probe reported a name that IS imported.')
  const prose = `// mentions ${INTERNAL_TAG} in prose\nexport interface P { f: string }\n`
  if (misplacedInternalTags(repoRoot, 'probe.ts', prose).length !== 1)
    problems.push('stripInternal source scan: the probe did not report a known prose mention.')
  const annotated = `/** ${INTERNAL_TAG} */\nexport interface P { f: string }\n`
  if (misplacedInternalTags(repoRoot, 'probe.ts', annotated).length !== 0)
    problems.push('stripInternal source scan: the probe reported a genuine JSDoc annotation.')
}

// SOURCE arm. Buildless, so it runs over every stripInternal package regardless
// of which packages were named on argv.
let sourceFiles = 0
let tagsJudged = 0
for (const pkgDir of stripInternalPackages(repoRoot)) {
  const src = join(repoRoot, 'packages', pkgDir, 'src')
  if (!existsSync(src)) continue
  for (const file of walkTs(src)) {
    sourceFiles++
    const text = readFileSync(file, 'utf8')
    if (!text.includes('internal')) continue
    tagsJudged++
    for (const t of misplacedInternalTags(repoRoot, file, text)) {
      problems.push(
        `${relative(repoRoot, file)}:${t.line}: the internal tag is spelled in ${
          t.kind === 'line-comment' ? 'a // comment' : 'JSDoc prose'
        }. stripInternal reads EVERY leading comment range, so this DELETES the ` +
          `next declaration from the emitted .d.ts whether it was meant as an ` +
          `annotation or not (#253). House style: a real annotation is a JSDoc tag ` +
          `at the start of its line; anything else must not spell it: ${t.text}`,
      )
    }
  }
}

// DIST arm. Needs a build; `targets()` already pushed a problem for any missing
// dist above, so an unbuilt tree fails loudly rather than sweeping nothing.
let dtsFiles = 0
let refsJudged = 0
/** Filled by arm 5 below, printed in the success summary. */
let semanticSummary = 'not run'
const globals = globalTypeNames(repoRoot)
if (globals.size < 500)
  problems.push(
    `dist type bindings: the globals probe resolved only ${globals.size} names — the lib files did not load, so every reference would read as free. Refusing to give a verdict.`,
  )
else {
  for (const pkgDir of targets()) {
    const dist = `packages/${pkgDir}/dist`
    if (!existsSync(dist)) continue
    for (const file of walkDts(dist)) {
      dtsFiles++
      const { free, referenced } = freeTypeNames(
        repoRoot,
        file,
        readFileSync(file, 'utf8'),
        globals,
      )
      refsJudged += referenced
      for (const f of free)
        problems.push(
          `${file}:${f.line}: "${f.name}" is referenced but bound nowhere — its import or declaration was deleted from the emitted .d.ts (#253). Any consumer with skipLibCheck:false gets TS2304.`,
        )
    }
  }
  // Vacuity: a FULL sweep that stopped finding things must fail, not pass
  // quietly. Scoped to the default target set on purpose — `targets()` also
  // accepts package names on argv, and a corpus floor applied to a one-package
  // invocation would reject it for doing exactly what was asked. The instrument
  // check above is what covers the scoped form.
  if (!scoped && (dtsFiles < 100 || refsJudged < 500))
    problems.push(
      `dist type bindings: judged only ${dtsFiles} .d.ts / ${refsJudged} type references — far below the expected corpus. The walk found nothing to check.`,
    )
}
// Vacuity, BOTH halves. `sourceFiles` counts files WALKED and cannot see the
// pre-filter below going wrong; `tagsJudged` counts files actually handed to the
// analyzer, which is the number that goes to zero when it does. Measured with
// #253 restored in source and the pre-filter broken: exit 0, with
// "0 of 109 source files scanned" printed on a GREEN line.
if (sourceFiles < 50)
  problems.push(
    `stripInternal source scan: judged only ${sourceFiles} source files across ${stripInternalPackages(repoRoot).length} stripInternal package(s) — the walk found nothing to check.`,
  )
if (tagsJudged < MIN_TAG_MENTIONS)
  problems.push(
    `stripInternal source scan: only ${tagsJudged} of ${sourceFiles} source files reached the analyzer (expected at least ${MIN_TAG_MENTIONS}) — the pre-filter is dropping everything, so this arm is judging nothing.`,
  )

// ---------------------------------------------------------------------------
// 5. SEMANTIC arm (#257): one program over every publishable package's emitted
//    `.d.ts` with `skipLibCheck: false`. This is what closes the specifier hole
//    arm 4's dist half leaves open by construction; read the header of
//    `scripts/lib/dist-type-bindings.mjs` before changing the scope or the
//    allowlist.
// ---------------------------------------------------------------------------
/** @type {string[]} */
const semanticRoots = []
/** @type {string[]} */
const semanticDistDirs = []
for (const pkgDir of targets()) {
  const dist = `packages/${pkgDir}/dist`
  if (!existsSync(dist)) continue
  semanticDistDirs.push(join(repoRoot, dist))
  for (const file of walkDts(dist)) semanticRoots.push(join(repoRoot, file))
}

if (!existsSync(join(repoRoot, PROBE_SIDE_EFFECT_TARGET))) {
  problems.push(
    `dist semantic sweep: the instrument probe's side-effect target "${PROBE_SIDE_EFFECT_TARGET}" does not exist, so the probe would report TS2307 instead of TS2882. Point PROBE_SIDE_EFFECT_TARGET at a checked-in non-TypeScript file.`,
  )
} else if (semanticRoots.length === 0) {
  problems.push('dist semantic sweep: no .d.ts to check — build before running this check')
} else {
  const semantic = distSemanticDiagnostics(repoRoot, semanticRoots, semanticDistDirs)

  // INSTRUMENT CHECK, before any verdict — the same discipline arm 4 uses. A
  // file count proves the walk ran; only the probe proves the program can still
  // REPORT the three failures this arm exists for.
  if (!semantic.probeOk)
    problems.push(
      `dist semantic sweep: the instrument probe reported [${semantic.probeCodes.join(', ')}] — expected TS2882 (side-effect import with no declarations), TS2307 (unresolvable inline import type) and TS2304 (free name). Refusing to give a verdict.`,
    )

  for (const d of semantic.reported)
    problems.push(
      `${d.file}:${d.line}:${d.column}: TS${d.code} ${d.message} — a published .d.ts that any consumer with skipLibCheck:false fails to compile (#257).`,
    )

  // The allowlist is CLOSED AT BOTH ENDS: an entry that no longer describes a
  // real diagnostic is a standing licence for a defect that has been fixed.
  for (const [i, a] of SEMANTIC_ALLOWED.entries())
    if (!semantic.allowedHits.has(i))
      problems.push(
        `dist semantic sweep: SEMANTIC_ALLOWED[${i}] (${a.file}: TS${a.code}) matched nothing — OBSOLETE. Delete it; leaving it standing approves a diagnostic nobody has seen.`,
      )

  // VERDICT INTEGRITY: an EXACT set size, across THREE independent enumerations
  // of the same corpus, not a floor.
  //
  // This is the assertion the first cut of this arm shipped without, and the
  // hole was not theoretical: dropping ONE package from `semanticRoots` took the
  // sweep from 558 files to 535 and the gate stayed GREEN — with
  // `import("rolldown")` back in the published `.d.ts`, and with 558 and 535
  // printed one line apart in the success output with nothing comparing them. A
  // floor of 100 against a 558-file corpus can only see a TOTAL loss; a partial
  // one is exactly how a gate goes quiet while the tree is broken (CLAUDE.md:
  // "assert an EXACT set size … a floor only detects under-collection, and would
  // have passed at 210").
  //
  // The three counts come from three separate walks, so no single edit can
  // silence the check by narrowing "both sides":
  //   integrityDts        — invariant 1-3's `walk()` over dist
  //   dtsFiles            — arm 4's `walkDts()` over dist
  //   semanticRoots.length— arm 5's own `walkDts()` over dist
  //   semantic.judged     — what the PROGRAM actually loaded under those dirs
  // The last is the one that also catches a file that was fed in and silently
  // not parsed. `dtsFiles` is 0 when the globals probe failed, which is already
  // a reported problem, so it is compared only when arm 4 ran.
  if (!scoped) {
    if (semantic.judged !== semanticRoots.length)
      problems.push(
        `dist semantic sweep: the program loaded ${semantic.judged} .d.ts under packages/*/dist but ${semanticRoots.length} were handed to it — every root name must be loaded, so the sweep is judging a DIFFERENT corpus than it walked.`,
      )
    if (semanticRoots.length !== integrityDts)
      problems.push(
        `dist semantic sweep: swept ${semanticRoots.length} .d.ts but the dist integrity walk found ${integrityDts} — the two enumerations of the same corpus disagree, so one of them is dropping files.`,
      )
    if (dtsFiles > 0 && semanticRoots.length !== dtsFiles)
      problems.push(
        `dist semantic sweep: swept ${semanticRoots.length} .d.ts but the binding arm judged ${dtsFiles} — the two arms are not looking at the same corpus.`,
      )
    if (semantic.judged < 100)
      problems.push(
        `dist semantic sweep: the program loaded only ${semantic.judged} .d.ts under packages/*/dist — far below the expected corpus.`,
      )
  }
  semanticSummary = `${semantic.judged} .d.ts type-checked with skipLibCheck:false in ${semantic.ms} ms (${SEMANTIC_ALLOWED.length} allowed)`
}

if (problems.length) {
  console.error(`✗ dist integrity: ${problems.length} problem(s)\n`)
  for (const p of problems.slice(0, 20)) console.error(`   ${p}`)
  if (problems.length > 20) console.error(`   … and ${problems.length - 20} more`)
  console.error('')
  process.exit(1)
}

console.log('✓ dist integrity: imports carry .js, sourcemap sources exist and ship')
console.log(
  `✓ stripInternal guard: ${refsJudged} type references across ${dtsFiles} .d.ts all bound (${globals.size} globals); ` +
    `${tagsJudged} of ${sourceFiles} source files scanned for a misplaced internal tag`,
)
console.log(`✓ published types compile: ${semanticSummary}`)
