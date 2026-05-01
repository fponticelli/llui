import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WsPairingRegistry } from '../../../src/server/ws/pairing-registry.js'
import type { ClientFrame, ServerFrame, HelloFrame } from '../../../src/protocol.js'

type Fake = {
  send: ReturnType<typeof vi.fn>
  emit: (f: ClientFrame) => void
  emitClose: () => void
}

function mkFake(): Fake {
  let onFrame: (f: ClientFrame) => void = () => {}
  let onClose: () => void = () => {}
  const conn = {
    send: vi.fn(),
    onFrame(h: typeof onFrame) {
      onFrame = h
    },
    onClose(h: typeof onClose) {
      onClose = h
    },
    close() {
      onClose()
    },
  }
  const out: Fake = {
    send: conn.send,
    emit: (f) => onFrame(f),
    emitClose: () => onClose(),
  }
  ;(out as unknown as { __conn: typeof conn }).__conn = conn
  return out
}

const hello = (schemaHash = 'h1'): HelloFrame => ({
  t: 'hello',
  appName: 'Test',
  appVersion: '0.0',
  msgSchema: {},
  stateSchema: {},
  affordancesSample: [],
  docs: null,
  schemaHash,
})

let reg: WsPairingRegistry
beforeEach(() => {
  reg = new WsPairingRegistry()
})

function getConn(f: Fake) {
  return (f as unknown as { __conn: Parameters<WsPairingRegistry['register']>[1] }).__conn
}

describe('WsPairingRegistry', () => {
  it('register stores the pairing keyed by tid', () => {
    const f = mkFake()
    reg.register(
      't1',
      (
        f as unknown as {
          __conn: {
            send: (x: ServerFrame) => void
            onFrame: (h: (cf: ClientFrame) => void) => void
            onClose: (h: () => void) => void
            close: () => void
          }
        }
      ).__conn,
    )
    expect(reg.isPaired('t1')).toBe(true)
  })

  it('unregister drops the pairing', () => {
    const f = mkFake()
    reg.register('t1', (f as unknown as { __conn: unknown }).__conn as never)
    reg.unregister('t1')
    expect(reg.isPaired('t1')).toBe(false)
  })

  it('caches the hello payload and returns it via getHello', () => {
    const f = mkFake()
    reg.register('t1', (f as unknown as { __conn: unknown }).__conn as never)
    f.emit(hello('hash-1'))
    const cached = reg.getHello('t1')
    expect(cached?.schemaHash).toBe('hash-1')
  })

  it('rpc() sends a frame with a generated id and resolves on matching rpc-reply', async () => {
    const f = mkFake()
    reg.register('t1', (f as unknown as { __conn: unknown }).__conn as never)
    const p = reg.rpc('t1', 'get_state', { path: null })
    expect(f.send).toHaveBeenCalledTimes(1)
    const sent = f.send.mock.calls[0]![0]! as ServerFrame
    expect(sent.t).toBe('rpc')
    if (sent.t !== 'rpc') throw new Error('unreachable')
    f.emit({ t: 'rpc-reply', id: sent.id, result: { state: { count: 7 } } })
    expect(await p).toEqual({ state: { count: 7 } })
  })

  it('rpc() rejects on matching rpc-error', async () => {
    const f = mkFake()
    reg.register('t1', (f as unknown as { __conn: unknown }).__conn as never)
    const p = reg.rpc('t1', 'get_state', {})
    const sent = f.send.mock.calls[0]![0]! as ServerFrame
    if (sent.t !== 'rpc') throw new Error('unreachable')
    f.emit({ t: 'rpc-error', id: sent.id, code: 'invalid', detail: 'bad path' })
    await expect(p).rejects.toMatchObject({ code: 'invalid', detail: 'bad path' })
  })

  it('rpc() rejects with paused when no pairing exists', async () => {
    await expect(reg.rpc('unknown', 'get_state', {})).rejects.toMatchObject({ code: 'paused' })
  })

  it('rpc() respects an explicit timeout', async () => {
    const f = mkFake()
    reg.register('t1', (f as unknown as { __conn: unknown }).__conn as never)
    await expect(reg.rpc('t1', 'get_state', {}, { timeoutMs: 1 })).rejects.toMatchObject({
      code: 'timeout',
    })
  })

  it('waitForConfirm() resolves when a matching confirm-resolved frame arrives', async () => {
    const f = mkFake()
    reg.register('t1', (f as unknown as { __conn: unknown }).__conn as never)
    const p = reg.waitForConfirm('t1', 'c-1', 1000)
    f.emit({
      t: 'confirm-resolved',
      confirmId: 'c-1',
      outcome: 'confirmed',
      stateAfter: { ok: true },
    })
    expect(await p).toEqual({ outcome: 'confirmed', stateAfter: { ok: true } })
  })

  it('waitForChange() resolves when a matching state-update arrives (path prefix match)', async () => {
    const f = mkFake()
    reg.register('t1', (f as unknown as { __conn: unknown }).__conn as never)
    const p = reg.waitForChange('t1', '/count', 1000)
    f.emit({ t: 'state-update', path: '/count', stateAfter: { count: 2 } })
    expect(await p).toEqual({ status: 'changed', stateAfter: { count: 2 } })
  })

  it('waitForChange() returns timeout if no matching update arrives', async () => {
    const f = mkFake()
    reg.register('t1', (f as unknown as { __conn: unknown }).__conn as never)
    const res = await reg.waitForChange('t1', '/count', 1)
    expect(res).toEqual({ status: 'timeout', stateAfter: null })
  })

  it('close cleans up pending rpc with paused error', async () => {
    const f = mkFake()
    reg.register('t1', (f as unknown as { __conn: unknown }).__conn as never)
    const p = reg.rpc('t1', 'get_state', {}, { timeoutMs: 10000 })
    f.emitClose()
    await expect(p).rejects.toMatchObject({ code: 'paused' })
  })

  it('onLogAppend callback is called with (tid, entry) when a log-append frame arrives', () => {
    const onLogAppend = vi.fn()
    const registry = new WsPairingRegistry({ onLogAppend })
    const f = mkFake()
    registry.register('t2', getConn(f))

    const entry = { id: 'e1', at: 1000, kind: 'read' as const }
    f.emit({ t: 'log-append', entry })

    expect(onLogAppend).toHaveBeenCalledOnce()
    expect(onLogAppend).toHaveBeenCalledWith('t2', entry)
  })
})

