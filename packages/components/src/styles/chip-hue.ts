/**
 * Value-hued categorical chips — a stable hue per string, with NO colour map.
 *
 * The problem: categorical labels (event kinds, source tags, document types) are
 * either all one neutral colour, in which case nothing is scannable, or they are
 * a hand-maintained `Record<string, colour>` that goes stale the moment the
 * server invents a category. Hashing the value to a hue removes the map. The
 * three parts that are easy to get wrong are the ones that belong in a design
 * system rather than in every app, and they are what this module owns.
 *
 * ## 1. Contrast — why OKLCH and not HSL
 *
 * The scale holds LIGHTNESS and CHROMA fixed and varies only HUE, so one
 * contrast measurement covers every category. That claim is FALSE in HSL and
 * true in OKLCH, and the difference is not academic: HSL's `L` is a channel
 * average, not a perceived lightness, so `hsl(H 58% 91%)` is far lighter at
 * H=60 (yellow) than at H=240 (blue). Measured over all 360 hues at the
 * originally proposed `hsl(H 55% 30%)` on `hsl(H 58% 91%)`, contrast ranges
 * 4.30:1 – 9.85:1 and **17 hues fall below the 4.5:1 AA floor**. OKLab's L IS
 * perceptual, so the same sweep over the shipped values spans 7.04:1 – 7.54:1 —
 * a 1.07x spread instead of 2.29x, and every hue clears AA by more than 1.5x.
 * (Rasterised by Chrome, which clips out-of-gamut chroma where CSS Color 4
 * gamut-maps it, the worst case is 6.90:1 — so the claim is AA with margin, not
 * AAA.) `scripts/test/chip-contrast.test.ts` re-measures both directions from
 * the shipped CSS on every run.
 *
 * ## 2. Distribution — quantised, not continuous
 *
 * `hash % 360` clusters, and a continuous hue is worse than it looks even with a
 * good hash: for n categories drawn uniformly from an arc of A degrees the
 * expected smallest gap is about A/n², so twelve categories on a 252-degree arc
 * are very likely to include a pair under 2 degrees apart — visually one colour,
 * but presented as two. This module therefore quantises to {@link CHIP_HUE_SLOT_COUNT}
 * slots spread by ARC LENGTH over the unreserved hues, which makes the minimum
 * separation between two DISTINCT chip colours a guarantee (21 degrees) rather
 * than a hope. Two values that collide then look identical rather than
 * confusingly-nearly-identical, which is the honest failure.
 *
 * Note what is deliberately NOT here: a golden-angle step. The golden angle
 * separates hues drawn from a SEQUENCE (0, 1, 2, …); applied after an avalanching
 * hash it is a no-op, because the hash output is already uniform. It reappears in
 * {@link chipHueAt}, which is the sequential case.
 *
 * ## 3. Reserved hues — the semantic constraint
 *
 * Red, amber and green carry meaning that the reader supplies whether or not the
 * app intended it: a green "lab" chip beside a green "in range" badge asserts a
 * relationship that does not exist. {@link RESERVED_HUE_ARCS} excludes those
 * three families, and the exclusion is BY CONSTRUCTION — the hash is mapped onto
 * the allowed arc length, never onto 0–359 with a rejection step — so there is no
 * path by which a chip can land on one.
 *
 * The arcs are a CONVENTION, not a reading of the tokens: this package ships
 * `--destructive` and nothing for ok/warn, so only the crit band can be checked
 * against a token (it is: `--destructive` is hue 27.325 light / 22.216 dark,
 * both inside `crit`). The other two encode what a reader infers from a traffic
 * light, which is the thing being protected against.
 *
 * The chart scale is NOT reserved, and that is a considered answer rather than
 * an omission. `--chart-1..5` carry no fixed meaning — `--chart-3` is "the third
 * series", not "bad" — so a chip sharing a chart hue asserts nothing. It is also
 * not a well-defined constraint to honour: the chart hues are not stable across
 * themes (`--chart-1` is 41.116 in light and 264.376 in dark), so "avoid the
 * chart hues" would reserve ten arcs, over half the wheel, and still be theme-
 * dependent. The agreement between the two scales runs the other way — see
 * {@link chipHueAt}, which is the unbounded continuation of `--chart-1..5`.
 *
 * ## Using it
 *
 * The consumer sets ONE custom property and the CSS does the rest:
 *
 * ```ts
 * span({ 'style.--chip-hue': String(chipHue(kind)), class: chipClass }, [text(kind)])
 * ```
 *
 * The registry's `chip` item is that, styled. The colour expressions live in the
 * RULE (the recipe), not in a `:root` token, and that is forced rather than
 * chosen: a custom property's `var()` references are substituted at the computed
 * -value time of the element that DECLARES it, so a `--chip-fill` defined on
 * `:root` would resolve `var(--chip-hue)` against `:root` and every chip would
 * inherit the same already-substituted colour. Only a declaration that matches
 * the chip itself sees the chip's own `--chip-hue`.
 */

