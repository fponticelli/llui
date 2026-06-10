import { describe, it, expect, vi } from 'vitest'
import { init, update, connect, positionFromPoint } from '../../src/components/splitter'
import { rootSignal, signalOf, read } from '../_signal'

describe('splitter reducer', () => {
  it('initializes at 50%', () => {
    expect(init()).toMatchObject({ position: 50, orientation: 'horizontal', dir: 'ltr' })
  })

  it('setDir updates direction (even while disabled)', () => {
    const [s1] = update(init(), { type: 'setDir', dir: 'rtl' })
    expect(s1.dir).toBe('rtl')
    const [s2] = update(init({ disabled: true }), { type: 'setDir', dir: 'rtl' })
    expect(s2.dir).toBe('rtl')
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
  const p = connect(rootSignal(), vi.fn())

  it('resizeTrigger role=separator', () => {
    expect(p.resizeTrigger.role).toBe('separator')
  })

  it('aria-valuenow tracks position', () => {
    expect(read(p.resizeTrigger['aria-valuenow'], init({ position: 73 }))).toBe(73)
  })

  it('ArrowRight sends increment', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    pc.resizeTrigger.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }),
    )
    expect(send).toHaveBeenCalledWith({ type: 'increment' })
  })

  it('ltr (default): ArrowLeft sends decrement', () => {
    const send = vi.fn()
    const pc = connect(rootSignal(), send)
    pc.resizeTrigger.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }))
    expect(send).toHaveBeenCalledWith({ type: 'decrement' })
  })

  it('rtl: ArrowRight sends decrement, ArrowLeft sends increment', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init({ dir: 'rtl' })), send)
    pc.resizeTrigger.onKeyDown(
      new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }),
    )
    pc.resizeTrigger.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'decrement' })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'increment' })
  })

  it('rtl + vertical orientation: vertical arrows are unaffected (Down increments, Up decrements)', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init({ dir: 'rtl', orientation: 'vertical' })), send)
    pc.resizeTrigger.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }))
    pc.resizeTrigger.onKeyDown(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'increment' })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'decrement' })
  })

  it('rtl: Home/End are NOT flipped', () => {
    const send = vi.fn()
    const pc = connect(signalOf(init({ dir: 'rtl' })), send)
    pc.resizeTrigger.onKeyDown(new KeyboardEvent('keydown', { key: 'Home', cancelable: true }))
    pc.resizeTrigger.onKeyDown(new KeyboardEvent('keydown', { key: 'End', cancelable: true }))
    expect(send).toHaveBeenNthCalledWith(1, { type: 'toMin' })
    expect(send).toHaveBeenNthCalledWith(2, { type: 'toMax' })
  })

  it('primaryPanel style uses position', () => {
    expect(read(p.primaryPanel.style, init({ position: 40, orientation: 'horizontal' }))).toContain(
      'width:40%',
    )
  })

  it('secondaryPanel style uses inverted position', () => {
    expect(
      read(p.secondaryPanel.style, init({ position: 40, orientation: 'horizontal' })),
    ).toContain('width:60%')
  })
})
