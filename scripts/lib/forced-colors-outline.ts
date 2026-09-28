// The forced-colors `outline-none` trap, found statically across the registry.
//
// Tailwind v4's `outline-none` sets `--tw-outline-style: none` (and
// `outline-style: none`), while a WIDTH utility — `outline-2`, `outline-1`,
// `outline-[3px]` — only sets `outline-width` and READS the style back through
// `outline-style: var(--tw-outline-style)`. So on an element that can carry
// `outline-none`, `forced-colors:outline-2 forced-colors:outline-[Highlight]`
// computes `outline-style: none` under forced colors: the outline the author
// added for high-contrast users never paints. The fix is an outline STYLE
// under the same condition (`forced-colors:outline-solid`, or the same variant
// chain as the width), which re-sets the variable after `outline-none` (#266,
// docs/agents/styling.md).
//
// The unit of analysis is the ELEMENT'S class list, not the file: the trap
// needs `outline-none` and the width on the SAME element, and the most common
// way `outline-none` gets there is COMPOSITION — `buttonVariants`'s base
// carries it, so `classPart(button, `${buttonVariants(…)} …`)`,
// `createVariantsPart(button, …)`, `Button({ class: '…' })` and `cn(
// buttonVariants(…), …)` all put it on an element whose own recipe never spells
// it. A file-level class SET would be wrong in both directions (a width on one
// part and `outline-none` on another is no trap; an `outline-solid` on a third
// part would hide a real one), so every class-application SITE is evaluated
// into the alternative class lists it can produce, following:
//
//   - `cn` / `mergeClass` / `classPart` / `classPartWithDefaults` arguments
//     (the extractor's positions, `scripts/lib/registry-classes.mjs`),
//   - `createVariants` / `createVariantsPart` configs, one alternative per
//     variant COMBINATION (compound variants applied where they match),
//   - a CALL of a variants function (local or imported), with the axes its
//     argument fixes by literal and every value of an axis it does not,
//   - a `class:` property passed to an element factory the registry exports
//     (`Button`, a `classPart`, a `createVariantsPart`), merged with that
//     factory's own root recipe,
//   - module string consts, template literals (static text plus any
//     variants-call span), `+` concatenation, and `*Recipe` consts that reach
//     a class only through a bespoke helper (the extractor's own fallback).
//
// A class under `&&` / `||` / `??` or a clsx object key is CONDITIONAL: it can
// TRIGGER the trap (it may apply) but cannot MITIGATE it (it may not). A
// ternary contributes both branches as separate alternatives. Anything this
// evaluator cannot read contributes nothing — which is fail-OPEN for the
// trigger, so `forced-colors-outline.test.ts` cross-checks every file's
// outline classes against the extractor's candidate set: a class the
// extractor sees and no evaluated site produced fails the test instead of
// going unjudged.
//
// What each utility DOES is not hand-listed here: the test compiles every
// outline utility in the corpus with the real Tailwind build and classifies it
// from the emitted declarations (`classifyOutlineUtility`).
import path from 'node:path'
import ts from 'typescript'
import { asObjectLiteral, indexObjectConsts, scopeIntroduces } from './registry-classes.mjs'

/** One class list an element can end up with. `groups` are CONDITIONAL
 * fragments: each applies as a unit or not at all. */
export interface ClassAlternative {
  readonly always: ReadonlySet<string>
  readonly groups: readonly ReadonlySet<string>[]
}

type Alternatives = readonly ClassAlternative[]

const EMPTY: ClassAlternative = { always: new Set(), groups: [] }

/** More alternatives than this at one site means the evaluator is enumerating
 * something it should not; fail loudly rather than grind. */
const MAX_ALTERNATIVES = 20_000

function words(text: string): Set<string> {
  return new Set(text.split(/\s+/).filter((w) => w !== ''))
}

function merge(a: ClassAlternative, b: ClassAlternative): ClassAlternative {
  return { always: new Set([...a.always, ...b.always]), groups: [...a.groups, ...b.groups] }
}

