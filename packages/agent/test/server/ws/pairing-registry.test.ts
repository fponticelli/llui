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

  it('answers every hello with a hello-ack carrying the server + min client versions', () => {
    const f = mkFake()
    reg.register('t1', getConn(f))
    f.emit({ ...hello(), lapVersion: 2 })
    const ack = f.send.mock.calls.map((c) => c[0] as ServerFrame).find((fr) => fr.t === 'hello-ack')
    expect(ack).toMatchObject({ t: 'hello-ack', lapVersion: 2, minClientVersion: 2 })
    // A compatible client stays paired.
    expect(reg.isPaired('t1')).toBe(true)
  })

  it('terminates the pairing when the client speaks a LAP version below the minimum', () => {
    const f = mkFake()
    reg.register('t1', getConn(f))
    f.emit({ ...hello(), lapVersion: 1 })
    // The hello-ack (the explicit reason) was still sent…
    const ack = f.send.mock.calls.map((c) => c[0] as ServerFrame).find((fr) => fr.t === 'hello-ack')
    expect(ack).toBeDefined()
    // …and then the pairing was torn down (hard incompatibility).
    expect(reg.isPaired('t1')).toBe(false)
  })

  it('allows a legacy client that omits lapVersion (nothing older to break on)', () => {
    const f = mkFake()
    reg.register('t1', getConn(f))
    f.emit(hello()) // no lapVersion
    expect(reg.isPaired('t1')).toBe(true)
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

  it('buffers a confirm-resolved outcome for level-triggered pickup (poll-gap liveness)', async () => {
    // Regression: confirm resolution used to be edge-triggered. If the
    // user approved in the gap between one long-poll tearing its
    // subscriber down and the next re-arming, the frame dispatched to
    // zero subscribers and was lost — the action ran but the agent polled
    // `still-pending` forever. Now the registry buffers the outcome and
    // `waitForConfirm` reads it BEFORE subscribing.
    const f = mkFake()
    reg.register('t1', getConn(f))
    // Resolution lands while NO waitForConfirm subscriber is armed.
    f.emit({
      t: 'confirm-resolved',
      confirmId: 'c-gap',
      outcome: 'confirmed',
      stateAfter: { ok: 1 },
    })
    // Level-triggered: the outcome is readable after the fact.
    expect(reg.getConfirmOutcome('t1', 'c-gap')).toMatchObject({ outcome: 'confirmed' })
    // The next wait returns it IMMEDIATELY (tiny timeout) instead of
    // blocking out and mapping to `timeout` (→ still-pending).
    const res = await reg.waitForConfirm('t1', 'c-gap', 5)
    expect(res).toEqual({ outcome: 'confirmed', stateAfter: { ok: 1 } })
  })

  it('getConfirmOutcome returns null for an unresolved confirmId', () => {
    const f = mkFake()
    reg.register('t1', getConn(f))
    expect(reg.getConfirmOutcome('t1', 'never')).toBeNull()
  })

  it('waitForConfirm still resolves via subscriber when armed before the frame', async () => {
    // The buffer must not break the normal (already-subscribed) path.
    const f = mkFake()
    reg.register('t1', getConn(f))
    const p = reg.waitForConfirm('t1', 'c-live', 1000)
    f.emit({
      t: 'confirm-resolved',
      confirmId: 'c-live',
      outcome: 'user-cancelled',
      stateAfter: null,
    })
    expect(await p).toEqual({ outcome: 'user-cancelled' })
  })

  it('waitForChange() arms a watch and resolves on the matching (id-correlated) state-update', async () => {
    const f = mkFake()
    reg.register('t1', getConn(f))
    const p = reg.waitForChange('t1', '/count', 1000)
    // The server arms the browser with a `watch { id, path }` frame.
    const watch = f.send.mock.calls.map((c) => c[0] as ServerFrame).find((fr) => fr.t === 'watch')
    expect(watch).toBeDefined()
    if (!watch || watch.t !== 'watch') throw new Error('unreachable')
    expect(watch.path).toBe('/count')
    // The browser answers with a state-update carrying that watch id.
    f.emit({ t: 'state-update', id: watch.id, path: '/count', stateAfter: { count: 2 } })
    expect(await p).toEqual({ status: 'changed', stateAfter: { count: 2 } })
    // And the watch is disarmed on resolution.
    const unwatch = f.send.mock.calls
      .map((c) => c[0] as ServerFrame)
      .find((fr) => fr.t === 'unwatch')
    expect(unwatch).toMatchObject({ t: 'unwatch', id: watch.id })
  })

  it('waitForChange() ignores a state-update whose id does NOT match the armed watch', async () => {
    const f = mkFake()
    reg.register('t1', getConn(f))
    const p = reg.waitForChange('t1', '/count', 20)
    // A state-update for a DIFFERENT watch id must not resolve this poll.
    f.emit({ t: 'state-update', id: 'some-other-id', path: '/count', stateAfter: { count: 9 } })
    expect(await p).toEqual({ status: 'timeout', stateAfter: null })
  })

  it('waitForChange() returns timeout if no matching update arrives', async () => {
    const f = mkFake()
    reg.register('t1', getConn(f))
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

  it('a reconnect supersede migrates in-flight rpc subscribers so the reply on the NEW socket settles the old promise', async () => {
    const a = mkFake()
    reg.register('t1', getConn(a))
    // rpc dispatched on socket A while it is the live pairing.
    const p = reg.rpc('t1', 'get_state', {}, { timeoutMs: 10000 })
    const sent = a.send.mock.calls[0]![0]! as ServerFrame
    if (sent.t !== 'rpc') throw new Error('unreachable')
    // Reconnect: socket B supersedes A while the rpc is still in flight.
    const b = mkFake()
    reg.register('t1', getConn(b))
    // The browser answers on the NEW socket, correlated by the same rpc id.
    b.emit({ t: 'rpc-reply', id: sent.id, result: { ok: 1 } })
    expect(await p).toEqual({ ok: 1 })
  })

  it('a migrated rpc closeHandler rejects paused when the NEW (superseding) socket closes', async () => {
    const a = mkFake()
    reg.register('t1', getConn(a))
    const p = reg.rpc('t1', 'get_state', {}, { timeoutMs: 10000 })
    const b = mkFake()
    reg.register('t1', getConn(b))
    // The reconnect never delivers a reply and then drops — the in-flight
    // rpc must still settle (paused), not hang forever.
    b.emitClose()
    await expect(p).rejects.toMatchObject({ code: 'paused' })
  })

  it('a stale conn close does NOT tear down the replacement pairing (connection-scoped close)', () => {
    const a = mkFake()
    reg.register('t1', getConn(a))
    // Replacement pairing arrives (reconnect) before the stale close fires.
    const b = mkFake()
    reg.register('t1', getConn(b))
    expect(reg.isPaired('t1')).toBe(true)
    // Stale close from the OLD socket fires late — must be a no-op.
    a.emitClose()
    expect(reg.isPaired('t1')).toBe(true)
    // The live pairing still routes to conn B.
    reg.send('t1', { t: 'active' })
    expect(b.send).toHaveBeenCalledWith({ t: 'active' })
  })

  it('register explicitly closes a superseded live conn before replacing it', () => {
    const a = mkFake()
    const closeSpy = vi.fn()
    const connA = getConn(a) as unknown as { close: () => void }
    connA.close = closeSpy
    reg.register('t1', connA as never)
    const b = mkFake()
    reg.register('t1', getConn(b))
    expect(closeSpy).toHaveBeenCalledOnce()
  })

  it('a stale close does NOT wipe the replacement pairing recent-log buffer', () => {
    const a = mkFake()
    reg.register('t1', getConn(a))
    const b = mkFake()
    reg.register('t1', getConn(b))
    b.emit({ t: 'log-append', entry: { id: 'e1', at: 1, kind: 'read' } })
    // Late stale close from A must not drop B's recent-log.
    a.emitClose()
    expect(reg.getRecentLog('t1', 10)).toHaveLength(1)
  })

  it('recent-log survives a legit close so a reconnect within the grace window keeps history', () => {
    const a = mkFake()
    reg.register('t1', getConn(a))
    a.emit({ t: 'log-append', entry: { id: 'e1', at: 1, kind: 'read' } })
    a.emitClose()
    // Reconnect within grace: recent-log history is still readable.
    const b = mkFake()
    reg.register('t1', getConn(b))
    expect(reg.getRecentLog('t1', 10)).toHaveLength(1)
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
