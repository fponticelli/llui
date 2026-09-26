import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  toCss,
  colorAt,
  parseGradient,
  pickerStateOf,
  type GradientPickerState,
} from '../../src/components/gradient-picker'
import { parseCssColor, interpolateColor } from '../../src/utils/color'
import { DEFAULT_MAX_CHROMA } from '../../src/components/color-picker'
import { signalOf, read } from '../_signal'

// ── init ─────────────────────────────────────────────────────────────────────

describe('gradient-picker init', () => {
  it('defaults to a linear 90deg black->white gradient with two stops', () => {
    const s = init()
    expect(s.kind).toBe('linear')
    expect(s.repeating).toBe(false)
    expect(s.angle).toBe(90)
    expect(s.stops).toHaveLength(2)
    expect(s.stops[0]).toMatchObject({ position: 0 })
    expect(s.stops[1]).toMatchObject({ position: 100 })
    expect(s.minStops).toBe(2)
    expect(s.maxStops).toBeUndefined()
    expect(s.model).toBe('hsv')
    expect(s.disabled).toBe(false)
    expect(s.dir).toBe('ltr')
  })

  it('omits maxStops entirely when unset (round-trips as an identity)', () => {
    const s = init()
    expect('maxStops' in s).toBe(false)
    expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s)
  })

  it('accepts an explicit css string', () => {
    const s = init({ css: 'linear-gradient(45deg, red 0%, blue 100%)' })
    expect(s.angle).toBe(45)
    expect(s.stops).toHaveLength(2)
  })

  it('falls back to explicit stops / defaults on invalid css', () => {
    const s = init({ css: 'not-a-gradient()' })
    expect(s.kind).toBe('linear')
    expect(s.stops).toHaveLength(2)
  })

  it('accepts explicit stops, sorted, with sequential ids', () => {
    const s = init({
      stops: [
        { position: 80, color: 'blue' },
        { position: 10, color: 'red' },
      ],
    })
    expect(s.stops.map((st) => st.position)).toEqual([10, 80])
    expect(s.stops.map((st) => st.id)).toEqual(['s1', 's2'])
    expect(s.nextId).toBe(3)
    expect(s.selectedId).toBe('s1')
  })

  it('accepts a PickerColor object for a stop (not just a css string)', () => {
    const s = init({
      stops: [
        { position: 0, color: { model: 'oklch', l: 0.5, c: 0.1, h: 30 } },
        { position: 100, color: { model: 'hsv', h: 0, s: 0, v: 100 } },
      ],
    })
    expect(s.stops[0]!.color).toEqual({ model: 'oklch', l: 0.5, c: 0.1, h: 30 })
  })

  it('applies maxChroma / minStops / maxStops / model / disabled / dir options', () => {
    const s = init({
      maxChroma: 0.2,
      minStops: 3,
      maxStops: 4,
      model: 'oklch',
      disabled: true,
      dir: 'rtl',
    })
    expect(s.maxChroma).toBe(0.2)
    expect(s.minStops).toBe(3)
    expect(s.maxStops).toBe(4)
    expect(s.model).toBe('oklch')
    expect(s.disabled).toBe(true)
    expect(s.dir).toBe('rtl')
  })

  it('truncates explicit stops to maxStops', () => {
    const s = init({
      maxStops: 2,
      stops: [
        { position: 0, color: 'red' },
        { position: 33, color: 'green' },
        { position: 66, color: 'blue' },
        { position: 100, color: 'yellow' },
      ],
    })
    expect(s.stops).toHaveLength(2)
  })

  it('non-finite numeric options fall back to documented defaults', () => {
    const s = init({ angle: NaN, center: { x: NaN, y: Infinity }, maxChroma: NaN, minStops: NaN })
    expect(s.angle).toBe(90)
    expect(s.center).toEqual({ x: 50, y: 50 })
    expect(s.maxChroma).toBe(DEFAULT_MAX_CHROMA)
    expect(s.minStops).toBe(2)
  })
})

// ── update: every Msg ────────────────────────────────────────────────────────

