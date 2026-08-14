import { describe, it, expect, afterEach } from 'vitest'
import { attachFloating } from '../../src/utils/floating'
import {
  init as menuInit,
  update as menuUpdate,
  floatingDir as menuFloatingDir,
} from '../../src/components/menu'

/**
 * RTL alignment is negated by `@floating-ui/core` itself whenever
 * `platform.isRTL(floating)` is true — and only on the inline axis, so
 * `left-*`/`right-*` (whose alignment runs down the block axis) are left alone.
 *
 * We used to rewrite `bottom-start` → `bottom-end` BEFORE handing the placement
 * over, which double-negated it under `<html dir="rtl">`: the overlay landed
 * exactly where LTR would put it (#128). The wrapper now declares the direction
 * through the platform instead, so exactly one negation happens, on the right
 * axis, wherever the overlay is portaled.
 *
 * jsdom has no cascade for `direction`, so the "the page is RTL" half is set as
 * an inline style on the floating element — the same thing `platform.isRTL`
 * reads in a browser when `dir="rtl"` is inherited from `<html>`.
 */

function rect(x: number, y: number, w: number, h: number): DOMRect {
  return {
    x,
    y,
    width: w,
    height: h,
    top: y,
    left: x,
    right: x + w,
    bottom: y + h,
    toJSON: () => ({}),
  } as DOMRect
}

const ANCHOR = { x: 100, y: 50, width: 40, height: 20 }

async function placeX(opts: {
  placement: 'bottom-start' | 'bottom-end' | 'right-start' | 'right-end'
  dir?: 'ltr' | 'rtl'
  /** Whether the floating element itself computes to `direction: rtl`. */
  computedRtl?: boolean
}): Promise<{ x: number; y: number }> {
  const anchor = document.createElement('button')
  const floating = document.createElement('div')
  document.body.append(anchor, floating)
  if (opts.computedRtl) floating.style.direction = 'rtl'
  anchor.getBoundingClientRect = () => rect(ANCHOR.x, ANCHOR.y, ANCHOR.width, ANCHOR.height)
  floating.getBoundingClientRect = () => rect(0, 0, 0, 0)
  let seen: { x: number; y: number } | null = null
  const stop = attachFloating({
    anchor,
    floating,
    placement: opts.placement,
    // Off so the assertions read the raw placement maths, not viewport fitting.
    flip: false,
    shift: false,
    dir: opts.dir,
    onUpdate: ({ x, y }) => {
      seen = x != null ? { x, y } : seen
    },
  })
  await new Promise((r) => setTimeout(r, 0))
  stop()
  if (seen === null) throw new Error('attachFloating never reported a position')
  return seen
}

// The floating element measures 0×0 in jsdom, so a start-aligned box sits on
// the anchor's left edge and an end-aligned one on its right edge.
const LEFT_EDGE = ANCHOR.x
const RIGHT_EDGE = ANCHOR.x + ANCHOR.width

describe('attachFloating placement under rtl', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('ltr: -start is the left edge, -end the right edge', async () => {
    expect((await placeX({ placement: 'bottom-start' })).x).toBe(LEFT_EDGE)
    expect((await placeX({ placement: 'bottom-end' })).x).toBe(RIGHT_EDGE)
  })

  it('dir:rtl flips the inline alignment exactly once', async () => {
    expect((await placeX({ placement: 'bottom-start', dir: 'rtl' })).x).toBe(RIGHT_EDGE)
    expect((await placeX({ placement: 'bottom-end', dir: 'rtl' })).x).toBe(LEFT_EDGE)
  })

  it('dir:rtl still flips exactly once when the element itself computes rtl', async () => {
    // The regression: two negations cancelled and left the LTR coordinate.
    expect((await placeX({ placement: 'bottom-start', dir: 'rtl', computedRtl: true })).x).toBe(
      RIGHT_EDGE,
    )
    expect((await placeX({ placement: 'bottom-end', dir: 'rtl', computedRtl: true })).x).toBe(
      LEFT_EDGE,
    )
  })

  it('dir:ltr wins over an rtl page — the caller declares the direction', async () => {
    expect((await placeX({ placement: 'bottom-start', dir: 'ltr', computedRtl: true })).x).toBe(
      LEFT_EDGE,
    )
  })

  it('omitting dir leaves the page to decide, as before', async () => {
    expect((await placeX({ placement: 'bottom-start', computedRtl: true })).x).toBe(RIGHT_EDGE)
    expect((await placeX({ placement: 'bottom-start' })).x).toBe(LEFT_EDGE)
  })

  it('rtl does NOT touch the block-axis alignment of left/right placements', async () => {
    const ltr = await placeX({ placement: 'right-start' })
    const rtl = await placeX({ placement: 'right-start', dir: 'rtl' })
    expect(rtl.y).toBe(ltr.y)
    expect(rtl.y).toBe(ANCHOR.y)
  })
})

/**
 * `menu.overlay` is `attachFloating`'s only in-repo caller that passes `dir`,
 * and it passed `state.dir` unconditionally while `init` defaulted it to
 * `'ltr'`. Once `dir` became AUTHORITATIVE that default started SUPPRESSING an
 * RTL page: measured in Chromium, a menu on `<html dir="rtl">` moved from
 * x=20 (RTL-correct) to x=100 (LTR) — the headline fix regressing its only
 * live caller (#138 review, blocking 4).
 *
 * `MenuState.dir` is now `TextDirection | null`, `null` meaning "the host never
 * said — let the page decide", and `menuFloatingDir` is the one place that
 * decision is made.
 */
describe('menu never overrides the page direction it was not given', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('an unset dir reaches attachFloating as undefined', () => {
    expect(menuInit().dir).toBeNull()
    expect(menuFloatingDir(menuInit())).toBeUndefined()
  })

  it('an explicit dir is still authoritative', () => {
    expect(menuFloatingDir(menuInit({ dir: 'rtl' }))).toBe('rtl')
    expect(menuFloatingDir(menuInit({ dir: 'ltr' }))).toBe('ltr')
  })

  it('unset dir on an RTL page keeps the RTL coordinate', async () => {
    const state = menuInit()
    const placed = await placeX({
      placement: 'bottom-start',
      dir: menuFloatingDir(state),
      computedRtl: true,
    })
    expect(placed.x).toBe(RIGHT_EDGE)
  })

  it('unset dir on an LTR page keeps the LTR coordinate', async () => {
    const placed = await placeX({
      placement: 'bottom-start',
      dir: menuFloatingDir(menuInit()),
    })
    expect(placed.x).toBe(LEFT_EDGE)
  })

  it('setDir clears back to "let the page decide"', () => {
    const [s1] = menuUpdate(menuInit(), { type: 'setDir', dir: 'rtl' })
    expect(menuFloatingDir(s1)).toBe('rtl')
    const [s2] = menuUpdate(s1, { type: 'setDir', dir: null })
    expect(menuFloatingDir(s2)).toBeUndefined()
  })
})
