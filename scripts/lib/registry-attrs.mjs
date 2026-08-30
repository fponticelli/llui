// Cross-check the STATE ATTRIBUTES a registry recipe styles against the ones
// its headless machine actually publishes.
//
// This exists because that mismatch is the registry's most expensive bug class
// and NOTHING else catches it. Four shipped at once and every check stayed
// green, because a class naming an attribute nobody emits is perfectly valid
// CSS: `scroll-area` styled `data-[orientation=…]` while the machine publishes
// `data-axis` (the thumb rendered at ZERO pixels); `carousel`'s indicator used
// `data-[state=active]` against a bare `data-active` (the current dot never
// highlighted); `calendar` used react-day-picker's `data-[state=…]` throughout
// (no today marker, no selection fill, no range, no focus ring on any day); and
// `resizable` bound `aria-[orientation=…]` alongside `data-[orientation=…]`,
// which for this machine mean OPPOSITE axes. Only a render showed any of them.
//
// It is deliberately a ONE-DIRECTION check — a recipe naming an attribute the
// machine never emits — because that direction is always a bug. The reverse (a
// machine publishing an attribute nothing styles) is normal and desirable: a
// part bag is a public surface, and most consumers style a fraction of it.
import ts from 'typescript'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * The BARE-spelling attributes in `candidate` (`data-foo:x`,
 * `group-data-foo/n:x`), added to `out`. Shared by `attrsInCandidate` — which
 * also reads the bracketed form — and `bareAttrsInCandidate`, which reads only
 * this one, so the two spellings of the same scan cannot drift apart.
 *
 * @param {string} candidate
 * @param {Set<string>} out
 * @returns {void}
 */
function collectBareAttrs(candidate, out) {
  for (const m of candidate.matchAll(
    /(?:^|:)(?:not-|group-|peer-)*((?:data|aria)-[a-zA-Z0-9-]+?)(?:\/[a-zA-Z0-9-]+)?:/g,
  )) {
    const whole = m[0]
    const attr = m[1]
    // The group is mandatory in the pattern, so a match always carries it.
    if (attr === undefined) continue
    // Skip the bracketed form, already handled (its next char is `[`).
    if (!whole.includes('[')) out.add(attr)
  }
}

/** `data-[foo=bar]:x` / `data-foo:x` / `not-data-foo:x` / `group-data-foo/n:x` /
 *  `aria-[foo=bar]:x` / `aria-foo:x` / `peer-data-[foo]:x` — every spelling
 *  Tailwind offers for an attribute variant. Returns bare attribute names.
 *
 * @param {string} candidate
 * @returns {string[]}
 */
