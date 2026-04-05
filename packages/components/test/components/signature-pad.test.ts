import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  isEmpty,
  pointCount,
  getBounds,
} from '../../src/components/signature-pad'
import type { SignaturePadState } from '../../src/components/signature-pad'

type Ctx = { p: SignaturePadState }
const wrap = (p: SignaturePadState): Ctx => ({ p })

describe('signature-pad reducer', () => {
  it('starts empty + not drawing', () => {
    expect(init()).toMatchObject({ strokes: [], current: null, drawing: false })
  })

  it('strokeStart begins a new stroke with the first point', () => {
    const [s] = update(init(), { type: 'strokeStart', x: 10, y: 20 })
    expect(s.drawing).toBe(true)
    expect(s.current).toEqual([{ x: 10, y: 20 }])
  })

  it('strokePoint appends to current stroke', () => {
    const [s1] = update(init(), { type: 'strokeStart', x: 0, y: 0 })
    const [s2] = update(s1, { type: 'strokePoint', x: 5, y: 5 })
    const [s3] = update(s2, { type: 'strokePoint', x: 10, y: 10 })
    expect(s3.current?.length).toBe(3)
  })

  it('strokePoint includes pressure when provided', () => {
    const [s1] = update(init(), { type: 'strokeStart', x: 0, y: 0, pressure: 0.5 })
    expect(s1.current?.[0]).toEqual({ x: 0, y: 0, pressure: 0.5 })
  })

  it('strokePoint is a no-op before strokeStart', () => {
    const [s] = update(init(), { type: 'strokePoint', x: 5, y: 5 })
    expect(s.current).toBeNull()
  })

  it('strokeEnd commits the current stroke', () => {
    let s: SignaturePadState = init()
    ;[s] = update(s, { type: 'strokeStart', x: 0, y: 0 })
    ;[s] = update(s, { type: 'strokePoint', x: 5, y: 5 })
    ;[s] = update(s, { type: 'strokeEnd' })
    expect(s.strokes).toHaveLength(1)
    expect(s.current).toBeNull()
    expect(s.drawing).toBe(false)
  })

  it('strokeEnd drops 1-point strokes (accidental taps)', () => {
    let s: SignaturePadState = init()
    ;[s] = update(s, { type: 'strokeStart', x: 0, y: 0 })
    ;[s] = update(s, { type: 'strokeEnd' })
    expect(s.strokes).toEqual([])
  })

  it('strokeCancel discards current', () => {
    let s: SignaturePadState = init()
    ;[s] = update(s, { type: 'strokeStart', x: 0, y: 0 })
    ;[s] = update(s, { type: 'strokePoint', x: 5, y: 5 })
    ;[s] = update(s, { type: 'strokeCancel' })
    expect(s.current).toBeNull()
    expect(s.strokes).toEqual([])
  })

  it('undo removes the last committed stroke', () => {
    let s: SignaturePadState = init()
    ;[s] = update(s, { type: 'strokeStart', x: 0, y: 0 })
    ;[s] = update(s, { type: 'strokePoint', x: 5, y: 5 })
    ;[s] = update(s, { type: 'strokeEnd' })
    ;[s] = update(s, { type: 'strokeStart', x: 10, y: 10 })
    ;[s] = update(s, { type: 'strokePoint', x: 15, y: 15 })
    ;[s] = update(s, { type: 'strokeEnd' })
    expect(s.strokes).toHaveLength(2)
    ;[s] = update(s, { type: 'undo' })
    expect(s.strokes).toHaveLength(1)
  })

  it('clear wipes all strokes + current', () => {
    let s: SignaturePadState = init({
      strokes: [
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      ],
    })
    ;[s] = update(s, { type: 'clear' })
    expect(s).toMatchObject({ strokes: [], current: null, drawing: false })
  })

  it('disabled blocks stroke input', () => {
    const s0 = init({ disabled: true })
    const [s] = update(s0, { type: 'strokeStart', x: 0, y: 0 })
    expect(s.drawing).toBe(false)
  })

  it('clear still works when disabled', () => {
    const s0: SignaturePadState = {
      ...init({ disabled: true }),
      strokes: [
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      ],
    }
    const [s] = update(s0, { type: 'clear' })
    expect(s.strokes).toEqual([])
  })
})

describe('signature-pad helpers', () => {
  it('isEmpty', () => {
    expect(isEmpty(init())).toBe(true)
    expect(
      isEmpty(
        init({
          strokes: [
            [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
          ],
        }),
      ),
    ).toBe(false)
  })

  it('pointCount sums across strokes + current', () => {
    let s: SignaturePadState = init()
    ;[s] = update(s, { type: 'strokeStart', x: 0, y: 0 })
    ;[s] = update(s, { type: 'strokePoint', x: 1, y: 1 })
    ;[s] = update(s, { type: 'strokePoint', x: 2, y: 2 })
    ;[s] = update(s, { type: 'strokeEnd' })
    // committed: 3 points
    ;[s] = update(s, { type: 'strokeStart', x: 10, y: 10 })
    // current: 1 point
    expect(pointCount(s)).toBe(4)
  })

  it('getBounds computes the bounding box', () => {
    const s = init({
      strokes: [
        [
          { x: 10, y: 20 },
          { x: 50, y: 80 },
        ],
      ],
    })
    expect(getBounds(s)).toEqual({ x: 10, y: 20, width: 40, height: 60 })
  })

  it('getBounds returns null for empty pad', () => {
    expect(getBounds(init())).toBeNull()
  })
})

describe('signature-pad.connect', () => {
  it('clearTrigger disabled when empty', () => {
    const p = connect<Ctx>((s) => s.p, vi.fn())
    expect(p.clearTrigger.disabled(wrap(init()))).toBe(true)
    const nonEmpty = init({
      strokes: [
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      ],
    })
    expect(p.clearTrigger.disabled(wrap(nonEmpty))).toBe(false)
  })

  it('undoTrigger disabled when no strokes', () => {
    const p = connect<Ctx>((s) => s.p, vi.fn())
    expect(p.undoTrigger.disabled(wrap(init()))).toBe(true)
  })

  it('root data-drawing tracks state', () => {
    const p = connect<Ctx>((s) => s.p, vi.fn())
    const drawing: SignaturePadState = { ...init(), drawing: true }
    expect(p.root['data-drawing'](wrap(drawing))).toBe('')
  })

  it('hiddenInput serializes strokes as JSON', () => {
    const p = connect<Ctx>((s) => s.p, vi.fn(), { name: 'sig' })
    const s = init({ strokes: [[{ x: 0, y: 0 }]] })
    expect(p.hiddenInput.value(wrap(s))).toBe('[[{"x":0,"y":0}]]')
    expect(p.hiddenInput.name).toBe('sig')
  })

  it('triggers dispatch correct messages', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.p, send)
    p.clearTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'clear' })
    p.undoTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'undo' })
  })
})
