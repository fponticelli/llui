import ts from 'typescript'
import { asObjectLiteral, indexObjectConsts } from '../../../../scripts/lib/registry-classes.mjs'

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

/** One parse, reused by every check below that needs it (#264 review LOW —
 * `hasDensityOrSizeProperty` used to parse the SAME source TWICE, once per
 * sub-check it delegates to, on what `navigation-data-contract.test.ts`
 * calls once per `checkedSources` entry across every density-N/A product). */
const parse = (source: string, fileName: string): ts.SourceFile =>
  ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

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
function optionsInterfacePropertyNamesFromSf(sf: ts.SourceFile): string[] {
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

export function optionsInterfacePropertyNames(source: string, fileName = 'source.ts'): string[] {
  return optionsInterfacePropertyNamesFromSf(parse(source, fileName))
}

/**
 * Resolve a `{ variants: ... }` (or `{ variants }` SHORTHAND) property to the
 * object literal it actually names, following a module-level const exactly
 * like `scripts/lib/registry-classes.mjs`'s own Tailwind extractor does
 * (#264 item F3, shared rather than reimplemented) — `button.ts`/`badge.ts`
 * both declare their `variants` map as a separate const and spread it in by
 * shorthand, and the whole axis map (`size` included) was invisible to this
 * density/size audit for the identical reason it used to be invisible to the
 * class extractor. Shared by both `createVariantsAxisNames` and
 * `createVariantsAxisValueNames` (#264 review LOW 5 — one resolution, not
 * two copies that could drift).
 */
function resolveVariantsProperty(
  prop: ts.ObjectLiteralElementLike,
  objectConsts: Map<string, ts.ObjectLiteralExpression>,
): ts.ObjectLiteralExpression | undefined {
  if (ts.isPropertyAssignment(prop) && propName(prop.name) === 'variants') {
    return asObjectLiteral(prop.initializer, objectConsts)
  }
  if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === 'variants') {
    return asObjectLiteral(prop.name, objectConsts)
  }
  return undefined
}

/**
 * Every `variants` object literal reachable from a `createVariants(...)` /
 * `createVariantsPart(...)` call in `sf`, resolving both the inline and the
 * module-const-by-shorthand spelling.
 */
function findVariantsObjects(
  sf: ts.SourceFile,
  objectConsts: Map<string, ts.ObjectLiteralExpression>,
): ts.ObjectLiteralExpression[] {
  const found: ts.ObjectLiteralExpression[] = []
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
          const variantsObj = resolveVariantsProperty(prop, objectConsts)
          if (variantsObj !== undefined) found.push(variantsObj)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/**
 * `createVariants({ variants: { <axis>: {...} } })`'s AXIS names (the top
 * level keys of the `variants` object) — this is the registry recipe
 * equivalent of a `ConnectOptions` field, and the shape a `size`/`density`
 * variant axis actually takes (`registry/llui/ui/badge.ts`'s `size` axis,
 * added via the same `variants`-shorthand-over-a-module-const spelling
 * `button.ts` uses, is the in-repo example — NOT `avatar.ts`, whose `size`
 * scale is a plain string recipe with `data-[size=…]` conditionals, never a
 * `createVariants` call at all, #264 review LOW).
 */
function createVariantsAxisNamesFromSf(sf: ts.SourceFile): string[] {
  const objectConsts = indexObjectConsts(sf)
  const names: string[] = []
  for (const variantsObj of findVariantsObjects(sf, objectConsts)) {
    for (const axis of variantsObj.properties) {
      const name =
        ts.isPropertyAssignment(axis) || ts.isShorthandPropertyAssignment(axis)
          ? propName(axis.name)
          : undefined
      if (name !== undefined) names.push(name)
    }
  }
  return names
}

export function createVariantsAxisNames(source: string, fileName = 'source.ts'): string[] {
  return createVariantsAxisNamesFromSf(parse(source, fileName))
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
  const sf = parse(source, fileName)
  const objectConsts = indexObjectConsts(sf)
  const names: string[] = []
  for (const variantsObj of findVariantsObjects(sf, objectConsts)) {
    for (const axis of variantsObj.properties) {
      const axisObj =
        (ts.isPropertyAssignment(axis) && propName(axis.name) === axisName) ||
        (ts.isShorthandPropertyAssignment(axis) && axis.name.text === axisName)
          ? asObjectLiteral(
              ts.isPropertyAssignment(axis) ? axis.initializer : axis.name,
              objectConsts,
            )
          : undefined
      if (axisObj === undefined) continue
      for (const value of axisObj.properties) {
        const name =
          ts.isPropertyAssignment(value) || ts.isShorthandPropertyAssignment(value)
            ? propName(value.name)
            : undefined
        if (name !== undefined) names.push(name)
      }
    }
  }
  return names
}

/**
 * The string-literal union members of a top-level `export type <name> = ...`
 * alias (e.g. `type AvatarDensity = 'comfortable' | 'compact'` ->
 * `['comfortable', 'compact']`) — the MACHINE-level ground truth for how many
 * real density values a component's own `connect()` option can even
 * construct, as opposed to a registry recipe's separate `size`/`createVariants`
 * scale (#264 review item 6: citing "the baseline stylesheet has no
 * lg-equivalent override" as the reason a density is capped at two is
 * circular — it points at what a STYLESHEET happens to contain rather than
 * at the type that actually settles the question). Returns an empty array
 * (never throws) if no alias with that name exists, or its type is not a
 * plain string-literal union.
 */
export function typeAliasUnionLiteralMembers(
  source: string,
  aliasName: string,
  fileName = 'source.ts',
): string[] {
  const sf = parse(source, fileName)
  const members: string[] = []
  for (const stmt of sf.statements) {
    if (!ts.isTypeAliasDeclaration(stmt) || stmt.name.text !== aliasName) continue
    if (!ts.isUnionTypeNode(stmt.type)) continue
    for (const member of stmt.type.types) {
      if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) {
        members.push(member.literal.text)
      }
    }
  }
  return members
}