export function attrsInCandidate(candidate) {
  /** @type {Set<string>} */
  const out = new Set()
  // Bracketed form: data-[state=open], group-data-[collapsible=icon]/x, aria-[orientation=vertical]
  for (const m of candidate.matchAll(
    /(?:^|:)(?:not-|group-|peer-)*((?:data|aria)-)\[([a-zA-Z0-9-]+)/g,
  )) {
    const prefix = m[1]
    const name = m[2]
    // Both groups are mandatory in the pattern; a match cannot omit either.
    if (prefix === undefined || name === undefined) continue
    out.add(prefix + name)
  }
  // Bare form: data-active:, not-data-in-month:, group-data-focused/day:
  collectBareAttrs(candidate, out)
  return [...out]
}

/**
 * Every `'data-*'` / `'aria-*'` key a module's exported `*Parts` interfaces
 * declare. Read from the TYPE, not the implementation: the interface is the
 * published contract, and a key present in one but not the other is its own bug
 * the package's own type-check already catches.
 *
 * @param {string} fileName
 * @param {string} source
 * @returns {Set<string>}
 */
export function publishedAttrs(fileName, source) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  /** @type {Set<string>} */
  const out = new Set()
  /** @param {ts.Node} node */
  const walk = (node) => {
    if (ts.isPropertySignature(node) && node.name !== undefined) {
      const name = ts.isStringLiteral(node.name)
        ? node.name.text
        : ts.isIdentifier(node.name)
          ? node.name.text
          : null
      if (name !== null && (name.startsWith('data-') || name.startsWith('aria-'))) out.add(name)
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)
  return out
}

// ── Value-level cross-check ────────────────────────────────────────────────
//
// The name-level check above cannot see the second half of this bug class: a
// recipe that names the RIGHT attribute and the WRONG value. Every boolean
// `data-*` in `@llui/components` is published BARE (`'' | undefined`) — the
// package-wide convention — while shadcn writes `data-invalid="true"` /
// `data-disabled="true"`. `data-[invalid=true]:text-destructive` therefore
// matches nothing a part bag ever produces, and it shipped that way in
// `field.ts` on all three of its rules: the `Field` root's destructive text and
// both `group-data-[disabled=true]/field:opacity-50`. Name-level, they were
// perfect. A render is the only other thing that shows it.

/** `data-[foo=bar]` pairs a candidate styles, as `"data-foo=bar"`. The bare
 *  spelling (`data-foo:`) carries no value and is not reported here.
 *
 * @param {string} candidate
 * @returns {string[]}
 */
export function attrValuePairsInCandidate(candidate) {
  /** @type {Set<string>} */
  const out = new Set()
  // Unanchored on purpose: `data-[x=y]` cannot occur inside a longer token, and
  // every variant prefix Tailwind allows (`not-`, `group-`, `peer-`, a `/name`
  // suffix) sits OUTSIDE the bracket. Anchoring on `^|:` is what an earlier cut
  // did, and it matched nothing at all — `group-data-[…]` has no colon before
  // the attribute and the `[` is not a name character.
  for (const m of candidate.matchAll(/((?:data|aria)-)\[([a-zA-Z0-9-]+)=([a-zA-Z0-9-]+)\]/g)) {
    const prefix = m[1]
    const name = m[2]
    const value = m[3]
    // All three groups are mandatory in the pattern; a match carries them all.
    // Guarded rather than interpolated: a template would silently spell a
    // missing group as the text `undefined`, which reads as a real pair.
    if (prefix === undefined || name === undefined || value === undefined) continue
    out.add(`${prefix}${name}=${value}`)
  }
  return [...out]
}

/** Attributes a candidate styles in the BARE spelling only (`data-foo:x`,
 *  `group-data-foo/n:x`) — i.e. "present at all", with no value asserted. This
 *  is what a value-level parity allowance must be paired with: the bracketed
 *  form contributes the same attribute NAME, so pairing against names alone
 *  would be satisfied by the dead spelling itself.
 *
 * @param {string} candidate
 * @returns {string[]}
 */
export function bareAttrsInCandidate(candidate) {
  /** @type {Set<string>} */
  const out = new Set()
  collectBareAttrs(candidate, out)
  return [...out]
}

/** Unwrap `Signal<X>` / `Reactive<X>` to X; anything else is returned as-is.
 *
 * @param {ts.TypeNode} typeNode
 * @returns {ts.TypeNode}
 */
function unwrapReactive(typeNode) {
  if (
    ts.isTypeReferenceNode(typeNode) &&
    ts.isIdentifier(typeNode.typeName) &&
    (typeNode.typeName.text === 'Signal' || typeNode.typeName.text === 'Reactive') &&
    typeNode.typeArguments?.length === 1
  ) {
    const only = typeNode.typeArguments[0]
    if (only !== undefined) return only
  }
  return typeNode
}

// ── Alias resolution (#248) ────────────────────────────────────────────────
//
// The value arm above gave NO VERDICT whenever the declared type was a NAMED
// type rather than an inline union — `Signal<Orientation>`, `Signal<StepStatus>`
// — because a syntax-only read of one file cannot see what the name means. That
// silence is a hole with a shipped bug in it: `meter` declared
// `'data-state': Signal<MeterThreshold>` while the skin styled
// `data-[state=critical]` / `data-[state=suboptimal]` against a machine emitting
// `low|optimal|high`, and the range painted `bg-primary` in every state for a
// full release (#235). Sixty-six declarations across `components/` and
// `patterns/` sat behind that silence, nineteen distinct aliases, `aria-*`
// included — where a wrong value is an accessibility defect rather than dead CSS.
//
// So the resolver follows a named type to its declaration, through the file's
// own top-level `type X = …` and through RELATIVE imports/re-exports inside the
// same package. It FAILS CLOSED — back to `null`, "no verdict" — on everything
// else, because a wrong verdict here is a build failure for a consumer who did
// nothing wrong: a bare-specifier or cross-package import, a type PARAMETER
// (`MenuItemAttrs<Scope extends string>` really is open), a generic alias, an
// interface/enum/class, a mapped or conditional type, a cycle, a file that does
// not exist, or a path that escapes the package root.

// Termination is guarded TWICE, on purpose and redundantly: `MAX_ALIAS_DEPTH`
// bounds any chain, and the `seen` set in `literalValues` catches a cycle at the
// first repeat. Either alone is sufficient — measured, dropping `seen` leaves
// both test files green — so do not read one as covering for the other's
// removal. `seen` reports the cycle at depth 1 instead of 16; the cap is the one
// that also answers a deep ACYCLIC chain, which no cycle set can.
const MAX_ALIAS_DEPTH = 16

/**
 * Where an imported or re-exported type NAME comes from.
 *
 * @typedef {{ specifier: string, exportedName: string }} ImportedType
 */

/**
 * A parsed module and the two lookups alias resolution needs.
 *
 * @typedef {object} RegistryModule
 * @property {string} fileName Absolute path the module was parsed under.
 * @property {ts.SourceFile} sf
 * @property {Map<string, ts.TypeNode>} aliases Top-level NON-generic `type X = …`.
 * @property {Map<string, ImportedType>} imported Local name → where it comes from.
 * @property {string | null} packageRoot Nearest ancestor holding a `package.json`.
 * @property {ModuleCache} cache The sweep-wide parse cache this module was loaded under.
 */

/**
 * Sweep-wide parse cache, keyed by resolved path. A `null` entry is a file that
 * does not exist — remembered so a missing sibling is stat'ed once, not once per
 * declaration that names it.
 *
 * @typedef {Map<string, RegistryModule | null>} ModuleCache
 */

/**
 * Type parameters declared by `node`, whatever kind it is.
 *
 * Read STRUCTURALLY, through one downcast, rather than from a hand-list of node
 * kinds: a kind the list failed to name would silently lose the shadow check,
 * and `resolveAliasTarget` would then follow a module-level alias of the SAME
 * name to a completely different type — the wrong-verdict direction this
 * resolver exists to avoid.
 *
 * @param {ts.Node} node
 * @returns {ts.NodeArray<ts.TypeParameterDeclaration> | undefined}
 */
function ownTypeParameters(node) {
  const carrier =
    /** @type {ts.Node & { readonly typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> }} */ (
      node
    )
  return carrier.typeParameters
}

/** Nearest ancestor directory holding a `package.json`, or `null`.
 *
 * @param {string} fileName
 * @returns {string | null}
 */
function packageRootOf(fileName) {
  let dir = path.dirname(path.resolve(fileName))
  for (;;) {
    if (existsSync(path.join(dir, 'package.json'))) return dir
    const up = path.dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

/**
 * A parsed module plus the two lookups alias resolution needs: its top-level
 * type aliases, and where each imported/re-exported type NAME comes from.
 * Memoized per `cache` so one sweep parses each sibling once.
 *
 * @param {string} fileName
 * @param {ModuleCache} cache
 * @returns {RegistryModule | null}
 */
function loadModule(fileName, cache) {
  const key = path.resolve(fileName)
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  if (!existsSync(key)) {
    cache.set(key, null)
    return null
  }
  const mod = buildModule(key, readFileSync(key, 'utf8'), cache)
  cache.set(key, mod)
  return mod
}

/** Parse `source` as `fileName` and index its type aliases and type imports.
 *
 * @param {string} fileName
 * @param {string} source
 * @param {ModuleCache} cache
 * @returns {RegistryModule}
 */
function buildModule(fileName, source, cache) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  /** @type {Map<string, ts.TypeNode>} */
  const aliases = new Map()
  /** @type {Map<string, ImportedType>} local name → { specifier, exportedName } */
  const imported = new Map()
  for (const st of sf.statements) {
    if (ts.isTypeAliasDeclaration(st)) {
      // A GENERIC alias cannot be resolved without its arguments; fail closed.
      if (st.typeParameters !== undefined && st.typeParameters.length > 0) continue
      aliases.set(st.name.text, st.type)
      continue
    }
    if (ts.isImportDeclaration(st) && st.importClause !== undefined) {
      const spec = st.moduleSpecifier
      if (!ts.isStringLiteral(spec)) continue
      const bindings = st.importClause.namedBindings
      if (bindings === undefined || !ts.isNamedImports(bindings)) continue
      for (const el of bindings.elements) {
        imported.set(el.name.text, {
          specifier: spec.text,
          exportedName: (el.propertyName ?? el.name).text,
        })
      }
      continue
    }
    // `export type { X } from './y.js'` — a re-export is how a barrel restates
    // a sibling's alias, and it reads exactly like an import for this purpose.
    // `export * from` is deliberately NOT followed: it names no binding, so
    // resolving through it would mean guessing which module owns the name.
    if (ts.isExportDeclaration(st) && st.exportClause !== undefined) {
      const spec = st.moduleSpecifier
      if (spec === undefined || !ts.isStringLiteral(spec)) continue
      if (!ts.isNamedExports(st.exportClause)) continue
      for (const el of st.exportClause.elements) {
        imported.set(el.name.text, {
          specifier: spec.text,
          exportedName: (el.propertyName ?? el.name).text,
        })
      }
    }
  }
  return { fileName, sf, aliases, imported, packageRoot: packageRootOf(fileName), cache }
}

/**
 * Resolve a RELATIVE specifier to a `.ts` file inside the SAME package.
 * Everything else — a bare specifier (`@llui/dom`, `typescript`), a path that
 * leaves the package root, a file that does not exist — resolves to `null`.
 *
 * @param {RegistryModule} mod
 * @param {string} specifier
 * @returns {string | null}
 */
function resolveRelative(mod, specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null
  if (mod.packageRoot === null) return null
  const base = path.resolve(path.dirname(mod.fileName), specifier)
  // TS sources import each other with a `.js` extension under NodeNext.
  const candidates = [base.replace(/\.jsx?$/, '.ts'), base + '.ts', path.join(base, 'index.ts')]
  for (const cand of candidates) {
    const rel = path.relative(mod.packageRoot, cand)
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue
    // `isFile()`, not merely `existsSync`: for an EXTENSIONLESS specifier whose
    // name is a DIRECTORY (`./sub`), candidate 0 is the directory itself and a
    // bare existence test hands it to `readFileSync`, which throws EISDIR — a
    // CRASH out of a resolver whose entire contract is to fail closed. With the
    // stat, `./sub` falls through to `sub/index.ts`, which is the answer
    // TypeScript gives. Latent while nothing under `packages/components/src`
    // imports extensionlessly, but the residue pin exists to push new files
    // through here.
    if (existsSync(cand) && statSync(cand).isFile()) return cand
  }
  return null
}

/** True when `name` is bound by a type PARAMETER on any ancestor of `node`.
 *
 * @param {ts.Node} node
 * @param {string} name
 * @returns {boolean}
 */
function shadowedByTypeParameter(node, name) {
  for (/** @type {ts.Node | undefined} */ let cur = node; cur !== undefined; cur = cur.parent) {
    const params = ownTypeParameters(cur)
    if (params === undefined) continue
    for (const p of params) if (p.name.text === name) return true
  }
  return false
}

/**
 * Follow `name` from `mod` to the type node it denotes, plus the module that
 * node lives in. `null` whenever it cannot be followed with certainty.
 *
 * @param {string} name
 * @param {RegistryModule} mod
 * @param {number} depth
 * @returns {{ type: ts.TypeNode, mod: RegistryModule } | null}
 */
function resolveAliasTarget(name, mod, depth) {
  if (depth > MAX_ALIAS_DEPTH) return null
  const local = mod.aliases.get(name)
  if (local !== undefined) return { type: local, mod }
  const via = mod.imported.get(name)
  if (via === undefined) return null
  const file = resolveRelative(mod, via.specifier)
  if (file === null) return null
  const next = loadModule(file, mod.cache)
  if (next === null) return null
  return resolveAliasTarget(via.exportedName, next, depth + 1)
}

/** Strip parentheses so `('a' | 'b')` reads as the union it is.
 *
 * @param {ts.TypeNode} typeNode
 * @returns {ts.TypeNode}
 */
function unwrapParens(typeNode) {
  /** @type {ts.TypeNode} */
  let cur = typeNode
  while (ts.isParenthesizedTypeNode(cur)) cur = cur.type
  return cur
}

/**
 * The literal string values a type can hold, or `null` when the type is OPEN
 * (a `string`, a template literal, an alias this syntax-only read cannot follow
 * — see the fail-closed list above). `null` means "no verdict": the check stays
 * silent rather than guessing, in keeping with the one-direction rule.
 *
 * @param {ts.TypeNode} typeNode
 * @param {RegistryModule} [mod]
 * @param {number} [depth]
 * @param {Set<string>} [seen]
 * @returns {Set<string> | null}
 */
function literalValues(typeNode, mod, depth = 0, seen = new Set()) {
  if (depth > MAX_ALIAS_DEPTH) return null
  const inner = unwrapParens(unwrapReactive(unwrapParens(typeNode)))
  /** @type {readonly ts.TypeNode[]} */
  const members = ts.isUnionTypeNode(inner) ? inner.types : [inner]
  /** @type {Set<string>} */
  const out = new Set()
  for (const raw of members) {
    const m = unwrapParens(raw)
    if (ts.isLiteralTypeNode(m)) {
      const lit = m.literal
      if (ts.isStringLiteral(lit)) {
        out.add(lit.text)
        continue
      }
      // `null` and `undefined` mean ABSENT, which no `[attr=value]` can select.
      if (lit.kind === ts.SyntaxKind.NullKeyword) continue
      return null
    }
    if (m.kind === ts.SyntaxKind.UndefinedKeyword) continue
    // A NAMED type: follow it, or give no verdict.
    if (
      mod !== undefined &&
      ts.isTypeReferenceNode(m) &&
      ts.isIdentifier(m.typeName) &&
      m.typeArguments === undefined
    ) {
      const name = m.typeName.text
      // A type PARAMETER (`MenuItemAttrs<Scope extends string>`) is genuinely
      // open — the machine's own callers choose the value.
      if (shadowedByTypeParameter(m, name)) return null
      const key = `${mod.fileName}#${name}`
      if (seen.has(key)) return null
      const target = resolveAliasTarget(name, mod, 0)
      if (target === null) return null
      const nested = literalValues(target.type, target.mod, depth + 1, new Set([...seen, key]))
      if (nested === null) return null
      for (const v of nested) out.add(v)
      continue
    }
    return null
  }
  return out
}

/**
 * Every `'data-*'` / `'aria-*'` key a module's exported `*Parts` interfaces
 * declare, mapped to the literal values it can hold (`null` = open type).
 * A key declared more than once unions its value sets, and one OPEN declaration
 * opens the attribute everywhere in the module.
 *
 * @param {string} fileName
 * @param {string} source
 * @param {ModuleCache} [cache]
 * @returns {Map<string, Set<string> | null>}
 */
export function publishedAttrValues(fileName, source, cache = new Map()) {
  const mod = buildModule(path.resolve(fileName), source, cache)
  cache.set(mod.fileName, mod)
  /** @type {Map<string, Set<string> | null>} */
  const out = new Map()
  /** @param {ts.Node} node */
  const walk = (node) => {
    if (ts.isPropertySignature(node) && node.name !== undefined && node.type !== undefined) {
      const name = ts.isStringLiteral(node.name)
        ? node.name.text
        : ts.isIdentifier(node.name)
          ? node.name.text
          : null
      if (name !== null && (name.startsWith('data-') || name.startsWith('aria-'))) {
        const values = literalValues(node.type, mod)
        const prev = out.get(name)
        // `out` only ever holds a `Set` or `null`, so `undefined` is exactly
        // "this key has not been seen yet".
        if (prev === undefined) out.set(name, values === null ? null : new Set(values))
        else if (prev === null || values === null) out.set(name, null)
        else for (const v of values) prev.add(v)
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(mod.sf)
  return out
}

/**
 * Every `'data-*'` / `'aria-*'` declaration in a module whose declared type
 * NAMES a type the resolver could not follow — the residue of the hole #248
 * closes, and what the companion guard pins so a new one cannot arrive
 * unnoticed. Reported as `{ attr, typeText, reason }`.
 *
 * A `string` / `number` / `boolean` declaration is NOT residue: it is honestly
 * open and no resolver can enumerate it. Only a NAMED type that fails to
 * resolve is, because that is a value set someone wrote down and the guard
 * cannot read.
 *
 * @param {string} fileName
 * @param {string} source
 * @param {ModuleCache} [cache]
 * @returns {{ attr: string, typeText: string, reason: string }[]}
 */
export function unresolvedAttrTypes(fileName, source, cache = new Map()) {
  const mod = buildModule(path.resolve(fileName), source, cache)
  cache.set(mod.fileName, mod)
  /** @type {{ attr: string, typeText: string, reason: string }[]} */
  const out = []
  /** @param {ts.Node} node */
  const walk = (node) => {
    if (ts.isPropertySignature(node) && node.name !== undefined && node.type !== undefined) {
      const name = ts.isStringLiteral(node.name)
        ? node.name.text
        : ts.isIdentifier(node.name)
          ? node.name.text
          : null
      if (
        name !== null &&
        (name.startsWith('data-') || name.startsWith('aria-')) &&
        literalValues(node.type, mod) === null
      ) {
        const named = firstUnresolvableTypeName(node.type, mod)
        if (named !== null) {
          out.push({ attr: name, typeText: node.type.getText(mod.sf), reason: named })
        }
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(mod.sf)
  return out
}

/**
 * The first named type in `typeNode`'s union that the resolver declines, with
 * why — `<Name>: type parameter` / `: unresolved`. `null` when the type is open
 * for a reason that has no name in it (a `string`, a `number`, a template).
 *
 * @param {ts.TypeNode} typeNode
 * @param {RegistryModule} mod
 * @returns {string | null}
 */
function firstUnresolvableTypeName(typeNode, mod) {
  const inner = unwrapParens(unwrapReactive(unwrapParens(typeNode)))
  /** @type {readonly ts.TypeNode[]} */
  const members = ts.isUnionTypeNode(inner) ? inner.types : [inner]
  for (const raw of members) {
    const m = unwrapParens(raw)
    // `typeof SOME_CONST` names a VALUE's type. It is a value set someone wrote
    // down and this read cannot follow it, so it is residue like any alias.
    if (ts.isTypeQueryNode(m)) return `${m.exprName.getText(mod.sf)}: typeof query`
    if (!ts.isTypeReferenceNode(m)) continue
    if (!ts.isIdentifier(m.typeName)) return `${m.typeName.getText(mod.sf)}: qualified name`
    const name = m.typeName.text
    if (m.typeArguments !== undefined) return `${name}: generic`
    if (shadowedByTypeParameter(m, name)) return `${name}: type parameter`
    if (literalValues(m, mod) === null) return `${name}: unresolved`
  }
  return null
}