describe('gradient-picker update', () => {
  it('addStop inserts sorted, colored exactly what colorAt reports there, and selects it', () => {
    // srgb interpolation: the stored HSV color round-trips byte-exactly
    // through integer sRGB, so this is a byte-for-byte check, not just a
    // numeric-closeness one.
    const s = init({ interpolation: { space: 'srgb' } })
    const before = colorAt(s, 50)
    const [next] = update(s, { type: 'addStop', position: 50 })
    expect(next.stops).toHaveLength(3)
    expect(next.stops[1]!.position).toBe(50)
    expect(next.selectedId).toBe(next.stops[1]!.id)
    // The new stop reproduces exactly what colorAt said was there before
    // insertion — read back through colorAt's own exact-stop-match branch.
    const shim: GradientPickerState = { ...next, stops: [next.stops[1]!] }
    expect(colorAt(shim, 50)).toBe(before)
  })

  it('addStop keeps the interpolated color NUMERICALLY exact even when the interpolation space (oklab) has no dedicated storage model', () => {
    // The default interpolation space is oklab, but PickerColor only stores
    // hsv/oklch. addStop must still preserve the VALUE exactly (oklab -> oklch
    // is a lossless polar/Cartesian change, not a gamut-mapping one) even
    // though the round-tripped CSS syntax differs (oklab() -> oklch()).
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'lime' },
      ],
    }) // default interpolation: oklab
    const before = colorAt(s, 50)
    const beforeParsed = parseCssColor(before)!
    const [next] = update(s, { type: 'addStop', position: 50 })
    const newStop = next.stops[1]!
    expect(newStop.color.model).toBe('oklch')
    if (beforeParsed.space === 'oklab') {
      const c = Math.sqrt(beforeParsed.a! * beforeParsed.a! + beforeParsed.b! * beforeParsed.b!)
      expect((newStop.color as { l: number }).l).toBeCloseTo(beforeParsed.l!, 3)
      expect((newStop.color as { c: number }).c).toBeCloseTo(c, 3)
    }
  })

  it('addStop clamps out-of-range positions', () => {
    const s = init()
    const [next] = update(s, { type: 'addStop', position: 150 })
    expect(next.stops.at(-1)!.position).toBe(100)
  })

  it('addStop is refused at maxStops', () => {
    const s = init({ maxStops: 2 })
    const [next] = update(s, { type: 'addStop', position: 50 })
    expect(next).toBe(s)
  })

  it('addStop with a non-finite position is an atomic no-op', () => {
    const s = init()
    expect(update(s, { type: 'addStop', position: NaN })[0]).toBe(s)
  })

  it('removeStop refuses below minStops', () => {
    const s = init() // 2 stops, minStops 2
    const [next] = update(s, { type: 'removeStop', id: s.stops[0]!.id })
    expect(next).toBe(s)
  })

  it('removeStop removes and reselects a neighbour when the selection was removed', () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 50, color: 'green' },
        { position: 100, color: 'blue' },
      ],
    })
    const [selected] = update(s, { type: 'selectStop', id: s.stops[1]!.id })
    const [next] = update(selected, { type: 'removeStop', id: s.stops[1]!.id })
    expect(next.stops).toHaveLength(2)
    expect(next.stops.some((st) => st.id === next.selectedId)).toBe(true)
    expect(next.selectedId).not.toBe(s.stops[1]!.id)
  })

  it('removeStop on an unknown id is a no-op', () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 50, color: 'green' },
        { position: 100, color: 'blue' },
      ],
    })
    expect(update(s, { type: 'removeStop', id: 'nope' })[0]).toBe(s)
  })

  it('selectStop selects an existing id, ignores an unknown one', () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'blue' },
      ],
    })
    const id = s.stops[1]!.id
    expect(update(s, { type: 'selectStop', id })[0].selectedId).toBe(id)
    expect(update(s, { type: 'selectStop', id: 'nope' })[0]).toBe(s)
  })

  it('moveStop clamps 0-100, re-sorts, and keeps selection by id', () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 50, color: 'green' },
        { position: 100, color: 'blue' },
      ],
    })
    const midId = s.stops[1]!.id
    const [selected] = update(s, { type: 'selectStop', id: midId })
    const [next] = update(selected, { type: 'moveStop', id: midId, position: -10 })
    // Ties are stable-by-insertion (new position wins the tie LAST), so the
    // pre-existing stop already at 0 stays ahead of the one moved onto it.
    expect(next.stops.map((st) => st.position)).toEqual([0, 0, 100])
    expect(next.stops.find((st) => st.id === midId)).toMatchObject({ position: 0 })
    expect(next.selectedId).toBe(midId)
    const [movedPast] = update(next, { type: 'moveStop', id: midId, position: 200 })
    expect(movedPast.stops.at(-1)).toMatchObject({ id: midId, position: 100 })
  })

  it('moveStop on an unknown id is a no-op', () => {
    const s = init()
    expect(update(s, { type: 'moveStop', id: 'nope', position: 50 })[0]).toBe(s)
  })

  it('moveStop with a non-finite position is an atomic no-op', () => {
    const s = init()
    expect(update(s, { type: 'moveStop', id: s.stops[0]!.id, position: NaN })[0]).toBe(s)
  })

  it('nudgeStop moves by a signed delta and re-sorts', () => {
    const s = init({
      stops: [
        { position: 10, color: 'red' },
        { position: 90, color: 'blue' },
      ],
    })
    const [next] = update(s, { type: 'nudgeStop', id: s.stops[1]!.id, delta: -85 })
    expect(next.stops.map((st) => st.position)).toEqual([5, 10])
  })

  it('selection survives a re-sort BY ID, even when the reorder changes which array index the selected stop lands at', () => {
    const s = init({
      stops: [
        { position: 10, color: 'red' },
        { position: 90, color: 'blue' },
      ],
    })
    const blueId = s.stops[1]!.id
    const [selected] = update(s, { type: 'selectStop', id: blueId })
    // Moving blue from 90 to 5 flips it ahead of red — index 1 -> index 0.
    // Selection is tracked by id, so it must still be blue's id, not
    // whatever stop happens to occupy blue's OLD index afterward.
    const [next] = update(selected, { type: 'nudgeStop', id: blueId, delta: -85 })
    expect(next.stops[0]!.id).toBe(blueId)
    expect(next.selectedId).toBe(blueId)
  })

  it('setKind accepts a valid kind, rejects an invalid one', () => {
    const s = init()
    expect(update(s, { type: 'setKind', kind: 'radial' })[0].kind).toBe('radial')
    expect(update(s, { type: 'setKind', kind: 'nonsense' as never })[0]).toBe(s)
  })

  it('setRepeating toggles the flag', () => {
    const s = init()
    expect(update(s, { type: 'setRepeating', repeating: true })[0].repeating).toBe(true)
  })

  it('setAngle normalizes to [0, 360)', () => {
    const s = init()
    expect(update(s, { type: 'setAngle', angle: 400 })[0].angle).toBe(40)
    expect(update(s, { type: 'setAngle', angle: -30 })[0].angle).toBe(330)
  })

  it('setCenter clamps both axes to 0-100', () => {
    const s = init()
    expect(update(s, { type: 'setCenter', x: -10, y: 150 })[0].center).toEqual({ x: 0, y: 100 })
  })

  it('setShape / setSize accept valid values and reject invalid ones', () => {
    const s = init()
    expect(update(s, { type: 'setShape', shape: 'circle' })[0].shape).toBe('circle')
    expect(update(s, { type: 'setShape', shape: 'nope' as never })[0]).toBe(s)
    expect(update(s, { type: 'setSize', size: 'closest-side' })[0].size).toBe('closest-side')
    expect(update(s, { type: 'setSize', size: 'nope' as never })[0]).toBe(s)
  })

  it('setInterpolation validates the space and (optionally) the hue method', () => {
    const s = init()
    expect(
      update(s, { type: 'setInterpolation', space: 'oklch', hue: 'longer' })[0].interpolation,
    ).toEqual({
      space: 'oklch',
      hue: 'longer',
    })
    expect(update(s, { type: 'setInterpolation', space: 'nope' as never })[0]).toBe(s)
    // An unrecognized hue value falls back to the current hue rather than
    // rejecting the whole message (the space change still lands).
    const [withBadHue] = update(s, {
      type: 'setInterpolation',
      space: 'hsl',
      hue: 'sideways' as never,
    })
    expect(withBadHue.interpolation).toEqual({ space: 'hsl', hue: s.interpolation.hue })
  })

  it('reverse mirrors every stop position about the middle and reverses order', () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 25, color: 'green' },
        { position: 100, color: 'blue' },
      ],
    })
    const [next] = update(s, { type: 'reverse' })
    expect(next.stops.map((st) => st.position)).toEqual([0, 75, 100])
    expect(next.stops.map((st) => st.color)).toEqual([
      s.stops[2]!.color,
      s.stops[1]!.color,
      s.stops[0]!.color,
    ])
  })

  it('distribute spaces stops evenly across 0-100, preserving order', () => {
    const s = init({
      stops: [
        { position: 5, color: 'red' },
        { position: 12, color: 'green' },
        { position: 90, color: 'blue' },
      ],
    })
    const ids = s.stops.map((st) => st.id)
    const [next] = update(s, { type: 'distribute' })
    expect(next.stops.map((st) => st.position)).toEqual([0, 50, 100])
    expect(next.stops.map((st) => st.id)).toEqual(ids)
  })

  it('distribute is a no-op with 0 or 1 stops', () => {
    const s: GradientPickerState = { ...init(), stops: [], minStops: 0 }
    expect(update(s, { type: 'distribute' })[0]).toBe(s)
  })

  it('setGradient replaces the gradient on valid css, leaves state unchanged on invalid css', () => {
    const s = init()
    const [next] = update(s, {
      type: 'setGradient',
      css: 'radial-gradient(circle, red 0%, blue 100%)',
    })
    expect(next.kind).toBe('radial')
    expect(next.shape).toBe('circle')
    const [unchanged] = update(s, { type: 'setGradient', css: 'garbage' })
    expect(unchanged).toBe(s)
  })

  it('picker writes color+alpha back onto the SELECTED stop only', () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'blue' },
      ],
    })
    const selectedId = s.stops[0]!.id
    const otherId = s.stops[1]!.id
    const [next] = update(s, { type: 'picker', msg: { type: 'setHue', h: 200 } })
    const changed = next.stops.find((st) => st.id === selectedId)!
    const other = next.stops.find((st) => st.id === otherId)!
    expect(changed.color).not.toEqual(s.stops[0]!.color)
    expect(other.color).toEqual(s.stops[1]!.color)
  })

  it('picker setModel updates state.model AND re-projects the selected stop', () => {
    const s = init({
      model: 'hsv',
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'blue' },
      ],
    })
    const [next] = update(s, { type: 'picker', msg: { type: 'setModel', model: 'oklch' } })
    expect(next.model).toBe('oklch')
    expect(next.stops[0]!.color.model).toBe('oklch')
  })

  it("picker preserves a gray stop's hue across a model switch (lossless, no hex round trip)", () => {
    // HSV gray: v=50, s=0 — hue is otherwise meaningless but STORED as 210.
    const s = init({
      stops: [
        { position: 0, color: { model: 'hsv', h: 210, s: 0, v: 50 } },
        { position: 100, color: 'blue' },
      ],
    })
    const [next] = update(s, { type: 'picker', msg: { type: 'setModel', model: 'oklch' } })
    const gray = next.stops[0]!.color
    expect(gray.model).toBe('oklch')
    expect((gray as { h: number }).h).toBeCloseTo(210, 5)
    const [back] = update(next, { type: 'picker', msg: { type: 'setModel', model: 'hsv' } })
    // Lossless HSV/HSL (color.ts stores floats, rounds only at format time —
    // see its module doc) means this round trip is no longer rounded to a
    // clean integer at each step; two hops through OKLab's cube roots leave
    // ~1e-5-scale floating-point noise on s/v, many orders of magnitude
    // below sRGB's own 8-bit precision floor (~0.4%). Hue is exact (the
    // achromatic-preserving path sets it verbatim, never recomputes it).
    const backColor = back.stops[0]!.color
    expect(backColor.model).toBe('hsv')
    expect((backColor as { h: number }).h).toBe(210)
    expect((backColor as { s: number }).s).toBeCloseTo(0, 3)
    expect((backColor as { v: number }).v).toBeCloseTo(50, 3)
  })

  it('selectNextStop / selectPrevStop move selection within bounds', () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 50, color: 'green' },
        { position: 100, color: 'blue' },
      ],
    })
    const [mid] = update(s, { type: 'selectNextStop' })
    expect(mid.selectedId).toBe(s.stops[1]!.id)
    const [last] = update(mid, { type: 'selectNextStop' })
    expect(last.selectedId).toBe(s.stops[2]!.id)
    const [clampedEnd] = update(last, { type: 'selectNextStop' })
    expect(clampedEnd).toBe(last)
    const [backToMid] = update(last, { type: 'selectPrevStop' })
    expect(backToMid.selectedId).toBe(s.stops[1]!.id)
  })

  it('setDir sets the reading direction', () => {
    const s = init()
    expect(update(s, { type: 'setDir', dir: 'rtl' })[0].dir).toBe('rtl')
  })

  it('disabled state ignores every message', () => {
    const s = init({
      disabled: true,
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'blue' },
      ],
    })
    for (const msg of [
      { type: 'addStop' as const, position: 50 },
      { type: 'removeStop' as const, id: s.stops[0]!.id },
      { type: 'selectStop' as const, id: s.stops[1]!.id },
      { type: 'moveStop' as const, id: s.stops[0]!.id, position: 20 },
      { type: 'nudgeStop' as const, id: s.stops[0]!.id, delta: 5 },
      { type: 'setKind' as const, kind: 'radial' as const },
      { type: 'setRepeating' as const, repeating: true },
      { type: 'setAngle' as const, angle: 30 },
      { type: 'setCenter' as const, x: 10, y: 10 },
      { type: 'setShape' as const, shape: 'circle' as const },
      { type: 'setSize' as const, size: 'closest-side' as const },
      { type: 'setInterpolation' as const, space: 'oklch' as const },
      { type: 'reverse' as const },
      { type: 'distribute' as const },
      { type: 'setGradient' as const, css: 'linear-gradient(0deg, red, blue)' },
      { type: 'picker' as const, msg: { type: 'setHue' as const, h: 10 } },
      { type: 'selectNextStop' as const },
      { type: 'selectPrevStop' as const },
    ]) {
      expect(update(s, msg)[0]).toBe(s)
    }
  })
})

