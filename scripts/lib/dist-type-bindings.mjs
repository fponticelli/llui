// The three arms that gate this repo's PUBLISHED `.d.ts` (#253, #257). Consumed
// by `scripts/check-dist.mjs` (the gate) and
// `scripts/test/dist-type-bindings.test.ts` (the analyzers' own tests + the
// source arm's corpus sweep).
//
// THE BUG THIS EXISTS FOR
// -----------------------
// `stripInternal` deletes any declaration whose LEADING COMMENT mentions the
// sigil-prefixed `internal` JSDoc tag. TypeScript's test for that
// (`isInternalDeclaration` -> `hasInternalAnnotation`) is a raw substring search
// over every leading comment range — it cannot tell an annotation from prose.
// `packages/lexical/src/nodewidget.ts` opened with an 80-line `//` header that
// mentioned the tag twice; the next statement was its `import { … } from
// 'lexical'`, so the WHOLE IMPORT was deleted from `dist/nodewidget.d.ts` and
// `LexicalNode` / `NodeKey` / `LexicalEditor` / `Klass` /
// `EditorDOMRenderConfig` shipped as five unbound names. Every workspace here
// inherits `skipLibCheck: true`, so nothing in the repo type-checked another
// package's emitted `.d.ts` and the release went out green.
//
// THREE ARMS, BECAUSE NONE SEES ANOTHER'S FAILURE
// -----------------------------------------------
// The SOURCE and DIST arms are deliberately asymmetric, and the reason is
// measured rather than theoretical (variants run through real tsc,
// TypeScript 6.0.2):
//
//   header ABOVE the imports (the shipped bug) -> the import is deleted and the
//     names it bound go free. The DIST arm sees this; the SOURCE arm also does.
//
//   header BELOW the imports (the fix issue #253 itself suggested) -> the header
//     attaches to the next declaration instead, and `stripInternal` deletes
//     THAT. Whether the DIST arm notices depends on something the author did not
//     choose: only if a declaration that SURVIVED still references the deleted
//     name. Both cases are measured. In `nodewidget.ts` itself the next
//     declaration is `WidgetPlacement`, and `WidgetSpec.placement` still
//     references it, so the emitted file does have a free name and BOTH arms
//     fire. In the reduced three-file repro, where nothing referenced the
//     deleted `Bar`, the emitted `.d.ts` is perfectly well-bound and simply
//     MISSING an exported interface — the dist arm is silent and only the
//     SOURCE arm catches it.
//
// So: the DIST arm catches the SYMPTOM whatever caused it (it knows nothing
// about `stripInternal`), and the SOURCE arm catches the CAUSE — including the
// silent-API-loss direction the dist arm can only see by luck, which is why the
// source arm is the one that makes that second direction unconditional.
//
// THE SEMANTIC ARM (#257), AND WHY THE DIST ARM SURVIVES IT
// ---------------------------------------------------------
// The DIST arm is a BINDING check, not a type check. It answers "is every type
// name this file references bound", which is exactly the #253 question, and it
// answers it with zero allowlist in ~0.23 s of sweep plus ~0.73 s for the
// globals program. What it structurally CANNOT answer is whether a module
// SPECIFIER resolves: an `import('x').Y` binds nothing, so it is skipped — and
// that is the commonest way a published `.d.ts` breaks a consumer after an
// unbound name. #257 is what that hole cost: with the dist arm green, this repo
// shipped
//
//   6 x TS2307  packages/vite-plugin/dist/{compile-plugin,hud-plugin}.d.ts
//               Cannot find module 'rolldown'. Vite's plugin-hook types are
//               declared in `rolldown`, so INFERRING the return type of a
//               `satisfies Plugin` factory wrote `import("rolldown").X` into our
//               own `.d.ts` — and `rolldown` is an undeclared transitive that
//               lives only inside vite's own pnpm dir, unresolvable from
//               `packages/vite-plugin` under Bundler, NodeNext and Node10 alike.
//   1 x TS2882  packages/devmode-annotate-editor/dist/index.d.ts — a side-effect
//               CSS import whose specifier had no `types` condition to resolve
//               through.
//
// Both are fixed (a declared `: Plugin` return type; a `types` condition on
// `@llui/markdown-editor`'s `./styles/*.css` subpaths), and the SEMANTIC arm now
// gates the class: ONE `ts.Program` over every publishable package's `.d.ts`
// with `skipLibCheck: false`.
//
// The DIST arm's reports are a strict SUBSET of the semantic arm's — TS2304 is
// what a free name produces — so say what keeps it rather than implying it adds
// coverage. Two things do. (1) It has NO allowlist, and the semantic arm has
// one: an allowlist entry is one edit away from switching a whole file's
// diagnostics off, and #253's exact shape must not be reachable that way.
// (2) It gives a message written for #253 (which NAME went free, and that its
// import was deleted) where the semantic arm gives tsc's, and it is the arm the
// unit tests in `scripts/test/dist-type-bindings.test.ts` exercise without a
// build.
//
// WHAT THE SEMANTIC ARM COSTS, AND ITS ALLOWLIST DISCIPLINE
// ---------------------------------------------------------
// Measured on a quiet machine: 557 -> 558 `.d.ts` root names, 4.7-6.1 s, and
// identical diagnostics under `types: ['node']`, `types: []` and no `types`
// field. `check:dist` wall goes from ~1.6 s to ~7 s.
//
// It is scoped STRUCTURALLY to files under `packages/<pkg>/dist/`, not by
// allowlist: three of the four surviving diagnostics live inside loro-crdt's own
// shipped `.d.ts` (TS2304/7010/7051), which is precisely what `skipLibCheck`
// exists for and would otherwise redden this gate on every dependency bump. A
// third-party type change that surfaces an error IN OUR file is still reported,
// because that IS a consumer-facing break.
//
// `SEMANTIC_ALLOWED` is CLOSED AT BOTH ENDS, the discipline
// `scripts/test/token-contrast.test.ts` documents: an entry that no longer
// matches a diagnostic fails as OBSOLETE. It is keyed `file` + `code` + a
// reason; a bare code (or a bare file) would excuse every occurrence in the
// repo. One entry today.
//
// MUTATION EVIDENCE (15 rows, re-run against the final tree; every row applied
// alone, restored in a `finally`, verified by an empty per-file `git diff` —
// never a file count). Kept HERE rather than in a review thread because the
// numbers are the argument for the shape above, and a lane report evaporates.
//
//   | Faithful mutation                                          | Result |
//   |------------------------------------------------------------|--------|
//   | Drop `: Plugin` from the two leaking factories, rebuild     | RED, 6 x TS2307 at #257's exact positions |
//   | Revert markdown-editor's CSS exports to bare strings        | RED, 1 x TS2882 |
//   | Point PROBE_SIDE_EFFECT_TARGET at a missing file            | RED, refuses a verdict |
//   | Drop the probe from the program's root names                | RED, probe reported [] |
//   | Add an allowance describing a diagnostic nobody has seen    | RED, OBSOLETE |
//   | Empty SEMANTIC_ALLOWED                                      | RED, the TS2416 it approves is reported |
//   | Drop the structural `packages/*/dist` scope                 | RED, 3 loro-crdt entries reach the verdict |
//   | Sweep 1 `.d.ts` per package                                 | RED on 4 checks (25 swept vs 558 walked) |
//   | Raise the corpus floor above the real corpus                | RED, the floor is evaluated |
//   | Drop ONE package from the swept roots                       | RED, 535 vs 558 |
//   | ...the same, with defect 1 rebuilt into dist                | RED, 535 vs 558 |
//   | Report nothing from our own output                          | RED, probe reported [] |
//   | ...the same, with SEMANTIC_ALLOWED emptied                  | RED, probe reported [] |
//   | Match an allowance on `code` alone (bare-code licence)      | gate GREEN, `dist-type-bindings.test.ts` RED |
//   | Narrow BOTH `walkDts` consumers at once                     | RED, 533 swept / 549 loaded / 558 walked |
//
// The last five are why the two structural checks above exist, and each was
// GREEN before them. `Drop ONE package` is the sharpest: it is a single edit,
// it took the sweep from 558 files to 535, and the gate stayed green WITH
// `import("rolldown")` back in the published `.d.ts` — while 558 and 535 were
// being printed one line apart in the success output. `Report nothing` was
// killed only by the obsolete-allowlist check, i.e. only by an entry expected
// to disappear once #129 resolves, so the gate would have got weaker the day
// that was fixed. `bare-code licence` is green on the GATE by construction (a
// clean tree has nothing to mis-approve), which is why the matcher had to be
// extracted and unit-tested rather than left inline.
//
// The one shape no mutation kills is deleting the `probeOk` verdict push: an
// instrument check is unobservable while the instrument works, and that is
// inherent rather than a gap to chase. Arm 4's own probe block has the same
// property.
//
// KNOWN LIMITS, stated rather than implied:
//   - The semantic arm runs ONE resolution mode: `Bundler`, matching the root
//     tsconfig and every consumer this repo has. Measured against the fixed
//     tree, `nodenext` is clean too; `node10` ignores `exports` maps entirely
//     (so the CSS `types` condition does not reach it) and is deprecated in
//     TypeScript 6, so it is not swept.
//   - A FILE-LESS diagnostic is dropped (`if (!d.file) continue`). Those are
//     whole-program ones — TS2688 "cannot find type definition file for 'node'",
//     TS6053 — which cannot be attributed to a published file, so they are not
//     what this verdict is about; the cost is that a broken `types: ['node']`
//     degrades this sweep quietly instead of reddening it. Arm 4's globals probe
//     floors the same lib load, which is what covers that direction today.
//   - It root-names every `.d.ts` in `dist/`. A real consumer only loads what
//     its `exports` map reaches, so the arm is STRICTER than a consumer:
//     measured, `compile-plugin.d.ts` and `hud-plugin.d.ts` are not reachable
//     from `@llui/vite-plugin`'s public entry points, so the 6 x TS2307 were not
//     yet consumer-visible — they became so the moment anything re-exported
//     those factories. Being stricter is the point: an unresolvable specifier in
//     a shipped file is a defect whether or not today's entry graph reaches it.
//   - Bindings in the DIST arm are collected FLAT (every binder anywhere in the
//     file lands in one set), so it cannot see a name bound in some inner scope
//     but free at the point of use. That is the UNDER-report direction, chosen
//     so the arm cannot false-positive on scoping; #253's shape (the binder is
//     gone entirely) is unaffected, and the semantic arm answers it exactly.
//   - The source arm reads only the literal tag. A declaration deleted because
//     its leading comment came from somewhere this scan does not model is not
//     covered.
//   - A prose mention of the tag INSIDE a JSDoc block, written at the start of
//     a line, reads as a genuine annotation and is allowed through.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { createRequire } from 'node:module'

