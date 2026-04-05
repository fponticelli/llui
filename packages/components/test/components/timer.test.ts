import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  display,
  isComplete,
  parts,
  formatMs,
} from '../../src/components/timer'
import type { TimerState } from '../../src/components/timer'

type Ctx = { t: TimerState }
const wrap = (t: TimerState): Ctx => ({ t })

describe('timer reducer', () => {
  it('init defaults to stopped count-up timer at 0', () => {
    const s = init()
    expect(s).toMatchObject({
      running: false,
      direction: 'up',
      targetMs: 0,
      elapsedMs: 0,
      startedAt: null,
    })
  })

  it('start sets running + startedAt', () => {
    const [s] = update(init(), { type: 'start', now: 1000 })
    expect(s.running).toBe(true)
    expect(s.startedAt).toBe(1000)
  })

  it('start is idempotent while running', () => {
    const [s1] = update(init(), { type: 'start', now: 1000 })
    const [s2] = update(s1, { type: 'start', now: 2000 })
    expect(s2.startedAt).toBe(1000) // unchanged
  })

  it('tick accumulates elapsed and advances startedAt', () => {
    const [s1] = update(init(), { type: 'start', now: 1000 })
    const [s2] = update(s1, { type: 'tick', now: 1250 })
    expect(s2.elapsedMs).toBe(250)
    expect(s2.startedAt).toBe(1250)
  })

  it('pause accumulates elapsed and clears startedAt', () => {
    const [s1] = update(init(), { type: 'start', now: 1000 })
    const [s2] = update(s1, { type: 'pause', now: 1500 })
    expect(s2.running).toBe(false)
    expect(s2.elapsedMs).toBe(500)
    expect(s2.startedAt).toBeNull()
  })

  it('resume after pause preserves elapsed', () => {
    const [s1] = update(init(), { type: 'start', now: 1000 })
    const [s2] = update(s1, { type: 'pause', now: 1500 })
    const [s3] = update(s2, { type: 'start', now: 2000 })
    const [s4] = update(s3, { type: 'tick', now: 2100 })
    expect(s4.elapsedMs).toBe(600) // 500 prior + 100 new
  })

  it('reset zeroes everything', () => {
    const s0 = init({ elapsedMs: 5000 })
    const [s] = update(s0, { type: 'reset' })
    expect(s.elapsedMs).toBe(0)
    expect(s.running).toBe(false)
    expect(s.startedAt).toBeNull()
  })

  it('countdown auto-stops at target', () => {
    const s0 = init({ direction: 'down', targetMs: 3000 })
    const [s1] = update(s0, { type: 'start', now: 1000 })
    const [s2] = update(s1, { type: 'tick', now: 5000 }) // 4s elapsed past 3s target
    expect(s2.running).toBe(false)
    expect(s2.elapsedMs).toBe(3000) // clamped to target
  })

  it('setTarget updates targetMs', () => {
    const [s] = update(init(), { type: 'setTarget', targetMs: 60000 })
    expect(s.targetMs).toBe(60000)
  })
})

describe('display / isComplete', () => {
  it('count-up returns elapsed', () => {
    const s = init({ elapsedMs: 1234 })
    expect(display(s)).toBe(1234)
  })

  it('count-down returns remaining', () => {
    const s = init({ direction: 'down', targetMs: 5000, elapsedMs: 2000 })
    expect(display(s)).toBe(3000)
  })

  it('count-down never goes below zero', () => {
    const s = init({ direction: 'down', targetMs: 5000, elapsedMs: 9000 })
    expect(display(s)).toBe(0)
  })

  it('isComplete true only for countdown at target', () => {
    expect(isComplete(init({ direction: 'up', elapsedMs: 9999 }))).toBe(false)
    expect(isComplete(init({ direction: 'down', targetMs: 1000, elapsedMs: 999 }))).toBe(false)
    expect(isComplete(init({ direction: 'down', targetMs: 1000, elapsedMs: 1000 }))).toBe(true)
  })
})

describe('parts / formatMs', () => {
  it('parts splits ms correctly', () => {
    expect(parts(0)).toEqual({ hours: 0, minutes: 0, seconds: 0, ms: 0 })
    expect(parts(1500)).toEqual({ hours: 0, minutes: 0, seconds: 1, ms: 500 })
    expect(parts(65_000)).toEqual({ hours: 0, minutes: 1, seconds: 5, ms: 0 })
    expect(parts(3_661_250)).toEqual({ hours: 1, minutes: 1, seconds: 1, ms: 250 })
  })

  it('formatMs supports HH/mm/ss/SSS tokens', () => {
    expect(formatMs(65_000, 'mm:ss')).toBe('01:05')
    expect(formatMs(125_500, 'mm:ss.SSS')).toBe('02:05.500')
    expect(formatMs(3_661_000, 'HH:mm:ss')).toBe('01:01:01')
    expect(formatMs(65_000, 'm:s')).toBe('1:5')
  })
})

describe('timer.connect', () => {
  it('startTrigger disabled while running', () => {
    const p = connect<Ctx>((s) => s.t, vi.fn())
    expect(p.startTrigger.disabled(wrap(init()))).toBe(false)
    const started: TimerState = { ...init(), running: true, startedAt: 1000 }
    expect(p.startTrigger.disabled(wrap(started))).toBe(true)
  })

  it('pauseTrigger disabled while stopped', () => {
    const p = connect<Ctx>((s) => s.t, vi.fn())
    expect(p.pauseTrigger.disabled(wrap(init()))).toBe(true)
    const started: TimerState = { ...init(), running: true, startedAt: 1000 }
    expect(p.pauseTrigger.disabled(wrap(started))).toBe(false)
  })

  it('triggers dispatch correct messages', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.t, send)
    p.startTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'start' }))
    p.pauseTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'pause' }))
    p.resetTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'reset' })
  })

  it('display has role=timer', () => {
    const p = connect<Ctx>((s) => s.t, vi.fn())
    expect(p.display.role).toBe('timer')
    expect(p.display['aria-live']).toBe('off')
  })

  it('ariaLive: polite is honoured', () => {
    const p = connect<Ctx>((s) => s.t, vi.fn(), { ariaLive: 'polite' })
    expect(p.display['aria-live']).toBe('polite')
  })

  it('root exposes data-running + data-direction', () => {
    const p = connect<Ctx>((s) => s.t, vi.fn())
    expect(p.root['data-running'](wrap(init()))).toBeUndefined()
    const running: TimerState = { ...init(), running: true, startedAt: 0 }
    expect(p.root['data-running'](wrap(running))).toBe('')
    expect(p.root['data-direction'](wrap(init({ direction: 'down' })))).toBe('down')
  })
})