/**
 * A hue arc withheld from the categorical scale because a reader assigns it
 * STATUS meaning. Half-widths are categorical: the band spans the hues a viewer
 * would name as that colour family, which is a coarser and more robust boundary
 * than a perceptual-difference threshold at the chip's low chroma.
 */
export interface ReservedHueArc {
  /** What the band protects. */
  readonly name: 'crit' | 'warn' | 'ok'
  /** Centre hue, degrees. */
  readonly center: number
  /** Degrees either side of {@link center} that are excluded. */
  readonly halfWidth: number
}

/**
 * The three status families, in ascending hue. Non-overlapping by construction
 * and asserted to be so by `packages/components/test/styles/chip-hue.test.ts` —
 * {@link CHIP_HUES} derives the allowed arcs by walking the gaps between them,
 * which is only correct while they are disjoint.
 *
 * `crit` is centred on `--destructive` (27.325 light, 22.216 dark; the band
 * contains both). `warn` and `ok` are the amber and green a traffic light
 * trains readers to expect.
 */
export const RESERVED_HUE_ARCS: readonly ReservedHueArc[] = Object.freeze([
  Object.freeze({ name: 'crit', center: 25, halfWidth: 18 } as const),
  Object.freeze({ name: 'warn', center: 85, halfWidth: 18 } as const),
  Object.freeze({ name: 'ok', center: 150, halfWidth: 18 } as const),
])

/**
 * How many distinct chip colours the scale has.
 *
 * Twelve is the largest count whose slots stay at least 21 degrees apart on the
 * 252 degrees the reserved arcs leave, and 21 degrees is roughly where two chip
 * FILLS stop being reliably distinguishable (their chroma after the mix is only
 * ~0.062–0.081, so a hue step buys little OKLab distance — the more saturated
 * ink carries the rest of the signal). Raising it makes two categories that
 * "have different colours" look the same, which is worse than an honest
 * collision: at twelve slots, values that collide are IDENTICAL rather than
 * subtly-different-but-not-really.
 */
export const CHIP_HUE_SLOT_COUNT = 12

/** Circular distance between two hues, in degrees (0–180). */
function hueDistance(a: number, b: number): number {
  const raw = (((a - b) % 360) + 360) % 360
  return Math.min(raw, 360 - raw)
}

/** Whether `hue` falls inside a {@link RESERVED_HUE_ARCS} band. */
export function isReservedHue(hue: number): boolean {
  return RESERVED_HUE_ARCS.some((arc) => hueDistance(hue, arc.center) < arc.halfWidth)
}

/** The unreserved arcs, as `{ start, length }` walking upward from the end of
 * each reserved band to the start of the next (wrapping past 360). */