/**
 * One free type name: referenced by a `.d.ts`, bound nowhere in it.
 * @typedef {object} FreeTypeName
 * @property {string} name
 * @property {number} line
 */

/**
 * One occurrence of the internal tag written where it is not an annotation.
 * @typedef {object} MisplacedTag
 * @property {number} line
 * @property {'line-comment' | 'jsdoc-prose'} kind
 * @property {string} text
 */

/**
 * Resolve `typescript` from the repo being checked, not from this file.
 * @param {string} root
 * @returns {typeof import('typescript')}
 */
function loadTs(root) {
  /** @type {unknown} */
  const mod = createRequire(join(root, '_.js'))('typescript')
  return /** @type {typeof import('typescript')} */ (mod)
}

/**
 * Every `.d.ts` under `dir`, recursively.
 * @param {string} dir
 * @param {string[]} [out]
 * @returns {string[]}
 */
export function walkDts(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e)
    if (statSync(f).isDirectory()) walkDts(f, out)
    else if (f.endsWith('.d.ts')) out.push(f)
  }
  return out
}

/**
 * Every `.ts`/`.tsx` under `dir`, recursively.
 * @param {string} dir
 * @param {string[]} [out]
 * @returns {string[]}
 */
export function walkTs(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e)
    if (statSync(f).isDirectory()) walkTs(f, out)
    else if (/\.tsx?$/.test(f) && !f.endsWith('.d.ts')) out.push(f)
  }
  return out
}

