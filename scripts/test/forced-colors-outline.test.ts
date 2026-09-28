import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { extractClassCandidates } from '../lib/registry-classes.mjs'
import { compileCandidates, selectorFor } from '../lib/tailwind-compile.mjs'
import {
  classifyOutlineUtility,
  isOutlineClass,
  RegistryOutlineAnalyzer,
  splitVariants,
  trapsIn,
  type ClassAlternative,
  type OutlineUtilityClass,
} from '../lib/forced-colors-outline'

/**
 * The forced-colors `outline-none` trap (docs/agents/styling.md, #266), gated
 * statically over every registry recipe.
 *
 * `outline-none` sets `--tw-outline-style: none`; `forced-colors:outline-2`
 * only sets a width and reads the style from that variable, so on an element
 * that can carry both, the high-contrast outline computes `outline-style: none`
 * and never paints. #266 fixed two by hand (image-cropper's crop box, the
 * calendar's range day) and suspected more without a way to look. This test is
 * the way to look: `scripts/lib/forced-colors-outline.ts` evaluates every
 * class-application SITE — following `buttonVariants` and every other variants
 * recipe, element factories such as `Button`, templates and consts — into the
 * class lists an element can end up with, and requires a forced-colors outline
 * STYLE beside every forced-colors outline WIDTH that shares an element with a
 * style-clearing class. There is no allowlist: the expected set is EMPTY.
 *
 * What each utility does is not hand-listed either — every outline utility in
 * the corpus is compiled with the real Tailwind build and classified from the
 * declarations it emits.
 */

const ROOT = path.resolve(__dirname, '../..')
const REGISTRY = path.join(ROOT, 'registry', 'llui')

/** Every registry source file, from git (never a walk: `.claude/worktrees/`). */
function registryFiles(): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'registry/llui'],
    { cwd: ROOT, encoding: 'utf8' },
  )
  return out
    .split('\0')
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(ROOT, f))
    .sort()
}

/** `@/ui/x` / `@/lib/x` are the aliases `llui add` rewrites; `./x` is relative. */
function resolveRegistryImport(
  base: string,
  files: ReadonlyMap<string, string>,
): (specifier: string, fromFile: string) => string | undefined {
  return (specifier, fromFile) => {
    let target: string | undefined
    const alias = /^@\/(ui|lib)\/(.+)$/.exec(specifier)
    if (alias !== null) target = path.join(base, alias[1] ?? '', alias[2] ?? '')
    else if (specifier.startsWith('.')) target = path.resolve(path.dirname(fromFile), specifier)
    if (target === undefined) return undefined
    const candidate = target.replace(/\.js$/, '') + '.ts'
    return files.has(candidate) ? candidate : undefined
  }
}

/** The body of the rule Tailwind emitted for `utility` (nested blocks included). */
function ruleBody(css: string, utility: string): string {
  const selector = `${selectorFor(utility)} {`
  const start = css.indexOf(selector)
  if (start === -1) throw new Error(`Tailwind emitted no rule for ${utility}`)
  let depth = 0
  for (let i = start + selector.length - 1; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1)
  }
  throw new Error(`unterminated rule for ${utility}`)
}

async function tailwindClassifier(
  utilities: readonly string[],
): Promise<(utility: string) => OutlineUtilityClass> {
  const { css } = await compileCandidates(utilities)
  const table = new Map(utilities.map((u) => [u, classifyOutlineUtility(ruleBody(css, u))]))
  const none: OutlineUtilityClass = { clears: false, width: false, sets: false }
  return (utility) => table.get(utility) ?? none
}

/** Anchors: the utilities whose meaning the whole guard rests on. */
const ANCHORS = ['outline-none', 'outline-hidden', 'outline-2', 'outline-solid']

let corpus: Map<string, string>
let analyzer: RegistryOutlineAnalyzer
let classify: (utility: string) => OutlineUtilityClass
let extracted: Map<string, string[]>

beforeAll(async () => {
  corpus = new Map(registryFiles().map((f) => [f, readFileSync(f, 'utf8')]))
  analyzer = new RegistryOutlineAnalyzer(ROOT, corpus, resolveRegistryImport(REGISTRY, corpus))
  extracted = new Map(
    [...corpus].map(([file, source]) => [
      file,
      extractClassCandidates(path.relative(ROOT, file), source),
    ]),
  )
  const utilities = new Set(ANCHORS)
  for (const classes of extracted.values()) {
    for (const cls of classes) if (isOutlineClass(cls)) utilities.add(splitVariants(cls).utility)
  }
  classify = await tailwindClassifier([...utilities].sort())
})