function allowedArcs(): readonly { readonly start: number; readonly length: number }[] {
  const bands = RESERVED_HUE_ARCS.map((arc) => ({
    start: arc.center - arc.halfWidth,
    end: arc.center + arc.halfWidth,
  })).sort((a, b) => a.start - b.start)
  return bands.map((band, i) => {
    const last = i === bands.length - 1
    const next = bands[last ? 0 : i + 1]!.start + (last ? 360 : 0)
    return { start: band.end, length: next - band.end }
  })
}

const ARCS = allowedArcs()
const ALLOWED_DEGREES = ARCS.reduce((total, arc) => total + arc.length, 0)

/** Position `pos` degrees along the concatenated allowed arcs. */
function hueAtArcPosition(pos: number): number {
  let remaining = pos
  for (const arc of ARCS) {
    if (remaining < arc.length) return (arc.start + remaining) % 360
    remaining -= arc.length
  }
  /* c8 ignore next -- unreachable: callers pass pos < ALLOWED_DEGREES */
  return ARCS[0]!.start
}

/**
 * The scale itself: {@link CHIP_HUE_SLOT_COUNT} hues, evenly spaced by ARC
 * LENGTH over the unreserved hues and centred in their slots. Even spacing by
 * arc length is what makes the minimum separation a guarantee — skipping a
 * reserved band only ever ADDS degrees between two neighbours.
 */
export const CHIP_HUES: readonly number[] = Object.freeze(
  Array.from({ length: CHIP_HUE_SLOT_COUNT }, (_, i) =>
    hueAtArcPosition((i + 0.5) * (ALLOWED_DEGREES / CHIP_HUE_SLOT_COUNT)),
  ),
)

/**
 * FNV-1a over UTF-16 code units, finished with murmur3's `fmix32` avalanche.
 *
 * The finaliser is not decoration. FNV-1a's low bits barely move between short
 * keys that share a suffix (`event-a` / `event-b`), and the slot is chosen with
 * a modulo, which reads exactly those bits — without `fmix32` a realistic corpus
 * of sibling category names lands in a handful of slots.
 */
function hash32(value: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * The hue for a category value — stable across sessions, machines and releases,
 * never inside a {@link RESERVED_HUE_ARCS} band, and always one of
 * {@link CHIP_HUES}.
 *
 * Feed it to `--chip-hue`; the chip's fill and ink are derived from that one
 * number by the recipe.
 */
export function chipHue(value: string): number {
  return CHIP_HUES[hash32(value) % CHIP_HUE_SLOT_COUNT]!
}

/**
 * `CHIP_HUE_SLOT_COUNT` coprime stride — the discrete analogue of the golden
 * angle. 5/12 = 0.4167 is the closest ratio to 1 - 1/phi = 0.382 that generates
 * the whole cycle, so consecutive indices land five slots (105 degrees) apart
 * instead of adjacent.
 */
const SEQUENTIAL_STRIDE = 5

/**
 * The hue for the `index`-th member of an ORDERED set, walked by a golden-angle
 * stride so that neighbours in the sequence are far apart on the wheel.
 *
 * This is where `--chart-1..5` and the chip scale agree: a chart with more
 * series than the five chart tokens define needs exactly this — an unbounded,
 * reserved-hue-respecting categorical scale allocated by position rather than by
 * name. Wraps (and repeats) past {@link CHIP_HUE_SLOT_COUNT}; a negative or
 * fractional index is normalised rather than rejected, because the caller is
 * usually an array index and a throw there would be a worse failure than a
 * repeat.
 */
export function chipHueAt(index: number): number {
  const n = Number.isFinite(index) ? Math.trunc(index) : 0
  const slot = ((n % CHIP_HUE_SLOT_COUNT) + CHIP_HUE_SLOT_COUNT) % CHIP_HUE_SLOT_COUNT
  return CHIP_HUES[(slot * SEQUENTIAL_STRIDE) % CHIP_HUE_SLOT_COUNT]!
}