/**
 * The ambient type/value/namespace names a `.d.ts` may reference without
 * binding them. Taken from a real program over the lib files so it is whatever
 * TypeScript itself considers global — never a hand-maintained allowlist, which
 * would fail in the silent direction (a missing entry is a false positive, an
 * over-broad one hides a real free name).
 * @param {string} root
 * @returns {Set<string>}
 */
export function globalTypeNames(root) {
  const ts = loadTs(root)
  const host = ts.createCompilerHost({}, true)
  const dummyName = '__llui_globals_probe__.ts'
  const dummy = ts.createSourceFile(dummyName, '', ts.ScriptTarget.ES2022, true)
  const orig = host.getSourceFile.bind(host)
  /** @type {import('typescript').CompilerHost['getSourceFile']} */
  const getSourceFile = (f, ...rest) => (f === dummyName ? dummy : orig(f, ...rest))
  host.getSourceFile = getSourceFile
  const program = ts.createProgram({
    rootNames: [dummyName],
    options: {
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
      types: ['node'],
    },
    host,
  })
  const checker = program.getTypeChecker()
  const sf = program.getSourceFile(dummyName)
  // A real guard, not a cast: if the synthetic file is missing the probe would
  // return an EMPTY global set, and every ordinary reference would then read as
  // free. `check-dist.mjs` floors the set size too; this fails closer to the cause.
  if (!sf) throw new Error('globals probe: synthetic source file missing from the program')
  const flags = ts.SymbolFlags.Type | ts.SymbolFlags.Namespace | ts.SymbolFlags.Value
  return new Set(checker.getSymbolsInScope(sf, flags).map((s) => s.getName()))
}

