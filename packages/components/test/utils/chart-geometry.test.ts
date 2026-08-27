import { describe, it, expect } from 'vitest'
import {
  bandCenter,
  bandExtent,
  nearestBand,
  niceDomain,
  normalize,
  denormalize,
  ticks,
  valueDomain,
} from '../../src/utils/scale'
import {
  annularSectorPath,
  areaPath,
  circlePath,
  curvePath,
  fmt,
  linearPath,
  monotonePath,
  polarPoint,
  rectPath,
} from '../../src/utils/path'
import {
  cartesianProjection,
  polarProjection,
  projectionFor,
  type Frame,
} from '../../src/utils/projection'

const FRAME: Frame = { x: 10, y: 20, width: 300, height: 200 }

describe('scale — normalize', () => {
  it('maps the domain ends to 0 and 1', () => {
    const d = { min: -50, max: 150 }
    expect(normalize(-50, d)).toBe(0)
    expect(normalize(150, d)).toBe(1)
    expect(normalize(50, d)).toBeCloseTo(0.5)
  })

  it('round-trips through denormalize', () => {
    const d = { min: 3, max: 17 }
    for (const value of [3, 5.5, 10, 17]) {
      expect(denormalize(normalize(value, d), d)).toBeCloseTo(value)
    }
  })

  it('a DEGENERATE domain maps to the middle, never NaN', () => {
    // Dividing by a zero span is how a whole series becomes `NaN` in a path
    // string, which silently voids the entire path element.
    expect(normalize(7, { min: 7, max: 7 })).toBe(0.5)
    expect(Number.isNaN(normalize(7, { min: 7, max: 7 }))).toBe(false)
  })

  it('a non-finite value maps to 0 rather than propagating', () => {
    expect(normalize(NaN, { min: 0, max: 10 })).toBe(0)
    expect(normalize(Infinity, { min: 0, max: 10 })).toBe(0)
  })
})

describe('scale — ticks', () => {
  it('produces round numbers inside the range', () => {
    const t = ticks(0, 100, 5)
    expect(t).toEqual([0, 20, 40, 60, 80, 100])
  })

  it('handles fractional steps without float noise in the count', () => {
    const t = ticks(0, 1, 5)
    expect(t.length).toBeGreaterThan(2)
    for (const v of t) expect(v).toBeGreaterThanOrEqual(0)
    for (const v of t) expect(v).toBeLessThanOrEqual(1)
  })

  it('reverses when the range is descending', () => {
    expect(ticks(100, 0, 5)).toEqual([100, 80, 60, 40, 20, 0])
  })

  it('returns EMPTY rather than looping for an unusable range', () => {
    // The failure mode being pinned is a hang, not a wrong answer.
    expect(ticks(NaN, 10, 5)).toEqual([])
    expect(ticks(0, 10, 0)).toEqual([])
    expect(ticks(0, Infinity, 5)).toEqual([])
  })
})

describe('scale — niceDomain / valueDomain', () => {
  it('rounds outward to tick boundaries', () => {
    const d = niceDomain(3, 97, 5)
    expect(d.min).toBeLessThanOrEqual(3)
    expect(d.max).toBeGreaterThanOrEqual(97)
    expect(d.min % 20).toBe(0)
    expect(d.max % 20).toBe(0)
  })

  it('a derived domain always includes zero', () => {
    // A bar whose baseline is not zero misrepresents its own length.
    const d = valueDomain([40, 55, 62], { tickCount: 5 })
    expect(d.min).toBeLessThanOrEqual(0)
  })

  it('explicit bounds are honoured verbatim, in either order', () => {
    expect(valueDomain([1, 2], { min: 10, max: 90, tickCount: 5 })).toEqual({ min: 10, max: 90 })
    expect(valueDomain([1, 2], { min: 90, max: 10, tickCount: 5 })).toEqual({ min: 10, max: 90 })
  })

  it('a NON-FINITE bound is treated as ABSENT, not stored', () => {
    // `finiteBound`'s rule (#177). A NaN bound that survived would switch that
    // side of the range off entirely, because every comparison against it fails.
    const d = valueDomain([0, 10], { min: NaN, max: Infinity, tickCount: 5 })
    expect(Number.isFinite(d.min)).toBe(true)
    expect(Number.isFinite(d.max)).toBe(true)
    expect(d.max).toBeGreaterThan(0)
  })

  it('equal explicit bounds still yield a non-degenerate domain', () => {
    expect(valueDomain([], { min: 5, max: 5, tickCount: 5 })).toEqual({ min: 5, max: 6 })
  })

  it('no data yields a usable unit domain', () => {
    const d = valueDomain([], { tickCount: 5 })
    expect(d.max).toBeGreaterThan(d.min)
  })
})