// ── toCss ────────────────────────────────────────────────────────────────────

describe('gradient-picker toCss', () => {
  const stops = [
    { position: 0, color: 'red' as const },
    { position: 100, color: 'blue' as const },
  ]

  it('linear: explicit angle + interpolation head', () => {
    const s = init({ kind: 'linear', angle: 45, stops, interpolation: { space: 'srgb' } })
    expect(toCss(s)).toBe('linear-gradient(45deg in srgb, #ff0000 0%, #0000ff 100%)')
  })

  it('radial: shape/size/center + interpolation head', () => {
    const s = init({
      kind: 'radial',
      shape: 'circle',
      size: 'closest-side',
      center: { x: 20, y: 30 },
      stops,
      interpolation: { space: 'srgb' },
    })
    expect(toCss(s)).toBe(
      'radial-gradient(circle closest-side at 20% 30% in srgb, #ff0000 0%, #0000ff 100%)',
    )
  })

  it('conic: from angle + center + interpolation head', () => {
    const s = init({
      kind: 'conic',
      angle: 10,
      center: { x: 40, y: 60 },
      stops,
      interpolation: { space: 'srgb' },
    })
    expect(toCss(s)).toBe('conic-gradient(from 10deg at 40% 60% in srgb, #ff0000 0%, #0000ff 100%)')
  })

  it('repeating- prefix', () => {
    const s = init({ repeating: true, stops, interpolation: { space: 'srgb' } })
    expect(toCss(s)).toMatch(/^repeating-linear-gradient\(/)
  })

  it('hue method is emitted only for a polar space AND only when non-default', () => {
    const shorter = init({ stops, interpolation: { space: 'oklch', hue: 'shorter' } })
    expect(toCss(shorter)).not.toContain('hue')
    const longer = init({ stops, interpolation: { space: 'oklch', hue: 'longer' } })
    expect(toCss(longer)).toContain('longer hue')
    const srgbLonger = init({ stops, interpolation: { space: 'srgb', hue: 'longer' } })
    expect(toCss(srgbLonger)).not.toContain('hue')
  })

  it('an out-of-gamut OKLCH stop stays exact (oklch(), not gamut-mapped hex)', () => {
    const s = init({
      stops: [
        { position: 0, color: { model: 'oklch', l: 0.7, c: 0.5, h: 30 } },
        { position: 100, color: 'blue' },
      ],
      interpolation: { space: 'srgb' },
    })
    expect(toCss(s)).toContain('oklch(0.7000 0.5000 30.00)')
  })
})

// ── parseGradient ────────────────────────────────────────────────────────────

describe('gradient-picker parseGradient', () => {
  it('accepts a plain linear gradient with an angle', () => {
    const r = parseGradient('linear-gradient(45deg, red 0%, blue 100%)')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.kind).toBe('linear')
      expect(r.value.angle).toBe(45)
      expect(r.value.stops).toHaveLength(2)
    }
  })

  it('accepts to <side-or-corner>, order-independent', () => {
    expect(parseGradient('linear-gradient(to right, red, blue)')).toMatchObject({
      ok: true,
      value: { angle: 90 },
    })
    expect(parseGradient('linear-gradient(to top right, red, blue)')).toMatchObject({
      ok: true,
      value: { angle: 45 },
    })
    expect(parseGradient('linear-gradient(to right top, red, blue)')).toMatchObject({
      ok: true,
      value: { angle: 45 },
    })
  })

  it('accepts angles in deg/grad/rad/turn', () => {
    expect(parseGradient('linear-gradient(100grad, red, blue)')).toMatchObject({
      ok: true,
      value: { angle: 90 },
    })
    expect(parseGradient('linear-gradient(0.5turn, red, blue)')).toMatchObject({
      ok: true,
      value: { angle: 180 },
    })
    const rad = parseGradient(`linear-gradient(${Math.PI / 2}rad, red, blue)`)
    expect(rad.ok).toBe(true)
    if (rad.ok) expect(rad.value.angle).toBeCloseTo(90, 5)
  })

  it('accepts repeating-*', () => {
    const r = parseGradient('repeating-linear-gradient(90deg, red 0%, blue 20%)')
    expect(r).toMatchObject({ ok: true, value: { repeating: true } })
  })

  it('accepts radial shape/size/at position', () => {
    const r = parseGradient('radial-gradient(circle farthest-side at 30% 40%, red, blue)')
    expect(r).toMatchObject({
      ok: true,
      value: { kind: 'radial', shape: 'circle', size: 'farthest-side', center: { x: 30, y: 40 } },
    })
  })

  it('accepts conic from/at', () => {
    const r = parseGradient('conic-gradient(from 20deg at 10% 90%, red, blue)')
    expect(r).toMatchObject({
      ok: true,
      value: { kind: 'conic', angle: 20, center: { x: 10, y: 90 } },
    })
  })

  it('accepts a position keyword ("at left", "at bottom", "at left top")', () => {
    expect(parseGradient('radial-gradient(at left, red, blue)')).toMatchObject({
      ok: true,
      value: { center: { x: 0, y: 50 } },
    })
    expect(parseGradient('radial-gradient(at bottom, red, blue)')).toMatchObject({
      ok: true,
      value: { center: { x: 50, y: 100 } },
    })
    expect(parseGradient('radial-gradient(at left top, red, blue)')).toMatchObject({
      ok: true,
      value: { center: { x: 0, y: 0 } },
    })
  })

  it('accepts in <space> [<hue> hue]', () => {
    const r = parseGradient('linear-gradient(45deg in oklch longer hue, red, blue)')
    expect(r).toMatchObject({
      ok: true,
      value: { interpolation: { space: 'oklch', hue: 'longer' } },
    })
  })

  it('defaults interpolation to oklab when omitted', () => {
    const r = parseGradient('linear-gradient(45deg, red, blue)')
    expect(r).toMatchObject({
      ok: true,
      value: { interpolation: { space: 'oklab', hue: 'shorter' } },
    })
  })

  it('accepts a head-omitted gradient (defaults to 180deg)', () => {
    const r = parseGradient('linear-gradient(red, blue)')
    expect(r).toMatchObject({ ok: true, value: { angle: 180 } })
  })

  it('accepts any color parseCssColor accepts (hex/rgb/hsl/oklch/oklab/named)', () => {
    const r = parseGradient(
      'linear-gradient(45deg, #f00 0%, rgb(0 255 0) 30%, hsl(240 100% 50%) 60%, oklch(0.6 0.1 300) 80%, oklab(0.5 0.1 -0.1) 100%)',
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.stops).toHaveLength(5)
  })

  it('a double-position stop expands into two stops', () => {
    const r = parseGradient('linear-gradient(45deg, red 0% 20%, blue 100%)')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.stops).toHaveLength(3)
      expect(r.value.stops[0]!.position).toBe(0)
      expect(r.value.stops[1]!.position).toBe(20)
      expect(r.value.stops[0]!.color).toEqual(r.value.stops[1]!.color)
    }
  })

  it('fills missing positions per the CSS auto-positioning algorithm', () => {
    const r = parseGradient('linear-gradient(45deg, red, green, blue)')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.stops.map((s) => s.position)).toEqual([0, 50, 100])
  })

  it('clamps a specified position that would decrease, non-decreasing', () => {
    const r = parseGradient('linear-gradient(45deg, red 50%, green 10%, blue 100%)')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.stops.map((s) => s.position)).toEqual([50, 50, 100])
  })

  it('rejects a non-gradient string', () => {
    expect(parseGradient('not a gradient')).toMatchObject({ ok: false })
    expect(parseGradient('linear-gradient(red, blue) extra')).toMatchObject({ ok: false })
  })

  it('rejects unbalanced parentheses', () => {
    const r = parseGradient('linear-gradient(45deg, red, oklch(0.5 0.1 30)')
    expect(r).toMatchObject({ ok: false })
  })

  it('rejects fewer than two stops', () => {
    expect(parseGradient('linear-gradient(45deg, red)')).toMatchObject({ ok: false })
  })

  it('rejects length-based stop positions', () => {
    const r = parseGradient('linear-gradient(45deg, red 0px, blue 100px)')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/percentage/)
  })

  it('rejects an explicit radial size length', () => {
    const r = parseGradient('radial-gradient(circle 40px, red, blue)')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/does not support an explicit size length/)
  })

  it('rejects a color hint (bare percentage with no color)', () => {
    const r = parseGradient('linear-gradient(45deg, red, 50%, blue)')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/color hint/)
  })

  it('rejects a hue method paired with a non-polar space', () => {
    const r = parseGradient('linear-gradient(45deg in srgb longer hue, red, blue)')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/polar space/)
  })

  it('rejects an unrecognized side-or-corner', () => {
    const r = parseGradient('linear-gradient(to nowhere, red, blue)')
    expect(r.ok).toBe(false)
  })

  it('rejects an unrecognized interpolation space', () => {
    const r = parseGradient('linear-gradient(45deg in cmyk, red, blue)')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/unknown color-interpolation-method/)
  })
})