/**
 * DIST ARM. Type names this `.d.ts` references but binds nowhere and that are
 * not ambient globals — i.e. names whose `import` or declaration was deleted.
 *
 * Returns `[{ name, line }]`, one entry per distinct name.
 * @param {string} root
 * @param {string} fileName
 * @param {string} text
 * @param {ReadonlySet<string>} globals
 * @returns {{ free: FreeTypeName[], referenced: number }}
 */
export function freeTypeNames(root, fileName, text, globals) {
  const ts = loadTs(root)
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)

  // Bindings: FLAT on purpose — see KNOWN LIMITS in the header.
  /** @type {Set<string>} */
  const bound = new Set()
  /** @param {import('typescript').Node | undefined} n */
  const bindName = (n) => {
    if (!n) return
    if (ts.isIdentifier(n)) bound.add(n.text)
    else if (ts.isStringLiteral(n)) bound.add(n.text)
    else if (ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n))
      for (const el of n.elements) if (!ts.isOmittedExpression(el)) bindName(el.name)
  }
  /** @param {import('typescript').Node} node */
  const collectBindings = (node) => {
    if (ts.isImportClause(node) && node.name) bindName(node.name)
    else if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) bindName(node.name)
    else if (ts.isImportEqualsDeclaration(node)) bindName(node.name)
    else if (ts.isTypeParameterDeclaration(node)) bindName(node.name)
    else if (
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isClassExpression(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isModuleDeclaration(node) ||
      ts.isVariableDeclaration(node) ||
      ts.isParameter(node)
    )
      bindName(node.name)
    ts.forEachChild(node, collectBindings)
  }
  collectBindings(sf)

  // References: the LEFTMOST identifier of every type reference / type query /
  // heritage clause. `import('x').Y` needs nothing bound and is skipped for free
  // (an ImportTypeNode carries its own specifier).
  /** @type {Map<string, number>} */
  const referenced = new Map()
  /**
   * @param {import('typescript').EntityName} n
   * @returns {import('typescript').Identifier | null}
   */
  const leftmost = (n) => {
    while (ts.isQualifiedName(n)) n = n.left
    return ts.isIdentifier(n) ? n : null
  }
  /** @param {import('typescript').Identifier | null} id */
  const note = (id) => {
    if (id && !referenced.has(id.text))
      referenced.set(id.text, sf.getLineAndCharacterOfPosition(id.getStart(sf)).line + 1)
  }
  /** @param {import('typescript').Node} node */
  const collectRefs = (node) => {
    if (ts.isTypeReferenceNode(node)) note(leftmost(node.typeName))
    else if (ts.isTypeQueryNode(node)) note(leftmost(node.exprName))
    else if (ts.isExpressionWithTypeArguments(node) && ts.isIdentifier(node.expression))
      note(node.expression)
    ts.forEachChild(node, collectRefs)
  }
  collectRefs(sf)

  /** @type {FreeTypeName[]} */
  const free = []
  for (const [name, line] of referenced)
    if (!bound.has(name) && !globals.has(name)) free.push({ name, line })
  return { free, referenced: referenced.size }
}

