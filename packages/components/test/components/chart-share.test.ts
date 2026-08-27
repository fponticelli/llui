import { describe, it, expect, vi } from 'vitest'
import { signalOf } from '../_signal'
import {
  init,
  update,
  connect,
  geometry,
  type ChartRow,
  type ChartState,
} from '../../src/components/chart'

/** One series, many rows — the shape a pie actually has. */
const PIE_SERIES = [{ key: 'visitors', label: 'Visitors', mark: 'bar' as const }]
const BROWSERS: ChartRow[] = [
  { label: 'Chrome', values: { visitors: 275 } },
  { label: 'Safari', values: { visitors: 200 } },
  { label: 'Firefox', values: { visitors: 187 } },
  { label: 'Edge', values: { visitors: 173 } },
]

const pie = (over: Partial<ChartState> = {}): ChartState => ({
  ...init({
    series: PIE_SERIES,
    rows: BROWSERS,
    domain: 'share',
    coord: 'polar',
    label: 'Visitors by browser',
    width: 200,
    height: 200,
  }),
  ...over,
})

const total = BROWSERS.reduce((a, r) => a + r.values.visitors!, 0)

describe('chart — the share domain', () => {
  it('defaults to the value domain, and setDomain switches it', () => {
    const s = init({ series: PIE_SERIES })
    expect(s.domain).toBe('value')
    const [next] = update(s, { type: 'setDomain', domain: 'share' })
    expect(next.domain).toBe('share')
    // Identity on a no-op, like every other setter here.
    const [same] = update(next, { type: 'setDomain', domain: 'share' })
    expect(same).toBe(next)
  })

  it('keeps state JSON-serializable key-for-key (#177)', () => {
    const s = pie()
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })

  it('allocates one wedge per row, in proportion to its value', () => {
    const g = geometry(pie())
    expect(g.slices).not.toBeNull()
    const expected = [275, 200, 187, 173].map((n) => n / total)
    g.slices!.forEach((slice, i) => expect(slice.share).toBeCloseTo(expected[i]!, 12))
    // Whatever the float noise, they must still tile the whole axis.
    expect(g.slices![0]!.start).toBe(0)
    expect(g.slices![3]!.end).toBe(1)
    expect(g.marks).toHaveLength(4)
    expect(g.marks.every((m) => m.mark === 'bar')).toBe(true)
    expect(g.marks.map((m) => m.index)).toEqual([0, 1, 2, 3])
  })

  // The point of doing this as a domain rather than a mark type: `coord` still
  // re-projects ONE dataset. The allocation must be identical either way, and
  // only the paths differ.
  it('re-projects the same allocation as a cartesian 100%-share bar', () => {
    const asPie = geometry(pie())
    const asBar = geometry(pie({ coord: 'cartesian' }))
    expect(asBar.slices).toEqual(asPie.slices)
    expect(asBar.marks).toHaveLength(asPie.marks.length)
    expect(asBar.marks.map((m) => m.index)).toEqual(asPie.marks.map((m) => m.index))
    // Same data, different projection — so every path must differ.
    for (let i = 0; i < asBar.marks.length; i++) {
      expect(asBar.marks[i]!.d).not.toEqual(asPie.marks[i]!.d)
      expect(asBar.marks[i]!.d).not.toBe('')
    }
  })

  // The magnitude is the spacing here. An iso-magnitude ring would be a line of
  // constant DEPTH, which says nothing about the numbers — and a reader will
  // try to read it.
  it('emits no value gridlines', () => {
    expect(geometry(pie()).gridLines).toEqual([])
    expect(geometry(pie({ domain: 'value' })).gridLines.length).toBeGreaterThan(0)
  })

  it('labels each wedge at its own middle', () => {
    const g = geometry(pie())
    expect(g.categoryTicks.map((c) => c.label)).toEqual(['Chrome', 'Safari', 'Firefox', 'Edge'])
    // Pin the ACTUAL placement against the projection, not merely "somewhere
    // other than the equal-slot position" — the band scale drops its padding
    // under a share domain, so the two differ slightly even when the label is
    // taking the wrong `u`, and a not-close-to assertion passes on that bug.
    g.categoryTicks.forEach((tick, i) => {
      const slice = g.slices![i]!
      const at = g.projection.tick((slice.start + slice.end) / 2)
      expect(tick.x).toBeCloseTo(at.x, 9)
      expect(tick.y).toBeCloseTo(at.y, 9)
    })
    // And the first label really is somewhere an equal slot would not put it.
    const equalSlot = g.projection.tick(1 / 8)
    expect(g.categoryTicks[0]!.x).not.toBeCloseTo(equalSlot.x, 3)
  })

  it('gives a zero or negative row no wedge and no label', () => {
    const rows: ChartRow[] = [
      { label: 'A', values: { visitors: 10 } },
      { label: 'Gone', values: { visitors: 0 } },
      { label: 'Negative', values: { visitors: -5 } },
      { label: 'B', values: { visitors: 10 } },
    ]
    const g = geometry(pie({ rows }))
    expect(g.marks.map((m) => m.index)).toEqual([0, 3])
    expect(g.categoryTicks.map((c) => c.label)).toEqual(['A', 'B'])
    // And the two that remain still split the whole circle between them.
    expect(g.slices!.map((x) => x.share)).toEqual([0.5, 0, 0, 0.5])
  })

  it('draws nothing at all when no row is positive, without emitting NaN', () => {
    const g = geometry(pie({ rows: [{ label: 'A', values: { visitors: 0 } }] }))
    expect(g.marks).toEqual([])
    expect(g.categoryTicks).toEqual([])
  })

  // A line along an axis whose spacing already encodes the magnitude would
  // place every point at a position that means something else.
  it('declines line and area series rather than approximating them', () => {
    const g = geometry(
      pie({
        series: [
          { key: 'visitors', label: 'Visitors', mark: 'bar' },
          { key: 'trend', label: 'Trend', mark: 'line' },
          { key: 'fill', label: 'Fill', mark: 'area' },
        ],
      }),
    )
    expect(new Set(g.marks.map((m) => m.seriesKey))).toEqual(new Set(['visitors']))
    expect(g.vertices).toEqual([])
  })

  it('reports each row share on the tooltip, and null under a value domain', () => {
    const g = geometry(pie({ activeIndex: 0 }))
    expect(g.tooltipRows).toHaveLength(1)
    expect(g.tooltipRows[0]!.value).toBe(275)
    expect(g.tooltipRows[0]!.share).toBeCloseTo(275 / total, 12)

    const v = geometry(pie({ domain: 'value', activeIndex: 0 }))
    expect(v.tooltipRows[0]!.share).toBeNull()
  })

  it('anchors the tooltip inside the active wedge', () => {
    const g = geometry(pie({ activeIndex: 1 }))
    expect(g.tooltipAt).not.toBeNull()
    // Centre is (100, 100) with outer radius 100 less the frame inset, so a
    // mid-depth anchor is strictly inside the disc and off the centre.
    const d = Math.hypot(g.tooltipAt!.x - 100, g.tooltipAt!.y - 100)
    expect(d).toBeGreaterThan(0)
    expect(d).toBeLessThan(100)
  })

  it('gives a second bar series its own concentric ring and its own allocation', () => {
    const g = geometry(
      pie({
        series: [
          { key: 'a', label: 'A', mark: 'bar' },
          { key: 'b', label: 'B', mark: 'bar' },
        ],
        rows: [
          { label: 'x', values: { a: 1, b: 3 } },
          { label: 'y', values: { a: 1, b: 1 } },
        ],
      }),
    )
    expect(g.marks).toHaveLength(4)
    // Each ring is proportional to ITSELF — that is what makes a nested donut
    // readable — so the two rings do not share one allocation.
    const a = g.marks.filter((m) => m.seriesKey === 'a')
    const b = g.marks.filter((m) => m.seriesKey === 'b')
    expect(a[0]!.d).not.toEqual(b[0]!.d)
    // The pointer follows the FIRST bar series.
    expect(g.slices!.map((s) => s.share)).toEqual([0.5, 0.5])
  })

  // The test above cannot see a DEPTH bug: its two series already have
  // different allocations, so the paths differ whether or not the rings were
  // given separate depth slots. Give them the SAME allocation and the depth is
  // the only thing left that can tell them apart.
  it('separates concentric rings by depth, not only by allocation', () => {
    const identical = pie({
      series: [
        { key: 'a', label: 'A', mark: 'bar' },
        { key: 'b', label: 'B', mark: 'bar' },
      ],
      rows: [
        { label: 'x', values: { a: 1, b: 2 } },
        { label: 'y', values: { a: 1, b: 2 } },
      ],
    })
    const g = geometry(identical)
    const a = g.marks.filter((m) => m.seriesKey === 'a')
    const b = g.marks.filter((m) => m.seriesKey === 'b')
    // Same shares on both rings — proving the allocation cannot distinguish
    // them, so the assertion below is about depth alone.
    expect(g.slices!.map((s) => s.share)).toEqual([0.5, 0.5])
    expect(a[0]!.d).not.toEqual(b[0]!.d)

    // A single series must still fill the whole depth.
    const solo = geometry(pie({ rows: [{ label: 'only', values: { visitors: 1 } }] }))
    expect(solo.marks).toHaveLength(1)
  })
})

