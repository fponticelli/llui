import { describe, expect, it, vi } from 'vitest'
import { createCaptureRegistry } from '../src/notes/capture-registry.js'

describe('createCaptureRegistry', () => {
  it('submit returns a unique requestId and a pending promise', async () => {
    const reg = createCaptureRegistry()
    const { requestId, promise } = reg.submit(
      { route: '/x' },
      { timeoutMs: 1000, hudConnected: true },
    )
    expect(typeof requestId).toBe('string')
    expect(requestId.length).toBeGreaterThan(0)
    // No await — promise is unresolved at this point
    let settled = false
    promise.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    // Cleanup
    reg.cancel(requestId, 'timeout')
    await promise
  })

  it('fulfill resolves the promise with the note', async () => {
    const reg = createCaptureRegistry()
    const { requestId, promise } = reg.submit({}, { timeoutMs: 1000, hudConnected: true })
    const note = {
      id: '001',
      filename: '001-llm-capture-x.md',
      path: '/tmp/x',
      sessionId: 'session-x',
    }
    reg.fulfill(requestId, note)
    const result = await promise
    expect(result.status).toBe('fulfilled')
    expect(result.note).toEqual(note)
    expect(result.requestId).toBe(requestId)
  })

  it('returns status:no-client when no HUD is connected', async () => {
    const reg = createCaptureRegistry()
    const { promise } = reg.submit({}, { timeoutMs: 1000, hudConnected: false })
    const result = await promise
    expect(result.status).toBe('no-client')
    expect(result.note).toBeUndefined()
  })

  it('respects timeoutMs and resolves with status:timeout', async () => {
    vi.useFakeTimers()
    const reg = createCaptureRegistry()
    const { promise } = reg.submit({}, { timeoutMs: 100, hudConnected: true })
    vi.advanceTimersByTime(150)
    const result = await promise
    expect(result.status).toBe('timeout')
    vi.useRealTimers()
  })

  it('fulfill on an unknown id is a no-op (returns false)', () => {
    const reg = createCaptureRegistry()
    const fulfilled = reg.fulfill('does-not-exist', {
      id: '001',
      filename: 'x.md',
      path: '/tmp/x',
      sessionId: 's',
    })
    expect(fulfilled).toBe(false)
  })

  it('fulfill removes the registry entry so subsequent fulfill returns false', () => {
    const reg = createCaptureRegistry()
    const { requestId } = reg.submit({}, { timeoutMs: 1000, hudConnected: true })
    expect(
      reg.fulfill(requestId, { id: '001', filename: 'x.md', path: '/tmp/x', sessionId: 's' }),
    ).toBe(true)
    expect(
      reg.fulfill(requestId, { id: '001', filename: 'x.md', path: '/tmp/x', sessionId: 's' }),
    ).toBe(false)
  })

  it('cancel resolves with the given status', async () => {
    const reg = createCaptureRegistry()
    const { requestId, promise } = reg.submit({}, { timeoutMs: 10_000, hudConnected: true })
    reg.cancel(requestId, 'timeout')
    const result = await promise
    expect(result.status).toBe('timeout')
  })

  it('listPending returns ids of unresolved requests', async () => {
    const reg = createCaptureRegistry()
    const a = reg.submit({}, { timeoutMs: 10_000, hudConnected: true })
    const b = reg.submit({}, { timeoutMs: 10_000, hudConnected: true })
    expect(reg.listPending()).toEqual(expect.arrayContaining([a.requestId, b.requestId]))
    reg.cancel(a.requestId, 'timeout')
    await a.promise
    expect(reg.listPending()).toEqual([b.requestId])
    reg.cancel(b.requestId, 'timeout')
    await b.promise
  })
})
