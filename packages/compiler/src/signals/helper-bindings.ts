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
// `HelperBindings` resolves a callee identifier (or a member of an imported
// namespace) to the canonical `@llui/dom` export name it denotes at that site,
// or `null` when it is not a framework helper. It is built once per immutable
// SourceFile, cached by that tree, and consulted at every recognition point.
// Rules:
//
//   • A name bound at module scope to a `@llui/dom` (or `@llui/dom/*` subpath)
//     named import resolves to its ORIGINAL export name — so an alias
//     `{ each as loop }` maps `loop` → `each`, and lowering emits the canonical
//     helper.
//   • A relative import resolves only when its target's nearest package.json is
//     exactly `@llui/dom`. A barrel outside that package resolves only when its
//     requested export can be traced through explicit/star re-exports to that
//     same identity. File basenames and suffixes carry no trust.
//   • A name bound at module scope to anything ELSE — a local function/const/
//     class/enum, a default/type-only import, or an import whose provenance is
//     missing, cyclic, ambiguous, or non-DOM — is NEVER a helper. This is the
//     root safety boundary: a user function named `text` is left verbatim.
//   • `import * as ui` is resolved per member (`ui.div` → `div`) through the
//     same provenance rules. Calling the namespace itself is never a helper.
//   • A name NOT bound at module scope falls back to canonical-name recognition
//     (the legacy permissive behavior). A real component file always imports the
//     helpers it uses, so this only affects isolated unit-test snippets that
//     pass a bare expression with no imports — where it's harmless.
//   • In every case, an INNER lexical binding of the name (a callback/param or a
//     block-local of the same name, between the use and module scope) shadows
//     the helper — `resolve` → null. This mirrors the scope-shadowing the
//     accessor analyzer (analyze-deps.ts) already applies inside .map bodies.

import ts from 'typescript'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { parseModule } from '../parse.js'

const DOM_MODULE = '@llui/dom'

const MODULE_RESOLUTION_OPTIONS: ts.CompilerOptions = {
  allowJs: true,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
}

function isDomSpecifier(specifier: string): boolean {
  return specifier === DOM_MODULE || specifier.startsWith(`${DOM_MODULE}/`)
}

