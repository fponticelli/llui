import { describe, it, expect, vi } from 'vitest'
import { component } from '@llui/dom'
import { propertyTest } from '@llui/test'
import {
  init,
  update,
  connect,
  toCss,
  colorAt,
  parseGradient,
  pickerStateOf,
  type GradientPickerState,
  type GradientPickerMsg,
} from '../../src/components/gradient-picker'
import { parseCssColor, interpolateColor } from '../../src/utils/color'
import { pickerColorToCss, DEFAULT_MAX_CHROMA } from '../../src/components/color-picker'
import { signalOf, read } from '../_signal'

// ── Real-event helpers (finding #13: no `as unknown as Event` casts) ───────

/** A real DOM element with the pointer-capture methods jsdom does not
 * implement stubbed on (jsdom's own gap, not a fake event) plus a fixed
 * `getBoundingClientRect` (jsdom never computes real layout). */
function fakeTrackElement(rect = { left: 0, top: 0, width: 200, height: 20 }): HTMLDivElement {
  const el = document.createElement('div')
  Object.assign(el, {
    getBoundingClientRect: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
    }),
    setPointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true),
    releasePointerCapture: vi.fn(),
  })
  return el
}

function realPointerEvent(
  target: EventTarget,
  type: string,
  overrides: Partial<{ button: number; pointerId: number; clientX: number; clientY: number }> = {},
): PointerEvent {
  const e = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: overrides.button ?? 0,
    pointerId: overrides.pointerId ?? 1,
    clientX: overrides.clientX ?? 0,
    clientY: overrides.clientY ?? 0,
  })
  Object.defineProperty(e, 'currentTarget', { value: target, configurable: true })
  return e
}