describe('forced-colors outline trap (#266 follow-up)', () => {
  it('classifies the anchor utilities from the real Tailwind output', () => {
    expect(classify('outline-none')).toEqual({ clears: true, width: false, sets: false })
    expect(classify('outline-hidden')).toEqual({ clears: true, width: false, sets: false })
    expect(classify('outline-2')).toEqual({ clears: false, width: true, sets: false })
    expect(classify('outline-solid')).toEqual({ clears: false, width: false, sets: true })
  })

  it('no registry element pairs a style-clearing class with an unstyled forced-colors outline width', () => {
    const traps = [...corpus.keys()].flatMap((file) => analyzer.traps(file, classify))
    expect(traps).toEqual([])
  })

  it('judges every outline class the Tailwind guard sees (no recipe position is unread)', () => {
    // The class extractor is the Tailwind guard's own notion of "a class this
    // file emits". An outline class it reports that no evaluated site produced
    // would be one this guard silently never judged.
    const unjudged: string[] = []
    let judged = 0
    for (const [file, classes] of extracted) {
      const seen = analyzer.classesSeen(file)
      for (const cls of classes.filter(isOutlineClass)) {
        if (seen.has(cls)) judged++
        else unjudged.push(`${path.relative(ROOT, file)}: ${cls}`)
      }
    }
    expect(unjudged).toEqual([])
    // Vacuity: the corpus really carries forced-colors outline widths, and
    // the evaluator really follows `buttonVariants` into a consumer.
    const forcedWidths = [...extracted.values()]
      .flat()
      .filter((c) => splitVariants(c).variants.includes('forced-colors'))
      .filter((c) => classify(splitVariants(c).utility).width)
    expect(forcedWidths.length).toBeGreaterThan(5)
    expect(judged).toBeGreaterThan(forcedWidths.length)
    const calendar = path.join(REGISTRY, 'ui', 'calendar.ts')
    expect(analyzer.classesSeen(calendar).has('outline-none')).toBe(true)
  })
})

/** A synthetic registry, so every rule of the guard is pinned in both directions. */
async function fixture(files: Record<string, string>): Promise<(file: string) => string[]> {
  const base = '/fixture/llui'
  const map = new Map(Object.entries(files).map(([f, s]) => [path.join(base, f), s]))
  const local = new RegistryOutlineAnalyzer('/fixture', map, resolveRegistryImport(base, map))
  // The fixture's own utilities, classified by the same real compile.
  const utilities = new Set(ANCHORS)
  for (const file of map.keys()) {
    for (const cls of local.classesSeen(file)) {
      if (isOutlineClass(cls)) utilities.add(splitVariants(cls).utility)
    }
  }
  const classifyFixture = await tailwindClassifier([...utilities].sort())
  return (file) =>
    local.traps(path.join(base, file), classifyFixture).map((t) => `${t.width} <- ${t.clearedBy}`)
}

const BUTTON = `
import { createVariants } from '@llui/components/styles'
import { mergeClass, splitArgs } from '@/lib/utils'
const variants = { variant: { default: 'bg-primary', ghost: 'hover:bg-accent' }, size: { default: 'h-9', icon: 'size-9' } }
export const buttonVariants = createVariants({
  base: 'inline-flex outline-none focus-visible:ring-[3px]',
  variants,
  defaultVariants: { variant: 'default', size: 'default' },
})
export function Button(a0, a1) {
  const { props, children } = splitArgs(a0, a1)
  const { variant, size, class: className, ...rest } = props
  return button({ ...rest, class: mergeClass(buttonVariants({ variant, size }), className) }, children)
}
`

