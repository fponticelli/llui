import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
// @ts-expect-error -- plain-JS script helpers, consumed by the repo's own tooling
import { extractClassCandidates } from '../lib/registry-classes.mjs'
// @ts-expect-error -- plain-JS script helpers, consumed by the repo's own tooling
import {
  contrast,
  gamutMapOklabToLinearSrgb,
  hslToLinearSrgb,
  mixOklab,
  oklchToOklab,
  quantize,
} from '../lib/oklch.mjs'
import {
  CHIP_HUES,
  CHIP_HUE_SLOT_COUNT,
  RESERVED_HUE_ARCS,
  chipHue,
  isReservedHue,
} from '../../packages/components/src/styles/chip-hue'

/**
 * The value-hued chip's product IS the contrast claim: "hold S/L, vary only the
 * hue, and every category stays legible in both themes". That claim is
 * falsifiable, it is FALSE in the colour space the proposal reached for first,
 * and neither of the registry's existing guards can see it — `tailwind-classes`
 * asks whether a class produces CSS, `registry-attrs` whether a selector names a
 * published attribute. Both are green on a chip whose yellow is unreadable.
 *
 * So this test evaluates the SHIPPED expressions. It parses `--chip-lightness` /
 * `--chip-chroma` / `--chip-mix` out of `tokens.css`, the two `color-mix()`
 * recipes out of `registry/llui/ui/chip.ts`, and `--background` / `--foreground`
 * out of both theme files, then sweeps all 360 hues. Editing any of those
 * numbers re-measures rather than re-asserts; changing the SHAPE of the recipe
 * (a different function, a hard-coded colour) fails the parse loudly instead of
 * quietly measuring something that is no longer there.
 *
 * A browser probe was deliberately not used for the sweep. `getComputedStyle` in
 * a hidden tab reports whatever a frozen transition left behind, and a
 * `cssRules` scan that does not descend into `@layer` / `@supports` reports live
 * rules as absent — both have produced confident wrong answers in this repo. The
 * rendered page is still the check for whether the chip LOOKS right; this is the
 * check for whether it is legible.
 */

const ROOT = path.resolve(__dirname, '../..')
const STYLES = path.join(ROOT, 'packages/components/src/styles')
const RECIPE = path.join(ROOT, 'registry/llui/ui/chip.ts')

const AA_NORMAL_TEXT = 4.5

type Oklab = readonly [number, number, number]

/** Every `--name: value` in a stylesheet, asserting that repeated declarations
 * of the same token agree. `tokens-dark.css` declares its palette twice (once
 * under `prefers-color-scheme`, once under `.dark` / `[data-theme='dark']`), and
 * a drift between the two would otherwise be invisible here. */
function readTokens(css: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of css.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)) {
    const [, name, raw] = m
    const value = raw!.trim()
    const seen = out.get(name!)
    if (seen !== undefined && seen !== value) {
      throw new Error(`token ${name} declared twice with different values: ${seen} / ${value}`)
    }
    out.set(name!, value)
  }
  return out
}

/** Split on commas that are not inside parentheses. */
function splitTop(s: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) {
      parts.push(s.slice(start, i))
      start = i + 1
    }
  }
  parts.push(s.slice(start))
  return parts.map((p) => p.trim())
}

/** Split on top-level whitespace. */
function splitWords(s: string): string[] {
  const words: string[] = []
  let depth = 0
  let cur = ''
  for (const c of s) {
    if (c === '(') depth++
    else if (c === ')') depth--
    if (/\s/.test(c) && depth === 0) {
      if (cur !== '') words.push(cur)
      cur = ''
    } else cur += c
  }
  if (cur !== '') words.push(cur)
  return words
}

/**
 * Evaluate the subset of CSS colour syntax the chip recipe uses — `var()`,
 * `oklch()` and `color-mix(in oklab, …)` — to an OKLab triple. Anything else
 * throws, so a recipe that grows a construct this cannot read fails the test
 * rather than silently measuring a default.
 */