function realKeyEvent(
  target: EventTarget,
  key: string,
  overrides: Partial<{ shiftKey: boolean }> = {},
): KeyboardEvent {
  const e = new KeyboardEvent('keydown', {
    key,
    shiftKey: overrides.shiftKey ?? false,
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperty(e, 'currentTarget', { value: target, configurable: true })
  return e
}

function realInputEvent(input: HTMLInputElement, value: string, type = 'input'): Event {
  input.value = value
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'target', { value: input, configurable: true })
  Object.defineProperty(e, 'currentTarget', { value: input, configurable: true })
  return e
}

/** `tagSend(send, variants, fn)` only sets `__lluiVariants` when `variants`
 * is non-empty (`binding-descriptors.ts`'s own guard), so a handler wrapped
 * with `tagSend(send, [], fn)` — dispatches nothing itself, e.g. `onPointerUp`
 * — is correctly UNTAGGED (`undefined`), not tagged with an empty array.
 * Finding #5 asks that every handler be ROUTED through `tagSend` uniformly
 * (so the mechanism is already in place if its variant list ever grows),
 * not that every handler carry a non-empty tag. */
function variantsOf(fn: unknown): readonly string[] | undefined {
  return (fn as { __lluiVariants?: readonly string[] }).__lluiVariants
}

// ── init ─────────────────────────────────────────────────────────────────────

describe('gradient-picker init', () => {
  it('defaults to a linear black->white gradient with two stops', () => {
    const s = init()
    expect(s.kind).toBe('linear')
    expect(s.repeating).toBe(false)
    expect(s.direction).toEqual({ type: 'angle', deg: 90 })
    expect(s.stops).toHaveLength(2)
    expect(s.stops[0]).toMatchObject({ position: 0 })
    expect(s.stops[1]).toMatchObject({ position: 100 })
    expect(s.minStops).toBe(2)
    expect(s.maxStops).toBeUndefined()
    expect(s.defaultModel).toBe('hsv')
    expect(s.disabled).toBe(false)
    expect(s.dir).toBe('ltr')
    expect(s.eyeDropperSupported).toBe(false)
    expect(s.cssDraft).toBeNull()
    expect(s.cssError).toBeNull()
  })

  it('omits maxStops entirely when unset (round-trips as an identity)', () => {
    const s = init()
    expect('maxStops' in s).toBe(false)
    expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s)
  })

  it('accepts an explicit css string', () => {
    const s = init({ css: 'linear-gradient(45deg, red 0%, blue 100%)' })
    expect(s.direction).toEqual({ type: 'angle', deg: 45 })
    expect(s.stops).toHaveLength(2)
  })

  it('falls back to explicit stops / defaults on invalid css', () => {
    const s = init({ css: 'not-a-gradient()' })
    expect(s.kind).toBe('linear')
    expect(s.stops).toHaveLength(2)
  })

  it('falls back to defaults when css has a stop count outside min/maxStops', () => {
    const s = init({ css: 'linear-gradient(45deg, red, blue)', minStops: 3 })
    // 2 parsed stops < minStops 3 -> treated like invalid css.
    expect(s.stops.length).toBeGreaterThanOrEqual(3)
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

  it('applies minStops/maxStops/defaultModel/disabled/dir options', () => {
    const s = init({ minStops: 3, maxStops: 4, defaultModel: 'oklch', disabled: true, dir: 'rtl' })
    expect(s.minStops).toBe(3)
    expect(s.maxStops).toBe(4)
    expect(s.defaultModel).toBe('oklch')
    expect(s.disabled).toBe(true)
    expect(s.dir).toBe('rtl')
  })

  it('non-finite numeric options fall back to documented defaults', () => {
    const s = init({ angle: NaN, center: { x: NaN, y: Infinity }, maxChroma: NaN, minStops: NaN })
    expect(s.direction).toEqual({ type: 'angle', deg: 90 })
    expect(s.center).toEqual({ x: 50, y: 50 })
    expect(s.maxChroma).toBe(DEFAULT_MAX_CHROMA)
    expect(s.minStops).toBe(2)
  })

  // ── finding #7: crashes/limits ─────────────────────────────────────────────

  it('an explicitly EMPTY stops array never produces an empty gradient', () => {
    const s = init({ stops: [] })
    expect(s.stops.length).toBeGreaterThan(0)
  })

  it('fewer explicit stops than minStops are PADDED, never crash', () => {
    const s = init({ stops: [{ position: 50, color: 'red' }], minStops: 4 })
    expect(s.stops.length).toBeGreaterThanOrEqual(4)
    // Padding never invents a color — every padded stop's color is one that
    // was already present.
    const colors = new Set(s.stops.map((st) => pickerColorToCss(st.color, st.alpha)))
    expect(colors.size).toBe(1)
  })

  it('a non-integer maxStops (0.5) never produces a config that forbids every stop', () => {
    const s = init({ maxStops: 0.5 })
    expect(s.maxStops).toBeGreaterThanOrEqual(s.minStops)
    expect(Number.isInteger(s.maxStops)).toBe(true)
    expect(s.stops.length).toBeGreaterThan(0)
  })

  it('maxStops below minStops is widened to minStops, never contradicts it', () => {
    const s = init({ minStops: 5, maxStops: 2 })
    expect(s.maxStops).toBe(5)
  })

  it('pickerStateOf never throws, even from a hand-built empty-stops state', () => {
    const s: GradientPickerState = { ...init(), stops: [] }
    expect(() => pickerStateOf(s)).not.toThrow()
  })

  // ── finding #2c: never clamp an explicit chroma — raise maxChroma instead ──

  it('an explicit OKLCH chroma beyond the default maxChroma RAISES maxChroma, never clamps', () => {
    const s = init({
      stops: [
        { position: 0, color: { model: 'oklch', l: 0.5, c: 0.6, h: 30 } },
        { position: 100, color: 'blue' },
      ],
    })
    expect(s.maxChroma).toBeGreaterThanOrEqual(0.6)
    expect(s.stops[0]!.color).toMatchObject({ c: 0.6 })
  })
})

// ── update: every Msg ────────────────────────────────────────────────────────

describe('gradient-picker update', () => {
  it('addStop inserts sorted, colored exactly what colorAt reports there, and selects it', () => {
    const s = init({ interpolation: { space: 'srgb' } })
    const before = colorAt(s, 50)
    const [next] = update(s, { type: 'addStop', position: 50 })
    expect(next.stops).toHaveLength(3)
    expect(next.stops[1]!.position).toBe(50)
    expect(next.selectedId).toBe(next.stops[1]!.id)
    const shim: GradientPickerState = { ...next, stops: [next.stops[1]!] }
    expect(colorAt(shim, 50)).toBe(before)
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

  it('setAngle sets an explicit angle for linear, converting away from a to-keyword direction', () => {
    const s = init({ css: 'linear-gradient(to right, red, blue)' })
    expect(s.direction).toEqual({ type: 'to', x: 'right' })
    const [next] = update(s, { type: 'setAngle', angle: 40 })
    expect(next.direction).toEqual({ type: 'angle', deg: 40 })
  })

  it('setAngle normalizes to [0, 360) for linear', () => {
    const s = init()
    expect(update(s, { type: 'setAngle', angle: 400 })[0].direction).toEqual({
      type: 'angle',
      deg: 40,
    })
    expect(update(s, { type: 'setAngle', angle: -30 })[0].direction).toEqual({
      type: 'angle',
      deg: 330,
    })
  })

  it('setAngle sets conicAngle for conic, is a no-op for radial', () => {
    const conic = update(init(), { type: 'setKind', kind: 'conic' })[0]
    expect(update(conic, { type: 'setAngle', angle: 40 })[0].conicAngle).toBe(40)
    const radial = update(init(), { type: 'setKind', kind: 'radial' })[0]
    expect(update(radial, { type: 'setAngle', angle: 40 })[0]).toBe(radial)
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

  it('setGradientDraft updates ONLY the draft — never parses, never touches the committed gradient', () => {
    const s = init()
    const [next] = update(s, { type: 'setGradientDraft', value: 'not valid css at all' })
    expect(next.cssDraft).toBe('not valid css at all')
    expect(next.kind).toBe(s.kind)
    expect(next.stops).toBe(s.stops)
    expect(next.cssError).toBeNull()
  })

  it('setGradient replaces the gradient on valid css and clears the draft/error', () => {
    const withDraft = { ...init(), cssDraft: 'linear-gradient(0deg, red, blue)', cssError: 'stale' }
    const [next] = update(withDraft, {
      type: 'setGradient',
      css: 'radial-gradient(circle, red 0%, blue 100%)',
    })
    expect(next.kind).toBe('radial')
    expect(next.shape).toBe('circle')
    expect(next.cssDraft).toBeNull()
    expect(next.cssError).toBeNull()
  })

  it('setGradient on invalid css keeps the OLD gradient but surfaces the draft + reason', () => {
    const s = init()
    const [next] = update(s, { type: 'setGradient', css: 'garbage' })
    expect(next.kind).toBe(s.kind)
    expect(next.stops).toBe(s.stops)
    expect(next.cssDraft).toBe('garbage')
    expect(next.cssError).not.toBeNull()
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

  it('picker propagates eyeDropperSupported up to the gradient-level field (not per-stop)', () => {
    const s = init()
    const [next] = update(s, {
      type: 'picker',
      msg: { type: 'setEyeDropperSupported', supported: true },
    })
    expect(next.eyeDropperSupported).toBe(true)
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

  it('setDir sets the reading direction, rejects an invalid value', () => {
    const s = init()
    expect(update(s, { type: 'setDir', dir: 'rtl' })[0].dir).toBe('rtl')
    expect(update(s, { type: 'setDir', dir: 'nope' as never })[0]).toBe(s)
  })

  it('disabled state ignores every message', () => {
    const s = init({
      disabled: true,
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'blue' },
      ],
    })
    const messages: GradientPickerMsg[] = [
      { type: 'addStop', position: 50 },
      { type: 'removeStop', id: s.stops[0]!.id },
      { type: 'selectStop', id: s.stops[1]!.id },
      { type: 'moveStop', id: s.stops[0]!.id, position: 20 },
      { type: 'nudgeStop', id: s.stops[0]!.id, delta: 5 },
      { type: 'setKind', kind: 'radial' },
      { type: 'setRepeating', repeating: true },
      { type: 'setAngle', angle: 30 },
      { type: 'setCenter', x: 10, y: 10 },
      { type: 'setShape', shape: 'circle' },
      { type: 'setSize', size: 'closest-side' },
      { type: 'setInterpolation', space: 'oklch' },
      { type: 'reverse' },
      { type: 'distribute' },
      { type: 'setGradientDraft', value: 'x' },
      { type: 'setGradient', css: 'linear-gradient(0deg, red, blue)' },
      { type: 'picker', msg: { type: 'setHue', h: 10 } },
      { type: 'selectNextStop' },
      { type: 'selectPrevStop' },
    ]
    for (const msg of messages) expect(update(s, msg)[0]).toBe(s)
  })
})

// ── Finding #1: the picker edits the stop's OWN model, never re-projects ────

describe('finding #1: picker write-back preserves an out-of-gamut stop exactly', () => {
  it('setAlpha on an OKLCH stop leaves l/c/h bit-identical', () => {
    const s = init({
      maxChroma: 0.4,
      stops: [
        { position: 0, color: { model: 'oklch', l: 0.7, c: 0.3, h: 150 } },
        { position: 100, color: 'blue' },
      ],
    })
    const before = s.stops[0]!.color
    const [next] = update(s, { type: 'picker', msg: { type: 'setAlpha', alpha: 0.5 } })
    const after = next.stops[0]!.color
    expect(after).toEqual(before) // bit-identical: same object shape, same values
    expect(next.stops[0]!.alpha).toBe(0.5)
  })

  it('setHue on an OKLCH stop leaves l/c bit-identical, only h changes', () => {
    const s = init({
      maxChroma: 0.4,
      stops: [
        { position: 0, color: { model: 'oklch', l: 0.7, c: 0.3, h: 150 } },
        { position: 100, color: 'blue' },
      ],
    })
    const [next] = update(s, { type: 'picker', msg: { type: 'setHue', h: 200 } })
    const after = next.stops[0]!.color as { model: 'oklch'; l: number; c: number; h: number }
    expect(after.l).toBe(0.7)
    expect(after.c).toBe(0.3)
    expect(after.h).toBe(200)
  })

  it('a stop keeps its OWN model until an explicit setModel — pickerStateOf never re-projects', () => {
    const s = init({
      defaultModel: 'hsv', // the gradient's default model for NEW stops
      stops: [
        { position: 0, color: { model: 'oklch', l: 0.6, c: 0.15, h: 40 } },
        { position: 100, color: 'blue' },
      ],
    })
    expect(pickerStateOf(s).color.model).toBe('oklch')
    const [afterAlpha] = update(s, { type: 'picker', msg: { type: 'setAlpha', alpha: 0.9 } })
    expect(afterAlpha.stops[0]!.color.model).toBe('oklch')
  })

  it("setModel converts ONLY the selected stop, via color-picker's own reducer", () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'blue' },
      ],
    })
    const otherBefore = s.stops[1]!.color
    const [next] = update(s, { type: 'picker', msg: { type: 'setModel', model: 'oklch' } })
    expect(next.stops[0]!.color.model).toBe('oklch')
    expect(next.stops[1]!.color).toEqual(otherBefore) // untouched
  })

  it('gray (achromatic) stop keeps its hue across a model switch — lossless, no hex round trip', () => {
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
    const backColor = back.stops[0]!.color as { model: 'hsv'; h: number; s: number; v: number }
    // The *Preserving projections keep the HUE exact across an hsv<->oklch
    // round trip (the whole point — `withHsvProjection`/`hsvToOklchPreserving`
    // special-case an achromatic color's hue verbatim); s/v go through the
    // FLOAT (not integer-rounded, per Lane A's df7684fd) conversion math and
    // land within float noise of their original values, not bit-identical.
    expect(backColor.model).toBe('hsv')
    expect(backColor.h).toBe(210)
    expect(backColor.s).toBeCloseTo(0, 3)
    expect(backColor.v).toBeCloseTo(50, 3)
  })
})

describe('gradient-picker pickerStateOf', () => {
  it('derives a ColorPickerState from the selected stop, UNCHANGED (no projection)', () => {
    const s = init({
      maxChroma: 0.25,
      disabled: true,
      stops: [
        { position: 0, color: { model: 'oklch', l: 0.5, c: 0.2, h: 10 } },
        { position: 100, color: 'blue' },
      ],
    })
    const derived = pickerStateOf(s)
    expect(derived.color).toEqual(s.stops[0]!.color)
    expect(derived.alpha).toBe(1)
    expect(derived.disabled).toBe(true)
    expect(derived.maxChroma).toBe(0.25)
    expect(derived.eyeDropperSupported).toBe(false)
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

// ── toCss ────────────────────────────────────────────────────────────────────

describe('gradient-picker toCss', () => {
  const stops = [
    { position: 0, color: 'red' as const },
    { position: 100, color: 'blue' as const },
  ]

  it('linear (explicit angle): angle + interpolation head', () => {
    const s = init({ angle: 45, stops, interpolation: { space: 'srgb' } })
    expect(toCss(s)).toBe('linear-gradient(45deg in srgb, #ff0000 0%, #0000ff 100%)')
  })

  it('linear (to-keyword): reproduces the keyword, NOT a numerically-equal angle (finding #2b)', () => {
    const s = init({
      css: 'linear-gradient(to right, red, blue)',
      interpolation: { space: 'srgb' },
    })
    expect(toCss(s)).toBe('linear-gradient(to right in srgb, #ff0000 0%, #0000ff 100%)')
  })

  it('linear (to-corner-keyword): round-trips the two-word corner form', () => {
    const s = init({
      css: 'linear-gradient(to top right, red, blue)',
      interpolation: { space: 'srgb' },
    })
    expect(toCss(s)).toBe('linear-gradient(to top right in srgb, #ff0000 0%, #0000ff 100%)')
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

  it('conic: from angle + center + interpolation head (own conicAngle field, not linear direction)', () => {
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
      maxChroma: 0.6,
      stops: [
        { position: 0, color: { model: 'oklch', l: 0.7, c: 0.5, h: 30 } },
        { position: 100, color: 'blue' },
      ],
      interpolation: { space: 'srgb' },
    })
    expect(toCss(s)).toContain('oklch(0.7000 0.5000 30.00)')
  })
})

// ── Finding #2a: the omitted-`in` default depends on legacy vs modern syntax ─

describe('finding #2a: omitted color-interpolation-method default', () => {
  it('defaults to srgb when every stop uses a LEGACY syntax (hex/rgb/hsl/hwb/named)', () => {
    const r = parseGradient('linear-gradient(45deg, red, #00f)')
    expect(r).toMatchObject({ ok: true, value: { interpolation: { space: 'srgb' } } })
    const r2 = parseGradient(
      'linear-gradient(45deg, rgb(255 0 0), hsl(240 100% 50%), hwb(0 0% 0%))',
    )
    expect(r2).toMatchObject({ ok: true, value: { interpolation: { space: 'srgb' } } })
  })

  it('defaults to oklab as soon as ANY stop uses a modern syntax (oklch/oklab/lab/lch/color)', () => {
    const r = parseGradient('linear-gradient(45deg, red, oklch(0.5 0.1 200))')
    expect(r).toMatchObject({ ok: true, value: { interpolation: { space: 'oklab' } } })
  })

  it('an explicit `in <space>` always wins over the classification', () => {
    const r = parseGradient('linear-gradient(45deg in oklch, red, blue)')
    expect(r).toMatchObject({ ok: true, value: { interpolation: { space: 'oklch' } } })
  })
})

// ── Finding #2b: `to <side-or-corner>` is stored as a keyword, not an angle ──

describe('finding #2b: linear direction model', () => {
  it('parses `to right` as a keyword direction, not angle:90', () => {
    const r = parseGradient('linear-gradient(to right, red, blue)')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.direction).toEqual({ type: 'to', x: 'right' })
  })

  it('parses `to top`/`to bottom` as single-axis y directions', () => {
    expect(parseGradient('linear-gradient(to top, red, blue)')).toMatchObject({
      ok: true,
      value: { direction: { type: 'to', y: 'top' } },
    })
    expect(parseGradient('linear-gradient(to bottom, red, blue)')).toMatchObject({
      ok: true,
      value: { direction: { type: 'to', y: 'bottom' } },
    })
  })

  it('parses both corner token orders into the SAME structured direction', () => {
    const a = parseGradient('linear-gradient(to top right, red, blue)')
    const b = parseGradient('linear-gradient(to right top, red, blue)')
    expect(a).toMatchObject({
      ok: true,
      value: { direction: { type: 'to', x: 'right', y: 'top' } },
    })
    expect(b).toMatchObject({
      ok: true,
      value: { direction: { type: 'to', x: 'right', y: 'top' } },
    })
  })

  it('conic has NO to-form: its angle is always a plain number (conicAngle)', () => {
    const r = parseGradient('conic-gradient(from 45deg, red, blue)')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.conicAngle).toBe(45)
  })
})

// ── Finding #2c: reject, never clamp/drop ───────────────────────────────────

describe('finding #2c: parseGradient rejects rather than silently coercing', () => {
  it('rejects a "none" hue component (cannot be represented in PickerColor)', () => {
    const r = parseGradient('linear-gradient(45deg, oklch(0.5 0.2 none), blue)')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/none.*component/i)
  })

  it('rejects a "none" alpha component', () => {
    const r = parseGradient('linear-gradient(45deg, rgb(255 0 0 / none), blue)')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/none.*component/i)
  })

  it('rejects a stop position outside 0%-100%', () => {
    const tooHigh = parseGradient('linear-gradient(45deg, red 0%, blue 150%)')
    expect(tooHigh.ok).toBe(false)
    if (!tooHigh.ok) expect(tooHigh.reason).toMatch(/0%-100%/)
    const negative = parseGradient('linear-gradient(45deg, red -10%, blue 100%)')
    expect(negative.ok).toBe(false)
  })

  it('setGradient REJECTS (never truncates) a stop count above maxStops', () => {
    const s = init({
      maxStops: 2,
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'blue' },
      ],
    })
    const [next] = update(s, {
      type: 'setGradient',
      css: 'linear-gradient(45deg, red, green, blue)',
    })
    expect(next.stops).toBe(s.stops) // unchanged — never truncated to 2
    expect(next.cssError).toMatch(/at most 2 stops/)
  })

  it('setGradient REJECTS (never pads) a stop count below minStops', () => {
    const s = init({
      minStops: 3,
      stops: [
        { position: 0, color: 'red' },
        { position: 50, color: 'green' },
        { position: 100, color: 'blue' },
      ],
    })
    const [next] = update(s, { type: 'setGradient', css: 'linear-gradient(45deg, red, blue)' })
    expect(next.stops).toBe(s.stops)
    expect(next.cssError).toMatch(/at least 3 stops/)
  })

  it("an explicit chroma beyond a LIVE instance's maxChroma RAISES it via setGradient, never clamps", () => {
    const s = init({ maxChroma: 0.1 })
    const [next] = update(s, {
      type: 'setGradient',
      css: 'linear-gradient(45deg, oklch(0.5 0.5 30), blue)',
    })
    expect(next.maxChroma).toBeGreaterThanOrEqual(0.5)
    expect(next.stops[0]!.color).toMatchObject({ c: 0.5 })
  })
})

// ── Finding #6: id stability + selection-by-position-index across setGradient

describe('finding #6: setGradient keeps ids monotone and selection by position-index', () => {
  it('never restarts the id counter — new stops continue from the OLD nextId', () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'blue' },
      ],
    }) // nextId 3
    const [next] = update(s, {
      type: 'setGradient',
      css: 'linear-gradient(0deg, red, green, blue)',
    })
    expect(next.stops.map((st) => st.id)).toEqual(['s3', 's4', 's5'])
    expect(next.nextId).toBe(6)
  })

  it('preserves selection by POSITION-INDEX when the same index still exists', () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 50, color: 'green' },
        { position: 100, color: 'blue' },
      ],
    })
    const [selected] = update(s, { type: 'selectStop', id: s.stops[1]!.id }) // index 1
    const [next] = update(selected, {
      type: 'setGradient',
      css: 'linear-gradient(0deg, yellow, orange, purple, cyan)',
    })
    expect(next.selectedId).toBe(next.stops[1]!.id) // still index 1
  })

  it('clamps the preserved index into the new (shorter) array', () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 50, color: 'green' },
        { position: 100, color: 'blue' },
      ],
    })
    const [selected] = update(s, { type: 'selectStop', id: s.stops[2]!.id }) // index 2
    const [next] = update(selected, {
      type: 'setGradient',
      css: 'linear-gradient(0deg, red, blue)',
    })
    expect(next.selectedId).toBe(next.stops[1]!.id) // clamped to the last index
  })
})

