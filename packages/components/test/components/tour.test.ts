import { describe, it, expect, vi } from 'vitest'
import {
  init,
  update,
  connect,
  currentStep,
  isFirst,
  isLast,
  progress,
} from '../../src/components/tour'
import type { TourState, TourStep } from '../../src/components/tour'

type Ctx = { t: TourState }
const wrap = (t: TourState): Ctx => ({ t })

const steps: TourStep[] = [
  { id: 'a', title: 'Step A', description: 'First', target: '#a' },
  { id: 'b', title: 'Step B', description: 'Second', target: '#b' },
  { id: 'c', title: 'Step C', description: 'Third', target: '#c' },
]

describe('tour reducer', () => {
  it('starts closed with no visited', () => {
    expect(init({ steps })).toMatchObject({ open: false, index: 0, visited: [] })
  })

  it('start opens the tour and marks step 0 visited', () => {
    const [s] = update(init({ steps }), { type: 'start' })
    expect(s.open).toBe(true)
    expect(s.index).toBe(0)
    expect(s.visited).toEqual(['a'])
  })

  it('start is a no-op with no steps', () => {
    const [s] = update(init(), { type: 'start' })
    expect(s.open).toBe(false)
  })

  it('next advances and marks visited', () => {
    const s0 = init({ steps, open: true })
    // init with open:true records step[0] as visited
    expect(s0.visited).toEqual(['a'])
    const [s1] = update(s0, { type: 'next' })
    expect(s1.index).toBe(1)
    expect(s1.visited).toEqual(['a', 'b'])
    const [s2] = update(s1, { type: 'next' })
    expect(s2.index).toBe(2)
    expect(s2.visited).toEqual(['a', 'b', 'c'])
  })

  it('next past last closes the tour', () => {
    const s0 = { ...init({ steps, open: true }), index: 2 } as TourState
    const [s] = update(s0, { type: 'next' })
    expect(s.open).toBe(false)
    expect(s.index).toBe(2)
  })

  it('prev goes backward', () => {
    const s0 = { ...init({ steps, open: true }), index: 2 } as TourState
    const [s] = update(s0, { type: 'prev' })
    expect(s.index).toBe(1)
  })

  it('prev at first is a no-op', () => {
    const s0 = init({ steps, open: true })
    const [s] = update(s0, { type: 'prev' })
    expect(s.index).toBe(0)
  })

  it('stop closes but preserves index', () => {
    const s0 = { ...init({ steps }), open: true, index: 1 } as TourState
    const [s] = update(s0, { type: 'stop' })
    expect(s.open).toBe(false)
    expect(s.index).toBe(1)
  })

  it('goto jumps to a specific step', () => {
    const [s] = update(init({ steps }), { type: 'goto', index: 2 })
    expect(s.index).toBe(2)
    expect(s.open).toBe(true)
    expect(s.visited).toContain('c')
  })

  it('goto clamps to valid range', () => {
    const s0 = init({ steps })
    const [s1] = update(s0, { type: 'goto', index: -1 })
    expect(s1.index).toBe(0) // no change
    const [s2] = update(s0, { type: 'goto', index: 99 })
    expect(s2.index).toBe(0) // no change
  })

  it("visited doesn't accumulate duplicates", () => {
    let s: TourState = init({ steps })
    ;[s] = update(s, { type: 'start' })
    ;[s] = update(s, { type: 'next' })
    ;[s] = update(s, { type: 'prev' })
    expect(s.visited.filter((id) => id === 'a')).toHaveLength(1)
  })
})

describe('tour helpers', () => {
  it('currentStep returns the active step', () => {
    expect(currentStep(init({ steps, index: 1 }))?.id).toBe('b')
    expect(currentStep(init())).toBeNull()
  })

  it('isFirst / isLast', () => {
    expect(isFirst(init({ steps }))).toBe(true)
    expect(isLast(init({ steps, index: 2 }))).toBe(true)
    expect(isFirst(init({ steps, index: 1 }))).toBe(false)
  })

  it('progress returns current/total', () => {
    expect(progress(init({ steps }))).toEqual({ current: 1, total: 3 })
    expect(progress(init({ steps, index: 2 }))).toEqual({ current: 3, total: 3 })
  })
})

describe('tour.connect', () => {
  it('root hidden mirrors open=false', () => {
    const p = connect<Ctx>((s) => s.t, vi.fn(), { id: 't' })
    expect(p.root.hidden(wrap(init({ steps })))).toBe(true)
    expect(p.root.hidden(wrap({ ...init({ steps }), open: true } as TourState))).toBe(false)
  })

  it('prevTrigger disabled at first step', () => {
    const p = connect<Ctx>((s) => s.t, vi.fn(), { id: 't' })
    expect(p.prevTrigger.disabled(wrap(init({ steps })))).toBe(true)
    expect(p.prevTrigger.disabled(wrap(init({ steps, index: 1 })))).toBe(false)
  })

  it('nextTrigger data-last marks final step', () => {
    const p = connect<Ctx>((s) => s.t, vi.fn(), { id: 't' })
    expect(p.nextTrigger['data-last'](wrap(init({ steps })))).toBeUndefined()
    expect(p.nextTrigger['data-last'](wrap(init({ steps, index: 2 })))).toBe('')
  })

  it('closeOnBackdropClick: false (default) — click is ignored', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.t, send, { id: 't' })
    p.backdrop.onClick(new MouseEvent('click'))
    expect(send).not.toHaveBeenCalled()
  })

  it('closeOnBackdropClick: true — click dispatches stop', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.t, send, { id: 't', closeOnBackdropClick: true })
    p.backdrop.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'stop' })
  })

  it('title/description have ids linked via aria-labelledby/describedby', () => {
    const p = connect<Ctx>((s) => s.t, vi.fn(), { id: 'my-tour' })
    expect(p.title.id).toBe('my-tour:title')
    expect(p.description.id).toBe('my-tour:description')
    expect(p.root['aria-labelledby']).toBe('my-tour:title')
    expect(p.root['aria-describedby']).toBe('my-tour:description')
  })

  it('triggers dispatch correct messages', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.t, send, { id: 't' })
    p.nextTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'next' })
    p.prevTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'prev' })
    p.closeTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'stop' })
  })
})
