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
// WHY THE DIST ARM IS STRUCTURAL AND NOT A `tsc` RUN
// --------------------------------------------------
// A regression test that merely runs `tsc` over `dist` is GREEN under this
// repo's default `skipLibCheck: true` and verifies nothing. Setting
// `skipLibCheck: false` does work — measured over all 25 publishable packages it
// finds exactly this bug (10 x TS2304 in one file) — but it costs **37 s** of
// program construction and drags in five diagnostics that are not about
// binding at all and would each need an allowlist entry: three `@types/node`
// globals, plus `markdown-editor`'s `MarkdownListNode.$config`, whose divergence
// from `ListNode` is DELIBERATE and documented (it carries the package's one
// `@ts-expect-error`, which does not survive into the `.d.ts`).
//
// The structural check answers the narrower question actually at stake — is
// every type name this file references BOUND — in **1.2 s** over the same 558
// files / 3919 type references, with zero allowlist entries. Globals come from
// a real `ts` program over the lib files (~4.6 s, one program, `getSymbolsInScope`),
// never a hand-written list, so `HTMLElement`/`Buffer`/`Record` are known
// because TypeScript says so.
//
// KNOWN LIMITS, stated rather than implied:
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

/** Resolve `typescript` from the repo being checked, not from this file. */
function loadTs(root) {
  return createRequire(join(root, '_.js'))('typescript')
}

/** Every `.d.ts` under `dir`, recursively. */
export function walkDts(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e)
    if (statSync(f).isDirectory()) walkDts(f, out)
    else if (f.endsWith('.d.ts')) out.push(f)
  }
  return out
}

/** Every `.ts`/`.tsx` under `dir`, recursively. */
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
 */
export function globalTypeNames(root) {
  const ts = loadTs(root)
  const host = ts.createCompilerHost({}, true)
  const dummyName = '__llui_globals_probe__.ts'
  const dummy = ts.createSourceFile(dummyName, '', ts.ScriptTarget.ES2022, true)
  const orig = host.getSourceFile.bind(host)
  host.getSourceFile = (f, ...rest) => (f === dummyName ? dummy : orig(f, ...rest))
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
  const flags = ts.SymbolFlags.Type | ts.SymbolFlags.Namespace | ts.SymbolFlags.Value
  return new Set(checker.getSymbolsInScope(sf, flags).map((s) => s.getName()))
}

/**
 * DIST ARM. Type names this `.d.ts` references but binds nowhere and that are
 * not ambient globals — i.e. names whose `import` or declaration was deleted.
 *
 * Returns `[{ name, line }]`, one entry per distinct name.
 */
export function freeTypeNames(root, fileName, text, globals) {
  const ts = loadTs(root)
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)

  // Bindings: FLAT on purpose — see KNOWN LIMITS in the header.
  const bound = new Set()
  const bindName = (n) => {
    if (!n) return
    if (ts.isIdentifier(n)) bound.add(n.text)
    else if (ts.isStringLiteral(n)) bound.add(n.text)
    else if (ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n))
      for (const el of n.elements) if (!ts.isOmittedExpression(el)) bindName(el.name)
  }
  ;(function collectBindings(node) {
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
  })(sf)

  // References: the LEFTMOST identifier of every type reference / type query /
  // heritage clause. `import('x').Y` needs nothing bound and is skipped for free
  // (an ImportTypeNode carries its own specifier).
  const referenced = new Map()
  const leftmost = (n) => {
    while (ts.isQualifiedName(n)) n = n.left
    return ts.isIdentifier(n) ? n : null
  }
  const note = (id) => {
    if (id && !referenced.has(id.text))
      referenced.set(id.text, sf.getLineAndCharacterOfPosition(id.getStart(sf)).line + 1)
  }
  ;(function collectRefs(node) {
    if (ts.isTypeReferenceNode(node)) note(leftmost(node.typeName))
    else if (ts.isTypeQueryNode(node)) note(leftmost(node.exprName))
    else if (ts.isExpressionWithTypeArguments(node) && ts.isIdentifier(node.expression))
      note(node.expression)
    ts.forEachChild(node, collectRefs)
  })(sf)

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
 * SOURCE ARM. Occurrences of the tag that `stripInternal` will act on but that
 * are NOT a JSDoc annotation on the declaration below them — i.e. prose.
 *
 * Legitimate: inside a `/** … *\/` block, as the first token of its line
 * (after the opening `/**` or a leading `*`). That is how all six genuine
 * annotations in this repo are written.
 *
 * Reported: any occurrence in a `//` line comment (#253's shape, and the shape
 * the "move the header below the imports" fix would leave behind), and any
 * occurrence mid-line inside a JSDoc block.
 */
export function misplacedInternalTags(root, fileName, text) {
  const ts = loadTs(root)
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const out = []
  const seen = new Set()

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
  ;(function visit(node) {
    scan(ts.getLeadingCommentRanges(text, node.pos))
    ts.forEachChild(node, visit)
  })(sf)

  return out.sort((a, b) => a.line - b.line)
}

/** Package dirs under `packages/` whose build config sets `stripInternal`. */
export function stripInternalPackages(root) {
  const out = []
  for (const d of readdirSync(join(root, 'packages'))) {
    const cfg = join(root, 'packages', d, 'tsconfig.build.json')
    if (!existsSync(cfg)) continue
    if (/"stripInternal"\s*:\s*true/.test(readFileSync(cfg, 'utf8'))) out.push(d)
  }
  return out
}

/** Publishable package dirs (no `private: true`). */
export function publishablePackages(root) {
  return readdirSync(join(root, 'packages')).filter((d) => {
    const p = join(root, 'packages', d, 'package.json')
    return existsSync(p) && !JSON.parse(readFileSync(p, 'utf8')).private
  })
}