describe('the trap analysis', () => {
  it('reports a width beside outline-none in one recipe, and accepts a forced-colors style', async () => {
    const traps = await fixture({
      'ui/a.ts': `
export const Bad = classPart(div, 'outline-none forced-colors:outline-2 forced-colors:outline-[Highlight]')
export const Good = classPart(div, 'outline-none forced-colors:outline-2 forced-colors:outline-solid')
export const Unset = classPart(div, 'forced-colors:outline-2 forced-colors:outline-[Highlight]')
`,
    })
    expect(traps('ui/a.ts')).toEqual(['forced-colors:outline-2 <- outline-none'])
  })

  it('follows buttonVariants through a template recipe, a cn call and an element factory', async () => {
    const traps = await fixture({
      'ui/button.ts': BUTTON,
      'ui/b.ts': `
import { buttonVariants, Button } from '@/ui/button'
export const Day = classPart(button, \`\${buttonVariants({ variant: 'ghost' })} forced-colors:data-today:outline-1\`)
export function Nav(p) { return button({ class: cn(buttonVariants({ size: 'icon' }), 'forced-colors:aria-selected:outline-2') }) }
export const view = () => Button({ variant: 'ghost', class: 'forced-colors:outline-[3px]' })
`,
    })
    expect(traps('ui/b.ts').sort()).toEqual([
      'forced-colors:aria-selected:outline-2 <- outline-none',
      'forced-colors:data-today:outline-1 <- outline-none',
      'forced-colors:outline-[3px] <- outline-none',
    ])
  })

  it('follows a variants call held in a LOCAL const (the pagination factory shape)', async () => {
    const traps = await fixture({
      'ui/button.ts': BUTTON,
      'ui/p.ts': `
import { buttonVariants } from '@/ui/button'
function link(size) {
  const ghostClass = buttonVariants({ variant: 'ghost', size })
  return (props) => button({ class: cn(ghostClass, 'forced-colors:data-selected:outline-2') })
}
function shadowed(ghostClass) {
  return button({ class: cn(ghostClass, 'forced-colors:data-current:outline-2') })
}
`,
    })
    expect(traps('ui/p.ts')).toEqual(['forced-colors:data-selected:outline-2 <- outline-none'])
  })

  it('reports a trap in any variant combination of a createVariantsPart recipe', async () => {
    const traps = await fixture({
      'ui/c.ts': `
export const Toggle = createVariantsPart(button, {
  base: 'inline-flex',
  variants: { variant: { plain: 'bg-transparent', flat: 'outline-none' }, tone: { on: 'forced-colors:outline-2' } },
  defaultVariants: { variant: 'plain' },
})
`,
    })
    expect(traps('ui/c.ts')).toEqual(['forced-colors:outline-2 <- outline-none'])
  })

  it('a style must hold in EVERY state the width does, and must not be conditional', async () => {
    const traps = await fixture({
      'ui/d.ts': `
export const Narrower = classPart(div, 'outline-none forced-colors:outline-2 forced-colors:data-selected:outline-solid')
export const SameChain = classPart(div, 'outline-none forced-colors:data-selected:outline-2 forced-colors:data-selected:outline-solid')
export const Broader = classPart(div, 'outline-none forced-colors:data-selected:outline-2 forced-colors:outline-solid')
export const Unprefixed = classPart(div, 'outline-none outline-solid forced-colors:aria-current:outline-2')
export function Conditional(on) { return div({ class: cn('outline-none forced-colors:aria-checked:outline-2', on && 'forced-colors:outline-solid') }) }
export function Together(on) { return div({ class: cn('outline-none', on && 'forced-colors:aria-busy:outline-2 forced-colors:outline-solid') }) }
`,
    })
    expect(traps('ui/d.ts').sort()).toEqual([
      'forced-colors:aria-checked:outline-2 <- outline-none',
      'forced-colors:aria-current:outline-2 <- outline-none',
      'forced-colors:outline-2 <- outline-none',
    ])
  })

  it('a conditional clearing class can still trigger it, and outline-hidden clears too', async () => {
    const traps = await fixture({
      'ui/e.ts': `
export function Maybe(on) { return div({ class: cn(on ? 'outline-hidden' : 'p-2', 'forced-colors:outline-2') }) }
export function AndAnd(on) { return div({ class: cn(on && 'focus-visible:outline-none', 'forced-colors:outline-2') }) }
`,
    })
    expect(traps('ui/e.ts').sort()).toEqual([
      'forced-colors:outline-2 <- focus-visible:outline-none',
      'forced-colors:outline-2 <- outline-hidden',
    ])
  })
})

/**
 * The static model, checked against the thing it models. Every registry class
 * list that carries a forced-colors outline width in a state this probe can
 * put an element into (`data-*`, `aria-*`, and `group-*` through a marked
 * parent — `focus-visible` needs real keyboard focus and is left to the
 * gallery's interaction gate) is RENDERED in Chromium under emulated forced
 * colors, together with a MUTANT of each that drops every outline-style
 * class. The analyzer's verdict must equal the computed `outline-style` for
 * all of them: the shipped lists must paint, and every mutant whose element
 * can carry `outline-none` must compute `none` and be reported. The mutant arm
 * is what makes this a proof rather than a tautology — without it a model
 * that never reports anything would agree with a clean corpus.
 *
 * CSS-probe rules (docs/agents/styling.md): transitions are killed outright,
 * the probe asserts the page is VISIBLE and that forced colors are ACTIVE
 * before reading anything, and a control element with a bare `outline-2`
 * must read `solid` (the variable's registered initial value).
 */
interface RenderCase {
  readonly label: string
  readonly classes: readonly string[]
  readonly state: readonly { onParent: boolean; name: string; value: string }[]
  readonly parentClass: string
  readonly staticTrap: boolean
}

