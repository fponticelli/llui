import { describe, it, expect, afterEach } from 'vitest'
import { attachFloating, type Placement } from '../../src/utils/floating'
import { init as menuInit, update as menuUpdate } from '../../src/components/menu'

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

// jsdom does no layout, so `documentElement.clientWidth/Height` are 0 and
// `detectOverflow` sees a zero-sized viewport — `shift` then pins everything to
// its padding. Give the tests a real viewport so the middleware cases measure
// the direction maths rather than jsdom's missing layout.
for (const [prop, value] of [
  ['clientWidth', 1024],
  ['clientHeight', 768],
] as const) {
  Object.defineProperty(document.documentElement, prop, { value, configurable: true })
}

async function placeX(opts: {
  placement: Placement
  dir?: 'ltr' | 'rtl'
  /** Whether the floating element itself computes to `direction: rtl`. */
  computedRtl?: boolean
  /** Both middlewares ALSO read `platform.isRTL`, and every production caller
   * turns them on (`overlay-engine.ts`), so the rtl cases must be provable with
   * them on too. Off by default so the base cases read the raw placement
   * maths, not viewport fitting (#138 review, item 10). */
  flip?: boolean
  shift?: boolean
  offset?: number
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
    flip: opts.flip ?? false,
    shift: opts.shift ?? false,
    offset: opts.offset ?? 0,
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

// The floating element measures 0×0 in jsdom (floating-ui reads its size from
// `offsetWidth`, which no `getBoundingClientRect` stub can supply), so a
// start-aligned box sits on the anchor's left edge and an end-aligned one on
// its right edge. Same fact as the reviewer's Chromium numbers, expressed
// without a width: the browser's 120-wide box at inline-end lands at
// RIGHT_EDGE - 120 = 20, versus 100 for inline-start.
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
 * and it now passes `state.dir` UNCONDITIONALLY — `MenuState` was migrated
 * onto the shared `@llui/interactions` direction-sync seam (#265 finding 6),
 * so `dir` is always a concrete `'ltr' | 'rtl'` and `dirSource` (`'dom'` |
 * `'explicit'`) is what records whether the host ever said. `init` is
 * DETERMINISTIC on the server (`dirSource: 'dom'`, `dir: 'ltr'`) and the real
 * page direction is resolved only after mount, by `directionSync` dispatching
 * `syncDomDir` — the same contract `navigation-menu`/`tabs`/`carousel`/
 * `pagination` all share. `setDir` is EXPLICIT and sticky: once a host calls
 * it, a later DOM observation cannot overwrite it (there is no longer a way to
 * clear back to "follow the page" — a breaking, documented change).
 */
describe('menu direction follows the shared direction-sync seam', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('an unconfigured dir is deterministic (dom-sourced, ltr) before any sync', () => {
    expect(menuInit().dir).toBe('ltr')
    expect(menuInit().dirSource).toBe('dom')
  })

  it('an explicit dir is authoritative from init', () => {
    const rtl = menuInit({ dir: 'rtl' })
    expect(rtl.dir).toBe('rtl')
    expect(rtl.dirSource).toBe('explicit')
    expect(menuInit({ dir: 'ltr' }).dir).toBe('ltr')
  })

  it('a DOM-sourced rtl sync keeps the RTL coordinate', async () => {
    const [state] = menuUpdate(menuInit(), { type: 'syncDomDir', dir: 'rtl' })
    const placed = await placeX({
      placement: 'bottom-start',
      dir: state.dir,
      computedRtl: true,
    })
    expect(placed.x).toBe(RIGHT_EDGE)
  })

  it('the deterministic pre-sync ltr default keeps the LTR coordinate', async () => {
    const placed = await placeX({
      placement: 'bottom-start',
      dir: menuInit().dir,
    })
    expect(placed.x).toBe(LEFT_EDGE)
  })

  it('setDir is explicit and sticky against a later DOM sync', () => {
    const [s1] = menuUpdate(menuInit(), { type: 'setDir', dir: 'rtl' })
    expect(s1.dir).toBe('rtl')
    expect(s1.dirSource).toBe('explicit')
    const [s2] = menuUpdate(s1, { type: 'syncDomDir', dir: 'ltr' })
    expect(s2.dir).toBe('rtl')
    expect(s2.dirSource).toBe('explicit')
  })
})

/**
 * The coordinate tests above run with `flip: false, shift: false`, but BOTH
 * middlewares also consult `platform.isRTL` (`flip` for its cross-axis
 * overflow sides, `offset` for its cross-axis sign) and every production caller
 * enables them — `overlay-engine.ts` passes `flip`/`shift` through with `true`
 * defaults. A fix that only holds with the middleware off is not a fix
 * (#138 review, item 10).
 */
describe('the middlewares production actually enables keep one negation', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  const on = { flip: true, shift: true, offset: 4 } as const

  it('dir:rtl on an rtl page still flips exactly once with flip+shift+offset on', async () => {
    expect(
      (await placeX({ placement: 'bottom-start', dir: 'rtl', computedRtl: true, ...on })).x,
    ).toBe(RIGHT_EDGE)
    expect(
      (await placeX({ placement: 'bottom-end', dir: 'rtl', computedRtl: true, ...on })).x,
    ).toBe(LEFT_EDGE)
  })

  it('an undeclared dir still follows the page with the middleware on', async () => {
    expect((await placeX({ placement: 'bottom-start', computedRtl: true, ...on })).x).toBe(
      RIGHT_EDGE,
    )
    expect((await placeX({ placement: 'bottom-start', ...on })).x).toBe(LEFT_EDGE)
  })

  it('top-* mirrors bottom-* on the inline axis', async () => {
    expect((await placeX({ placement: 'top-start' })).x).toBe(LEFT_EDGE)
    expect((await placeX({ placement: 'top-end' })).x).toBe(RIGHT_EDGE)
    expect((await placeX({ placement: 'top-start', dir: 'rtl' })).x).toBe(RIGHT_EDGE)
    expect((await placeX({ placement: 'top-end', dir: 'rtl' })).x).toBe(LEFT_EDGE)
  })

  it('suffix-less physical placements are centred whatever the direction', async () => {
    const centre = ANCHOR.x + ANCHOR.width / 2
    expect((await placeX({ placement: 'bottom' })).x).toBe(centre)
    expect((await placeX({ placement: 'bottom', dir: 'rtl' })).x).toBe(centre)
    expect((await placeX({ placement: 'top', dir: 'rtl' })).x).toBe(centre)
    // `left`/`right` sit off the anchor's edges; direction never moves them.
    expect((await placeX({ placement: 'left', dir: 'rtl' })).x).toBe(
      (await placeX({ placement: 'left' })).x,
    )
  })

  it('left-start is NOT flipped by rtl — its alignment runs down the block axis', async () => {
    const ltr = await placeX({ placement: 'left-start' })
    const rtl = await placeX({ placement: 'left-start', dir: 'rtl' })
    expect(rtl).toEqual(ltr)
    expect(ltr.y).toBe(ANCHOR.y)
    // The deleted `flipPlacement('left-start', 'rtl') === 'left-end'` claimed
    // otherwise; left-end is a DIFFERENT y, which is why that test was wrong.
    const end = await placeX({ placement: 'left-end' })
    expect(end.y).toBe(ANCHOR.y + ANCHOR.height)
    expect(end.y).not.toBe(ltr.y)
  })
})