function evalColor(expr: string, vars: Map<string, string>): Oklab {
  const e = expr.trim()
  const v = /^var\(\s*(--[a-z0-9-]+)\s*(?:,([^]*))?\)$/i.exec(e)
  if (v !== null) {
    const value = vars.get(v[1]!) ?? v[2]
    if (value === undefined) throw new Error(`unknown custom property ${v[1]}`)
    return evalColor(value, vars)
  }
  const mix = /^color-mix\(([^]*)\)$/i.exec(e)
  if (mix !== null) {
    const [space, a, b] = splitTop(mix[1]!)
    if (space?.trim().toLowerCase() !== 'in oklab') {
      throw new Error(`only \`in oklab\` is evaluated here, got: ${space}`)
    }
    const aWords = splitWords(a!)
    const pct = aWords.length === 2 ? readNumber(aWords[1]!, vars) / 100 : 0.5
    return mixOklab(evalColor(aWords[0]!, vars), evalColor(b!, vars), pct) as Oklab
  }
  const oklch = /^oklch\(([^]*)\)$/i.exec(e)
  if (oklch !== null) {
    const parts = splitWords(oklch[1]!)
    if (parts.length !== 3) throw new Error(`expected 3 oklch components in: ${e}`)
    return oklchToOklab(parts.map((p) => readNumber(p, vars)) as [number, number, number]) as Oklab
  }
  throw new Error(`cannot evaluate colour expression: ${e}`)
}

function readNumber(expr: string, vars: Map<string, string>): number {
  const e = expr.trim()
  const v = /^var\(\s*(--[a-z0-9-]+)\s*(?:,([^]*))?\)$/i.exec(e)
  if (v !== null) {
    const value = vars.get(v[1]!) ?? v[2]
    if (value === undefined) throw new Error(`unknown custom property ${v[1]}`)
    return readNumber(value, vars)
  }
  const n = Number.parseFloat(e.replace('%', ''))
  if (!Number.isFinite(n)) throw new Error(`not a number: ${e}`)
  return n
}

/** The two colour expressions the shipped recipe carries, read out of the same
 * AST positions the Tailwind guard reads (so a recipe it cannot see is a recipe
 * this cannot see either — one failure, not two silent ones). */
async function chipExpressions(): Promise<{ fill: string; ink: string }> {
  const source = await readFile(RECIPE, 'utf8')
  const candidates: string[] = extractClassCandidates(RECIPE, source)
  const pick = (prefix: string): string => {
    const hits = candidates.filter((c) => c.startsWith(prefix) && c.endsWith(']'))
    expect(hits, `expected exactly one \`${prefix}…]\` recipe in chip.ts`).toHaveLength(1)
    // Tailwind arbitrary values spell a space as `_`.
    return hits[0]!.slice(prefix.length, -1).replaceAll('_', ' ')
  }
  return { fill: pick('bg-['), ink: pick('text-[') }
}

async function themeVars(): Promise<{ light: Map<string, string>; dark: Map<string, string> }> {
  const [light, darkOnly] = await Promise.all([
    readFile(path.join(STYLES, 'tokens.css'), 'utf8').then(readTokens),
    readFile(path.join(STYLES, 'tokens-dark.css'), 'utf8').then(readTokens),
  ])
  return { light, dark: new Map([...light, ...darkOnly]) }
}

/** Contrast of the chip's ink on its fill at `hue`, through CSS Color 4 gamut
 * mapping and an 8-bit sRGB round trip — what a display actually shows. */
function ratioAt(hue: number, vars: Map<string, string>, fill: string, ink: string): number {
  const withHue = new Map(vars)
  withHue.set('--chip-hue', String(hue))
  const bg = quantize(gamutMapOklabToLinearSrgb(evalColor(fill, withHue)))
  const fg = quantize(gamutMapOklabToLinearSrgb(evalColor(ink, withHue)))
  return contrast(fg, bg)
}

