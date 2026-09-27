// Extract the Tailwind class candidates a registry item actually emits.
//
// Deliberately AST-driven and NOT a regex over every string literal. A liberal
// scan also picks up `'button'` (an element `type`), `'horizontal'` (an
// orientation) and `'registry:ui'` (a schema value) — none of which are classes,
// none of which produce CSS, and each of which would fail the compile check for
// the wrong reason. Only the two positions that genuinely become a `class`
// attribute are read:
//
//   1. every string-literal argument to `cn(...)` / `mergeClass(...)` /
//      `classPart(tag, recipe)`
//   2. inside `createVariants({ ... })`: `base`, every string leaf under
//      `variants`, and each `compoundVariants[].class`
//   3. a literal `class:` property in an element props bag — how app code
//      (`examples/components-demo`) spells the same thing
//
// `classPartWithDefaults` is in that list for the same reason `classPart` is:
// its recipe sits in the same argument position, and a helper this file does not
// name is a recipe nobody checks.
//
// `classPart` is in that list because it USED to be a per-file local factory,
// and three components' recipes were invisible here until it became one shared
// named seam. That is the failure mode to watch for: a recipe reached through a
// helper this file does not name is silently unchecked.
//
// Anything a future recipe helper introduces is invisible here BY DESIGN — an
// unread position is a missed check, never a false failure, and adding the
// position is a one-line change next to its name.
//
// `extractHtmlClassCandidates` is the same question asked of an app's HTML entry
// point, which is the ONE file every demo has and which nothing read until #251:
// `examples/components-demo/index.html` carried `bg-surface-muted` / `text-text`
// / `text-text-muted` on `<body>` and `<p>`, all of the dead `bg-surface-2`
// token family, all compiling to no CSS, and no check in the repo opened the
// file.
import ts from 'typescript'

const CLASS_CALLS = new Set(['cn', 'mergeClass', 'classPart', 'classPartWithDefaults'])

/**
 * `classPart`/`classPartWithDefaults`'s FIRST argument is the element tag
 * function (`div`, `button`, …), never a recipe — reading it as one used to
 * be harmless because `pushString` silently ignored any non-literal node,
 * but general identifier resolution (#264 item F2) means an unresolved
 * identifier now FAILS LOUDLY, so the tag argument must be skipped rather
 * than treated as an unresolvable recipe reference.
 */
const TAG_FIRST_CALLS = new Set(['classPart', 'classPartWithDefaults'])

/**
 * @param {string} fileName
 * @param {string} source
 * @returns {string[]} whitespace-split class candidates, deduped.
 */
