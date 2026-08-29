import { div, span } from '@llui/dom'
import { classPart } from '../../lib/utils'

/**
 * Meter — skin for `@llui/components/meter`. Unlike Progress, a meter shows a
 * measurement within a known range, so everything is tinted by `data-state`,
 * which carries the current band's TONE (`optimal` / `suboptimal` / `critical`
 * / `neutral`) rather than always primary.
 *
 * TWO presentations, from the same part bag:
 *
 *   - a classic gauge — `MeterTrack` > `MeterRange`, a bar filled to the value;
 *   - a REFERENCE RANGE (#235) — `MeterTrack` > one `MeterBand` per band, drawn
 *     from `parts.bands` with `each`, plus a `MeterMarker` at the reading. That
 *     is the shape of a lab result, a quota gauge or a score.
 *
 * The machine writes every position as an inline style (`inline-size` for the
 * range, `inset-inline-start` for a band and the marker), so the recipes supply
 * only the box and the colour.
 *
 * Note the tone names: they used to be `low`/`optimal`/`high` on the machine
 * while these recipes already said `critical`/`suboptimal`, so both of those
 * rules were dead CSS — the range painted `bg-primary` in every state. The
 * value arm of `scripts/test/registry-attrs.test.ts` could not see it because
 * the machine declared the attribute through a type ALIAS, which it reads as an
 * open type and declines to give a verdict on; the union is now spelled inline
 * there and the check covers this file.
 */
export const Meter = classPart(div, 'flex w-full flex-col gap-1.5')
export const MeterLabel = classPart(span, 'text-sm font-medium')
export const MeterTrack = classPart(
  div,
  'relative h-2 w-full overflow-hidden rounded-full bg-muted',
)
export const MeterRange = classPart(
  div,
  'h-full rounded-full bg-primary transition-all data-[state=critical]:bg-destructive data-[state=suboptimal]:bg-chart-4',
)

/**
 * One band of the reference range. Positioned by the machine; the tone is a
 * WASH under the marker rather than a solid fill, so a band never competes with
 * the reading for attention.
 */
export const MeterBand = classPart(
  div,
  'absolute inset-y-0 bg-muted-foreground/15 data-[state=optimal]:bg-primary/20 data-[state=suboptimal]:bg-chart-4/25 data-[state=critical]:bg-destructive/20',
)

/**
 * The reading itself, sitting on the banded track.
 *
 * `-translate-x-1/2` centres the 2px rule on the value, so at 0% and 100% one
 * of its two columns falls outside the track and `MeterTrack`'s
 * `overflow-hidden` clips it. MEASURED in headless Chromium (marker box 39–41
 * against a track of 40–360; 1 of 2 painted columns at each extreme, 2 of 2 in
 * the interior) rather than reasoned about, and kept:
 *
 *   - the marker stays VISIBLE at both ends, 1px narrower and 0.5px inset;
 *   - `overflow-hidden` is what clips the band washes to the rounded track, so
 *     dropping it to save the pixel leaves square corners under a round cap;
 *   - the alternative — an outer positioned box plus an inner clipping one —
 *     splits one component into two and makes the wrapper something a caller
 *     has to remember, which is the footgun `command`'s filter field
 *     demonstrated (see the registry rules in CLAUDE.md).
 *
 * Dropping the translate instead is strictly worse: the box then sits fully
 * OUTSIDE the track at 100% and is clipped away entirely.
 */
export const MeterMarker = classPart(
  div,
  'absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-foreground transition-all',
)