// ── colorAt ──────────────────────────────────────────────────────────────────

describe('gradient-picker pickerStateOf', () => {
  it('derives a ColorPickerState from the selected stop, projected onto state.model', () => {
    const s = init({
      model: 'oklch',
      maxChroma: 0.25,
      disabled: true,
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'blue' },
      ],
    })
    const derived = pickerStateOf(s)
    expect(derived.color.model).toBe('oklch')
    expect(derived.alpha).toBe(1)
    expect(derived.disabled).toBe(true)
    expect(derived.maxChroma).toBe(0.25)
  })

  it('follows selection: switching the selected stop changes what it derives', () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'blue' },
      ],
    })
    const [switched] = update(s, { type: 'selectStop', id: s.stops[1]!.id })
    expect(pickerStateOf(s).color).not.toEqual(pickerStateOf(switched).color)
  })
})

describe('gradient-picker colorAt', () => {
  it("returns an existing stop's own exact color at its own position", () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'blue' },
      ],
    })
    expect(colorAt(s, 0)).toBe('#ff0000')
    expect(colorAt(s, 100)).toBe('#0000ff')
  })

  it('clamps outside the stop range to the nearest end stop', () => {
    const s = init({
      stops: [
        { position: 20, color: 'red' },
        { position: 80, color: 'blue' },
      ],
    })
    expect(colorAt(s, 0)).toBe('#ff0000')
    expect(colorAt(s, 100)).toBe('#0000ff')
  })

  it('midpoint of red -> blue: srgb vs oklch differ as expected', () => {
    const base = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'blue' },
      ],
    })
    const srgbState = update(base, { type: 'setInterpolation', space: 'srgb' })[0]
    // Hand-verified: (1,0,0) and (0,0,1) lerp to (0.5,0,0.5) -> 0.5*255=127.5,
    // Math.round -> 128 -> #800080.
    expect(colorAt(srgbState, 50)).toBe('#800080')

    const oklchState = update(base, { type: 'setInterpolation', space: 'oklch', hue: 'shorter' })[0]
    const oklchResult = colorAt(oklchState, 50)
    expect(oklchResult).not.toBe('#800080')
    expect(oklchResult.startsWith('oklch(')).toBe(true)

    // Independently re-derive the SAME interpolation directly through
    // `interpolateColor` (the function `color.test.ts` owns correctness
    // for) and compare NUMERICALLY — this is the integration property under
    // test: `colorAt` must feed it the right (a, b, t, space, hueMethod).
    const a = parseCssColor('red')!
    const b = parseCssColor('blue')!
    const expected = interpolateColor(a, b, 0.5, 'oklch', 'shorter')
    const parsedResult = parseCssColor(oklchResult)
    expect(parsedResult).not.toBeNull()
    if (parsedResult && parsedResult.space === 'oklch' && expected.space === 'oklch') {
      expect(parsedResult.l).toBeCloseTo(expected.l!, 3)
      expect(parsedResult.c).toBeCloseTo(expected.c!, 3)
      expect(parsedResult.h).toBeCloseTo(expected.h!, 1)
    }
  })

  it('interpolates between the two BRACKETING stops, not the endpoints, for a 3+ stop gradient', () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 50, color: 'lime' },
        { position: 100, color: 'blue' },
      ],
      interpolation: { space: 'srgb' },
    })
    // At 25%, halfway between red and lime — NOT influenced by blue at all.
    expect(colorAt(s, 25)).toBe('#808000')
  })
})