// The literal TypeScript looks for, assembled rather than spelled so this file
// does not trip the very rule it implements (and so `stripInternal` cannot eat
// anything here).
export const INTERNAL_TAG = '@' + 'internal'

/**
 * Floor for how many source files must MENTION the tag before either consumer
 * gives a verdict. The gate pre-filters on the substring for speed, and that
 * pre-filter is a silent-disable path: break it and the arm scans nothing while
 * printing a GREEN line (measured with #253 restored — `0 of 109 source files`,
 * exit 0). A floor on files WALKED cannot see that, because the walk is fine; it
 * is the JUDGING that stopped. Six occurrences exist across four files today.
 */
export const MIN_TAG_MENTIONS = 4

/**
 * SOURCE ARM. Occurrences of the tag that are not written the way this repo
 * writes a real annotation.
 *
 * BE PRECISE ABOUT WHAT THIS IS: `// @internal` on its own line IS a working
 * TypeScript annotation — verified, it strips the declaration below it just as
 * a JSDoc block would, because `hasInternalAnnotation` reads EVERY leading
 * comment range and does not care about the comment's shape. So this arm is a
 * HOUSE-STYLE rule, not a claim about what tsc will do: requiring the JSDoc
 * spelling is what makes "annotation" and "prose" distinguishable at all, and
 * an annotation that cannot be told apart from the paragraph above it is how
 * #253 happened. Blast radius of the style rule today is zero — all six genuine
 * annotations in the repo are already JSDoc.
 *
 * Legitimate: inside a JSDoc block, as the first token of its line (after the
 * opening marker or a leading `*`).
 *
 * Reported: any occurrence in a `//` line comment (#253's shape, and the shape
 * the "move the header below the imports" fix would leave behind), and any
 * occurrence mid-line inside a JSDoc block.
 * @param {string} root
 * @param {string} fileName
 * @param {string} text
 * @returns {MisplacedTag[]}
 */