function nearestPackageName(fileName: string): string | null {
  let dir = dirname(fileName)
  while (true) {
    const manifest = join(dir, 'package.json')
    if (ts.sys.fileExists(manifest)) {
      const text = ts.sys.readFile(manifest)
      if (text === undefined) return null
      try {
        const parsed = JSON.parse(text) as { name?: unknown }
        return typeof parsed.name === 'string' ? parsed.name : null
      } catch {
        return null
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

type ExportOrigin =
  | { readonly kind: 'dom'; readonly canonical: string }
  | { readonly kind: 'other' }
  | { readonly kind: 'missing' }

const OTHER_EXPORT: ExportOrigin = { kind: 'other' }
const MISSING_EXPORT: ExportOrigin = { kind: 'missing' }

/** Trace a named export to the `@llui/dom` package that defines it. */
class DomExportResolver {
  private readonly resolving = new Set<string>()
  private readonly cache = new Map<string, ExportOrigin>()

  resolve(specifier: string, containingFile: string, exportedName: string): string | null {
    const origin = this.trace(specifier, containingFile, exportedName)
    return origin.kind === 'dom' ? origin.canonical : null
  }

  private trace(specifier: string, containingFile: string, exportedName: string): ExportOrigin {
    if (isDomSpecifier(specifier)) return { kind: 'dom', canonical: exportedName }
    const key = `${containingFile}\0${specifier}\0${exportedName}`
    const cached = this.cache.get(key)
    if (cached) return cached
    const fileName = this.resolveModule(specifier, containingFile)
    const result =
      fileName === null
        ? MISSING_EXPORT
        : nearestPackageName(fileName) === DOM_MODULE
          ? { kind: 'dom' as const, canonical: exportedName }
          : this.resolveFromBarrel(fileName, exportedName)
    this.cache.set(key, result)
    return result
  }

  private resolveModule(specifier: string, containingFile: string): string | null {
    const result = ts.resolveModuleName(
      specifier,
      resolvePath(containingFile),
      MODULE_RESOLUTION_OPTIONS,
      ts.sys,
    ).resolvedModule
    return result?.resolvedFileName ?? null
  }

  private resolveFromBarrel(fileName: string, exportedName: string): ExportOrigin {
    const key = `${fileName}\0${exportedName}`
    if (this.resolving.has(key)) return MISSING_EXPORT
    this.resolving.add(key)
    try {
      const text = ts.sys.readFile(fileName)
      if (text === undefined) return MISSING_EXPORT
      const sf = parseModule(fileName, text).sourceFile()
      const explicit: ExportOrigin[] = []
      const stars: ExportOrigin[] = []

      for (const statement of sf.statements) {
        if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue
        const moduleSpecifier = statement.moduleSpecifier
        const clause = statement.exportClause
        if (clause && ts.isNamedExports(clause)) {
          for (const element of clause.elements) {
            if (element.isTypeOnly || element.name.text !== exportedName) continue
            const sourceName = element.propertyName?.text ?? element.name.text
            explicit.push(
              moduleSpecifier && ts.isStringLiteral(moduleSpecifier)
                ? this.trace(moduleSpecifier.text, fileName, sourceName)
                : this.resolveLocalImport(sf, fileName, sourceName),
            )
          }
        } else if (clause && ts.isNamespaceExport(clause) && clause.name.text === exportedName) {
          explicit.push(OTHER_EXPORT)
        } else if (!clause && moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) {
          stars.push(this.trace(moduleSpecifier.text, fileName, exportedName))
        }
      }

      if (explicit.length > 0) return this.mergeOrigins(explicit, true)
      const starOrigin = this.mergeOrigins(stars, false)
      if (starOrigin.kind !== 'missing') return starOrigin
      return this.hasLocalExport(sf, exportedName) ? OTHER_EXPORT : MISSING_EXPORT
    } finally {
      this.resolving.delete(key)
    }
  }

  private mergeOrigins(origins: readonly ExportOrigin[], explicit: boolean): ExportOrigin {
    const present = origins.filter((origin) => origin.kind !== 'missing')
    if (present.length === 0) return explicit ? OTHER_EXPORT : MISSING_EXPORT
    if (present.some((origin) => origin.kind === 'other')) return OTHER_EXPORT
    const canonicals = new Set(
      present.flatMap((origin) => (origin.kind === 'dom' ? [origin.canonical] : [])),
    )
    if (canonicals.size !== 1) return OTHER_EXPORT
    return { kind: 'dom', canonical: [...canonicals][0]! }
  }

  private hasLocalExport(sf: ts.SourceFile, exportedName: string): boolean {
    for (const statement of sf.statements) {
      const exported =
        ts.canHaveModifiers(statement) &&
        ts
          .getModifiers(statement)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
      if (!exported) continue
      if (ts.isVariableStatement(statement)) {
        if (
          statement.declarationList.declarations.some((declaration) =>
            bindingNames(declaration.name).includes(exportedName),
          )
        ) {
          return true
        }
      } else if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isEnumDeclaration(statement)) &&
        statement.name?.text === exportedName
      ) {
        return true
      } else if (ts.isExportAssignment(statement) && exportedName === 'default') {
        return true
      }
    }
    return false
  }

  private resolveLocalImport(
    sf: ts.SourceFile,
    containingFile: string,
    localName: string,
  ): ExportOrigin {
    for (const statement of sf.statements) {
      if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
      const bindings = statement.importClause?.namedBindings
      if (!bindings || !ts.isNamedImports(bindings)) continue
      for (const element of bindings.elements) {
        if (element.isTypeOnly || element.name.text !== localName) continue
        return this.trace(
          statement.moduleSpecifier.text,
          containingFile,
          element.propertyName?.text ?? element.name.text,
        )
      }
    }
    // `export { localName }` explicitly publishes a local value. If it is not
    // an imported DOM helper, it is positively non-DOM rather than absent.
    return OTHER_EXPORT
  }
}

interface NamespaceBinding {
  readonly specifier: string
  readonly containingFile: string
}

const SOURCE_FILE_BINDINGS = new WeakMap<ts.SourceFile, HelperBindings>()

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
 * scopes over its subtree? Covers function-like params, a function/class
 * EXPRESSION's own name, block-level `var`/`let`/`const`/`function`/`class`
 * declarations, `for` initializers, and `catch` bindings. (A declaration
 * appearing after the use still lexically shadows, so position within the scope
 * is not considered — conservative: when unsure we treat the name as shadowed,
 * i.e. NOT a helper, which only forgoes lowering.)
 *
 * Exported because every walker that carries a NAME through a subtree owes the
 * same discipline: a signal root, like a helper binding, stops being itself the
 * moment an inner scope rebinds its name — `each(…, (state) => …)` inside a view
 * whose bag root is also `state` is a plain row handle, not the component state.
 * `collect-signal-deps.ts` prunes its roots with this, and `tag-send-drift`
 * decides dispatcher attribution with it. Reuse it rather than re-deriving
 * shadowing per walker; the cases below are the ones hand-rolled versions forget
 * (`for` initializers, `catch`, hoisted function/class names, and — until #153 —
 * a function/class expression's own name). */
export function scopeIntroduces(node: ts.Node, name: string): boolean {
  // A function or class EXPRESSION binds its OWN name over its own subtree.
  // That is how a self-recursive function expression calls itself, so inside
  // `function send(m) { send(m) }` the identifier `send` is the FUNCTION, not
  // whatever `send` meant outside — exactly the `items.forEach(({ send }) => …)`
  // case in a different binding form (#153). Missing it left the name "live"
  // inside a scope that had rebound it, which cost `tag-send-drift` two false
  // positives on code that type-checks and made `function div() { div({}, []) }`
  // lint AND lower as the `@llui/dom` helper inside its own body.
  //
  // A DECLARATION is deliberately not here: `function f() {}` / `class C {}`
  // bind in the ENCLOSING scope, which the `Block` branch below (and, at module
  // scope, `HelperBindings.fromSourceFile`) already owns.
  if ((ts.isFunctionExpression(node) || ts.isClassExpression(node)) && node.name?.text === name) {
    return true
  }
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
 * pointers must be set on the source file (createSourceFile setParentNodes).
 *
 * Exported for the same reason {@link scopeIntroduces} is: any walker that
 * resolves an identifier to a MODULE-SCOPE declaration owes this check, and
 * re-deriving the ancestor walk per walker is how the cases at the end of
 * `scopeIntroduces`'s list get forgotten. `imperative-dom-mutation` uses it to
 * decide whether `onClick: handleClick` really names the module's
 * `const handleClick = …`. */
export function isShadowed(id: ts.Identifier): boolean {
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
  private readonly namespaces: ReadonlyMap<string, NamespaceBinding>
  private readonly exportResolver: DomExportResolver | null

  private constructor(
    m: ReadonlyMap<string, string | null>,
    namespaces: ReadonlyMap<string, NamespaceBinding>,
    exportResolver: DomExportResolver | null,
  ) {
    this.moduleScope = m
    this.namespaces = namespaces
    this.exportResolver = exportResolver
  }

  /** Permissive, import-less bindings — every name falls back to canonical-name
   * recognition (still shadow-aware). Used when a lowering helper is called in
   * isolation (unit tests) with no file context. */
  static empty(): HelperBindings {
    return new HelperBindings(new Map(), new Map(), null)
  }

  /** Build (or reuse) the per-file binding map from a source file's top-level
   * imports and value declarations. SourceFiles are immutable by repository
   * contract, so the WeakMap cannot serve stale binding state. */
  static fromSourceFile(sf: ts.SourceFile): HelperBindings {
    const cached = SOURCE_FILE_BINDINGS.get(sf)
    if (cached) return cached
    const m = new Map<string, string | null>()
    const namespaces = new Map<string, NamespaceBinding>()
    const exportResolver = new DomExportResolver()
    const other = (name: string): void => {
      m.set(name, null)
      namespaces.delete(name)
    }
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st)) {
        const spec = st.moduleSpecifier
        const clause = st.importClause
        if (!clause) continue
        if (clause.isTypeOnly) {
          if (clause.name) other(clause.name.text)
          const typeBindings = clause.namedBindings
          if (typeBindings && ts.isNamespaceImport(typeBindings)) other(typeBindings.name.text)
          else if (typeBindings && ts.isNamedImports(typeBindings)) {
            for (const element of typeBindings.elements) other(element.name.text)
          }
          continue
        }
        // default import (`import Foo from …`) binds an object, not a helper.
        if (clause.name) other(clause.name.text)
        const nb = clause.namedBindings
        if (nb && ts.isNamespaceImport(nb)) {
          other(nb.name.text)
          if (ts.isStringLiteral(spec)) {
            namespaces.set(nb.name.text, {
              specifier: spec.text,
              containingFile: sf.fileName,
            })
          }
        } else if (nb && ts.isNamedImports(nb)) {
          for (const el of nb.elements) {
            const local = el.name.text
            const imported = el.propertyName ? el.propertyName.text : el.name.text
            namespaces.delete(local)
            m.set(
              local,
              !el.isTypeOnly && ts.isStringLiteral(spec)
                ? exportResolver.resolve(spec.text, sf.fileName, imported)
                : null,
            )
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
    const bindings = new HelperBindings(m, namespaces, exportResolver)
    SOURCE_FILE_BINDINGS.set(sf, bindings)
    return bindings
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

  /** Resolve a call expression's callee (or `null` when it is neither a bare
   * helper identifier nor a helper member on an imported namespace). */
  resolveCall(call: ts.CallExpression): string | null {
    if (ts.isIdentifier(call.expression)) return this.resolve(call.expression)
    if (
      ts.isPropertyAccessExpression(call.expression) &&
      ts.isIdentifier(call.expression.expression)
    ) {
      const namespace = call.expression.expression
      const binding = this.namespaces.get(namespace.text)
      if (!binding || isShadowed(namespace) || this.exportResolver === null) return null
      return this.exportResolver.resolve(
        binding.specifier,
        binding.containingFile,
        call.expression.name.text,
      )
    }
    return null
  }
}