// ── round trip: parseGradient(toCss(s)) reproduces s, modulo ids ───────────

describe('gradient-picker round trip', () => {
  const cases: GradientPickerState[] = [
    init({
      kind: 'linear',
      angle: 0,
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'blue' },
      ],
      interpolation: { space: 'srgb' },
    }),
    init({
      kind: 'linear',
      angle: 123,
      repeating: true,
      stops: [
        { position: 10, color: 'red' },
        { position: 90, color: 'lime' },
      ],
      interpolation: { space: 'oklch', hue: 'longer' },
    }),
    init({
      kind: 'radial',
      shape: 'circle',
      size: 'closest-corner',
      center: { x: 25, y: 75 },
      stops: [
        { position: 0, color: 'red' },
        { position: 50, color: 'green' },
        { position: 100, color: 'blue' },
      ],
      interpolation: { space: 'hsl' },
    }),
    init({
      kind: 'conic',
      angle: 200,
      center: { x: 60, y: 40 },
      stops: [
        { position: 0, color: 'yellow' },
        { position: 100, color: 'purple' },
      ],
      interpolation: { space: 'oklab' },
    }),
    init({
      kind: 'linear',
      angle: 45,
      stops: [
        { position: 0, color: { model: 'oklch', l: 0.6, c: 0.2, h: 260 } },
        { position: 100, color: 'white' },
      ],
      interpolation: { space: 'srgb' },
    }),
  ]

  for (const [i, state] of cases.entries()) {
    it(`case ${i}: ${state.kind}${state.repeating ? ' repeating' : ''} in ${state.interpolation.space}`, () => {
      const css = toCss(state)
      const parsed = parseGradient(css)
      expect(parsed.ok, `parseGradient failed on: ${css}`).toBe(true)
      if (!parsed.ok) return
      expect(parsed.value.kind).toBe(state.kind)
      expect(parsed.value.repeating).toBe(state.repeating)
      expect(parsed.value.interpolation).toEqual(state.interpolation)
      if (state.kind !== 'radial') expect(parsed.value.angle).toBeCloseTo(state.angle, 1)
      if (state.kind !== 'linear') {
        expect(parsed.value.center.x).toBeCloseTo(state.center.x, 1)
        expect(parsed.value.center.y).toBeCloseTo(state.center.y, 1)
      }
      if (state.kind === 'radial') {
        expect(parsed.value.shape).toBe(state.shape)
        expect(parsed.value.size).toBe(state.size)
      }
      expect(parsed.value.stops).toHaveLength(state.stops.length)
      parsed.value.stops.forEach((stop, idx) => {
        expect(stop.position).toBeCloseTo(state.stops[idx]!.position, 1)
        expect(stop.alpha).toBeCloseTo(state.stops[idx]!.alpha, 3)
      })
    })
  }
})

