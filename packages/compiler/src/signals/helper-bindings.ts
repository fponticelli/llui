// Import-binding-based framework-call recognition.
//
// The transform and the lint rules must decide, for a call like `text(...)` /
// `each(...)` / `div(...)` / `component(...)`, whether the callee is the
// `@llui/dom` framework helper of that name — or a USER binding that merely
// shares the name (a local function, a const, an import from another module) or
// a lexical shadow (a callback param). Deciding by bare name (the old behavior)
// miscompiles a user's own `text`/`each` and can't see through an alias
// (`import { each as loop }`).
//
// `HelperBindings` resolves a callee IDENTIFIER to the canonical `@llui/dom`
// export name it denotes at that site, or `null` when it is not a framework
// helper. It is built once per file from the import + module-scope declarations
// and consulted at every recognition point. Rules:
//
//   • A name bound at module scope to a `@llui/dom` (or `@llui/dom/*` subpath)
//     named import resolves to its ORIGINAL export name — so an alias
//     `{ each as loop }` maps `loop` → `each`, and lowering emits the canonical
//     helper.
//   • A name bound at module scope to anything ELSE — a local function/const/
//     class/enum, a default/namespace import, or a named import from another
//     module — is NEVER a helper (`resolve` → null). This is the root fix: a
//     user function named `text` is left verbatim.
//   • A name NOT bound at module scope falls back to canonical-name recognition
//     (the legacy permissive behavior). A real component file always imports the
//     helpers it uses, so this only affects isolated unit-test snippets that
//     pass a bare expression with no imports — where it's harmless.
//   • In every case, an INNER lexical binding of the name (a callback/param or a
//     block-local of the same name, between the use and module scope) shadows
//     the helper — `resolve` → null. This mirrors the scope-shadowing the
//     accessor analyzer (analyze-deps.ts) already applies inside .map bodies.

import ts from 'typescript'

const DOM_MODULE = '@llui/dom'

/** All identifier names introduced by a (possibly destructured) binding name. */
export function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  const out: string[] = []
  for (const el of name.elements) {
    if (ts.isBindingElement(el)) out.push(...bindingNames(el.name))
  }
  return out
}

/** Does `node` — a scope-introducing node — declare a binding named `name` that
 * scopes over its subtree? Covers function-like params, block-level `var`/`let`/
 * `const`/`function`/`class` declarations, `for` initializers, and `catch`
 * bindings. (A declaration appearing after the use still lexically shadows, so
 * position within the scope is not considered — conservative: when unsure we
 * treat the name as shadowed, i.e. NOT a helper, which only forgoes lowering.) */
function scopeIntroduces(node: ts.Node, name: string): boolean {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return node.parameters.some((p) => bindingNames(p.name).includes(name))
  }
  if (ts.isBlock(node) || ts.isCaseBlock(node)) {
    const statements = ts.isBlock(node)
      ? node.statements
      : node.clauses.flatMap((c) => [...c.statements])
    for (const st of statements) {
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (bindingNames(d.name).includes(name)) return true
        }
      } else if (
        (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) &&
        st.name?.text === name
      ) {
        return true
      }
    }
    return false
  }
  if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) {
    const init = node.initializer
    if (init && ts.isVariableDeclarationList(init)) {
      return init.declarations.some((d) => bindingNames(d.name).includes(name))
    }
    return false
  }
  if (ts.isCatchClause(node)) {
    return node.variableDeclaration
      ? bindingNames(node.variableDeclaration.name).includes(name)
      : false
  }
  return false
}

/** Is `id` shadowed by an inner binding of its own name somewhere between its use
 * site and (exclusive) the module scope? Walks the ancestor chain — `.parent`
 * pointers must be set on the source file (createSourceFile setParentNodes). */
function isShadowed(id: ts.Identifier): boolean {
  const name = id.text
  let node: ts.Node | undefined = id.parent
  while (node && !ts.isSourceFile(node)) {
    if (scopeIntroduces(node, name)) return true
    node = node.parent
  }
  return false
}

export class HelperBindings {
  // module-scope name -> canonical @llui/dom export name (alias-resolved), or
  // `null` when bound at module scope to a NON-dom source (never a helper).
  // Absent -> unbound at module scope (permissive canonical-name fallback).
  private readonly moduleScope: ReadonlyMap<string, string | null>

  private constructor(m: ReadonlyMap<string, string | null>) {
    this.moduleScope = m
  }

  /** Permissive, import-less bindings — every name falls back to canonical-name
   * recognition (still shadow-aware). Used when a lowering helper is called in
   * isolation (unit tests) with no file context. */
  static empty(): HelperBindings {
    return new HelperBindings(new Map())
  }

  /** Build the per-file binding map from a source file's top-level imports and
   * value declarations. */
  static fromSourceFile(sf: ts.SourceFile): HelperBindings {
    const m = new Map<string, string | null>()
    const other = (name: string): void => void m.set(name, null)
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st)) {
        const spec = st.moduleSpecifier
        const isDom =
          ts.isStringLiteral(spec) &&
          (spec.text === DOM_MODULE || spec.text.startsWith(`${DOM_MODULE}/`))
        const clause = st.importClause
        if (!clause) continue
        // default import (`import Foo from …`) binds an object, not a helper.
        if (clause.name) other(clause.name.text)
        const nb = clause.namedBindings
        if (nb && ts.isNamespaceImport(nb)) {
          other(nb.name.text) // `import * as dom` — bare-callee use is impossible
        } else if (nb && ts.isNamedImports(nb)) {
          for (const el of nb.elements) {
            const local = el.name.text
            const imported = el.propertyName ? el.propertyName.text : el.name.text
            m.set(local, isDom ? imported : null)
          }
        }
        continue
      }
      // Module-scope value declarations override/shadow a helper name.
      if (ts.isFunctionDeclaration(st) && st.name) other(st.name.text)
      else if (ts.isClassDeclaration(st) && st.name) other(st.name.text)
      else if (ts.isEnumDeclaration(st)) other(st.name.text)
      else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          for (const n of bindingNames(d.name)) other(n)
        }
      }
    }
    return new HelperBindings(m)
  }

  /** Resolve a callee identifier to the canonical `@llui/dom` helper name it
   * denotes at this site, or `null` when it is not a framework helper (a non-dom
   * module-scope binding, or an inner lexical shadow). */
  resolve(id: ts.Identifier): string | null {
    const bound = this.moduleScope.get(id.text)
    let canonical: string
    if (bound === undefined)
      canonical = id.text // unbound -> permissive fallback
    else if (bound === null)
      return null // non-dom module-scope binding
    else canonical = bound // dom import (alias resolved to its export name)
    return isShadowed(id) ? null : canonical
  }

  /** Resolve a call expression's callee (or `null` when the callee isn't a bare
   * identifier, or isn't a framework helper). */
  resolveCall(call: ts.CallExpression): string | null {
    return ts.isIdentifier(call.expression) ? this.resolve(call.expression) : null
  }
}
