// The `@llui/dom` runtime helpers the signal transform can emit — and the
// per-file decision of WHICH IDENTIFIER each one is emitted under.
//
// The transform prepends `import { … } from '@llui/dom'` for the helpers it
// actually emitted. That import declares TOP-LEVEL bindings, so it breaks on any
// use the file already makes of the name — not merely on another `@llui/dom`
// import specifier (issue #90). Two distinct failures, and the second is worse:
//
//   • a top-level binding (`const el = …`, `function el() {}`, `class el {}`,
//     `import el from './x'`, a destructuring pattern, or a `var` HOISTED out of
//     a block) is re-declared → SyntaxError in code that compiled before;
//   • a binding that merely SHADOWS the import where the lowered call sits — a
//     `const el` inside a lowered block-body view — silently rebinds the emitted
//     call to the user's value. That compiles, and calls the wrong function.
//
// So the collision test is "does this identifier occur ANYWHERE in the file",
// answered by `allIdentifierNames`. See its comment for why coarse is correct.
//
// The resolution is an ALIAS, never a skip: skipping the injection leaves the
// lowered `el(...)` bound to the USER's value, which compiles and silently does
// the wrong thing at runtime — strictly worse than a build error. Because the
// alias must appear at every lowered call site, it is decided BEFORE lowering and
// threaded into the view transform (`setHelperEmitNames`), so the generated text
// carries it from the start. Nothing rewrites an already-emitted edit: an edit's
// text also contains VERBATIM user code, where a call to the user's own `el` must
// keep meaning the user's `el`.

import ts from 'typescript'

const DOM_MODULE = '@llui/dom'

const HELPER_NAMES = [
  'signalText',
  'staticText',
  'el',
  'react',
  'signalEach',
  'signalEachDirect',
  'eachDirect',
  'eachArm',
  'rowHandle',
  'applyAttr',
  'signalShow',
  'signalBranch',
  'signalForeign',
] as const

/** A `@llui/dom` export the signal transform can emit a call to. The list order
 * is the order specifiers appear in the injected import. */
export type RuntimeHelper = (typeof HELPER_NAMES)[number]

/** The identifier each runtime helper is EMITTED as in one file: its canonical
 * name, or an alias when that name is already taken at top level. */
export type HelperEmitNames = Readonly<Record<RuntimeHelper, string>>

/** Build a full emit-name record. Written out per key (rather than looping into a
 * `Partial`) so the compiler — not a cast — proves every helper is covered. */
function mapHelpers(nameFor: (helper: RuntimeHelper) => string): HelperEmitNames {
  return {
    signalText: nameFor('signalText'),
    staticText: nameFor('staticText'),
    el: nameFor('el'),
    react: nameFor('react'),
    signalEach: nameFor('signalEach'),
    signalEachDirect: nameFor('signalEachDirect'),
    eachDirect: nameFor('eachDirect'),
    eachArm: nameFor('eachArm'),
    rowHandle: nameFor('rowHandle'),
    applyAttr: nameFor('applyAttr'),
    signalShow: nameFor('signalShow'),
    signalBranch: nameFor('signalBranch'),
    signalForeign: nameFor('signalForeign'),
  }
}

/** Every helper emitted under its own name — the default for callers that lower an
 * expression with no file context (unit tests, isolated helper lowering). */
export const CANONICAL_HELPER_NAMES: HelperEmitNames = mapHelpers((h) => h)

/** How one file must handle the runtime import. */
export interface HelperImportPlan {
  /** the identifier each helper is emitted as (canonical unless taken) */
  readonly names: HelperEmitNames
  /** helpers this file ALREADY imports from '@llui/dom' under their canonical
   * name — emitted verbatim and never re-imported (that would duplicate the
   * binding); the import subtraction that predates #90. */
  readonly alreadyImported: ReadonlySet<RuntimeHelper>
}

/** The canonical `@llui/dom` exports this file already imports UNDER THAT SAME
 * NAME — the only case where emitting the bare helper name reaches the real
 * helper. `import { text as el }` binds `el` to a different export, so it is a
 * collision, not a subtraction; a type-only specifier binds no value at all. */
function domValueImportsByCanonicalName(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>()
  for (const st of sf.statements) {
    if (
      !ts.isImportDeclaration(st) ||
      !ts.isStringLiteral(st.moduleSpecifier) ||
      st.moduleSpecifier.text !== DOM_MODULE ||
      st.importClause?.isTypeOnly
    ) {
      continue
    }
    const nb = st.importClause?.namedBindings
    if (!nb || !ts.isNamedImports(nb)) continue
    for (const spec of nb.elements) {
      if (spec.isTypeOnly) continue
      const imported = spec.propertyName?.text ?? spec.name.text
      if (imported === spec.name.text) out.add(imported)
    }
  }
  return out
}

/** Every identifier text anywhere in the file. This is BOTH the collision test and
 * the pool an alias must avoid, and it is deliberately the coarsest possible answer:
 *
 *   • INNER scopes count. Block-body views are lowered, so an emitted call can land
 *     inside a scope the user shadows (`view: () => { const el = …; return […] }`) —
 *     there the injected top-level import is invisible and the lowered call reaches
 *     the user's value. Same for the alias itself.
 *   • HOISTED bindings count. `if (x) { var el = 1 }` hoists to module scope and
 *     duplicates the injected import, yet appears in no top-level statement.
 *
 * It over-approximates — a property name, a type name, an unrelated local — and the
 * only cost is an alias nobody needed. Under-approximating costs a SyntaxError, or
 * worse, code that compiles and calls the wrong function; so when in doubt, alias. */
function allIdentifierNames(sf: ts.SourceFile): Set<string> {
  const out = new Set<string>()
  const walk = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) out.add(n.text)
    n.forEachChild(walk)
  }
  walk(sf)
  return out
}

/** Decide, for every runtime helper, the name this file emits it under and
 * whether it still needs importing. */
export function planHelperImports(sf: ts.SourceFile): HelperImportPlan {
  const domImported = domValueImportsByCanonicalName(sf)
  const taken = allIdentifierNames(sf)
  const alreadyImported = new Set<RuntimeHelper>()
  const names = mapHelpers((helper) => {
    if (domImported.has(helper)) {
      alreadyImported.add(helper)
      return helper // the file's own import IS the helper — emit it verbatim
    }
    if (!taken.has(helper)) return helper // the name occurs nowhere — safe to import as-is
    let alias = `${helper}$llui`
    for (let i = 2; taken.has(alias); i++) alias = `${helper}$llui${i}`
    taken.add(alias)
    return alias
  })
  return { names, alreadyImported }
}

/** The `import { … } from '@llui/dom'` line for the helpers actually emitted —
 * aliased where the plan had to dodge a name of the user's — or undefined when
 * nothing is left to import. `emitted` holds CANONICAL helper names (see the
 * reverse map in transform-component). */
export function helperImportStatement(
  plan: HelperImportPlan,
  emitted: ReadonlySet<string>,
): string | undefined {
  const specifiers = HELPER_NAMES.filter((h) => emitted.has(h) && !plan.alreadyImported.has(h)).map(
    (h) => (plan.names[h] === h ? h : `${h} as ${plan.names[h]}`),
  )
  return specifiers.length > 0
    ? `import { ${specifiers.join(', ')} } from '${DOM_MODULE}'\n`
    : undefined
}