function altKey(alt: ClassAlternative): string {
  return [
    [...alt.always].sort().join(' '),
    ...alt.groups.map((g) => [...g].sort().join(' ')).sort(),
  ].join('|')
}

function dedupe(alts: Alternatives): Alternatives {
  const seen = new Map<string, ClassAlternative>()
  for (const alt of alts) seen.set(altKey(alt), alt)
  return [...seen.values()]
}

function product(parts: readonly Alternatives[]): Alternatives {
  let out: Alternatives = [EMPTY]
  for (const part of parts) {
    if (part.length === 0) continue
    const next: ClassAlternative[] = []
    for (const left of out) for (const right of part) next.push(merge(left, right))
    out = dedupe(next)
    if (out.length > MAX_ALTERNATIVES) {
      throw new Error(`forced-colors-outline: more than ${MAX_ALTERNATIVES} alternatives`)
    }
  }
  return out
}

/** Every class of `alts` demoted to a single conditional group. */
function conditional(alts: Alternatives): Alternatives {
  return alts.map((alt) => ({
    always: new Set<string>(),
    groups: [...(alt.always.size > 0 ? [alt.always] : []), ...alt.groups],
  }))
}

interface VariantsDef {
  readonly file: FileContext
  readonly base: ts.Expression | undefined
  readonly axes: readonly { name: string; values: Map<string, ts.Expression> }[]
  readonly defaults: ReadonlyMap<string, string>
  readonly compounds: readonly { when: ReadonlyMap<string, string>; cls: ts.Expression }[]
}

type Entity =
  | { kind: 'variants'; def: VariantsDef }
  | { kind: 'element'; root: (props: ts.ObjectLiteralExpression | undefined) => Alternatives }
  | { kind: 'string'; file: FileContext; init: ts.Expression }

interface FileContext {
  readonly file: string
  readonly sf: ts.SourceFile
  readonly consts: ReadonlyMap<string, ts.Expression>
  readonly functions: ReadonlyMap<string, ts.FunctionDeclaration>
  readonly imports: ReadonlyMap<string, { from: string; name: string }>
  readonly objectConsts: Map<string, ts.ObjectLiteralExpression>
}

/** A finding: a forced-colors outline WIDTH on an element that can carry a
 * style-clearing class, with no forced-colors outline STYLE beside it. */
export interface OutlineTrap {
  /** Repo-relative file of the SITE (where the class list is assembled). */
  readonly file: string
  readonly line: number
  /** The width class that computes `outline-style: none`. */
  readonly width: string
  /** A style-clearing class on the same element (e.g. `outline-none`). */
  readonly clearedBy: string
}

/** How a Tailwind utility (variants stripped) touches `--tw-outline-style`,
 * the variable every width utility reads its style from. */
export interface OutlineUtilityClass {
  /** Sets `--tw-outline-style: none` — `outline-none`, `outline-hidden`. */
  readonly clears: boolean
  /** Sets an outline width and reads the style from `--tw-outline-style`. */
  readonly width: boolean
  /** Sets `--tw-outline-style` to a real style — `outline-solid`, `-dashed`, … */
  readonly sets: boolean
}

/**
 * Classify ONE utility from the CSS the real Tailwind build emitted for it
 * (`css` is that utility's rule, nested blocks included). Only the VARIABLE
 * counts on the setting side: a width utility reads `var(--tw-outline-style)`,
 * so a class that writes `outline-style` or the `outline` shorthand directly
 * (`[outline:2px_solid_Highlight]`, `outline-hidden`'s forced-colors block)
 * leaves the variable — and therefore any width beside it — untouched.
 */
export function classifyOutlineUtility(css: string): OutlineUtilityClass {
  let clears = false
  let width = false
  let sets = false
  for (const [, prop, raw] of css.matchAll(/(--tw-outline-style|outline-style)\s*:\s*([^;}]+)/g)) {
    const value = (raw ?? '').trim()
    if (prop === '--tw-outline-style') {
      if (value === 'none') clears = true
      else sets = true
    } else if (value === 'var(--tw-outline-style)') width = true
  }
  return { clears, width, sets }
}

