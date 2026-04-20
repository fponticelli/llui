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
    onFrame(h: typeof onFrame) { onFrame = h },
    onClose(h: typeof onClose) { onClose = h },
    close() { onClose() },
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
beforeEach(() => { reg = new WsPairingRegistry({ now: () => 1000 }) })

describe('WsPairingRegistry', () => {
  it('register stores the pairing keyed by tid', () => {
    const f = mkFake()
    reg.register('t1', (f as unknown as { __conn: { send: (x: ServerFrame) => void; onFrame: (h: (cf: ClientFrame) => void) => void; onClose: (h: () => void) => void; close: () => void } }).__conn)
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
    await expect(reg.rpc('t1', 'get_state', {}, { timeoutMs: 1 })).rejects.toMatchObject({ code: 'timeout' })
  })

  it('waitForConfirm() resolves when a matching confirm-resolved frame arrives', async () => {
    const f = mkFake()
    reg.register('t1', (f as unknown as { __conn: unknown }).__conn as never)
    const p = reg.waitForConfirm('t1', 'c-1', 1000)
    f.emit({ t: 'confirm-resolved', confirmId: 'c-1', outcome: 'confirmed', stateAfter: { ok: true } })
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
})