describe('value-hued chip contrast', () => {
  it('clears AA at every hue in both themes', async () => {
    const { fill, ink } = await chipExpressions()
    const { light, dark } = await themeVars()
    const failures: string[] = []
    const report: Record<string, { min: number; max: number; worstHue: number }> = {}
    for (const [name, vars] of [
      ['light', light],
      ['dark', dark],
    ] as const) {
      let min = Infinity
      let max = -Infinity
      let worstHue = -1
      for (let hue = 0; hue < 360; hue++) {
        const ratio = ratioAt(hue, vars, fill, ink)
        if (ratio < min) {
          min = ratio
          worstHue = hue
        }
        if (ratio > max) max = ratio
        if (ratio < AA_NORMAL_TEXT) failures.push(`${name} h=${hue}: ${ratio.toFixed(2)}:1`)
      }
      report[name] = { min, max, worstHue }
    }
    expect(
      failures,
      `Chip ink/fill falls below ${AA_NORMAL_TEXT}:1.\n` +
        `light ${report.light!.min.toFixed(2)}–${report.light!.max.toFixed(2)}, ` +
        `dark ${report.dark!.min.toFixed(2)}–${report.dark!.max.toFixed(2)}\n` +
        failures.slice(0, 20).join('\n'),
    ).toEqual([])
    // The margin is the point: a scale that only just clears AA has no room for
    // a theme that darkens `--foreground`. Measured against the shipped tokens
    // the range is 7.245–7.540 light and 7.038–7.318 dark — a 1.07x spread
    // across the whole wheel, versus 2.29x for the HSL formulation below.
    //
    // The floor is 7 because that is where the model sits, NOT because the
    // shipped chip is AAA: Chrome rasterises the same colours ~2% lower (6.90
    // worst case, measured on the registry demo) because it CLIPS out-of-gamut
    // chroma where CSS Color 4 gamut-maps it. The honest claim is AA with 1.5x
    // margin; this bound is a tripwire on the model, not the product claim.
    expect(Math.min(report.light!.min, report.dark!.min)).toBeGreaterThan(7)
  })

  it('reports the HSL formulation this replaced as failing — the sweep can fail', async () => {
    // The originally proposed `hsl(H 55% 30%)` on `hsl(H 58% 91%)`. HSL's `L` is
    // a channel average, so perceived lightness swings hard with hue. Without
    // this case the sweep above proves only that SOME formulation passes.
    const below: number[] = []
    let min = Infinity
    let max = -Infinity
    for (let hue = 0; hue < 360; hue++) {
      const ratio = contrast(hslToLinearSrgb(hue, 0.55, 0.3), hslToLinearSrgb(hue, 0.58, 0.91))
      if (ratio < AA_NORMAL_TEXT) below.push(hue)
      min = Math.min(min, ratio)
      max = Math.max(max, ratio)
    }
    expect(below.length).toBeGreaterThan(0)
    expect(min).toBeLessThan(AA_NORMAL_TEXT)
    // ~2.3x spread across hue, versus ~1.1x for the OKLCH scale above.
    expect(max / min).toBeGreaterThan(2)
  })

  it('every hue the hash can emit is one of the measured slots', async () => {
    expect(CHIP_HUES).toHaveLength(CHIP_HUE_SLOT_COUNT)
    const slots = new Set(CHIP_HUES)
    // A corpus wide enough to exercise the modulo, not a spot check.
    for (let i = 0; i < 5000; i++) expect(slots.has(chipHue(`category-${i}`))).toBe(true)
  })

  it('the reserved `crit` arc actually contains `--destructive`, in both themes', async () => {
    // The one reserved band that can be checked against a token rather than
    // against convention — and the check is what keeps the TS constant and the
    // CSS from drifting apart. `warn` / `ok` have no token in this package.
    const { light, dark } = await themeVars()
    const crit = RESERVED_HUE_ARCS.find((a) => a.name === 'crit')!
    for (const [name, vars] of [
      ['light', light],
      ['dark', dark],
    ] as const) {
      const value = vars.get('--destructive')!
      const hue = Number.parseFloat(splitWords(/^oklch\(([^]*)\)$/.exec(value)![1]!)[2]!)
      expect(isReservedHue(hue), `${name} --destructive (h=${hue}) must be reserved`).toBe(true)
      expect(Math.abs(hue - crit.center)).toBeLessThan(crit.halfWidth)
    }
  })
})