/**
 * Split a class into its variant chain and utility at `:` outside brackets
 * and parentheses. Tailwind's leading/trailing `!` (important) is dropped from
 * the utility.
 */
export function splitVariants(cls: string): { variants: string[]; utility: string } {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of cls) {
    if (ch === '[' || ch === '(') depth++
    else if (ch === ']' || ch === ')') depth--
    if (ch === ':' && depth === 0) {
      parts.push(current)
      current = ''
    } else current += ch
  }
  const utility = current.replace(/^!|!$/g, '')
  return { variants: parts, utility }
}

/** True when `cls` names an outline utility at all (the only ones classified). */
export const isOutlineClass = (cls: string): boolean =>
  /(^|-)outline(-|$)|\[outline[:-]/.test(splitVariants(cls).utility)

/**
 * The traps in ONE class list. `classify` answers for a bare utility.
 *
 * A width `w` under variants `V` (with `forced-colors` in `V`) is a trap when
 * the list can carry a CLEARING class and no STYLE class `s` that is
 * guaranteed to apply whenever `w` does: `s` must be unconditional (or in
 * `w`'s own conditional group), carry `forced-colors` (so it sorts after an
 * unprefixed `outline-none`), and have a variant chain that is a SUBSET of
 * `V` (so it is active in every state `w` is).
 */
export function trapsIn(
  alt: ClassAlternative,
  classify: (utility: string) => OutlineUtilityClass,
): { width: string; clearedBy: string }[] {
  const all = [...alt.always, ...alt.groups.flatMap((g) => [...g])]
  const clearing = all.find((c) => classify(splitVariants(c).utility).clears)
  if (clearing === undefined) return []
  const out: { width: string; clearedBy: string }[] = []
  const check = (cls: string, alongside: ReadonlySet<string>): void => {
    const { variants, utility } = splitVariants(cls)
    if (!variants.includes('forced-colors') || !classify(utility).width) return
    const mitigated = [...alongside].some((candidate) => {
      const split = splitVariants(candidate)
      return (
        classify(split.utility).sets &&
        split.variants.includes('forced-colors') &&
        split.variants.every((v) => variants.includes(v))
      )
    })
    if (!mitigated) out.push({ width: cls, clearedBy: clearing })
  }
  for (const cls of alt.always) check(cls, alt.always)
  for (const group of alt.groups) {
    const alongside = new Set([...alt.always, ...group])
    for (const cls of group) check(cls, alongside)
  }
  return out
}

const CLASS_CALLS = new Set(['cn', 'mergeClass'])
const TAG_FIRST_CALLS = new Set(['classPart', 'classPartWithDefaults'])

function propName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
  return undefined
}

function stringValue(node: ts.Expression | undefined): string | undefined {
  if (node === undefined) return undefined
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return undefined
}

/** True when `id` is bound by something between it and the module scope. */
function isLocallyBound(id: ts.Identifier): boolean {
  let current: ts.Node | undefined = id.parent
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (scopeIntroduces(current, id.text)) return true
    current = current.parent
  }
  return false
}

/**
 * The initializer of the NEAREST local `const` binding `id` (a block-scoped
 * `const ghostClass = buttonVariants(…)` inside a factory, as `pagination.ts`
 * writes), or `undefined` when the nearest local binding is anything else — a
 * parameter, a destructure, a `let` — whose value this analysis cannot know.
 */
function localConstInit(id: ts.Identifier): ts.Expression | undefined {
  let current: ts.Node | undefined = id.parent
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (scopeIntroduces(current, id.text)) {
      if (!ts.isBlock(current)) return undefined
      for (const stmt of current.statements) {
        if (!ts.isVariableStatement(stmt)) continue
        if ((stmt.declarationList.flags & ts.NodeFlags.Const) === 0) continue
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.name.text === id.text) return decl.initializer
        }
      }
      return undefined
    }
    current = current.parent
  }
  return undefined
}