export function misplacedInternalTags(root, fileName, text) {
  const ts = loadTs(root)
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  /** @type {MisplacedTag[]} */
  const out = []
  /** @type {Set<number>} */
  const seen = new Set()

  /** @param {readonly import('typescript').CommentRange[] | undefined} ranges */
  const scan = (ranges) => {
    for (const r of ranges ?? []) {
      if (seen.has(r.pos)) continue
      seen.add(r.pos)
      const comment = text.slice(r.pos, r.end)
      if (!comment.includes(INTERNAL_TAG)) continue
      const line = sf.getLineAndCharacterOfPosition(r.pos).line + 1
      if (r.kind === ts.SyntaxKind.SingleLineCommentTrivia) {
        out.push({ line, kind: 'line-comment', text: comment.trim() })
        continue
      }
      // Block comment: allow the tag only at the start of a JSDoc line.
      for (const [i, raw] of comment.split('\n').entries()) {
        const idx = raw.indexOf(INTERNAL_TAG)
        if (idx < 0) continue
        const before = raw.slice(0, idx)
        // `/** @internal`, ` * @internal`, or `/*` + whitespace only.
        if (/^\s*(\/\*\*?)?\s*\*?\s*$/.test(before)) continue
        out.push({ line: line + i, kind: 'jsdoc-prose', text: raw.trim() })
      }
    }
  }

  // Every leading + trailing comment range in the file. Walking statements is
  // enough: `stripInternal` only ever consults a declaration's leading comments,
  // and a comment attaches to the node that follows it.
  /** @param {import('typescript').Node} node */
  const visit = (node) => {
    scan(ts.getLeadingCommentRanges(text, node.pos))
    ts.forEachChild(node, visit)
  }
  visit(sf)

  return out.sort((a, b) => a.line - b.line)
}

/**
 * Package dirs under `packages/` whose build config sets `stripInternal`.
 * @param {string} root
 * @returns {string[]}
 */
export function stripInternalPackages(root) {
  /** @type {string[]} */
  const out = []
  for (const d of readdirSync(join(root, 'packages'))) {
    const cfg = join(root, 'packages', d, 'tsconfig.build.json')
    if (!existsSync(cfg)) continue
    if (/"stripInternal"\s*:\s*true/.test(readFileSync(cfg, 'utf8'))) out.push(d)
  }
  return out
}

// ---------------------------------------------------------------------------
// SEMANTIC ARM (#257). One program over every publishable package's emitted
// `.d.ts` with `skipLibCheck: false` — the check a consumer that does not skip
// lib checking actually runs against our published types.
// ---------------------------------------------------------------------------

/**
 * One approved diagnostic in our own published output.
 * @typedef {object} SemanticAllowance
 * @property {string} file  Repo-relative POSIX path of the emitted `.d.ts`.
 * @property {number} code  TypeScript diagnostic code.
 * @property {string} reason
 */

/**
 * Diagnostics allowed to stand in `packages/<pkg>/dist/**`.
 *
 * KEYED BY FILE **AND** CODE, never by one alone: a bare code excuses every
 * occurrence in the repo, which is the shape `scripts/test/registry-attrs.test.ts`
 * measured as switching a whole check off. CLOSED AT BOTH ENDS — `check-dist.mjs`
 * fails on an entry that matches nothing, so a fixed defect cannot leave a
 * standing licence behind.
 *
 * @type {readonly SemanticAllowance[]}
 */
export const SEMANTIC_ALLOWED = [
  {
    file: 'packages/markdown-editor/dist/nodes/list.d.ts',
    code: 2416,
    reason:
      "MarkdownListNode's `$config` declares `extends: ElementNode` so " +
      "`iterStaticNodeConfigChain` skips ListNode's unconditional " +
      '`mergeNextSiblingListIfSameType` (#129). Lexical documents `extends` as ' +
      '"must be the exact superclass" and TypeScript rejects the divergence, so ' +
      "the override carries this package's one `@ts-expect-error` — which does " +
      'NOT survive into the emitted `.d.ts`. Deliberate and load-bearing: ' +
      'removing it re-opens #129 (two adjacent same-type Markdown lists merge).',
  },
]