// ── colorAt (independent references, not interpolateColor itself) ──────────

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

  it('non-repeating: clamps outside the stop range to the nearest end stop', () => {
    const s = init({
      stops: [
        { position: 20, color: 'red' },
        { position: 80, color: 'blue' },
      ],
    })
    expect(colorAt(s, 0)).toBe('#ff0000')
    expect(colorAt(s, 100)).toBe('#0000ff')
  })

  it('midpoint of red -> blue in srgb: hand-verified exact byte value', () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'blue' },
      ],
      interpolation: { space: 'srgb' },
    })
    // (1,0,0) and (0,0,1) lerp to (0.5,0,0.5) -> 0.5*255=127.5, Math.round -> 128 -> #800080.
    expect(colorAt(s, 50)).toBe('#800080')
  })

  it('srgb vs oklch produce genuinely different results for the same stops/position', () => {
    const base = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'blue' },
      ],
    })
    const srgbState = update(base, { type: 'setInterpolation', space: 'srgb' })[0]
    const oklchState = update(base, { type: 'setInterpolation', space: 'oklch', hue: 'shorter' })[0]
    expect(colorAt(srgbState, 50)).toBe('#800080')
    expect(colorAt(oklchState, 50)).not.toBe('#800080')
    expect(colorAt(oklchState, 50).startsWith('oklch(')).toBe(true)
  })

  // Finding #3: repeating wrap — the review's own measured reproduction.
  it('finding #3: repeating wraps a query outside the stop range by the period, matching a real repeating-linear-gradient', () => {
    const s = init({
      repeating: true,
      stops: [
        { position: 20, color: 'red' },
        { position: 60, color: 'blue' },
      ],
      interpolation: { space: 'srgb' },
    })
    // period 40; querying 10 wraps to 20 + (((10-20)%40)+40)%40 = 20+30 = 50,
    // 75% of the way from red to blue in srgb: r=0.25,g=0,b=0.75 -> #4000bf.
    expect(colorAt(s, 10)).toBe('#4000bf')
    expect(colorAt(s, 10)).toBe(colorAt(s, 50))
    // A full period away must repeat identically.
    expect(colorAt(s, 10)).toBe(colorAt(s, 10 + 40))
    expect(colorAt(s, 10)).toBe(colorAt(s, 10 - 40))
  })

  it('non-repeating does NOT wrap — the same out-of-range query just clamps', () => {
    const s = init({
      repeating: false,
      stops: [
        { position: 20, color: 'red' },
        { position: 60, color: 'blue' },
      ],
      interpolation: { space: 'srgb' },
    })
    expect(colorAt(s, 10)).toBe('#ff0000') // clamped to the first stop, NOT wrapped
  })

  it('interpolates between the two BRACKETING stops for a 3+ stop gradient', () => {
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

  it("cross-checks the oklch/oklab path against interpolateColor as an INTEGRATION property (colorAt must feed it the right (a,b,t,space,hueMethod)) — color.test.ts owns interpolateColor's own correctness", () => {
    const s = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 100, color: 'lime' },
      ],
    }) // default interpolation: oklab
    const before = colorAt(s, 50)
    const beforeParsed = parseCssColor(before)!
    const a = parseCssColor('red')!
    const b = parseCssColor('lime')!
    const expected = interpolateColor(a, b, 0.5, 'oklab', 'shorter')
    if (beforeParsed.space === 'oklab' && expected.space === 'oklab') {
      expect(beforeParsed.l).toBeCloseTo(expected.l!, 3)
      expect(beforeParsed.a).toBeCloseTo(expected.a!, 3)
      expect(beforeParsed.b).toBeCloseTo(expected.b!, 3)
    }
  })
})

