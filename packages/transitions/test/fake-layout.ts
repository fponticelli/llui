/**
 * A jsdom element that reports a LAYOUT BOX — through both of the channels
 * `flip()` reads it from.
 *
 * jsdom has no layout engine, so every element reports a zero rect AND
 * `offsetLeft`/`offsetTop` of 0. Overriding `getBoundingClientRect` alone
 * describes a DOM that cannot exist: in a real one the two agree except for the
 * transforms the rect folds in, and `flip()` reads BOTH precisely because
 * neither is on its own transform-free and sub-pixel exact (see `layoutDelta`
 * in `src/flip.ts`). A fixture stating only the rect gets an answer to match.
 *
 * So a row's layout box is stated ONCE here and both channels are derived from
 * it, the way a browser derives them:
 *
 * - `getBoundingClientRect()` — the layout box with the element's `transform`
 *   folded in, at full precision.
 * - `offsetLeft` / `offsetTop` — the layout box alone, ROUNDED, because the
 *   CSSOM types them `long`. (Measured in Chromium 143: rows on a 33.333px
 *   pitch report 0/33/67/100/133/167 for true tops of
 *   0/33.33/66.66/99.98/133.31/166.64.) The rounding is not incidental detail —
 *   it is the whole reason the rect is still read at all.
 */

export interface Box {
  left: number
  top: number
}

/** Which of the two channels a read came through. */
export type ReadKind = 'rect' | 'offset'

export interface FakeLayoutOptions {
  /** The element's computed `transform`, as a browser would report it. */
  transform?: () => string
  /** Called on every read, so a test can assert the read/write batching. */
  onRead?: (kind: ReadKind) => void
}

/**
 * The translation component of a computed `transform`.
 *
 * A BROWSER serializes a computed transform as `matrix(a, b, c, d, tx, ty)`,
 * never as the authored function — so an author-set `transform` reads back in
 * that form, and `getBoundingClientRect` folds it into the box. jsdom reports
 * `none` for both, which is exactly why the author-transform cases were
 * invisible to this suite before the fixtures modelled it.
 */
export function parseTranslate(value: string): [number, number] {
  const m = value.match(/translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/)
  if (m) return [parseFloat(m[1]!), parseFloat(m[2]!)]
  const matrix = value.match(/^matrix\(([^)]*)\)$/)
  if (matrix) {
    const parts = matrix[1]!.split(',')
    return [parseFloat(parts[4] ?? '0'), parseFloat(parts[5] ?? '0')]
  }
  return [0, 0]
}

/** Make `el` report `box()` as its layout box through both channels. */
export function fakeLayout(el: HTMLElement, box: () => Box, opts: FakeLayoutOptions = {}): void {
  const read = opts.onRead ?? ((): void => {})
  el.getBoundingClientRect = (): DOMRect => {
    read('rect')
    const { left, top } = box()
    const [dx, dy] = parseTranslate(opts.transform?.() ?? 'none')
    return { left: left + dx, top: top + dy, width: 10, height: 10 } as DOMRect
  }
  const axes = [
    ['offsetLeft', 'left'],
    ['offsetTop', 'top'],
  ] as const
  for (const [prop, axis] of axes) {
    Object.defineProperty(el, prop, {
      configurable: true,
      get: (): number => {
        read('offset')
        return Math.round(box()[axis])
      },
    })
  }
}