// ── connect(): part bags ─────────────────────────────────────────────────────

describe('gradient-picker connect — static/reactive part attributes', () => {
  const s = init({
    stops: [
      { position: 0, color: 'red' },
      { position: 50, color: 'green' },
      { position: 100, color: 'blue' },
    ],
  })
  const send = vi.fn()
  const p = connect(signalOf(s), send, { id: 'gp' })

  it('root reflects kind/disabled/repeating', () => {
    expect(read(p.root['data-kind'], s)).toBe('linear')
    expect(read(p.root['data-disabled'], s)).toBeUndefined()
    expect(read(p.root['data-disabled'], { ...s, disabled: true })).toBe('')
    expect(read(p.root['data-repeating'], s)).toBeUndefined()
    expect(read(p.root['data-repeating'], { ...s, repeating: true })).toBe('')
  })

  it('preview style is the current gradient css', () => {
    expect(read(p.preview.style, s)).toContain(toCss(s))
  })

  it('track style is a plain 90deg ramp in the interpolation space', () => {
    expect(read(p.track.style, s)).toMatch(/linear-gradient\(90deg in oklab,/)
  })

  it('stop() publishes ARIA + position style', () => {
    const stop = p.stop(s.stops[1]!.id)
    expect(stop.role).toBe('slider')
    expect(read(stop['aria-valuenow'], s)).toBe(50)
    expect(read(stop['aria-valuetext'], s)).toContain('50')
    expect(read(stop.style, s)).toContain('left:50%')
  })

  it('stop() publishes data-selected bare, matching state.selectedId', () => {
    const selected = p.stop(s.selectedId)
    const other = p.stop(s.stops[1]!.id)
    expect(read(selected['data-selected'], s)).toBe('')
    expect(read(other['data-selected'], s)).toBeUndefined()
  })

  it('stop() mirrors left% under rtl', () => {
    const stop = p.stop(s.stops[1]!.id)
    expect(read(stop.style, { ...s, dir: 'rtl' as const })).toContain('left:50%')
    const near = p.stop(s.stops[0]!.id)
    expect(read(near.style, s)).toContain('left:0%')
    expect(read(near.style, { ...s, dir: 'rtl' as const })).toContain('left:100%')
  })

  it('addStopButton/removeStopButton disabled logic', () => {
    expect(read(p.removeStopButton.disabled, init())).toBe(true) // 2 stops == minStops 2
    expect(read(p.removeStopButton.disabled, s)).toBe(false) // 3 stops > minStops 2
    expect(read(p.addStopButton.disabled, init({ maxStops: 2 }))).toBe(true)
  })

  it('kindToggle / shapeOption / sizeOption reflect selection via data-state', () => {
    expect(read(p.kindToggle('linear')['data-state'], s)).toBe('on')
    expect(read(p.kindToggle('radial')['data-state'], s)).toBe('off')
    expect(read(p.shapeOption('ellipse')['data-state'], s)).toBe('on')
    expect(read(p.sizeOption('farthest-corner')['data-state'], s)).toBe('on')
  })

  it('interpolationHueSelect is disabled for a non-polar space', () => {
    expect(
      read(
        p.interpolationHueSelect.disabled,
        update(s, { type: 'setInterpolation', space: 'srgb' })[0],
      ),
    ).toBe(true)
    expect(
      read(
        p.interpolationHueSelect.disabled,
        update(s, { type: 'setInterpolation', space: 'oklch' })[0],
      ),
    ).toBe(false)
  })

  it('cssInput value is toCss(state)', () => {
    expect(read(p.cssInput.value, s)).toBe(toCss(s))
  })

  it('picker exposes the full color-picker part bag over the derived state', () => {
    expect(p.picker.hexInput).toBeDefined()
    expect(p.picker.eyeDropperTrigger).toBeDefined()
    // `p.picker`'s signals are composed atop the OUTER gradient-picker state
    // signal (`state.map(pickerStateOf)` inside `connect`), so `read` takes
    // the gradient state `s`, not a pre-projected `ColorPickerState` — the
    // projection happens as part of reading the composed signal.
    expect(read(p.picker.hexInput.value, s)).toBe('#ff0000')
  })
})

describe('gradient-picker connect — dispatch', () => {
  it('addStopButton dispatches addStop at the midpoint of the largest gap', () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 20, color: 'green' },
        { position: 100, color: 'blue' },
      ],
    })
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    p.addStopButton.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'addStop', position: 60 })
  })

  it('removeStopButton dispatches removeStop for the selected id', () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 50, color: 'green' },
        { position: 100, color: 'blue' },
      ],
    })
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    p.removeStopButton.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'removeStop', id: s.selectedId })
  })

  it('kindToggle / repeatingToggle / reverseButton / distributeButton dispatch', () => {
    const s = init()
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    p.kindToggle('conic').onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'setKind', kind: 'conic' })
    p.repeatingToggle.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'setRepeating', repeating: true })
    p.reverseButton.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'reverse' })
    p.distributeButton.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'distribute' })
  })

  it('angleInput dispatches setAngle', () => {
    const s = init()
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    p.angleInput.onInput({ target: { value: '77' } } as unknown as Event)
    expect(send).toHaveBeenCalledWith({ type: 'setAngle', angle: 77 })
  })

  it('cssInput dispatches setGradient', () => {
    const s = init()
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    p.cssInput.onInput({
      target: { value: 'linear-gradient(0deg, red, blue)' },
    } as unknown as Event)
    expect(send).toHaveBeenCalledWith({
      type: 'setGradient',
      css: 'linear-gradient(0deg, red, blue)',
    })
  })

  it('interpolationSpaceSelect / interpolationHueSelect dispatch setInterpolation', () => {
    const s = init()
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    p.interpolationSpaceSelect.onInput({ target: { value: 'hsl' } } as unknown as Event)
    expect(send).toHaveBeenCalledWith({
      type: 'setInterpolation',
      space: 'hsl',
      hue: s.interpolation.hue,
    })
    p.interpolationHueSelect.onInput({ target: { value: 'increasing' } } as unknown as Event)
    expect(send).toHaveBeenCalledWith({
      type: 'setInterpolation',
      space: s.interpolation.space,
      hue: 'increasing',
    })
  })

  it('picker wrapping: editing the picker changes only the selected stop', () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'blue' },
      ],
    })
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    p.picker.hueSlider.onInput({ target: { value: '200' } } as unknown as Event)
    expect(send).toHaveBeenCalledWith({ type: 'picker', msg: { type: 'setHue', h: 200 } })
  })
})