describe('scale — band', () => {
  const band = { count: 4, paddingInner: 0.25, paddingOuter: 0.15 }

  it('bands are ordered, disjoint and inside [0,1]', () => {
    let prevEnd = 0
    for (let i = 0; i < band.count; i++) {
      const [a, b] = bandExtent(i, band)
      expect(a).toBeGreaterThanOrEqual(prevEnd - 1e-9)
      expect(b).toBeGreaterThan(a)
      expect(b).toBeLessThanOrEqual(1 + 1e-9)
      prevEnd = b
    }
  })

  it('with no padding the bands tile [0,1] exactly', () => {
    const tight = { count: 5, paddingInner: 0, paddingOuter: 0 }
    expect(bandExtent(0, tight)[0]).toBeCloseTo(0)
    expect(bandExtent(4, tight)[1]).toBeCloseTo(1)
    expect(bandCenter(0, tight)).toBeCloseTo(0.1)
  })

  it('an empty axis yields a zero extent rather than dividing by zero', () => {
    expect(bandExtent(0, { count: 0, paddingInner: 0, paddingOuter: 0 })).toEqual([0, 0])
    expect(nearestBand(0.5, { count: 0, paddingInner: 0, paddingOuter: 0 })).toBeNull()
  })

  it('nearestBand snaps a centre back to its own index', () => {
    for (let i = 0; i < band.count; i++) {
      expect(nearestBand(bandCenter(i, band), band)).toBe(i)
    }
  })

  it('nearestBand has NO dead zone — a gap belongs to the closer band', () => {
    // Nearest-centre, not containment: a pointer between two bars must still
    // select one of them.
    const [, endOfFirst] = bandExtent(0, band)
    const [startOfSecond] = bandExtent(1, band)
    const inTheGap = (endOfFirst + startOfSecond) / 2
    expect(nearestBand(inTheGap, band)).not.toBeNull()
    expect(nearestBand(0, band)).toBe(0)
    expect(nearestBand(1, band)).toBe(band.count - 1)
    expect(nearestBand(-5, band)).toBe(0)
    expect(nearestBand(5, band)).toBe(band.count - 1)
  })
})

describe('path — fmt', () => {
  it('is STABLE: equal geometry yields an identical string', () => {
    // The reconciler commits on output-equality, so a path recomputed from
    // unchanged data must be byte-identical or every mark re-commits.
    expect(fmt(0.1 + 0.2)).toBe(fmt(0.3))
    expect(fmt(-0)).toBe(fmt(0))
    expect(fmt(1 / 3)).toBe(fmt(0.3333333))
  })

  it('a non-finite coordinate becomes 0, never NaN', () => {
    // One `NaN` voids the WHOLE path element, taking every later command.
    expect(fmt(NaN)).toBe('0')
    expect(fmt(Infinity)).toBe('0')
  })
})