export function extractClassCandidates(fileName, source) {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  )
  /** @type {string[]} */
  const strings = []

  // Index module-level `const X = { … }` so a `createVariants({ variants })`
  // SHORTHAND can be followed to its object. Without this the whole variant map
  // of any component written that way is invisible: `button.ts` and `badge.ts`
  // both are, and every one of their variant classes was going unchecked while
  // the file still reported plenty of candidates from its base recipe — a silent
  // hole, not an obvious one.
  //
  // The identical hazard exists one level down: a recipe STRING assigned to a
  // module-level const and passed BY IDENTIFIER to `cn`/`mergeClass`/`classPart`/
  // `classPartWithDefaults` (`const TABLE_CONTAINER_CLASSES = '…'; …
  // mergeClass(TABLE_CONTAINER_CLASSES, viewportClassName)`) used to reach
  // `pushString` as a bare `Identifier`, which no branch handled — silently
  // skipped, no candidates contributed, no error. `stringConsts` (below) is the
  // string-typed sibling of `objectConsts`, resolved through the exact same
  // `asObject`-shaped lookup inside `pushString` itself, so every recipe
  // position gains it for free rather than needing its own copy of the lookup.
  /** @type {Map<string, ts.ObjectLiteralExpression>} */
  const objectConsts = new Map()
  /** @type {Map<string, ts.Expression>} */
  const stringConsts = new Map()
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.initializer === undefined) continue
      if (ts.isObjectLiteralExpression(decl.initializer)) {
        objectConsts.set(decl.name.text, decl.initializer)
      } else if (
        ts.isStringLiteral(decl.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(decl.initializer) ||
        ts.isTemplateExpression(decl.initializer)
      ) {
        stringConsts.set(decl.name.text, decl.initializer)
      }
    }
  }

  // Names bound by an IMPORT (`import { inputRecipe } from '@/ui/input'`):
  // this extractor works one file at a time and cannot follow the import to
  // resolve the recipe text here, but the imported const's OWN file gets
  // scanned separately and reports its text there — so an imported name
  // reaching a recipe position is a MISSED check in this one file at worst
  // (never a false failure), and must be skipped rather than treated as an
  // unresolvable reference.
  /** @type {Set<string>} */
  const importedNames = new Set()
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || stmt.importClause === undefined) continue
    const clause = stmt.importClause
    if (clause.name !== undefined) importedNames.add(clause.name.text)
    const bindings = clause.namedBindings
    if (bindings === undefined) continue
    if (ts.isNamespaceImport(bindings)) importedNames.add(bindings.name.text)
    else for (const el of bindings.elements) importedNames.add(el.name.text)
  }

  /** Resolve to an object literal, following a module-level const by name.
   *
   * @param {ts.Node | undefined} node
   * @returns {ts.ObjectLiteralExpression | undefined}
   */
  const asObject = (node) => {
    if (node === undefined) return undefined
    if (ts.isObjectLiteralExpression(node)) return node
    if (ts.isIdentifier(node)) return objectConsts.get(node.text)
    return undefined
  }

  /**
   * The set of names bound in every DIRECT binding pattern (a destructured
   * parameter or variable), so a genuinely dynamic value — a function
   * parameter, a destructured prop — is never mistaken for an unresolved
   * module-level recipe reference.
   *
   * @param {ts.BindingName} name
   * @returns {Set<string>}
   */
  const bindingNames = (name) => {
    /** @type {Set<string>} */
    const out = new Set()
    /** @param {ts.BindingName} n */
    const collect = (n) => {
      if (ts.isIdentifier(n)) {
        out.add(n.text)
        return
      }
      for (const el of n.elements) {
        if (ts.isBindingElement(el)) collect(el.name)
      }
    }
    collect(name)
    return out
  }

  /**
   * True when `node`'s name is bound by an ENCLOSING function parameter,
   * local variable/destructure, or catch clause — i.e. a genuinely dynamic,
   * caller-provided value (`mergeClass(recipe, className)` inside this very
   * file's own `classPart`/`classPartWithDefaults` definitions) that a
   * recipe position may legitimately carry and which is never expected to
   * resolve against a module-level const. Anything NOT locally bound is
   * expected to be a module-level recipe reference (or a typo/an import),
   * and `pushString` fails loudly rather than silently when it cannot
   * resolve one — a silently-skipped identifier is exactly how a hoisted
   * recipe (and any dead class inside it) went unchecked.
   *
   * @param {ts.Identifier} node
   * @returns {boolean}
   */
  const isLocallyBound = (node) => {
    const name = node.text
    /** @type {ts.Node | undefined} */
    let current = node.parent
    while (current !== undefined && !ts.isSourceFile(current)) {
      if (
        (ts.isFunctionDeclaration(current) ||
          ts.isFunctionExpression(current) ||
          ts.isArrowFunction(current) ||
          ts.isMethodDeclaration(current)) &&
        current.parameters.some((p) => bindingNames(p.name).has(name))
      ) {
        return true
      }
      if (
        ts.isCatchClause(current) &&
        current.variableDeclaration !== undefined &&
        bindingNames(current.variableDeclaration.name).has(name)
      ) {
        return true
      }
      if (ts.isBlock(current)) {
        for (const stmt of current.statements) {
          if (ts.isVariableStatement(stmt)) {
            for (const decl of stmt.declarationList.declarations) {
              if (bindingNames(decl.name).has(name)) return true
            }
          }
          if (
            (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) &&
            stmt.name?.text === name
          ) {
            return true
          }
        }
      }
      current = current.parent
    }
    return false
  }

  // Template literals contribute their STATIC text only. An interpolated span is
  // an arbitrary expression whose value this pass cannot know, so reading it is
  // impossible and reporting it would be a false failure; the static head/tail
  // around it is still real class text and is still checked. A recipe whose
  // whole class list is interpolated is therefore unchecked — prefer
  // `createVariants` for a conditional recipe, which IS read in full.
  /**
   * @param {ts.Node | undefined} node
   * @returns {void}
   */
  const pushString = (node) => {
    if (node === undefined) return
    if (ts.isStringLiteral(node)) strings.push(node.text)
    else if (ts.isNoSubstitutionTemplateLiteral(node)) strings.push(node.text)
    else if (ts.isTemplateExpression(node)) {
      strings.push(node.head.text)
      for (const span of node.templateSpans) strings.push(span.literal.text)
    } else if (ts.isIdentifier(node)) {
      // A genuinely dynamic value (a parameter, a destructured prop) is not
      // expected to name a recipe — skip it silently, same as before.
      if (isLocallyBound(node)) return
      // An imported recipe const is resolved and checked in ITS OWN file —
      // a missed check here at worst, never a false failure.
      if (importedNames.has(node.text)) return
      const resolved = stringConsts.get(node.text)
      if (resolved !== undefined) {
        pushString(resolved)
        return
      }
      // Anything else reaching a recipe position as a bare identifier is
      // either a typo or a recipe helper this file does not know how to
      // follow — fail loudly rather than silently reporting zero
      // candidates for it (#264 item F2; this is exactly how a hoisted
      // recipe used to go unchecked).
      throw new Error(
        `registry-classes: recipe position in ${fileName} references identifier ` +
          `"${node.text}", which is not a module-level string const this extractor ` +
          "can resolve. Assign the recipe to a plain `const NAME = '…'`/template " +
          'literal at module scope, or inline the string.',
      )
    }
  }

  /**
   * @param {ts.Node | undefined} maybe
   * @returns {void}
   */
  const readVariantsObject = (maybe) => {
    const obj = asObject(maybe)
    if (obj === undefined) return
    for (const group of obj.properties) {
      if (!ts.isPropertyAssignment(group)) continue
      if (!ts.isObjectLiteralExpression(group.initializer)) continue
      for (const leaf of group.initializer.properties) {
        if (ts.isPropertyAssignment(leaf)) pushString(leaf.initializer)
      }
    }
  }

  /**
   * @param {ts.Node | undefined} arg
   * @returns {void}
   */
  const readCreateVariants = (arg) => {
    const config = asObject(arg)
    if (config === undefined) return
    for (const prop of config.properties) {
      if (ts.isShorthandPropertyAssignment(prop)) {
        // `{ base, variants, defaultVariants }` — the shorthand names the const.
        if (prop.name.text === 'variants') readVariantsObject(prop.name)
        continue
      }
      if (!ts.isPropertyAssignment(prop)) continue
      const key =
        ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null
      if (key === 'base') pushString(prop.initializer)
      else if (key === 'variants') readVariantsObject(prop.initializer)
      else if (key === 'compoundVariants' && ts.isArrayLiteralExpression(prop.initializer)) {
        for (const entry of prop.initializer.elements) {
          if (!ts.isObjectLiteralExpression(entry)) continue
          for (const p of entry.properties) {
            if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue
            if (p.name.text === 'class') pushString(p.initializer)
          }
        }
      }
    }
  }

  /**
   * @param {ts.Node} node
   * @returns {void}
   */
  const walk = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text
      if (CLASS_CALLS.has(callee)) {
        const args = TAG_FIRST_CALLS.has(callee) ? node.arguments.slice(1) : node.arguments
        args.forEach(pushString)
      } else if (callee === 'createVariants' && node.arguments[0] !== undefined) {
        readCreateVariants(node.arguments[0])
      } else if (callee === 'createVariantsPart' && node.arguments[1] !== undefined) {
        // Same config object, one argument further along — the tag comes first.
        readCreateVariants(node.arguments[1])
      }
    }
    // `div({ class: 'flex gap-2' }, …)` — the app-code spelling. Only a literal
    // initializer is read; a `.map(…)` binding is an expression this pass cannot
    // evaluate, and guessing at it would fail for the wrong reason.
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === 'class'
    ) {
      pushString(node.initializer)
    }
    // A record of class strings (`calendarDayModifiers`) — every string VALUE is
    // a recipe. Keyed on the `Modifiers`/`Classes` suffix so an arbitrary object
    // of strings is not mistaken for one.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /(?:Modifiers|Classes)$/.test(node.name.text)
    ) {
      const obj = asObject(
        node.initializer !== undefined && ts.isAsExpression(node.initializer)
          ? node.initializer.expression
          : node.initializer,
      )
      if (obj !== undefined) {
        for (const prop of obj.properties)
          if (ts.isPropertyAssignment(prop)) pushString(prop.initializer)
      }
    }
    // A recipe assigned to a `const` and forwarded through a BESPOKE local
    // helper (never one of `CLASS_CALLS`) can reach no call argument this
    // walk recognizes at all — `pagination.ts`'s `paginationPreviousRecipe`/
    // `paginationNextRecipe` are passed to its own `paginationLink(…)`, whose
    // parameter then flows into `cn(…)` as a locally-bound identifier
    // (`extra`), invisible to a caller-position analysis. `stringConsts`
    // resolution above already covers every recipe reachable through a
    // RECOGNIZED position by name, so this is now purely the fallback for
    // that unreachable-by-construction shape, gated by naming convention.
    // The check used to be `.endsWith('Recipe')` — case-sensitive, so a
    // const named in SCREAMING_SNAKE_CASE (`TABLE_CONTAINER_CLASSES`) never
    // matched it (#264 item F2's own M1 mutation exploited exactly this).
    // General `stringConsts` resolution now covers that shape by NAME
    // reference rather than by suffix, so this stays scoped to `Recipe`
    // case-INSENSITIVELY rather than growing a second naming convention.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /recipe$/i.test(node.name.text)
    ) {
      pushString(node.initializer)
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)

  /** @type {Set<string>} */
  const out = new Set()
  for (const s of strings) for (const t of s.split(/\s+/)) if (t !== '') out.add(t)
  return [...out].sort()
}