describe('gradient-picker connect — pointer drag on the track (add + drag)', () => {
  function fakeTrack(): {
    target: {
      getBoundingClientRect: () => { left: number; top: number; width: number; height: number }
      setPointerCapture: ReturnType<typeof vi.fn>
      hasPointerCapture: ReturnType<typeof vi.fn>
      releasePointerCapture: ReturnType<typeof vi.fn>
      querySelector: ReturnType<typeof vi.fn>
    }
    stopEl: { focus: ReturnType<typeof vi.fn> }
  } {
    const stopEl = { focus: vi.fn() }
    return {
      target: {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 20 }),
        setPointerCapture: vi.fn(),
        hasPointerCapture: vi.fn(() => true),
        releasePointerCapture: vi.fn(),
        querySelector: vi.fn(() => stopEl),
      },
      stopEl,
    }
  }
  const pointerEvent = (
    target: unknown,
    overrides: Partial<{
      button: number
      clientX: number
      clientY: number
      pointerId: number
    }> = {},
  ): PointerEvent =>
    ({
      button: overrides.button ?? 0,
      pointerId: overrides.pointerId ?? 1,
      clientX: overrides.clientX ?? 100,
      clientY: overrides.clientY ?? 10,
      currentTarget: target,
    }) as unknown as PointerEvent

  it('pointerdown on the bare track adds a stop at that position and focuses it', () => {
    const s = init()
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    const { target, stopEl } = fakeTrack()
    p.track.onPointerDown(pointerEvent(target, { clientX: 100 }))
    expect(send).toHaveBeenCalledWith({ type: 'addStop', position: 50 })
    expect(target.setPointerCapture).toHaveBeenCalledWith(1)
    expect(stopEl.focus).toHaveBeenCalledTimes(1)
  })

  it('subsequent pointermove drags the newly-added stop', () => {
    const s = init()
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    const { target } = fakeTrack()
    p.track.onPointerDown(pointerEvent(target, { clientX: 100 }))
    const newId = `s${s.nextId}`
    send.mockClear()
    p.track.onPointerMove(pointerEvent(target, { clientX: 150 }))
    expect(send).toHaveBeenCalledWith({ type: 'moveStop', id: newId, position: 75 })
  })

  it('pointerup ends the drag (a further move is inert)', () => {
    const s = init()
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    const { target } = fakeTrack()
    p.track.onPointerDown(pointerEvent(target, { clientX: 100 }))
    p.track.onPointerUp(pointerEvent(target))
    send.mockClear()
    p.track.onPointerMove(pointerEvent(target, { clientX: 10 }))
    expect(send).not.toHaveBeenCalled()
  })

  it('mirrors under rtl', () => {
    const s: GradientPickerState = { ...init(), dir: 'rtl' }
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    const { target } = fakeTrack()
    p.track.onPointerDown(pointerEvent(target, { clientX: 50 })) // 25% physical -> 75% logical under rtl
    expect(send).toHaveBeenCalledWith({ type: 'addStop', position: 75 })
  })

  it('disabled: pointerdown on the track is inert', () => {
    const s = init({ disabled: true })
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    const { target } = fakeTrack()
    p.track.onPointerDown(pointerEvent(target))
    expect(send).not.toHaveBeenCalled()
  })
})

