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
// `classPart` is in that list because it USED to be a per-file local factory,
// and three components' recipes were invisible here until it became one shared
// named seam. That is the failure mode to watch for: a recipe reached through a
// helper this file does not name is silently unchecked.
//
// Anything a future recipe helper introduces is invisible here BY DESIGN — an
// unread position is a missed check, never a false failure, and adding the
// position is a one-line change next to its name.
import ts from 'typescript'

const CLASS_CALLS = new Set(['cn', 'mergeClass', 'classPart'])

/** @returns {string[]} whitespace-split class candidates, deduped. */
export function extractClassCandidates(fileName, source) {
  const sf = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  )
  const strings = []

  // Index module-level `const X = { … }` so a `createVariants({ variants })`
  // SHORTHAND can be followed to its object. Without this the whole variant map
  // of any component written that way is invisible: `button.ts` and `badge.ts`
  // both are, and every one of their variant classes was going unchecked while
  // the file still reported plenty of candidates from its base recipe — a silent
  // hole, not an obvious one.
  const objectConsts = new Map()
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const decl of stmt.declarationList.declarations) {
      if (
        ts.isIdentifier(decl.name) &&
        decl.initializer !== undefined &&
        ts.isObjectLiteralExpression(decl.initializer)
      ) {
        objectConsts.set(decl.name.text, decl.initializer)
      }
    }
  }

  /** Resolve to an object literal, following a module-level const by name. */
  const asObject = (node) => {
    if (node === undefined) return undefined
    if (ts.isObjectLiteralExpression(node)) return node
    if (ts.isIdentifier(node)) return objectConsts.get(node.text)
    return undefined
  }

  // Template literals contribute their STATIC text only. An interpolated span is
  // an arbitrary expression whose value this pass cannot know, so reading it is
  // impossible and reporting it would be a false failure; the static head/tail
  // around it is still real class text and is still checked. A recipe whose
  // whole class list is interpolated is therefore unchecked — prefer
  // `createVariants` for a conditional recipe, which IS read in full.
  const pushString = (node) => {
    if (node === undefined) return
    if (ts.isStringLiteral(node)) strings.push(node.text)
    else if (ts.isNoSubstitutionTemplateLiteral(node)) strings.push(node.text)
    else if (ts.isTemplateExpression(node)) {
      strings.push(node.head.text)
      for (const span of node.templateSpans) strings.push(span.literal.text)
    }
  }

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
            const n = ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) ? p.name.text : null
            if (n === 'class') pushString(p.initializer)
          }
        }
      }
    }
  }

  const walk = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text
      if (CLASS_CALLS.has(callee)) node.arguments.forEach(pushString)
      else if (callee === 'createVariants' && node.arguments[0] !== undefined) {
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
    // A recipe assigned to a `const` and passed by name (`inputRecipe`) never
    // reaches a call argument, so read exported string consts named *Recipe too.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text.endsWith('Recipe')
    ) {
      pushString(node.initializer)
    }
    ts.forEachChild(node, walk)
  }
  walk(sf)

  const out = new Set()
  for (const s of strings) for (const t of s.split(/\s+/)) if (t !== '') out.add(t)
  return [...out].sort()
}

function scriptKind(fileName) {
  return fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
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
  const walk = (n) => {
    if (ts.isIdentifier(n) && named.has(n.text)) buildsRecipes = true
    ts.forEachChild(n, walk)
  }
  walk(sf)
  return !buildsRecipes
}