/**
 * The allowlist LOOKUP, extracted so it is unit-testable. The keying is the
 * load-bearing part and it cannot be tested through `SEMANTIC_ALLOWED`'s shape:
 * a matcher mutated to `a.code === d.code` — the bare-code licence this file's
 * prose warns against — leaves every entry perfectly well-formed and simply
 * approves that code everywhere. Both halves of the key must be required, and
 * `scripts/test/dist-type-bindings.test.ts` pins each direction.
 *
 * @param {string} file Repo-relative POSIX path of the emitted `.d.ts`.
 * @param {number} code TypeScript diagnostic code.
 * @returns {number} Index into `SEMANTIC_ALLOWED`, or -1.
 */
export function semanticAllowanceIndex(file, code) {
  return SEMANTIC_ALLOWED.findIndex((a) => a.file === file && a.code === code)
}

/**
 * The virtual `.d.ts` the semantic arm compiles alongside the corpus so the
 * INSTRUMENT is proved before any verdict. A count floor says the walk found
 * files; it cannot say the program is still capable of REPORTING.
 *
 * Three shapes, one per failure this arm exists for:
 *   - an unresolvable INLINE import type (the `rolldown` shape, and precisely
 *     what the dist binding arm is blind to),
 *   - a side-effect import of a real file with no type declarations (the
 *     `devmode-annotate-editor` CSS shape),
 *   - a free type name (TS2304, the #253 shape the dist arm also covers).
 *
 * `PROBE_SIDE_EFFECT_TARGET` is a checked-in source file, never a build output,
 * so the probe does not depend on another package having been built. If it is
 * ever renamed the specifier becomes unresolvable and the probe reports TS2307
 * instead of TS2882 — a LOUD failure, which is the safe direction.
 *
 * The probe file is placed INSIDE a real `packages/<pkg>/dist` directory (it is
 * virtual — nothing is written to disk), so its diagnostics travel the SAME path
 * a genuine finding does: the structural dist scope, the allowlist lookup, and
 * the push into `reported`. That is deliberate. With the probe classified
 * separately, a mutation that made the arm report NOTHING from our own output
 * was caught only by the obsolete-allowlist check — i.e. only by an allowlist
 * that is expected to be EMPTY once #129's TS2416 resolves, so the gate would
 * have got weaker the day that was fixed. Routing the probe through the same
 * code makes the reporting path itself the thing the instrument check proves.
 */
export const PROBE_SIDE_EFFECT_TARGET = 'packages/markdown-editor/src/styles/editor.css'

/** Codes the probe must produce, in the order the probe writes them. */
const PROBE_EXPECTED_CODES = [2882, 2307, 2304]

/**
 * SEMANTIC ARM. Type-check every `.d.ts` in `distDirs` with `skipLibCheck: false`
 * and report the diagnostics that land in our own published output.
 *
 * @param {string} root
 * @param {string[]} files Absolute paths of the `.d.ts` to root the program at.
 * @param {string[]} distDirs Absolute `packages/<pkg>/dist` dirs that scope the verdict.
 * @returns {{
 *   reported: { file: string, line: number, column: number, code: number, message: string }[],
 *   allowedHits: Map<number, number>,
 *   probeCodes: number[],
 *   probeOk: boolean,
 *   judged: number,
 *   ms: number,
 * }}
 */