describe('chart — the share hit test', () => {
  function hit(state: ChartState, x: number, y: number): number | null {
    const send = vi.fn()
    // The hit test reads state through `peek()`, so the handle has to carry a
    // live value — `rootSignal()` deliberately has none.
    const parts = connect(signalOf(state), send, { id: 'c' })
    const currentTarget = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: state.width, height: state.height }),
    }
    parts.svg.onPointerMove({ currentTarget, clientX: x, clientY: y } as unknown as PointerEvent)
    const call = send.mock.calls.at(-1)?.[0] as { type: string; index: number | null } | undefined
    return call?.type === 'setActive' ? call.index : null
  }

  // Slices tile with no gaps, so containment is exact. Nearest-CENTRE would
  // hand a thin wedge's own interior to the wide one beside it.
  it('answers the wedge the pointer is actually inside', () => {
    const state = pie({
      rows: [
        { label: 'Thin', values: { visitors: 1 } },
        { label: 'Wide', values: { visitors: 99 } },
      ],
    })
    // Just clockwise of 12 o'clock is inside the 1% wedge; centre is (100,100).
    expect(hit(state, 103, 40)).toBe(0)
    // Round the other side is deep inside the 99% wedge.
    expect(hit(state, 40, 140)).toBe(1)
  })
})

