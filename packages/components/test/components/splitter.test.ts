import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, positionFromPoint } from '../../src/components/splitter'
import type { SplitterState } from '../../src/components/splitter'

type Ctx = { s: SplitterState }
const wrap = (s: SplitterState): Ctx => ({ s })

describe('splitter reducer', () => {
  it('initializes at 50%', () => {
    expect(init()).toMatchObject({ position: 50, orientation: 'horizontal' })
  })

  it('setPosition clamps to min/max', () => {
    const s0 = init({ min: 10, max: 90 })
    expect(update(s0, { type: 'setPosition', position: 150 })[0].position).toBe(90)
    expect(update(s0, { type: 'setPosition', position: -20 })[0].position).toBe(10)
  })

  it('increment/decrement by step', () => {
    const s0 = init({ position: 50, step: 5 })
    expect(update(s0, { type: 'increment' })[0].position).toBe(55)
    expect(update(s0, { type: 'decrement', multiplier: 2 })[0].position).toBe(40)
  })

  it('toMin/toMax', () => {
    const s0 = init({ position: 50, min: 10, max: 90 })
    expect(update(s0, { type: 'toMin' })[0].position).toBe(10)
    expect(update(s0, { type: 'toMax' })[0].position).toBe(90)
  })

  it('startDrag/endDrag toggle dragging', () => {
    const [s1] = update(init(), { type: 'startDrag' })
    expect(s1.dragging).toBe(true)
    const [s2] = update(s1, { type: 'endDrag' })
    expect(s2.dragging).toBe(false)
  })

  it('disabled blocks mutations except endDrag', () => {
    const s0 = { ...init({ disabled: true, position: 50 }), dragging: true }
    expect(update(s0, { type: 'increment' })[0].position).toBe(50)
    expect(update(s0, { type: 'endDrag' })[0].dragging).toBe(false)
  })
})

describe('positionFromPoint', () => {
  const rect = { left: 0, top: 0, width: 100, height: 100 } as DOMRect

  it('horizontal computes percent from x', () => {
    expect(positionFromPoint(init({ orientation: 'horizontal' }), rect, 25, 0)).toBe(25)
    expect(positionFromPoint(init({ orientation: 'horizontal' }), rect, 100, 0)).toBe(100)
  })

  it('vertical computes percent from y', () => {
    expect(positionFromPoint(init({ orientation: 'vertical' }), rect, 0, 75)).toBe(75)
  })
})

describe('splitter.connect', () => {
  const p = connect<Ctx>((s) => s.s, vi.fn())

  it('resizeTrigger role=separator', () => {
    expect(p.resizeTrigger.role).toBe('separator')
  })

  it('aria-valuenow tracks position', () => {
    expect(p.resizeTrigger['aria-valuenow'](wrap(init({ position: 73 })))).toBe(73)
  })

  it('ArrowRight sends increment', () => {
    const send = vi.fn()
    const pc = connect<Ctx>((s) => s.s, send)
    pc.resizeTrigger.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }),
    )
    expect(send).toHaveBeenCalledWith({ type: 'increment' })
  })

  it('primaryPanel style uses position', () => {
    expect(p.primaryPanel.style(wrap(init({ position: 40, orientation: 'horizontal' })))).toContain(
      'width:40%',
    )
  })

  it('secondaryPanel style uses inverted position', () => {
    expect(
      p.secondaryPanel.style(wrap(init({ position: 40, orientation: 'horizontal' }))),
    ).toContain('width:60%')
  })
})