describe('path — curves', () => {
  const pts = [
    { x: 0, y: 10 },
    { x: 10, y: 0 },
    { x: 20, y: 20 },
    { x: 30, y: 15 },
  ]

  it('linear visits every point', () => {
    const d = linearPath(pts)
    expect(d.startsWith('M0,10')).toBe(true)
    expect(d).toContain('L30,15')
  })

  it('closed linear ends with Z', () => {
    expect(linearPath(pts, true).endsWith('Z')).toBe(true)
    expect(linearPath(pts, false).endsWith('Z')).toBe(false)
  })

  it('empty and single-point runs are safe', () => {
    expect(linearPath([])).toBe('')
    expect(monotonePath([])).toBe('')
    expect(monotonePath([{ x: 1, y: 2 }])).toBe('M1,2')
  })

  it('monotone NEVER OVERSHOOTS between samples', () => {
    // The defining guarantee, and the whole reason to use it over a cardinal
    // spline: a curve that overshoots draws a value nobody measured.
    const rising = [
      { x: 0, y: 0 },
      { x: 10, y: 1 },
      { x: 20, y: 30 },
      { x: 30, y: 31 },
    ]
    const d = monotonePath(rising)
    // Sample every control point in the emitted cubics; each segment's controls
    // must stay within its own endpoints' y range.
    const nums = [...d.matchAll(/C([-\d.]+),([-\d.]+) ([-\d.]+),([-\d.]+) ([-\d.]+),([-\d.]+)/g)]
    expect(nums.length).toBe(3)
    nums.forEach((m, i) => {
      const y0 = rising[i]!.y
      const y1 = rising[i + 1]!.y
      const lo = Math.min(y0, y1) - 1e-6
      const hi = Math.max(y0, y1) + 1e-6
      expect(Number(m[2])).toBeGreaterThanOrEqual(lo)
      expect(Number(m[2])).toBeLessThanOrEqual(hi)
      expect(Number(m[4])).toBeGreaterThanOrEqual(lo)
      expect(Number(m[4])).toBeLessThanOrEqual(hi)
    })
  })

  it('monotone flattens the tangent at a local extremum', () => {
    // The sign-change clamp. Without it the curve rounds OVER the peak and
    // reports a maximum that is not in the data.
    const peak = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ]
    const d = monotonePath(peak)
    const segs = [...d.matchAll(/C([-\d.]+),([-\d.]+) ([-\d.]+),([-\d.]+)/g)]
    // Both controls adjacent to the peak sit exactly at the peak's height.
    expect(Number(segs[0]![4])).toBeCloseTo(10)
    expect(Number(segs[1]![2])).toBeCloseTo(10)
  })

  it('curvePath dispatches on the named curve', () => {
    expect(curvePath(pts, 'linear')).toBe(linearPath(pts))
    expect(curvePath(pts, 'monotone')).toBe(monotonePath(pts))
    expect(curvePath(pts, 'step')).toContain('L5,10')
  })

  it('areaPath closes and returns along the lower run', () => {
    const lower = pts.map((p) => ({ x: p.x, y: 40 }))
    const d = areaPath(pts, lower, 'linear')
    expect(d.endsWith('Z')).toBe(true)
    // The seam is a LineTo, not a second MoveTo — a second subpath lets the
    // fill-rule punch a hole through the band.
    expect(d.match(/M/g)!.length).toBe(1)
  })
})

describe('path — polar primitives', () => {
  it('polarPoint measures clockwise from 12 o’clock', () => {
    const up = polarPoint(0, 0, 10, 0)
    expect(up.x).toBeCloseTo(0)
    expect(up.y).toBeCloseTo(-10)
    const right = polarPoint(0, 0, 10, Math.PI / 2)
    expect(right.x).toBeCloseTo(10)
    expect(right.y).toBeCloseTo(0)
  })

  it('circlePath uses TWO arcs', () => {
    // A single 360° arc is degenerate — its endpoints coincide and SVG draws
    // nothing, which is the classic vanishing polar gridline.
    const d = circlePath(0, 0, 10)
    expect(d.match(/A/g)!.length).toBe(2)
    expect(circlePath(0, 0, 0)).toBe('')
  })

  it('a full-turn sector draws a ring, not an empty path', () => {
    const ring = annularSectorPath(0, 0, 0, 10, 0, Math.PI * 2)
    expect(ring.length).toBeGreaterThan(0)
    expect(ring).toContain('A')
  })

  it('a donut sector closes back through the inner arc', () => {
    const d = annularSectorPath(0, 0, 5, 10, 0, Math.PI / 2)
    expect(d.match(/A/g)!.length).toBe(2)
    expect(d.endsWith('Z')).toBe(true)
  })

  it('a pie wedge closes through the centre', () => {
    const d = annularSectorPath(0, 0, 0, 10, 0, Math.PI / 2)
    expect(d).toContain('L0,0Z')
  })

  it('a zero or negative sweep draws nothing', () => {
    expect(annularSectorPath(0, 0, 0, 10, 1, 1)).toBe('')
    expect(annularSectorPath(0, 0, 0, 0, 0, 1)).toBe('')
  })

  it('sets the large-arc flag past a half turn', () => {
    expect(annularSectorPath(0, 0, 0, 10, 0, Math.PI / 2)).toContain('0 0 1')
    expect(annularSectorPath(0, 0, 0, 10, 0, Math.PI * 1.5)).toContain('0 1 1')
  })

  it('rectPath normalizes corner order', () => {
    expect(rectPath(10, 20, 0, 0)).toBe(rectPath(0, 0, 10, 20))
  })
})