export function distSemanticDiagnostics(root, files, distDirs) {
  const ts = loadTs(root)
  // Inside a real dist dir (sorted so the choice is deterministic), and named so
  // it cannot collide with an emitted file. Virtual: the host serves it from
  // memory and nothing touches the filesystem.
  const probeDir = [...distDirs].sort()[0]
  if (probeDir === undefined) throw new Error('semantic sweep: no dist dir to place the probe in')
  const probeName = join(probeDir, '__llui_dist_semantic_probe__.d.ts')
  const probeRel = relative(root, probeName).split(sep).join('/')
  // Relative to the PROBE's directory, not the repo root.
  const sideEffectSpecifier = relative(probeDir, join(root, PROBE_SIDE_EFFECT_TARGET))
    .split(sep)
    .join('/')
  const probeText =
    `import '${sideEffectSpecifier}'\n` +
    `export interface ProbeA { a: import('llui-no-such-module-anywhere').Nope }\n` +
    `export interface ProbeB { b: LluiDefinitelyNotBoundAnywhere }\n`

  const options = {
    noEmit: true,
    skipLibCheck: false,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    types: ['node'],
  }
  const host = ts.createCompilerHost(options, true)
  const probeFile = ts.createSourceFile(
    probeName,
    probeText,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  )
  const origGetSourceFile = host.getSourceFile.bind(host)
  /** @type {import('typescript').CompilerHost['getSourceFile']} */
  const getSourceFile = (f, ...rest) =>
    f === probeName ? probeFile : origGetSourceFile(f, ...rest)
  host.getSourceFile = getSourceFile
  const origFileExists = host.fileExists.bind(host)
  host.fileExists = (f) => (f === probeName ? true : origFileExists(f))
  const origReadFile = host.readFile.bind(host)
  host.readFile = (f) => (f === probeName ? probeText : origReadFile(f))

  const started = Date.now()
  const program = ts.createProgram({ rootNames: [...files, probeName], options, host })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  const ms = Date.now() - started

  const normalizedDistDirs = distDirs.map((d) => ts.sys.resolvePath(d) + '/')
  /** @type {{ file: string, line: number, column: number, code: number, message: string }[]} */
  const reported = []
  /** @type {Map<number, number>} */
  const allowedHits = new Map()
  /** @type {number[]} */
  const probeCodes = []

  for (const d of diagnostics) {
    // KNOWN LIMIT, stated here and in the header: a FILE-LESS diagnostic (a
    // whole-program one such as TS2688 "cannot find type definition file for
    // 'node'", or TS6053) is dropped. It cannot be attributed to a published
    // file, which is what this arm's verdict is about — but it also means a
    // broken `types: ['node']` would degrade this sweep silently rather than
    // redden it. The globals probe in arm 4 floors the same lib load.
    if (!d.file) continue
    const abs = ts.sys.resolvePath(d.file.fileName)
    // STRUCTURAL scope, not an allowlist: a third-party `.d.ts` we merely pull in
    // is exactly what `skipLibCheck` exists for. The probe lives inside a dist
    // dir precisely so it must pass this test too.
    if (!normalizedDistDirs.some((dir) => abs.startsWith(dir))) continue
    const rel = relative(root, abs).split(sep).join('/')
    const allowedIndex = semanticAllowanceIndex(rel, d.code)
    if (allowedIndex >= 0) {
      allowedHits.set(allowedIndex, (allowedHits.get(allowedIndex) ?? 0) + 1)
      continue
    }
    const { line, character } =
      d.start === undefined
        ? { line: 0, character: 0 }
        : d.file.getLineAndCharacterOfPosition(d.start)
    reported.push({
      file: rel,
      line: line + 1,
      column: character + 1,
      code: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, ' ').slice(0, 400),
    })
  }

  // Partition the probe back OUT of the verdict, after it has travelled the
  // whole reporting path. Anything the probe produced that is not one of the
  // three expected codes is left in `reported` on purpose — an unexpected probe
  // diagnostic means the probe itself no longer says what this file claims.
  /** @type {typeof reported} */
  const verdict = []
  for (const r of reported) {
    if (r.file === probeRel && PROBE_EXPECTED_CODES.includes(r.code)) probeCodes.push(r.code)
    else verdict.push(r)
  }

  // Counts the REAL corpus, not the virtual probe that shares its directory.
  const judged = program.getSourceFiles().filter((f) => {
    const abs = ts.sys.resolvePath(f.fileName)
    return (
      abs !== ts.sys.resolvePath(probeName) && normalizedDistDirs.some((dir) => abs.startsWith(dir))
    )
  }).length

  return {
    reported: verdict,
    allowedHits,
    probeCodes,
    probeOk:
      probeCodes.length === PROBE_EXPECTED_CODES.length &&
      PROBE_EXPECTED_CODES.every((c, i) => probeCodes[i] === c),
    judged,
    ms,
  }
}