/**
 * The registry, indexed for cross-file resolution. `files` maps an ABSOLUTE
 * path to its source; `resolveImport` maps a specifier seen in `fromFile` to
 * an absolute path in `files` (or `undefined` for a package import).
 */
export class RegistryOutlineAnalyzer {
  private readonly contexts = new Map<string, FileContext>()
  private readonly entityMemo = new Map<string, Entity | null>()
  private readonly resolving = new Set<string>()

  constructor(
    private readonly root: string,
    files: ReadonlyMap<string, string>,
    private readonly resolveImport: (specifier: string, fromFile: string) => string | undefined,
  ) {
    for (const [file, source] of files) this.contexts.set(file, this.index(file, source))
  }

  private index(file: string, source: string): FileContext {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const consts = new Map<string, ts.Expression>()
    const functions = new Map<string, ts.FunctionDeclaration>()
    const imports = new Map<string, { from: string; name: string }>()
    for (const stmt of sf.statements) {
      if (ts.isVariableStatement(stmt) && (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0) {
        for (const decl of stmt.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.initializer !== undefined) {
            consts.set(decl.name.text, decl.initializer)
          }
        }
      } else if (ts.isFunctionDeclaration(stmt) && stmt.name !== undefined) {
        functions.set(stmt.name.text, stmt)
      } else if (
        ts.isImportDeclaration(stmt) &&
        ts.isStringLiteral(stmt.moduleSpecifier) &&
        stmt.importClause?.namedBindings !== undefined &&
        ts.isNamedImports(stmt.importClause.namedBindings)
      ) {
        const target = this.resolveImport(stmt.moduleSpecifier.text, file)
        if (target === undefined) continue
        for (const el of stmt.importClause.namedBindings.elements) {
          imports.set(el.name.text, { from: target, name: (el.propertyName ?? el.name).text })
        }
      }
    }
    return { file, sf, consts, functions, imports, objectConsts: indexObjectConsts(sf) }
  }

  /** Resolve a MODULE-level name in `ctx` (following one import hop at a time). */
  private entity(ctx: FileContext, name: string): Entity | undefined {
    const key = `${ctx.file}#${name}`
    const memo = this.entityMemo.get(key)
    if (memo !== undefined) return memo ?? undefined
    if (this.resolving.has(key)) return undefined
    this.resolving.add(key)
    try {
      const found = this.computeEntity(ctx, name)
      this.entityMemo.set(key, found ?? null)
      return found
    } finally {
      this.resolving.delete(key)
    }
  }