describe('gradient-picker connect — pointer drag on an existing stop', () => {
  function fakeStopDrag(): {
    target: {
      getBoundingClientRect: () => { left: number; top: number; width: number; height: number }
      setPointerCapture: ReturnType<typeof vi.fn>
      hasPointerCapture: ReturnType<typeof vi.fn>
      releasePointerCapture: ReturnType<typeof vi.fn>
      closest: ReturnType<typeof vi.fn>
    }
  } {
    const track = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 20 }) }
    return {
      target: {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 20, height: 20 }),
        setPointerCapture: vi.fn(),
        hasPointerCapture: vi.fn(() => true),
        releasePointerCapture: vi.fn(),
        closest: vi.fn(() => track),
      },
    }
  }
  const pointerEvent = (target: unknown, clientX: number): PointerEvent =>
    ({
      button: 0,
      pointerId: 1,
      clientX,
      clientY: 10,
      currentTarget: target,
      stopPropagation: vi.fn(),
    }) as unknown as PointerEvent

  it('pointerdown selects the stop and stops propagation (so the track does not also add a stop)', () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 50, color: 'green' },
        { position: 100, color: 'blue' },
      ],
    })
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    const id = s.stops[1]!.id
    const stopPart = p.stop(id)
    const { target } = fakeStopDrag()
    const e = pointerEvent(target, 100)
    stopPart.onPointerDown(e)
    expect(e.stopPropagation).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ type: 'selectStop', id })
  })

  it('pointermove after pointerdown moves the stop via the ancestor track rect', () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 50, color: 'green' },
        { position: 100, color: 'blue' },
      ],
    })
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    const id = s.stops[1]!.id
    const stopPart = p.stop(id)
    const { target } = fakeStopDrag()
    stopPart.onPointerDown(pointerEvent(target, 100))
    send.mockClear()
    stopPart.onPointerMove(pointerEvent(target, 20))
    expect(send).toHaveBeenCalledWith({ type: 'moveStop', id, position: 10 })
  })

  it('keyboard: ArrowRight/Left nudge, Shift is coarse, Home/End snap, Delete removes', () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 50, color: 'green' },
        { position: 100, color: 'blue' },
      ],
    })
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    const id = s.stops[1]!.id
    const stopPart = p.stop(id)
    const mk = (key: string, shiftKey = false): KeyboardEvent =>
      ({ key, shiftKey, preventDefault: vi.fn() }) as unknown as KeyboardEvent

    stopPart.onKeyDown(mk('ArrowRight'))
    expect(send).toHaveBeenCalledWith({ type: 'nudgeStop', id, delta: 1 })
    stopPart.onKeyDown(mk('ArrowLeft', true))
    expect(send).toHaveBeenCalledWith({ type: 'nudgeStop', id, delta: -10 })
    stopPart.onKeyDown(mk('Home'))
    expect(send).toHaveBeenCalledWith({ type: 'moveStop', id, position: 0 })
    stopPart.onKeyDown(mk('End'))
    expect(send).toHaveBeenCalledWith({ type: 'moveStop', id, position: 100 })
    stopPart.onKeyDown(mk('PageUp'))
    expect(send).toHaveBeenCalledWith({ type: 'nudgeStop', id, delta: 10 })
    stopPart.onKeyDown(mk('PageDown'))
    expect(send).toHaveBeenCalledWith({ type: 'nudgeStop', id, delta: -10 })
    stopPart.onKeyDown(mk('Delete'))
    expect(send).toHaveBeenCalledWith({ type: 'removeStop', id })
    stopPart.onKeyDown(mk('Backspace'))
    expect(send).toHaveBeenCalledWith({ type: 'removeStop', id })
  })

  it('onFocus selects the stop', () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'blue' },
      ],
    })
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    const id = s.stops[1]!.id
    p.stop(id).onFocus(new FocusEvent('focus'))
    expect(send).toHaveBeenCalledWith({ type: 'selectStop', id })
  })
})

describe('gradient-picker connect — center area (radial/conic)', () => {
  function fakeArea(): {
    target: {
      getBoundingClientRect: () => { left: number; top: number; width: number; height: number }
      querySelector: ReturnType<typeof vi.fn>
      setPointerCapture: ReturnType<typeof vi.fn>
      hasPointerCapture: ReturnType<typeof vi.fn>
      releasePointerCapture: ReturnType<typeof vi.fn>
    }
  } {
    return {
      target: {
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 50 }),
        querySelector: vi.fn(() => ({ focus: vi.fn() })),
        setPointerCapture: vi.fn(),
        hasPointerCapture: vi.fn(() => true),
        releasePointerCapture: vi.fn(),
      },
    }
  }

  it('pointerdown/move on centerArea dispatches setCenter from the 2D position', () => {
    const s = init({ kind: 'radial' })
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    const { target } = fakeArea()
    p.centerArea.onPointerDown({
      button: 0,
      pointerId: 1,
      clientX: 25,
      clientY: 25,
      currentTarget: target,
    } as unknown as PointerEvent)
    expect(send).toHaveBeenCalledWith({ type: 'setCenter', x: 25, y: 50 })
  })

  it('centerThumb keyboard nudges x/y, Home/End snap to corners', () => {
    const s = init({ kind: 'radial', center: { x: 50, y: 50 } })
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    const mk = (key: string, shiftKey = false): KeyboardEvent =>
      ({ key, shiftKey, preventDefault: vi.fn() }) as unknown as KeyboardEvent
    p.centerThumb.onKeyDown(mk('ArrowRight'))
    expect(send).toHaveBeenCalledWith({ type: 'setCenter', x: 51, y: 50 })
    p.centerThumb.onKeyDown(mk('ArrowDown', true))
    expect(send).toHaveBeenCalledWith({ type: 'setCenter', x: 50, y: 60 })
    p.centerThumb.onKeyDown(mk('Home'))
    expect(send).toHaveBeenCalledWith({ type: 'setCenter', x: 0, y: 0 })
    p.centerThumb.onKeyDown(mk('End'))
    expect(send).toHaveBeenCalledWith({ type: 'setCenter', x: 100, y: 100 })
  })
})
