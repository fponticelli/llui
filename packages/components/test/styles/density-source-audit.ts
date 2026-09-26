import ts from 'typescript'

/**
 * #264 review item 4: the density-N/A rationale's per-product `checkedSources`
 * guard used to be `expect(source).not.toMatch(/density/i)` — a naive
 * whole-file substring/regex scan. That is fooled in BOTH directions: a
 * comment or unrelated identifier merely CONTAINING "density" (e.g. a prose
 * note explaining why a field is NOT a density option) would false-positive
 * the guard, and a real density/size OPTION spelled without the literal
 * substring "density" (a `size` field, a registry `createVariants({ size:
 * {...} })` key) would sail through undetected. This module reads the real
 * STRUCTURE instead: TypeScript interface/property-signature names for a
 * `.ts` source (`densityLikePropertyNames`), and CSS attribute-selector text
 * scoped to one product's `[data-scope]` (`cssScopeHasDensityOrSizeSelector`).
 */

const DENSITY_LIKE_NAMES = new Set(['density', 'size'])

const propName = (name: ts.PropertyName | undefined): string | undefined =>
  name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteralLike(name))
    ? name.text
    : undefined

/** `connect()`'s options interface (always named `ConnectOptions` in this
 * package's components) or an `init()` options interface (named `*Init`,
 * e.g. `AccordionInit`) — the two shapes this codebase spells a public
 * "configure this instance" contract with. */
const isOptionsInterfaceName = (name: string): boolean =>
  name === 'ConnectOptions' || name.endsWith('Init')

/**
 * Property-signature names declared on the file's OWN `ConnectOptions`/
 * `*Init` interface(s) — deliberately not every interface in the file, and
 * not a plain object-literal property assignment. Scanning every interface
 * false-positived `meter.ts`'s internal `MeterBandGeometry.size` (a band's
 * WIDTH on the track, an unrelated geometry concept spelled with the same
 * word); scanning object literals false-positived `carousel.ts`'s
 * `buttonVariants({ variant: 'outline', size: 'icon' })` (button's OWN fixed
 * icon-size variant, selected by carousel's recipe, not carousel's own
 * geometry). A name is matched EXACTLY (`size`, `density`) via a real AST
 * walk, never as a substring of something else (`fontSize`,
 * `densityRationale`).
 */
export function optionsInterfacePropertyNames(source: string, fileName = 'source.ts'): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const names: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isInterfaceDeclaration(node) && isOptionsInterfaceName(node.name.text)) {
      for (const member of node.members) {
        if (ts.isPropertySignature(member)) {
          const name = propName(member.name)
          if (name !== undefined) names.push(name)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return names
}

/**
 * `createVariants({ variants: { <axis>: {...} } })`'s AXIS names (the top
 * level keys of the `variants` object) — this is the registry recipe
 * equivalent of a `ConnectOptions` field, and the shape a `size`/`density`
 * variant axis actually takes (`registry/llui/ui/avatar.ts`'s `data-size`
 * driven by exactly such an axis on avatar's OWN recipe, as opposed to a
 * borrowed one like the carousel case above).
 */
export function createVariantsAxisNames(source: string, fileName = 'source.ts'): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const names: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 'createVariants' || node.expression.text === 'createVariantsPart')
    ) {
      // The options object may be the first argument (`createVariants({...})`)
      // or a LATER one (`createVariantsPart(tag, {...})`) — find whichever
      // argument is an object literal carrying its own `variants` property,
      // rather than assuming a fixed position.
      for (const arg of node.arguments) {
        if (!ts.isObjectLiteralExpression(arg)) continue
        for (const prop of arg.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            propName(prop.name) === 'variants' &&
            ts.isObjectLiteralExpression(prop.initializer)
          ) {
            for (const axis of prop.initializer.properties) {
              const name =
                ts.isPropertyAssignment(axis) || ts.isShorthandPropertyAssignment(axis)
                  ? propName(axis.name)
                  : undefined
              if (name !== undefined) names.push(name)
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return names
}

/** The option KEYS of one named `createVariants` axis (e.g. `size`'s
 * `{ default, sm, lg }` -> `['default', 'sm', 'lg']`) — used to assert how
 * many real rungs a recipe's variant scale actually has, rather than
 * assuming it from a component's UNRELATED `comfortable`/`compact` axis. */
export function createVariantsAxisValueNames(
  source: string,
  axisName: string,
  fileName = 'source.ts',
): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const names: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === 'createVariants' || node.expression.text === 'createVariantsPart')
    ) {
      for (const arg of node.arguments) {
        if (!ts.isObjectLiteralExpression(arg)) continue
        for (const prop of arg.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            propName(prop.name) === 'variants' &&
            ts.isObjectLiteralExpression(prop.initializer)
          ) {
            for (const axis of prop.initializer.properties) {
              if (
                ts.isPropertyAssignment(axis) &&
                propName(axis.name) === axisName &&
                ts.isObjectLiteralExpression(axis.initializer)
              ) {
                for (const value of axis.initializer.properties) {
                  const name =
                    ts.isPropertyAssignment(value) || ts.isShorthandPropertyAssignment(value)
                      ? propName(value.name)
                      : undefined
                  if (name !== undefined) names.push(name)
                }
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return names
}

/** True if the file declares ANY interface property or `createVariants` axis
 * named exactly `density` or `size` (case-insensitive on the whole name,
 * never a substring match). */
export function hasDensityOrSizeProperty(source: string, fileName?: string): boolean {
  const names = [
    ...optionsInterfacePropertyNames(source, fileName),
    ...createVariantsAxisNames(source, fileName),
  ]
  return names.some((name) => DENSITY_LIKE_NAMES.has(name.toLowerCase()))
}

/**
 * Scans CSS rule selectors for one containing BOTH this product's
 * `[data-scope='<scope>']` attribute selector and a `[data-density...]` or
 * `[data-size...]` attribute selector — the shape every real density rule in
 * this package's baseline stylesheets is written in (see
 * `data-display.css`'s `[data-scope='avatar'][data-part='root'][data-density='compact']`).
 * A selector is a rule's text up to its `{`; multi-selector rules are split
 * on top-level commas (none of this family's selectors nest a comma inside
 * brackets/parens, so a plain split is exact here).
 */
export function cssScopeHasDensityOrSizeSelector(css: string, scope: string): boolean {
  const scopeAttr = new RegExp(`\\[data-scope=['"]${scope}['"]\\]`)
  const densityOrSizeAttr = /\[data-(?:density|size)[=\]]/
  const rules = css.split('{').slice(0, -1)
  for (const chunk of rules) {
    // Only the selector text since the PREVIOUS rule's closing brace is this
    // rule's own selector — a naive split on `{` alone would also capture
    // trailing declaration text from the prior block.
    const selectorText = chunk.split('}').pop() ?? chunk
    for (const selector of selectorText.split(',')) {
      if (scopeAttr.test(selector) && densityOrSizeAttr.test(selector)) return true
    }
  }
  return false
}