/**
 * @param {string} fileName
 * @returns {ts.ScriptKind}
 */
function scriptKind(fileName) {
  return fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
}

/**
 * The class candidates an HTML entry point emits.
 *
 * Deliberate in the same way `extractClassCandidates` is: the ONLY position read
 * is a QUOTED `class` attribute value on a tag. HTML has no equivalent of the
 * `'button'`/`'horizontal'` false-positive problem for that position — a
 * `class="…"` attribute is unambiguously a class list — but two regions of an
 * HTML file are text that merely LOOKS like markup, and reading them would fail
 * a build for the wrong reason:
 *
 *   • a COMMENT. `components-demo/index.html` carries one naming the dead tokens
 *     this extractor exists to catch; a comment showing example markup would
 *     otherwise contribute every class in it.
 *   • the body of a `<script>` or `<style>`. A string `class="x"` inside inline
 *     JS is not markup.
 *
 * Both are blanked (length-preserving is unnecessary — nothing here reports
 * offsets) before the attribute scan.
 *
 * UNQUOTED values (`class=foo`) are deliberately NOT read, and neither is an
 * uppercase `CLASS=` (also legal HTML). Both are absent from every entry point
 * in this repo, and the pattern that would match an unquoted value also matches
 * enough non-attribute text to be a false-failure risk.
 *
 * "Unread positions cost a missed check, not a broken build" is the policy, and
 * it is TRUE OF THE POSITIONS ABOVE but is not a total guarantee about this
 * function — state it exactly, because a claim of totality is the thing a later
 * reader would rely on. Two pathological inputs, neither present in this repo,
 * DO contribute classes that are not markup: a class list nested inside a
 * single-quoted attribute value (`<div title='x class="nested"'>`), and text
 * following an UNCLOSED `<script>`, whose body the strip cannot delimit. Both
 * would be a false failure rather than a missed check.
 *
 * @param {string} _fileName
 * @param {string} source
 * @returns {string[]} whitespace-split class candidates, deduped and sorted.
 */