// ── parseGradient: general accept/reject sweep ──────────────────────────────

describe('gradient-picker parseGradient', () => {
  it('accepts a plain linear gradient with an angle', () => {
    const r = parseGradient('linear-gradient(45deg, red 0%, blue 100%)')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.kind).toBe('linear')
      expect(r.value.direction).toEqual({ type: 'angle', deg: 45 })
      expect(r.value.stops).toHaveLength(2)
    }
  })

  it('accepts angles in deg/grad/rad/turn', () => {
    expect(parseGradient('linear-gradient(100grad, red, blue)')).toMatchObject({
      ok: true,
      value: { direction: { type: 'angle', deg: 90 } },
    })
    expect(parseGradient('linear-gradient(0.5turn, red, blue)')).toMatchObject({
      ok: true,
      value: { direction: { type: 'angle', deg: 180 } },
    })
    const rad = parseGradient(`linear-gradient(${Math.PI / 2}rad, red, blue)`)
    expect(rad.ok).toBe(true)
    if (rad.ok && rad.value.direction.type === 'angle')
      expect(rad.value.direction.deg).toBeCloseTo(90, 5)
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
      value: { kind: 'conic', conicAngle: 20, center: { x: 10, y: 90 } },
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

  it('accepts a head-omitted gradient (defaults to 180deg)', () => {
    const r = parseGradient('linear-gradient(red, blue)')
    expect(r).toMatchObject({ ok: true, value: { direction: { type: 'angle', deg: 180 } } })
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
  const p = connect(signalOf(s), send, { id: 'gp', trackLabel: 'Custom track label' })

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

  // Finding #11: trackLabel is an actual ConnectOptions field that must be used.
  it("finding #11: opts.trackLabel is actually used for a stop's aria-label", () => {
    expect(read(p.stop(s.stops[0]!.id)['aria-label'], s)).toBe('Custom track label')
  })

  it('finding #3: track style is built from the SAME serializer as toCss (hue method included, repeating/rtl reflected)', () => {
    const longerHueState = {
      ...s,
      interpolation: { space: 'oklch' as const, hue: 'longer' as const },
    }
    expect(read(p.track.style, longerHueState)).toMatch(
      /linear-gradient\(90deg in oklch longer hue,/,
    )
    const repeatingState = { ...s, repeating: true }
    expect(read(p.track.style, repeatingState)).toMatch(/^background: repeating-linear-gradient\(/)
    const rtlState = { ...s, dir: 'rtl' as const }
    expect(read(p.track.style, rtlState)).toMatch(/linear-gradient\(270deg/)
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

  it('finding #8: interpolationHueSelect is disabled for a non-polar space AND when the whole picker is disabled', () => {
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
    expect(
      read(p.interpolationHueSelect.disabled, {
        ...s,
        disabled: true,
        interpolation: { space: 'oklch', hue: 'shorter' },
      }),
    ).toBe(true)
  })

  it('finding #6: cssInput shows the DRAFT while editing, the live value otherwise; aria-invalid + describedby follow cssError', () => {
    expect(read(p.cssInput.value, s)).toBe(toCss(s))
    expect(read(p.cssInput['aria-invalid'], s)).toBeUndefined()
    expect(read(p.cssInput['aria-describedby'], s)).toBeUndefined()
    const draftState = { ...s, cssDraft: 'typing...', cssError: 'bad input' }
    expect(read(p.cssInput.value, draftState)).toBe('typing...')
    expect(read(p.cssInput['aria-invalid'], draftState)).toBe('true')
    expect(read(p.cssInput['aria-describedby'], draftState)).toBe(p.cssError.id)
    expect(read(p.cssError.visible, draftState)).toBe(true)
    expect(read(p.cssError.message, draftState)).toContain('bad input')
    expect(read(p.cssError.visible, s)).toBe(false)
  })

  it('picker exposes the full color-picker part bag over the derived state', () => {
    expect(p.picker.hexInput).toBeDefined()
    expect(p.picker.eyeDropperTrigger).toBeDefined()
    // `p.picker`'s signals are composed atop the OUTER gradient-picker state
    // signal, so `read` takes the gradient state `s`.
    expect(read(p.picker.hexInput.value, s)).toBe('#ff0000')
  })
})

// ── Finding #5: every handler is tagSend-wrapped with truthful variants ─────

describe('finding #5: tagSend coverage and picker variant truthfulness', () => {
  const s = init({
    stops: [
      { position: 0, color: 'red' },
      { position: 100, color: 'blue' },
    ],
  })
  const send = vi.fn()
  const p = connect(signalOf(s), send, { id: 'gp' })

  it('track: every pointer handler (incl. move/up/cancel/lostpointercapture) is tagSend-wrapped', () => {
    expect(variantsOf(p.track.onPointerDown)).toEqual(['addStop', 'moveStop'])
    expect(variantsOf(p.track.onPointerMove)).toEqual(['moveStop'])
    expect(variantsOf(p.track.onPointerUp)).toBeUndefined()
    expect(variantsOf(p.track.onPointerCancel)).toBeUndefined()
    expect(variantsOf(p.track.onLostPointerCapture)).toBeUndefined()
  })

  it('stop(): every pointer handler is tagSend-wrapped, including onPointerMove', () => {
    const stop = p.stop(s.stops[0]!.id)
    expect(variantsOf(stop.onPointerDown)).toEqual(['selectStop', 'moveStop'])
    expect(variantsOf(stop.onPointerMove)).toEqual(['moveStop'])
    expect(variantsOf(stop.onPointerUp)).toBeUndefined()
    expect(variantsOf(stop.onPointerCancel)).toBeUndefined()
    expect(variantsOf(stop.onLostPointerCapture)).toBeUndefined()
    expect(variantsOf(stop.onFocus)).toEqual(['selectStop'])
    expect(variantsOf(stop.onKeyDown)).toEqual(['nudgeStop', 'moveStop', 'removeStop'])
  })

  it('centerArea: every pointer handler is tagSend-wrapped', () => {
    expect(variantsOf(p.centerArea.onPointerDown)).toEqual(['setCenter'])
    expect(variantsOf(p.centerArea.onPointerUp)).toBeUndefined()
    expect(variantsOf(p.centerArea.onPointerCancel)).toBeUndefined()
    expect(variantsOf(p.centerArea.onLostPointerCapture)).toBeUndefined()
  })

  it("the embedded picker's wrapped send is tagged __lluiVariants: ['picker'] — every handler color-picker builds from it reports the TRUTHFUL parent type", () => {
    expect(variantsOf(p.picker.hueSlider.onInput)).toEqual(['picker'])
    expect(variantsOf(p.picker.modelToggle.onClick)).toEqual(['picker'])
    expect(variantsOf(p.picker.eyeDropperTrigger.onClick)).toEqual(['picker'])
  })

  it('picker wrapping still dispatches the correctly-shaped wrapped message', () => {
    p.picker.hueSlider.onInput(realInputEvent(document.createElement('input'), '200'))
    expect(send).toHaveBeenCalledWith({ type: 'picker', msg: { type: 'setHue', h: 200 } })
  })
})

// ── connect(): dispatch, using REAL events (finding #13) ────────────────────

describe('gradient-picker connect — dispatch (real events)', () => {
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

  it('angleInput dispatches setAngle from a real input element', () => {
    const s = init()
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    const input = document.createElement('input')
    p.angleInput.onInput(realInputEvent(input, '77'))
    expect(send).toHaveBeenCalledWith({ type: 'setAngle', angle: 77 })
  })

  it('finding #6: cssInput commits on Enter/change, NEVER on plain input (draft only)', () => {
    const s = init()
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    const input = document.createElement('input')

    p.cssInput.onInput(realInputEvent(input, 'linear-gradient(0deg, red, blue)'))
    expect(send).toHaveBeenCalledWith({
      type: 'setGradientDraft',
      value: 'linear-gradient(0deg, red, blue)',
    })
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'setGradient' }))

    send.mockClear()
    const enterEvent = realKeyEvent(input, 'Enter')
    Object.defineProperty(enterEvent, 'target', { value: input, configurable: true })
    p.cssInput.onKeyDown(enterEvent)
    expect(send).toHaveBeenCalledWith({
      type: 'setGradient',
      css: 'linear-gradient(0deg, red, blue)',
    })
    expect(enterEvent.defaultPrevented).toBe(true)

    send.mockClear()
    input.value = 'radial-gradient(circle, red, blue)'
    p.cssInput.onChange(realInputEvent(input, 'radial-gradient(circle, red, blue)', 'change'))
    expect(send).toHaveBeenCalledWith({
      type: 'setGradient',
      css: 'radial-gradient(circle, red, blue)',
    })
  })

  it('a non-Enter key on cssInput does not commit', () => {
    const s = init()
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    const input = document.createElement('input')
    input.value = 'x'
    const tabEvent = realKeyEvent(input, 'Tab')
    Object.defineProperty(tabEvent, 'target', { value: input, configurable: true })
    p.cssInput.onKeyDown(tabEvent)
    expect(send).not.toHaveBeenCalled()
  })

  it('interpolationSpaceSelect / interpolationHueSelect dispatch setInterpolation', () => {
    const s = init()
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    // A real <select>'s `.value` setter only takes effect when a matching
    // <option> exists — populate both selects before dispatching.
    const spaceSelect = document.createElement('select')
    for (const v of ['srgb', 'srgb-linear', 'oklab', 'oklch', 'hsl']) {
      spaceSelect.appendChild(new Option(v, v))
    }
    p.interpolationSpaceSelect.onInput(
      realInputEvent(spaceSelect as unknown as HTMLInputElement, 'hsl'),
    )
    expect(send).toHaveBeenCalledWith({
      type: 'setInterpolation',
      space: 'hsl',
      hue: s.interpolation.hue,
    })

    const hueSelect = document.createElement('select')
    for (const v of ['shorter', 'longer', 'increasing', 'decreasing']) {
      hueSelect.appendChild(new Option(v, v))
    }
    p.interpolationHueSelect.onInput(
      realInputEvent(hueSelect as unknown as HTMLInputElement, 'increasing'),
    )
    expect(send).toHaveBeenCalledWith({
      type: 'setInterpolation',
      space: s.interpolation.space,
      hue: 'increasing',
    })
  })
})

describe('gradient-picker connect — pointer drag on the track (add + drag), real PointerEvents', () => {
  it('pointerdown on the bare track adds a stop at that position and focuses it', () => {
    const s = init()
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    const track = fakeTrackElement()
    const stopEl = document.createElement('div')
    const focusSpy = vi.spyOn(stopEl, 'focus')
    track.querySelector = vi.fn(() => stopEl)
    p.track.onPointerDown(realPointerEvent(track, 'pointerdown', { clientX: 100 }))
    expect(send).toHaveBeenCalledWith({ type: 'addStop', position: 50 })
    expect(track.setPointerCapture).toHaveBeenCalledWith(1)
    expect(focusSpy).toHaveBeenCalledTimes(1)
  })

  it('subsequent pointermove drags the newly-added stop', () => {
    const s = init()
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    const track = fakeTrackElement()
    p.track.onPointerDown(realPointerEvent(track, 'pointerdown', { clientX: 100 }))
    const newId = `s${s.nextId}`
    send.mockClear()
    p.track.onPointerMove(realPointerEvent(track, 'pointermove', { clientX: 150 }))
    expect(send).toHaveBeenCalledWith({ type: 'moveStop', id: newId, position: 75 })
  })

  it('pointerup ends the drag (a further move is inert)', () => {
    const s = init()
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    const track = fakeTrackElement()
    p.track.onPointerDown(realPointerEvent(track, 'pointerdown', { clientX: 100 }))
    p.track.onPointerUp(realPointerEvent(track, 'pointerup'))
    send.mockClear()
    p.track.onPointerMove(realPointerEvent(track, 'pointermove', { clientX: 10 }))
    expect(send).not.toHaveBeenCalled()
  })

  it('mirrors under rtl', () => {
    const s: GradientPickerState = { ...init(), dir: 'rtl' }
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    const track = fakeTrackElement()
    p.track.onPointerDown(realPointerEvent(track, 'pointerdown', { clientX: 50 })) // 25% physical -> 75% logical under rtl
    expect(send).toHaveBeenCalledWith({ type: 'addStop', position: 75 })
  })

  it('disabled: pointerdown on the track is inert', () => {
    const s = init({ disabled: true })
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    const track = fakeTrackElement()
    p.track.onPointerDown(realPointerEvent(track, 'pointerdown'))
    expect(send).not.toHaveBeenCalled()
  })
})

describe('gradient-picker connect — pointer drag on an existing stop', () => {
  function fakeStopTarget(): HTMLDivElement {
    const track = fakeTrackElement()
    const el = document.createElement('div')
    Object.assign(el, {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 20,
        height: 20,
        right: 20,
        bottom: 20,
      }),
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
      closest: vi.fn(() => track),
    })
    return el
  }

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
    const el = fakeStopTarget()
    const e = realPointerEvent(el, 'pointerdown', { clientX: 100 })
    const stopPropSpy = vi.spyOn(e, 'stopPropagation')
    stopPart.onPointerDown(e)
    expect(stopPropSpy).toHaveBeenCalledTimes(1)
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
    const el = fakeStopTarget()
    stopPart.onPointerDown(realPointerEvent(el, 'pointerdown', { clientX: 100 }))
    send.mockClear()
    stopPart.onPointerMove(realPointerEvent(el, 'pointermove', { clientX: 20 }))
    expect(send).toHaveBeenCalledWith({ type: 'moveStop', id, position: 10 })
  })

  it('finding #8 (RTL): ArrowRight/Left flip under rtl; ArrowUp/Down are direction-agnostic', () => {
    const ltr = init({
      stops: [
        { position: 0, color: 'red' },
        { position: 50, color: 'green' },
        { position: 100, color: 'blue' },
      ],
    })
    const rtl: GradientPickerState = { ...ltr, dir: 'rtl' }
    const id = ltr.stops[1]!.id

    const sendLtr = vi.fn()
    const pLtr = connect(signalOf(ltr), sendLtr, { id: 'gp' })
    const el1 = fakeStopTarget()
    pLtr.stop(id).onKeyDown(realKeyEvent(el1, 'ArrowRight'))
    expect(sendLtr).toHaveBeenCalledWith({ type: 'nudgeStop', id, delta: 1 })

    const sendRtl = vi.fn()
    const pRtl = connect(signalOf(rtl), sendRtl, { id: 'gp' })
    const el2 = fakeStopTarget()
    pRtl.stop(id).onKeyDown(realKeyEvent(el2, 'ArrowRight'))
    // Under rtl, ArrowRight is flipped to mean "decrease".
    expect(sendRtl).toHaveBeenCalledWith({ type: 'nudgeStop', id, delta: -1 })

    sendRtl.mockClear()
    pRtl.stop(id).onKeyDown(realKeyEvent(el2, 'ArrowUp'))
    // ArrowUp/Down are never flipped by rtl (flipArrow only touches Left/Right).
    expect(sendRtl).toHaveBeenCalledWith({ type: 'nudgeStop', id, delta: 1 })
  })

  it('keyboard: ArrowUp/Down (APG horizontal-slider synonyms), Shift is coarse, Home/End snap, Delete removes', () => {
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
    const el = fakeStopTarget()

    stopPart.onKeyDown(realKeyEvent(el, 'ArrowUp'))
    expect(send).toHaveBeenCalledWith({ type: 'nudgeStop', id, delta: 1 })
    stopPart.onKeyDown(realKeyEvent(el, 'ArrowDown', { shiftKey: true }))
    expect(send).toHaveBeenCalledWith({ type: 'nudgeStop', id, delta: -10 })
    stopPart.onKeyDown(realKeyEvent(el, 'Home'))
    expect(send).toHaveBeenCalledWith({ type: 'moveStop', id, position: 0 })
    stopPart.onKeyDown(realKeyEvent(el, 'End'))
    expect(send).toHaveBeenCalledWith({ type: 'moveStop', id, position: 100 })
    stopPart.onKeyDown(realKeyEvent(el, 'PageUp'))
    expect(send).toHaveBeenCalledWith({ type: 'nudgeStop', id, delta: 10 })
    stopPart.onKeyDown(realKeyEvent(el, 'PageDown'))
    expect(send).toHaveBeenCalledWith({ type: 'nudgeStop', id, delta: -10 })
    stopPart.onKeyDown(realKeyEvent(el, 'Delete'))
    expect(send).toHaveBeenCalledWith({ type: 'removeStop', id })
    stopPart.onKeyDown(realKeyEvent(el, 'Backspace'))
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
  function fakeAreaElement(): HTMLDivElement {
    const el = document.createElement('div')
    const thumb = document.createElement('div')
    Object.assign(el, {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 100,
        height: 50,
        right: 100,
        bottom: 50,
      }),
      querySelector: vi.fn(() => thumb),
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    })
    return el
  }

  it('pointerdown/move on centerArea dispatches setCenter from the 2D position', () => {
    const s = init({ kind: 'radial' })
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    const el = fakeAreaElement()
    p.centerArea.onPointerDown(realPointerEvent(el, 'pointerdown', { clientX: 25, clientY: 25 }))
    expect(send).toHaveBeenCalledWith({ type: 'setCenter', x: 25, y: 50 })
  })

  it('finding #8: centerThumb keyboard nudges x/y (rtl-flipped Left/Right), Home/End snap to corners', () => {
    const s = init({ kind: 'radial', center: { x: 50, y: 50 } })
    const send = vi.fn()
    const p = connect(signalOf(s), send, { id: 'gp' })
    const el = document.createElement('div')
    p.centerThumb.onKeyDown(realKeyEvent(el, 'ArrowRight'))
    expect(send).toHaveBeenCalledWith({ type: 'setCenter', x: 51, y: 50 })
    p.centerThumb.onKeyDown(realKeyEvent(el, 'ArrowDown', { shiftKey: true }))
    expect(send).toHaveBeenCalledWith({ type: 'setCenter', x: 50, y: 60 })
    p.centerThumb.onKeyDown(realKeyEvent(el, 'Home'))
    expect(send).toHaveBeenCalledWith({ type: 'setCenter', x: 0, y: 0 })
    p.centerThumb.onKeyDown(realKeyEvent(el, 'End'))
    expect(send).toHaveBeenCalledWith({ type: 'setCenter', x: 100, y: 100 })

    const rtl: GradientPickerState = { ...s, dir: 'rtl' }
    const sendRtl = vi.fn()
    const pRtl = connect(signalOf(rtl), sendRtl, { id: 'gp' })
    pRtl.centerThumb.onKeyDown(realKeyEvent(el, 'ArrowRight'))
    expect(sendRtl).toHaveBeenCalledWith({ type: 'setCenter', x: 49, y: 50 })
  })
})