describe('projection — the cartesian/polar seam', () => {
  it('both projections satisfy the same interface', () => {
    for (const p of [cartesianProjection(FRAME), polarProjection(FRAME)]) {
      expect(typeof p.point).toBe('function')
      expect(typeof p.line).toBe('function')
      expect(typeof p.area).toBe('function')
      expect(typeof p.band).toBe('function')
      expect(typeof p.gridline).toBe('function')
      expect(typeof p.tick).toBe('function')
      expect(typeof p.valueTick).toBe('function')
      expect(typeof p.locate).toBe('function')
    }
  })

  it('projectionFor selects by coord', () => {
    expect(projectionFor('cartesian', FRAME).kind).toBe('cartesian')
    expect(projectionFor('polar', FRAME).kind).toBe('polar')
  })

  it('cartesian: v grows UPWARD, u rightward', () => {
    const p = cartesianProjection(FRAME)
    expect(p.point(0, 0)).toEqual({ x: 10, y: 220 })
    expect(p.point(1, 1)).toEqual({ x: 310, y: 20 })
  })

  it('cartesian horizontal swaps the axes and nothing else', () => {
    const p = cartesianProjection(FRAME, { horizontal: true })
    expect(p.point(0, 0)).toEqual({ x: 10, y: 20 })
    expect(p.point(1, 1)).toEqual({ x: 310, y: 220 })
    // The value tick moves to the bottom edge, the category tick to the left.
    expect(p.tick(0.5).anchor).toBe('end')
    expect(p.valueTick(0.5).baseline).toBe('hanging')
  })

  it('polar: u is an angle clockwise from 12, v is a radius', () => {
    const p = polarProjection({ x: 0, y: 0, width: 200, height: 200 })
    const top = p.point(0, 1)
    expect(top.x).toBeCloseTo(100)
    expect(top.y).toBeCloseTo(0)
    const centre = p.point(0, 0)
    expect(centre.x).toBeCloseTo(100)
    expect(centre.y).toBeCloseTo(100)
  })

  it('polar innerRadius lifts v=0 off the centre', () => {
    const p = polarProjection({ x: 0, y: 0, width: 200, height: 200 }, { innerRadius: 0.5 })
    const inner = p.point(0, 0)
    expect(inner.y).toBeCloseTo(50)
  })

  it('a FULL-turn polar projection is closed; a partial one is not', () => {
    expect(polarProjection(FRAME).closed).toBe(true)
    expect(polarProjection(FRAME, { sweep: Math.PI }).closed).toBe(false)
    expect(cartesianProjection(FRAME).closed).toBe(false)
  })

  it('a closed polar line joins back to its first vertex', () => {
    const p = polarProjection(FRAME)
    const d = p.line(
      [
        { u: 0, v: 1 },
        { u: 0.33, v: 0.5 },
        { u: 0.66, v: 0.8 },
      ],
      'linear',
    )
    expect(d.endsWith('Z')).toBe(true)
  })

  it('polar DECLINES monotone and step rather than approximating them', () => {
    // Monotone cubic is defined on y = f(x) with increasing x; on a closed
    // angular loop the no-overshoot guarantee does not hold, so honouring the
    // request would draw values nobody measured.
    const p = polarProjection(FRAME)
    expect(p.curves).toEqual(['linear'])
    const samples = [
      { u: 0, v: 0.2 },
      { u: 0.5, v: 0.9 },
    ]
    expect(p.line(samples, 'monotone')).toBe(p.line(samples, 'linear'))
    expect(p.line(samples, 'step')).toBe(p.line(samples, 'linear'))
  })

  it('cartesian honours all three curves', () => {
    const p = cartesianProjection(FRAME)
    expect(p.curves).toEqual(['linear', 'monotone', 'step'])
    const samples = [
      { u: 0, v: 0 },
      { u: 0.5, v: 1 },
      { u: 1, v: 0.5 },
    ]
    expect(p.line(samples, 'monotone')).not.toBe(p.line(samples, 'linear'))
    expect(p.line(samples, 'step')).not.toBe(p.line(samples, 'linear'))
  })

  /**
   * `monotone` and `step` are defined on a function of the INDEPENDENT axis, and
   * `horizontal` moves that axis from x to y. Running them along x regardless
   * produced a curve whose control points were offset along the DEPENDENT axis:
   * measured, a four-point series emitted `M150,0C190,25 230,75 270,75`, where
   * the second control already sits at the segment's end instead of two thirds
   * along it. It reads as a smoothing artefact and is a wrong-axis bug.
   *
   * Note what is NOT enough to catch it: the ENDPOINTS are correct in both
   * orientations, so asserting that the path advances monotonically catches
   * nothing. The property that breaks is where the controls SIT.
   */
  const AXIS_FRAME: Frame = { x: 0, y: 0, width: 300, height: 300 }
  const WAVY = [
    { u: 0, v: 0.5 },
    { u: 0.25, v: 0.9 },
    { u: 0.5, v: 0.2 },
    { u: 0.75, v: 0.7 },
    { u: 1, v: 0.4 },
  ]
  const coordsOf = (d: string): Array<[number, number]> =>
    [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])])

  for (const horizontal of [false, true]) {
    const name = horizontal ? 'horizontal' : 'vertical'
    // Which coordinate the curve is a function OF.
    const indep = (c: [number, number]): number => (horizontal ? c[1] : c[0])
    const dep = (c: [number, number]): number => (horizontal ? c[0] : c[1])

    it(`monotone places its controls at the thirds of the INDEPENDENT axis (${name})`, () => {
      const p = cartesianProjection(AXIS_FRAME, { horizontal })
      const pts = WAVY.map((s) => p.point(s.u, s.v))
      const d = p.line(WAVY, 'monotone')
      const segs = [...d.matchAll(/C(-?[\d.]+),(-?[\d.]+) (-?[\d.]+),(-?[\d.]+)/g)]
      expect(segs.length).toBe(WAVY.length - 1)
      segs.forEach((m, i) => {
        const t0 = horizontal ? pts[i]!.y : pts[i]!.x
        const t1 = horizontal ? pts[i + 1]!.y : pts[i + 1]!.x
        const h = t1 - t0
        const c1: [number, number] = [Number(m[1]), Number(m[2])]
        const c2: [number, number] = [Number(m[3]), Number(m[4])]
        expect(indep(c1), `segment ${i} c1 in ${d}`).toBeCloseTo(t0 + h / 3, 3)
        expect(indep(c2), `segment ${i} c2 in ${d}`).toBeCloseTo(t1 - h / 3, 3)
      })
    })

    it(`monotone never overshoots on the dependent axis (${name})`, () => {
      const p = cartesianProjection(AXIS_FRAME, { horizontal })
      const pts = WAVY.map((s) => p.point(s.u, s.v))
      const d = p.line(WAVY, 'monotone')
      const segs = [...d.matchAll(/C(-?[\d.]+),(-?[\d.]+) (-?[\d.]+),(-?[\d.]+)/g)]
      segs.forEach((m, i) => {
        const w0 = horizontal ? pts[i]!.x : pts[i]!.y
        const w1 = horizontal ? pts[i + 1]!.x : pts[i + 1]!.y
        const lo = Math.min(w0, w1) - 1e-6
        const hi = Math.max(w0, w1) + 1e-6
        for (const c of [
          [Number(m[1]), Number(m[2])] as [number, number],
          [Number(m[3]), Number(m[4])] as [number, number],
        ]) {
          expect(dep(c), `segment ${i} overshoots in ${d}`).toBeGreaterThanOrEqual(lo)
          expect(dep(c)).toBeLessThanOrEqual(hi)
        }
      })
    })

    it(`step turns at the MIDPOINT of the independent axis (${name})`, () => {
      const p = cartesianProjection(AXIS_FRAME, { horizontal })
      const pts = WAVY.map((s) => p.point(s.u, s.v))
      const d = p.line(WAVY, 'step')
      const seen = coordsOf(d).map(indep)
      for (let i = 0; i < pts.length - 1; i++) {
        const t0 = horizontal ? pts[i]!.y : pts[i]!.x
        const t1 = horizontal ? pts[i + 1]!.y : pts[i + 1]!.x
        const mid = (t0 + t1) / 2
        expect(
          seen.some((v) => Math.abs(v - mid) < 1e-3),
          `no step at ${mid} on the independent axis in ${d}`,
        ).toBe(true)
      }
    })
  }

  it('an AREA joins its runs with the SAME curve axis as a line', () => {
    // Weaker forms of this test pass while `area` still runs the curve along the
    // wrong axis: counting subpaths and checking for a trailing `Z` are true of
    // the broken output too. Anchoring on the line path is what ties the two.
    for (const horizontal of [false, true]) {
      const p = cartesianProjection(AXIS_FRAME, { horizontal })
      const lower = WAVY.map((s) => ({ u: s.u, v: 0 }))
      const d = p.area(WAVY, lower, 'monotone')
      expect(d.endsWith('Z')).toBe(true)
      // Two subpaths would let the fill-rule punch through the band.
      expect(d.match(/M/g)!.length).toBe(1)
      expect(d.startsWith(p.line(WAVY, 'monotone'))).toBe(true)
    }
  })

  it('a band is a RECT in cartesian and a SECTOR in polar', () => {
    const rect = cartesianProjection(FRAME).band(0.1, 0.3, 0, 0.8)
    expect(rect).not.toContain('A')
    const wedge = polarProjection(FRAME).band(0.1, 0.3, 0, 0.8)
    expect(wedge).toContain('A')
  })

  it('a gridline is a RULE in cartesian and a RING or WEB in polar', () => {
    expect(cartesianProjection(FRAME).gridline(0.5)).toMatch(/^M[\d.,-]+L[\d.,-]+$/)
    expect(polarProjection(FRAME, { grid: 'ring' }).gridline(0.5)).toContain('A')
    const web = polarProjection(FRAME, { grid: 'web', spokes: 5 }).gridline(0.5)
    expect(web).not.toContain('A')
    expect(web.match(/L/g)!.length).toBe(4)
    expect(web.endsWith('Z')).toBe(true)
  })

  it('locate inverts point for both projections', () => {
    for (const p of [cartesianProjection(FRAME), polarProjection(FRAME)]) {
      for (const u of [0.1, 0.25, 0.5, 0.9]) {
        const pt = p.point(u, 0.7)
        expect(p.locate(pt.x, pt.y)).toBeCloseTo(u, 5)
      }
    }
  })

  it('polar locate wraps rather than returning a negative u', () => {
    const p = polarProjection({ x: 0, y: 0, width: 200, height: 200 })
    // Just anticlockwise of 12 o'clock is the END of the range, not before it.
    const pt = p.point(0.99, 0.8)
    const u = p.locate(pt.x, pt.y)!
    expect(u).toBeGreaterThan(0.9)
    expect(u).toBeLessThanOrEqual(1)
  })

  it('polar locate has no answer at the exact centre', () => {
    const p = polarProjection({ x: 0, y: 0, width: 200, height: 200 })
    expect(p.locate(100, 100)).toBeNull()
  })

  it('a zero-width cartesian frame reports no location instead of NaN', () => {
    const p = cartesianProjection({ x: 0, y: 0, width: 0, height: 100 })
    expect(p.locate(0, 50)).toBeNull()
  })
})