export function extractHtmlClassCandidates(_fileName, source) {
  const markup = source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')

  /** @type {Set<string>} */
  const out = new Set()
  for (const m of markup.matchAll(/\sclass\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    const value = m[2] ?? m[3] ?? ''
    for (const t of value.split(/\s+/)) if (t !== '') out.add(t)
  }
  return [...out].sort()
}

/**
 * True when a module only RE-EXPORTS other modules' components and declares no
 * recipes of its own (`context-menu` is the dropdown's recipes under different
 * names).
 *
 * The vacuity guard asserts every `ui/` file yields at least one class
 * candidate, which is what caught three components whose recipes the extractor
 * could not see. A pure re-export legitimately yields none — but "yields none"
 * must be PROVEN, not assumed from an empty result, or the guard silently stops
 * guarding the moment a real recipe becomes unreadable. So this checks the
 * shape: every statement is an import or an `export … from`, and no recipe
 * builder is named anywhere in the file.
 *
 * @param {string} fileName
 * @param {string} source
 * @returns {boolean}
 */
export function isPureReExport(fileName, source) {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  )
  let reExports = 0
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) continue
    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier !== undefined) {
      reExports++
      continue
    }
    return false
  }
  if (reExports === 0) return false
  // A recipe builder mentioned anywhere means the file DOES declare recipes and
  // the extractor simply failed to read them — exactly what the guard is for.
  const named = new Set([...CLASS_CALLS, 'createVariants', 'createVariantsPart'])
  let buildsRecipes = false
  /**
   * @param {ts.Node} n
   * @returns {void}
   */
  const walk = (n) => {
    if (ts.isIdentifier(n) && named.has(n.text)) buildsRecipes = true
    ts.forEachChild(n, walk)
  }
  walk(sf)
  return !buildsRecipes
}