// ── Property test: parseGradient(toCss(state)) round-trips through a random
// sequence of reducer messages, not just a hand-picked table (finding #13) ──

describe('gradient-picker property: round trip survives arbitrary reducer traffic', () => {
  const gpComponent = component<GradientPickerState, GradientPickerMsg, never>({
    name: 'gradient-picker-property-under-test',
    init: () => init({ interpolation: { space: 'srgb' } }),
    update: (state, msg) => update(state, msg),
    view: () => [],
  })

  const POSITIONS = [0, 5, 12.5, 25, 33, 50, 66, 75, 87.5, 95, 100]
  const ANGLES = [0, 15, 45, 90, 135, 180, 225, 270, 315, 359]
  let posCursor = 0
  let angleCursor = 0
  const nextPosition = (): number => POSITIONS[posCursor++ % POSITIONS.length]!
  const nextAngle = (): number => ANGLES[angleCursor++ % ANGLES.length]!

  function roundTripHolds(state: GradientPickerState): boolean {
    const css = toCss(state)
    const parsed = parseGradient(css)
    if (!parsed.ok) return false
    if (parsed.value.kind !== state.kind) return false
    if (parsed.value.repeating !== state.repeating) return false
    if (parsed.value.interpolation.space !== state.interpolation.space) return false
    // `hue` only matters for a POLAR space (hsl/oklch) — `toCss` correctly
    // drops an inert hue method for a non-polar space (`interpolationHead`),
    // so a stored-but-irrelevant hue on e.g. `srgb-linear` legitimately does
    // NOT round-trip, and comparing it there would be testing a value that
    // was never observable in the serialized CSS to begin with.
    const isPolar = state.interpolation.space === 'hsl' || state.interpolation.space === 'oklch'
    if (isPolar && parsed.value.interpolation.hue !== state.interpolation.hue) return false
    if (state.kind === 'conic' && Math.abs(parsed.value.conicAngle - state.conicAngle) > 0.05) {
      return false
    }
    if (state.kind === 'linear') {
      if (state.direction.type === 'angle') {
        if (parsed.value.direction.type !== 'angle') return false
        if (Math.abs(parsed.value.direction.deg - state.direction.deg) > 0.05) return false
      }
    }
    if (parsed.value.stops.length !== state.stops.length) return false
    for (let i = 0; i < state.stops.length; i++) {
      if (Math.abs(parsed.value.stops[i]!.position - state.stops[i]!.position) > 0.05) return false
      const a = pickerColorToCss(state.stops[i]!.color, state.stops[i]!.alpha)
      const b = pickerColorToCss(parsed.value.stops[i]!.color, parsed.value.stops[i]!.alpha)
      if (a !== b) return false
    }
    return true
  }

  it('holds after every message in 200 random sequences (kind/repeating/angle/center/stops/interpolation only — setGradient/picker are exercised by their own dedicated tests)', () => {
    propertyTest<GradientPickerState, GradientPickerMsg, never>(gpComponent, {
      invariants: [(state) => state.stops.length >= state.minStops && roundTripHolds(state)],
      messageGenerators: {
        addStop: (): GradientPickerMsg => ({ type: 'addStop', position: nextPosition() }),
        removeStop: (s: GradientPickerState): GradientPickerMsg => ({
          type: 'removeStop',
          id: s.stops[posCursor++ % s.stops.length]!.id,
        }),
        moveStop: (s: GradientPickerState): GradientPickerMsg => ({
          type: 'moveStop',
          id: s.stops[posCursor++ % s.stops.length]!.id,
          position: nextPosition(),
        }),
        nudgeStop: (s: GradientPickerState): GradientPickerMsg => ({
          type: 'nudgeStop',
          id: s.stops[posCursor++ % s.stops.length]!.id,
          delta: nextPosition() - 50,
        }),
        setKind: (): GradientPickerMsg => ({
          type: 'setKind',
          kind: (['linear', 'radial', 'conic'] as const)[angleCursor++ % 3]!,
        }),
        setRepeating: (): GradientPickerMsg => ({
          type: 'setRepeating',
          repeating: angleCursor++ % 2 === 0,
        }),
        setAngle: (): GradientPickerMsg => ({ type: 'setAngle', angle: nextAngle() }),
        setCenter: (): GradientPickerMsg => ({
          type: 'setCenter',
          x: nextPosition(),
          y: nextPosition(),
        }),
        setShape: (): GradientPickerMsg => ({
          type: 'setShape',
          shape: (['circle', 'ellipse'] as const)[angleCursor++ % 2]!,
        }),
        setSize: (): GradientPickerMsg => ({
          type: 'setSize',
          size: (['closest-side', 'closest-corner', 'farthest-side', 'farthest-corner'] as const)[
            angleCursor++ % 4
          ]!,
        }),
        setInterpolation: (): GradientPickerMsg => ({
          type: 'setInterpolation',
          space: (['srgb', 'srgb-linear', 'oklab', 'oklch', 'hsl'] as const)[angleCursor++ % 5]!,
          hue: (['shorter', 'longer', 'increasing', 'decreasing'] as const)[angleCursor++ % 4]!,
        }),
        reverse: (): GradientPickerMsg => ({ type: 'reverse' }),
        distribute: (): GradientPickerMsg => ({ type: 'distribute' }),
      },
      runs: 200,
      maxSequenceLength: 15,
      seed: 12345,
    })
  })
})