describe('waitForUserInput', () => {
  beforeEach(() => {
    reg = new WsPairingRegistry()
  })

  it('resolves immediately from buffered input when present', async () => {
    const f = mkFake()
    reg.register('t1', getConn(f))
    f.emit({ t: 'user-input-submitted', text: 'hello', at: 1_000 })
    const res = await reg.waitForUserInput('t1', 5_000)
    expect(res).toEqual({ status: 'submitted', text: 'hello', at: 1_000 })
  })

  it('parks until a frame arrives, then resolves', async () => {
    const f = mkFake()
    reg.register('t1', getConn(f))
    const pending = reg.waitForUserInput('t1', 5_000)
    let resolved: unknown = null
    pending.then((v) => {
      resolved = v
    })
    await Promise.resolve()
    expect(resolved).toBeNull()
    f.emit({ t: 'user-input-submitted', text: 'late', at: 2_000 })
    await expect(pending).resolves.toEqual({ status: 'submitted', text: 'late', at: 2_000 })
  })

  it('FIFO: each submission resolves the oldest parked waiter', async () => {
    const f = mkFake()
    reg.register('t1', getConn(f))
    const w1 = reg.waitForUserInput('t1', 5_000)
    const w2 = reg.waitForUserInput('t1', 5_000)
    f.emit({ t: 'user-input-submitted', text: 'first', at: 1 })
    f.emit({ t: 'user-input-submitted', text: 'second', at: 2 })
    await expect(w1).resolves.toEqual({ status: 'submitted', text: 'first', at: 1 })
    await expect(w2).resolves.toEqual({ status: 'submitted', text: 'second', at: 2 })
  })

  it('buffers up to the cap, dropping oldest on overflow', async () => {
    const f = mkFake()
    reg.register('t1', getConn(f))
    // Cap is 8 — push 10 messages with no parked waiter.
    for (let i = 0; i < 10; i++) {
      f.emit({ t: 'user-input-submitted', text: `m${i}`, at: i })
    }
    // Drain: expect messages m2..m9 (oldest 2 dropped).
    const ordered: string[] = []
    for (let i = 0; i < 8; i++) {
      const r = await reg.waitForUserInput('t1', 100)
      if (r.status === 'submitted') ordered.push(r.text)
    }
    expect(ordered).toEqual(['m2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9'])
    // Buffer empty now; next call times out.
    const tail = await reg.waitForUserInput('t1', 5)
    expect(tail).toEqual({ status: 'timeout' })
  })

  it('returns timeout when no input arrives within timeoutMs', async () => {
    const f = mkFake()
    reg.register('t1', getConn(f))
    const res = await reg.waitForUserInput('t1', 5)
    expect(res).toEqual({ status: 'timeout' })
  })

  it('returns timeout for unknown tid (covers race after isPaired check)', async () => {
    const res = await reg.waitForUserInput('unknown-tid', 100)
    expect(res).toEqual({ status: 'timeout' })
  })

  it('parked waiter resolves as timeout when the pairing closes', async () => {
    const f = mkFake()
    reg.register('t1', getConn(f))
    const pending = reg.waitForUserInput('t1', 60_000) // long enough that close, not timer, decides
    f.emitClose()
    await expect(pending).resolves.toEqual({ status: 'timeout' })
  })

  it('buffered messages are dropped on close (not visible to next register)', async () => {
    const f = mkFake()
    reg.register('t1', getConn(f))
    f.emit({ t: 'user-input-submitted', text: 'before-close', at: 1 })
    f.emitClose()
    const f2 = mkFake()
    reg.register('t1', getConn(f2))
    const res = await reg.waitForUserInput('t1', 5)
    expect(res).toEqual({ status: 'timeout' })
  })

  it('user-input-submitted frames are NOT routed to subscribers (registry-owned)', () => {
    const f = mkFake()
    reg.register('t1', getConn(f))
    const sub = vi.fn(() => false)
    reg.subscribe('t1', sub)
    f.emit({ t: 'user-input-submitted', text: 'hi', at: 1 })
    expect(sub).not.toHaveBeenCalled()
  })
})