/** True if the file declares ANY interface property or `createVariants` axis
 * named exactly `density` or `size` (case-insensitive on the whole name,
 * never a substring match). Parses `source` ONCE (#264 review LOW) and
 * shares that single `SourceFile` between both sub-checks, rather than each
 * of `optionsInterfacePropertyNames`/`createVariantsAxisNames` re-parsing it
 * independently — this is the hot path `navigation-data-contract.test.ts`
 * calls once per `checkedSources` entry across every density-N/A product. */
export function hasDensityOrSizeProperty(source: string, fileName?: string): boolean {
  const sf = parse(source, fileName ?? 'source.ts')
  const names = [...optionsInterfacePropertyNamesFromSf(sf), ...createVariantsAxisNamesFromSf(sf)]
  return names.some((name) => DENSITY_LIKE_NAMES.has(name.toLowerCase()))
}

/**
 * Neutralize CSS structural characters (`{`, `}`, `,`) that appear inside a
 * `/* ... *\/` comment or a quoted string, WITHOUT disturbing anything else —
 * critically, an attribute-selector's own quoted value
 * (`[data-scope='avatar']`) must survive byte-for-byte, quotes included, so
 * `scopeAttr`'s regex can still match it. #264 review item 5: a plain
 * `css.split('{')` scan reads THROUGH a comment (`/* an avatar's
 * [data-density] rule was removed *\/`) and through a declaration-value
 * string (`content: "{ not a rule }"`) as if they were live selector/brace
 * syntax — a false-positive risk for `cssScopeHasDensityOrSizeSelector`'s "no
 * density selector for this scope" direction, and the same class of gap
 * CLAUDE.md documents for `cssRules`-walking tools generally. A comment's
 * entire span is blanked (its content never needs to survive for the regex);
 * inside a quoted string only the three structural characters are replaced
 * with a space, one-for-one, so every other byte — including the quotes and
 * the scope/attribute text between them — is untouched. Quotes are tracked
 * with a single "current quote char or none" state rather than nested — CSS
 * strings never nest.
 */
function neutralizeStructuralCharsInCommentsAndStrings(css: string): string {
  const chars = [...css]
  let quote: '"' | "'" | null = null
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]!
    if (quote !== null) {
      if (ch === '\\') {
        i += 1 // an escaped char (including an escaped quote) is never the close
        continue
      }
      if (ch === quote) {
        quote = null
        continue
      }
      if (ch === '{' || ch === '}' || ch === ',') chars[i] = ' '
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === '/' && chars[i + 1] === '*') {
      let j = i
      while (j < chars.length && !(chars[j] === '*' && chars[j + 1] === '/')) {
        if (chars[j] !== '\n') chars[j] = ' '
        j += 1
      }
      if (j < chars.length) {
        chars[j] = ' ' // '*'
        chars[j + 1] = ' ' // '/'
      }
      i = j + 1
      continue
    }
  }
  return chars.join('')
}

/**
 * Scans CSS rule selectors for one containing BOTH this product's
 * `[data-scope='<scope>']` attribute selector and a `[data-density...]` or
 * `[data-size...]` attribute selector — the shape every real density rule in
 * this package's baseline stylesheets is written in (see
 * `data-display.css`'s `[data-scope='avatar'][data-part='root'][data-density='compact']`).
 * A selector is a rule's text up to its `{`; multi-selector rules are split
 * on top-level commas (none of this family's selectors nest a comma inside
 * brackets/parens, so a plain split is exact here). Comments and quoted
 * strings are blanked out FIRST so a brace/comma inside either is inert.
 */
export function cssScopeHasDensityOrSizeSelector(css: string, scope: string): boolean {
  const scopeAttr = new RegExp(`\\[data-scope=['"]${scope}['"]\\]`)
  const densityOrSizeAttr = /\[data-(?:density|size)[=\]]/
  const cleaned = neutralizeStructuralCharsInCommentsAndStrings(css)
  const rules = cleaned.split('{').slice(0, -1)
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

/**
 * True if ANY baseline rule carries this product's `[data-scope='<scope>']`
 * attribute selector at all, regardless of what else the rule selects on.
 *
 * `cssScopeHasDensityOrSizeSelector` returning `false` is ambiguous on its
 * own (#264 item F3): it means EITHER "this scope has baseline rules and
 * genuinely none of them are density/size-scoped" (the case the density-N/A
 * rationale check exists to prove) OR "this scope has NO baseline rules at
 * all", which proves nothing about density/size and would let a product
 * that never shipped ANY baseline CSS pass the absence check vacuously. A
 * caller asserting the density-N/A rationale should check THIS first and
 * require an explicit, separate reason (e.g. `presentation.baseline.mode ===
 * 'styleless'`) for a product with no owned scope at all, rather than
 * reading silence as "checked and clean".
 */
export function cssHasScopeSelector(css: string, scope: string): boolean {
  const scopeAttr = new RegExp(`\\[data-scope=['"]${scope}['"]\\]`)
  const cleaned = neutralizeStructuralCharsInCommentsAndStrings(css)
  const rules = cleaned.split('{').slice(0, -1)
  for (const chunk of rules) {
    const selectorText = chunk.split('}').pop() ?? chunk
    for (const selector of selectorText.split(',')) {
      if (scopeAttr.test(selector)) return true
    }
  }
  return false
}
