// The two arms of the `stripInternal` guard (#253). Consumed by
// `scripts/check-dist.mjs` (the gate) and `scripts/test/dist-type-bindings.test.ts`
// (the analyzer's own tests + the source arm's corpus sweep).
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
// TWO ARMS, BECAUSE ONE CANNOT SEE THE OTHER'S FAILURE
// ----------------------------------------------------
// The arms are deliberately asymmetric, and the reason is measured rather than
// theoretical (variants run through real tsc, TypeScript 6.0.2):
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
// silent-API-loss direction the dist arm can only see by luck. Neither arm is
// redundant, and the source arm is the one that makes the second direction
// unconditional.
//
// WHAT THE DIST ARM IS, AND WHAT IT IS NOT
// ----------------------------------------
// It is a BINDING check, not a type check, and the difference is not academic —
// read the limits below before treating a green run as "the published types
// compile".
//
// A regression test that merely runs `tsc` over `dist` is GREEN under this
// repo's default `skipLibCheck: true` and verifies nothing, so that is not the
// alternative. The real alternative is ONE program over all 557 `.d.ts` with
// `skipLibCheck: false`, and it is neither as slow nor as noisy as an earlier
// version of this comment claimed. Measured on a quiet machine, three samples,
// identical results under `types: ['node']`, `types: []` and no `types` field:
// **4.9-6.9 s and ELEVEN diagnostics**, of which eight are in our OWN published
// output:
//
//   6 x TS2307  packages/vite-plugin/dist/{compile-plugin,hud-plugin}.d.ts
//               Cannot find module 'rolldown'. An inferred plugin-hook `this`
//               type leaked an undeclared transitive dep; `rolldown` exists only
//               inside vite's own pnpm dir and is UNRESOLVABLE from vite-plugin
//               under Bundler, NodeNext and Node10 alike. A real shipped defect,
//               same family as #253. Tracked as #257.
//   1 x TS2882  packages/devmode-annotate-editor/dist/index.d.ts — a side-effect
//               CSS import with no module declaration. Also consumer-facing.
//   1 x TS2416  packages/markdown-editor/dist/nodes/list.d.ts — the DELIBERATE
//               `MarkdownListNode` divergence #129 depends on, whose
//               `@ts-expect-error` does not survive into the `.d.ts`.
//   3 x TS2304/7010/7051  inside loro-crdt's own shipped `.d.ts` — third-party,
//               not ours to fix, and exactly what `skipLibCheck` exists for.
//
// So the semantic sweep is NOT "noise plus one documented exception": it finds
// two live defects this arm cannot. It is not the gate today only because it is
// RED on those two, and adopting it means either fixing them first or carrying a
// four-entry allowlist. That is the right follow-up, in that order — not a
// reason to call this arm a superset of it.
//
// This arm answers the narrower question #253 actually needed — is every type
// name this file references BOUND — over the same corpus in ~0.23 s of sweep
// plus ~0.73 s for the globals program (`check:dist` wall: 1.6-1.7 s), with zero
// allowlist entries. Globals come from a real `ts` program over the lib files
// (`getSymbolsInScope`), never a hand-written list, so `HTMLElement` / `Buffer` /
// `Record` are known because TypeScript says so.
//
// KNOWN LIMITS, stated rather than implied:
//   - **It does not resolve module specifiers.** An `import('x').Y` needs
//     nothing BOUND, so it is skipped — which means an unresolvable specifier
//     (the `rolldown` case above, and the commonest way a `.d.ts` breaks a
//     consumer after an unbound name) is OUTSIDE this arm by construction. The
//     `examples/markdown-editor` type-check that originally surfaced #253 DID
//     catch that class; this arm is not a superset of it. Widening it means
//     module resolution, and is gated on the two live defects above (#257).
//   - Bindings are collected FLAT (every binder anywhere in the file lands in
//     one set), so the arm cannot see a name that is bound in some inner scope
//     but free at the point of use. That is the UNDER-report direction, chosen
//     so the arm cannot false-positive on scoping; #253's shape (the binder is
//     gone entirely) is unaffected.
//   - The source arm reads only the literal tag. A declaration deleted because
//     its leading comment came from somewhere this scan does not model is not
//     covered.
//   - A prose mention of the tag INSIDE a JSDoc block, written at the start of
//     a line, reads as a genuine annotation and is allowed through.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
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
  return createRequire(join(root, '_.js'))('typescript')
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
