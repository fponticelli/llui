import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handleEffects, timeout, interval, cancel, type Effect } from '../src/index'

describe('timeout() / interval()', () => {
  let send: ReturnType<typeof vi.fn>
  let controller: AbortController
  let signal: AbortSignal

  beforeEach(() => {
    vi.useFakeTimers()
    send = vi.fn()
    controller = new AbortController()
    signal = controller.signal
  })

  afterEach(() => {
    vi.useRealTimers()
    controller.abort()
  })

  it('timeout fires msg once after delay', () => {
    const handler = handleEffects<Effect>().else(() => {})
    handler({ effect: timeout(100, { type: 'tick', n: 1 }), send, signal })

    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(99)
    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({ type: 'tick', n: 1 })
  })

  it('timeout does not fire if signal is aborted before delay', () => {
    const handler = handleEffects<Effect>().else(() => {})
    handler({ effect: timeout(100, { type: 'tick' }), send, signal })

    controller.abort()
    vi.advanceTimersByTime(200)
    expect(send).not.toHaveBeenCalled()
  })

  it('interval fires msg repeatedly', () => {
    const handler = handleEffects<Effect>().else(() => {})
    handler({ effect: interval('t1', 50, { type: 'tick' }), send, signal })

    expect(send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(50)
    expect(send).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(50)
    expect(send).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(100)
    expect(send).toHaveBeenCalledTimes(4)
  })

  it('cancel(key) stops an active interval', () => {
    const handler = handleEffects<Effect>().else(() => {})
    handler({ effect: interval('ticker', 50, { type: 'tick' }), send, signal })

    vi.advanceTimersByTime(150)
    expect(send).toHaveBeenCalledTimes(3)

    handler({ effect: cancel('ticker'), send, signal })

    vi.advanceTimersByTime(200)
    expect(send).toHaveBeenCalledTimes(3) // no new calls
  })

  it('starting a new interval with same key replaces the old one', () => {
    const handler = handleEffects<Effect>().else(() => {})
    handler({ effect: interval('t', 50, { type: 'first' }), send, signal })

    vi.advanceTimersByTime(60)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenLastCalledWith({ type: 'first' })

    // Replace
    handler({ effect: interval('t', 100, { type: 'second' }), send, signal })

    vi.advanceTimersByTime(100)
    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenLastCalledWith({ type: 'second' })
  })

  it('component unmount aborts active intervals', () => {
    const handler = handleEffects<Effect>().else(() => {})
    handler({ effect: interval('ticker', 50, { type: 'tick' }), send, signal })

    vi.advanceTimersByTime(50)
    expect(send).toHaveBeenCalledTimes(1)

    controller.abort()
    vi.advanceTimersByTime(200)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