describe('chart — radial bars (polar with the axes swapped)', () => {
  const radial = (over: Partial<ChartState> = {}): ChartState => ({
    ...init({
      series: PIE_SERIES,
      rows: BROWSERS,
      coord: 'polar',
      horizontal: true,
      label: 'Visitors by browser',
      width: 200,
      height: 200,
    }),
    ...over,
  })

  // `horizontal` already means "the independent axis moves off its default
  // screen axis". In polar that reads "off the angle, onto the radius", so a
  // consumer flipping `coord` keeps the orientation they asked for instead of
  // silently getting the other one.
  it('honours the same horizontal flag polar used to ignore', () => {
    const rings = geometry(radial())
    const wedges = geometry(radial({ horizontal: false }))
    expect(rings.marks).toHaveLength(4)
    expect(wedges.marks).toHaveLength(4)
    for (let i = 0; i < 4; i++) {
      expect(rings.marks[i]!.d).not.toEqual(wedges.marks[i]!.d)
      expect(rings.marks[i]!.d).not.toBe('')
    }
  })

  it('gives every category its own ring, one mark per row', () => {
    const g = geometry(radial())
    expect(g.marks.map((m) => m.index)).toEqual([0, 1, 2, 3])
    expect(g.projection.closed).toBe(false)
  })

  // Magnitude is the angle here, so a value gridline is a spoke and the value
  // ticks live around the rim. Both come straight from the projection — the
  // machine does not branch on the coordinate system.
  it('still draws a value axis, unlike a share domain', () => {
    const g = geometry(radial())
    expect(g.gridLines.length).toBeGreaterThan(0)
    // A spoke is two points joined; a ring is an arc.
    expect(g.gridLines[0]!.d).not.toContain('A')
  })

  it('hit-tests by distance from the centre', () => {
    const send = vi.fn()
    const state = radial()
    const parts = connect(signalOf(state), send, { id: 'c' })
    const currentTarget = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    }
    // Dead centre carries no category at all. A miss sends NOTHING rather than
    // clearing — passing over a gap must not drop the cursor the user has.
    parts.svg.onPointerMove({
      currentTarget,
      clientX: 100,
      clientY: 100,
    } as unknown as PointerEvent)
    expect(send).not.toHaveBeenCalled()

    // Out near the rim is the outermost ring, which is the last row.
    send.mockClear()
    parts.svg.onPointerMove({
      currentTarget,
      clientX: 195,
      clientY: 100,
    } as unknown as PointerEvent)
    expect(send.mock.calls.at(-1)?.[0]).toEqual({ type: 'setActive', index: 3 })
  })

  // Radial bars are a VALUE domain: the arcs state magnitude by arc length.
  // Combining them with a share domain would put the magnitude on the radius
  // as well, so the two must stay independently selectable.
  it('composes with a share domain without either overriding the other', () => {
    const g = geometry(radial({ domain: 'share' }))
    expect(g.slices).not.toBeNull()
    expect(g.marks).toHaveLength(4)
    // Share moved the magnitude onto the radius, so the rings are now sized by
    // value rather than evenly spaced — a different picture from either alone.
    expect(g.marks[0]!.d).not.toEqual(geometry(radial()).marks[0]!.d)
  })
})