/** The element (and group-parent) attributes a variant chain needs, or null. */
function stateFor(
  variants: readonly string[],
): { attrs: RenderCase['state']; parentClass: string } | null {
  const attrs: { onParent: boolean; name: string; value: string }[] = []
  let parentClass = ''
  for (const v of variants) {
    if (v === 'forced-colors') continue
    const group = /^group-(data|aria)-(.+)\/([\w-]+)$/.exec(v)
    const own = /^(data|aria)-(.+)$/.exec(v)
    const match = group ?? own
    if (match === null) return null
    const [, kind = '', spec = ''] = match
    const bracket = /^\[([\w-]+)(?:=([\w-]+))?\]$/.exec(spec)
    const name = `${kind}-${bracket?.[1] ?? spec}`
    const value = bracket?.[2] ?? (kind === 'aria' ? 'true' : '')
    attrs.push({ onParent: group !== null, name, value })
    if (group !== null) parentClass = `group/${group[3] ?? ''}`
  }
  return { attrs, parentClass }
}

function renderCases(): RenderCase[] {
  const cases = new Map<string, RenderCase>()
  const add = (label: string, alt: ClassAlternative, mutant: boolean): void => {
    const classes = [...alt.always, ...alt.groups.flatMap((g) => [...g])]
    const kept = mutant ? classes.filter((c) => !classify(splitVariants(c).utility).sets) : classes
    const widths = kept.filter((c) => {
      const split = splitVariants(c)
      return split.variants.includes('forced-colors') && classify(split.utility).width
    })
    if (widths.length === 0) return
    // Every width's state at once, so each of them is active in the render.
    const states = widths.map((w) => stateFor(splitVariants(w).variants))
    if (states.some((s) => s === null)) return
    const parents = new Set(states.map((s) => s?.parentClass ?? '').filter((p) => p !== ''))
    if (parents.size > 1) return
    const altOf: ClassAlternative = { always: new Set(kept), groups: [] }
    const key = [...kept].sort().join(' ')
    if (cases.has(key)) return
    cases.set(key, {
      label: `${label}${mutant ? ' (mutant: no outline style)' : ''}`,
      classes: kept,
      state: states.flatMap((s) => s?.attrs ?? []),
      parentClass: [...parents][0] ?? '',
      staticTrap: trapsIn(altOf, classify).length > 0,
    })
  }
  for (const file of corpus.keys()) {
    for (const site of analyzer.sites(file)) {
      for (const alt of site.alternatives) {
        const label = `${path.relative(ROOT, file)}:${site.line}`
        add(label, alt, false)
        add(label, alt, true)
      }
    }
  }
  return [...cases.values()]
}

describe('the static verdict matches Chromium under forced colors', () => {
  let browser: Browser | undefined
  afterAll(async () => {
    await browser?.close()
  })

  it('renders every judgeable width, shipped and mutated, as the analyzer predicts', async () => {
    const cases = renderCases()
    // Vacuity, both directions: shipped lists that paint AND mutants that trap.
    expect(cases.filter((c) => c.staticTrap).length).toBeGreaterThan(2)
    expect(cases.filter((c) => !c.staticTrap).length).toBeGreaterThan(4)

    const all = new Set(['outline-2', ...cases.flatMap((c) => c.classes)])
    for (const c of cases) if (c.parentClass !== '') all.add(c.parentClass)
    const { css } = await compileCandidates([...all])
    const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    const markup = cases
      .map((c, i) => {
        const attrs = (onParent: boolean): string =>
          c.state
            .filter((s) => s.onParent === onParent)
            .map((s) => ` ${s.name}="${escape(s.value)}"`)
            .join('')
        const el = `<div id="case-${i}" class="${escape(c.classes.join(' '))}"${attrs(false)}>x</div>`
        return `<div class="${escape(c.parentClass)}"${attrs(true)}>${el}</div>`
      })
      .join('')

    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    await page.emulateMedia({ forcedColors: 'active' })
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>` +
        `<style>*, *::before, *::after { transition: none !important; animation: none !important; }</style>` +
        `</head><body><div id="control" class="outline-2">x</div>${markup}</body></html>`,
    )
    const facts = await page.evaluate((count) => {
      const style = (id: string): string =>
        getComputedStyle(document.getElementById(id) as Element).outlineStyle
      return {
        visible: document.visibilityState,
        forced: matchMedia('(forced-colors: active)').matches,
        control: style('control'),
        styles: Array.from({ length: count }, (_, i) => style(`case-${i}`)),
      }
    }, cases.length)
    expect(facts.visible).toBe('visible')
    expect(facts.forced).toBe(true)
    expect(facts.control).toBe('solid')

    const disagreements = cases
      .map((c, i) => ({ c, rendered: facts.styles[i] }))
      .filter(({ c, rendered }) => (rendered === 'none') !== c.staticTrap)
      .map(({ c, rendered }) => `${c.label}: static ${c.staticTrap}, rendered ${rendered}`)
    expect(disagreements).toEqual([])
  })
})