  private computeEntity(ctx: FileContext, name: string): Entity | undefined {
    const imported = ctx.imports.get(name)
    if (imported !== undefined) {
      const target = this.contexts.get(imported.from)
      return target === undefined ? undefined : this.entity(target, imported.name)
    }
    const fn = ctx.functions.get(name)
    if (fn !== undefined) return this.functionElement(ctx, fn)
    const init = ctx.consts.get(name)
    if (init === undefined) return undefined
    if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
      const callee = init.expression.text
      if (callee === 'createVariants') {
        const def = this.variantsDef(ctx, init.arguments[0])
        return def === undefined ? undefined : { kind: 'variants', def }
      }
      if (callee === 'createVariantsPart') {
        const def = this.variantsDef(ctx, init.arguments[1])
        if (def === undefined) return undefined
        return { kind: 'element', root: (props) => this.combinations(def, props) }
      }
      if (TAG_FIRST_CALLS.has(callee)) {
        const recipe = init.arguments[1]
        return {
          kind: 'element',
          root: () => (recipe === undefined ? [EMPTY] : this.evaluate(ctx, recipe)),
        }
      }
    }
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
      return this.functionElement(ctx, init)
    }
    return { kind: 'string', file: ctx, init }
  }

  /**
   * A function component is an element factory when some `mergeClass`/`cn`
   * call inside it merges a name destructured from the props' `class` — that
   * call is the class of the element the caller's `class` lands on, and its
   * OTHER arguments are the root recipe.
   */
  private functionElement(ctx: FileContext, fn: ts.FunctionLikeDeclaration): Entity | undefined {
    const classNames = new Set<string>()
    const findDestructure = (node: ts.Node): void => {
      if (ts.isBindingElement(node) && node.propertyName !== undefined) {
        if (propName(node.propertyName) === 'class' && ts.isIdentifier(node.name)) {
          classNames.add(node.name.text)
        }
      }
      ts.forEachChild(node, findDestructure)
    }
    if (fn.body !== undefined) findDestructure(fn.body)
    for (const p of fn.parameters) findDestructure(p)
    if (classNames.size === 0) return undefined
    let merged: ts.CallExpression | undefined
    const findMerge = (node: ts.Node): void => {
      if (
        merged === undefined &&
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        CLASS_CALLS.has(node.expression.text) &&
        node.arguments.some((a) => ts.isIdentifier(a) && classNames.has(a.text))
      ) {
        merged = node
      }
      ts.forEachChild(node, findMerge)
    }
    if (fn.body !== undefined) findMerge(fn.body)
    const call = merged
    if (call === undefined) return undefined
    return {
      kind: 'element',
      root: () =>
        product(
          call.arguments
            .filter((a) => !(ts.isIdentifier(a) && classNames.has(a.text)))
            .map((a) => this.evaluate(ctx, a)),
        ),
    }
  }

  private variantsDef(ctx: FileContext, arg: ts.Node | undefined): VariantsDef | undefined {
    const config = asObjectLiteral(arg, ctx.objectConsts)
    if (config === undefined) return undefined
    let base: ts.Expression | undefined
    const axes: { name: string; values: Map<string, ts.Expression> }[] = []
    const defaults = new Map<string, string>()
    const compounds: { when: Map<string, string>; cls: ts.Expression }[] = []
    const readAxes = (node: ts.Node): void => {
      const obj = asObjectLiteral(node, ctx.objectConsts)
      if (obj === undefined) return
      for (const axis of obj.properties) {
        if (!ts.isPropertyAssignment(axis) || !ts.isObjectLiteralExpression(axis.initializer)) {
          continue
        }
        const name = propName(axis.name)
        if (name === undefined) continue
        const values = new Map<string, ts.Expression>()
        for (const leaf of axis.initializer.properties) {
          if (!ts.isPropertyAssignment(leaf)) continue
          const value = propName(leaf.name)
          if (value !== undefined) values.set(value, leaf.initializer)
        }
        axes.push({ name, values })
      }
    }
    for (const prop of config.properties) {
      if (ts.isShorthandPropertyAssignment(prop)) {
        if (prop.name.text === 'variants') readAxes(prop.name)
        continue
      }
      if (!ts.isPropertyAssignment(prop)) continue
      const key = propName(prop.name)
      if (key === 'base') base = prop.initializer
      else if (key === 'variants') readAxes(prop.initializer)
      else if (key === 'defaultVariants' && ts.isObjectLiteralExpression(prop.initializer)) {
        for (const d of prop.initializer.properties) {
          if (!ts.isPropertyAssignment(d)) continue
          const axis = propName(d.name)
          const value = stringValue(d.initializer)
          if (axis !== undefined && value !== undefined) defaults.set(axis, value)
        }
      } else if (key === 'compoundVariants' && ts.isArrayLiteralExpression(prop.initializer)) {
        for (const entry of prop.initializer.elements) {
          if (!ts.isObjectLiteralExpression(entry)) continue
          const when = new Map<string, string>()
          let cls: ts.Expression | undefined
          for (const p of entry.properties) {
            if (!ts.isPropertyAssignment(p)) continue
            const k = propName(p.name)
            if (k === 'class') cls = p.initializer
            else if (k !== undefined) {
              const v = stringValue(p.initializer)
              if (v !== undefined) when.set(k, v)
            }
          }
          if (cls !== undefined) compounds.push({ when, cls })
        }
      }
    }
    return { file: ctx, base, axes, defaults, compounds }
  }

  /** Every class list a variants recipe yields, given the props passed. */
  private combinations(
    def: VariantsDef,
    props: ts.ObjectLiteralExpression | undefined,
  ): Alternatives {
    const passed = new Map<string, ts.Expression | 'shorthand'>()
    for (const p of props?.properties ?? []) {
      if (ts.isShorthandPropertyAssignment(p)) passed.set(p.name.text, 'shorthand')
      else if (ts.isPropertyAssignment(p)) {
        const k = propName(p.name)
        if (k !== undefined) passed.set(k, p.initializer)
      }
    }
    const spread = props?.properties.some((p) => ts.isSpreadAssignment(p)) ?? false
    // Per axis, the values the element can be at: a literal pins one, an
    // absent prop takes the default (or none), anything else is every value.
    let choices: Map<string, string | undefined>[] = [new Map<string, string | undefined>()]
    for (const axis of def.axes) {
      const given = passed.get(axis.name)
      let values: (string | undefined)[]
      const literal = given === undefined || given === 'shorthand' ? undefined : stringValue(given)
      if (literal !== undefined) values = [literal]
      else if (given === undefined && !spread) values = [def.defaults.get(axis.name)]
      else values = [...axis.values.keys(), ...(def.defaults.has(axis.name) ? [] : [undefined])]
      const next: Map<string, string | undefined>[] = []
      for (const choice of choices) {
        for (const v of values) next.push(new Map(choice).set(axis.name, v))
      }
      choices = next
    }
    const out: ClassAlternative[] = []
    for (const choice of choices) {
      const parts: Alternatives[] = []
      if (def.base !== undefined) parts.push(this.evaluate(def.file, def.base))
      for (const axis of def.axes) {
        const v = choice.get(axis.name)
        const leaf = v === undefined ? undefined : axis.values.get(v)
        if (leaf !== undefined) parts.push(this.evaluate(def.file, leaf))
      }
      for (const compound of def.compounds) {
        if ([...compound.when].every(([k, v]) => choice.get(k) === v)) {
          parts.push(this.evaluate(def.file, compound.cls))
        }
      }
      out.push(...product(parts))
    }
    return dedupe(out)
  }

  /** Evaluate an expression in class position into its alternatives. */
  evaluate(ctx: FileContext, node: ts.Expression): Alternatives {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return [{ always: words(node.text), groups: [] }]
    }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
      return this.evaluate(ctx, node.expression)
    }
    if (ts.isTemplateExpression(node)) {
      const parts: Alternatives[] = [[{ always: words(node.head.text), groups: [] }]]
      for (const span of node.templateSpans) {
        parts.push(this.evaluate(ctx, span.expression))
        parts.push([{ always: words(span.literal.text), groups: [] }])
      }
      return product(parts)
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind
      if (op === ts.SyntaxKind.PlusToken) {
        return product([this.evaluate(ctx, node.left), this.evaluate(ctx, node.right)])
      }
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
        return conditional(this.evaluate(ctx, node.right))
      }
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
        return product([
          conditional(this.evaluate(ctx, node.left)),
          conditional(this.evaluate(ctx, node.right)),
        ])
      }
      return [EMPTY]
    }
    if (ts.isConditionalExpression(node)) {
      return dedupe([...this.evaluate(ctx, node.whenTrue), ...this.evaluate(ctx, node.whenFalse)])
    }
    if (ts.isArrayLiteralExpression(node)) {
      return product(
        node.elements.filter((e) => !ts.isSpreadElement(e)).map((e) => this.evaluate(ctx, e)),
      )
    }
    if (ts.isObjectLiteralExpression(node)) {
      // A clsx object: every key is a class list applied when its value holds.
      const groups: Set<string>[] = []
      for (const p of node.properties) {
        if (!ts.isPropertyAssignment(p)) continue
        const key = propName(p.name)
        if (key !== undefined) groups.push(words(key))
      }
      return [{ always: new Set(), groups }]
    }
    if (ts.isIdentifier(node)) {
      if (node.text === 'undefined') return [EMPTY]
      if (isLocallyBound(node)) {
        const init = localConstInit(node)
        return init === undefined ? [EMPTY] : this.evaluate(ctx, init)
      }
      const found = this.entity(ctx, node.text)
      if (found?.kind === 'string') return this.evaluate(found.file, found.init)
      return [EMPTY]
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text
      if (CLASS_CALLS.has(callee)) {
        return product(node.arguments.map((a) => this.evaluate(ctx, a)))
      }
      const found = isLocallyBound(node.expression) ? undefined : this.entity(ctx, callee)
      if (found?.kind === 'variants') {
        const arg = node.arguments[0]
        return this.combinations(
          found.def,
          arg !== undefined && ts.isObjectLiteralExpression(arg) ? arg : undefined,
        )
      }
    }
    return [EMPTY]
  }

  /** Every class-application site in `file`, with the alternatives it yields. */
  sites(file: string): { line: number; alternatives: Alternatives }[] {
    const ctx = this.contexts.get(file)
    if (ctx === undefined) throw new Error(`forced-colors-outline: ${file} is not indexed`)
    const out: { line: number; alternatives: Alternatives }[] = []
    const add = (node: ts.Node, alternatives: Alternatives): void => {
      const { line } = ctx.sf.getLineAndCharacterOfPosition(node.getStart(ctx.sf))
      out.push({ line: line + 1, alternatives })
    }
    const walk = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const callee = node.expression.text
        if (CLASS_CALLS.has(callee)) add(node, this.evaluate(ctx, node))
        else if (TAG_FIRST_CALLS.has(callee)) {
          const recipe = node.arguments[1]
          if (recipe !== undefined) add(node, this.evaluate(ctx, recipe))
        } else if (callee === 'createVariants' || callee === 'createVariantsPart') {
          const def = this.variantsDef(ctx, node.arguments[callee === 'createVariants' ? 0 : 1])
          if (def !== undefined) {
            // Every combination the recipe can produce: a spread prop bag
            // leaves every axis free.
            const free = ts.factory.createObjectLiteralExpression([
              ts.factory.createSpreadAssignment(ts.factory.createIdentifier('props')),
            ])
            add(node, this.combinations(def, free))
          }
        } else {
          // A `class:` passed to an element factory lands on its root
          // element, merged with the factory's own recipe.
          const props = node.arguments.find(ts.isObjectLiteralExpression)
          const classProp = props?.properties.find(
            (p): p is ts.PropertyAssignment =>
              ts.isPropertyAssignment(p) && propName(p.name) === 'class',
          )
          if (props !== undefined && classProp !== undefined) {
            const found = isLocallyBound(node.expression) ? undefined : this.entity(ctx, callee)
            const own = this.evaluate(ctx, classProp.initializer)
            add(node, found?.kind === 'element' ? product([found.root(props), own]) : own)
          }
        }
      }
      // A recipe const reaching its element only through a bespoke helper
      // (`pagination.ts`'s `paginationSelectedForcedColorsRecipe`) — the
      // extractor's own `*Recipe` fallback, judged on its own.
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        /recipe$/i.test(node.name.text) &&
        node.initializer !== undefined
      ) {
        add(node, this.evaluate(ctx, node.initializer))
      }
      ts.forEachChild(node, walk)
    }
    walk(ctx.sf)
    return out
  }

  /** The traps in `file`, one per (line, width class). */
  traps(file: string, classify: (utility: string) => OutlineUtilityClass): OutlineTrap[] {
    const seen = new Map<string, OutlineTrap>()
    for (const site of this.sites(file)) {
      for (const alt of site.alternatives) {
        for (const trap of trapsIn(alt, classify)) {
          const found: OutlineTrap = {
            file: path.relative(this.root, file),
            line: site.line,
            ...trap,
          }
          seen.set(`${found.line}:${found.width}`, found)
        }
      }
    }
    return [...seen.values()]
  }

  /** Every class any site in `file` can produce (the coverage cross-check). */
  classesSeen(file: string): Set<string> {
    const out = new Set<string>()
    for (const site of this.sites(file)) {
      for (const alt of site.alternatives) {
        for (const c of alt.always) out.add(c)
        for (const g of alt.groups) for (const c of g) out.add(c)
      }
    }
    return out
  }
}
