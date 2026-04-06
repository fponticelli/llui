import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { stagger } from '../src/stagger'
import { fade } from '../src/presets'

function makeEl(): HTMLElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  return el
}

describe('stagger()', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns enter and leave functions', () => {
    const t = stagger(fade({ duration: 100 }), { delayPerItem: 30 })
    expect(typeof t.enter).toBe('function')
    expect(typeof t.leave).toBe('function')
  })

  it('first enter call has no delay', () => {
    const enterSpy = vi.fn()
    const spec = { enter: enterSpy, leave: vi.fn() }
    const t = stagger(spec, { delayPerItem: 50 })

    const el = makeEl()
    t.enter!([el])
    // First call: no delay, enter is called immediately
    expect(enterSpy).toHaveBeenCalledTimes(1)
  })

  it('sequential enter calls get increasing delays', () => {
    const enterSpy = vi.fn()
    const spec = { enter: enterSpy, leave: vi.fn() }
    const t = stagger(spec, { delayPerItem: 50 })

    const el1 = makeEl()
    const el2 = makeEl()
    const el3 = makeEl()

    t.enter!([el1]) // index 0 → no delay
    t.enter!([el2]) // index 1 → 50ms delay
    t.enter!([el3]) // index 2 → 100ms delay

    // Only the first should have been called immediately
    expect(enterSpy).toHaveBeenCalledTimes(1)
    expect(enterSpy).toHaveBeenCalledWith([el1])

    // Advance 50ms → second item fires
    vi.advanceTimersByTime(50)
    expect(enterSpy).toHaveBeenCalledTimes(2)
    expect(enterSpy).toHaveBeenCalledWith([el2])

    // Advance another 50ms → third item fires
    vi.advanceTimersByTime(50)
    expect(enterSpy).toHaveBeenCalledTimes(3)
    expect(enterSpy).toHaveBeenCalledWith([el3])
  })

  it('delay resets between batches (microtask boundary)', async () => {
    const enterSpy = vi.fn()
    const spec = { enter: enterSpy, leave: vi.fn() }
    const t = stagger(spec, { delayPerItem: 50 })

    // Batch 1
    const el1 = makeEl()
    const el2 = makeEl()
    t.enter!([el1]) // index 0
    t.enter!([el2]) // index 1

    // Flush batch 1 completely (microtask + pending timers)
    await vi.advanceTimersByTimeAsync(50)
    const callsAfterBatch1 = enterSpy.mock.calls.length
    expect(callsAfterBatch1).toBe(2)

    // Batch 2 — counter should be reset
    const el3 = makeEl()
    const el4 = makeEl()
    t.enter!([el3]) // index 0 again (no delay)
    t.enter!([el4]) // index 1 again (50ms delay)

    // el3 should fire immediately (index 0 in new batch)
    expect(enterSpy).toHaveBeenCalledTimes(callsAfterBatch1 + 1)
    expect(enterSpy).toHaveBeenCalledWith([el3])

    // el4 should fire after 50ms
    vi.advanceTimersByTime(50)
    expect(enterSpy).toHaveBeenCalledTimes(callsAfterBatch1 + 2)
    expect(enterSpy).toHaveBeenCalledWith([el4])
  })

  it('works with any transition preset (fade)', () => {
    const t = stagger(fade({ duration: 100 }), { delayPerItem: 20 })
    const el1 = makeEl()
    const el2 = makeEl()

    t.enter!([el1])
    // First enters immediately — styles applied
    expect(el1.style.opacity).toBe('1')

    t.enter!([el2])
    // Second hasn't entered yet
    expect(el2.style.opacity).toBe('')

    // After delay, second enters
    vi.advanceTimersByTime(20)
    expect(el2.style.opacity).toBe('1')
  })

  it('leave is simultaneous by default', () => {
    const leaveSpy = vi.fn()
    const spec = { enter: vi.fn(), leave: leaveSpy }
    const t = stagger(spec, { delayPerItem: 50 })

    const el1 = makeEl()
    const el2 = makeEl()

    t.leave!([el1])
    t.leave!([el2])

    // Both called immediately (no stagger on leave by default)
    expect(leaveSpy).toHaveBeenCalledTimes(2)
  })

  it('leave with sequential order staggers like enter', () => {
    const leaveSpy = vi.fn()
    const spec = { enter: vi.fn(), leave: leaveSpy }
    const t = stagger(spec, { delayPerItem: 50, leaveOrder: 'sequential' })

    const el1 = makeEl()
    const el2 = makeEl()
    const el3 = makeEl()

    t.leave!([el1]) // index 0 → immediate
    t.leave!([el2]) // index 1 → 50ms
    t.leave!([el3]) // index 2 → 100ms

    expect(leaveSpy).toHaveBeenCalledTimes(1)
    expect(leaveSpy).toHaveBeenCalledWith([el1])

    vi.advanceTimersByTime(50)
    expect(leaveSpy).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(50)
    expect(leaveSpy).toHaveBeenCalledTimes(3)
  })

  it('defaults delayPerItem to 30', () => {
    const enterSpy = vi.fn()
    const spec = { enter: enterSpy, leave: vi.fn() }
    const t = stagger(spec)

    const el1 = makeEl()
    const el2 = makeEl()
    t.enter!([el1])
    t.enter!([el2])

    expect(enterSpy).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(29)
    expect(enterSpy).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(enterSpy).toHaveBeenCalledTimes(2)
  })

  it('passes through onTransition from the spec', () => {
    const onT = vi.fn()
    const spec = { enter: vi.fn(), leave: vi.fn(), onTransition: onT }
    const t = stagger(spec, { delayPerItem: 20 })
    expect(t.onTransition).toBe(onT)
  })
})
