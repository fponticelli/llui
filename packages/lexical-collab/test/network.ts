// An in-memory Yjs network: connect N `TestProvider`s to a `TestHub` and they
// relay document updates + awareness to each other synchronously — the transport
// a real `y-websocket` would provide, minus the socket. Lets the binding tests
// assert true multi-peer convergence/presence without a server.

import { applyUpdate, Doc as YDoc, encodeStateAsUpdate } from 'yjs'
import type { UserState } from '@lexical/yjs'
import type { CollabProvider } from '../src/index.js'

/** Origin tag for remote-applied updates, so the local doc-update handler can
 * tell its own writes (which must broadcast) from inbound ones (which must not). */
const REMOTE = Symbol('llui-test-remote')

class TestAwareness {
  localState: UserState | null = null
  readonly states = new Map<number, UserState>()
  private readonly listeners = new Set<() => void>()
  constructor(
    readonly clientID: number,
    private readonly provider: TestProvider,
  ) {}
  getLocalState(): UserState | null {
    return this.localState
  }
  getStates(): Map<number, UserState> {
    return this.states
  }
  setLocalState(state: UserState | null): void {
    this.localState = state
    if (state) this.states.set(this.clientID, state)
    else this.states.delete(this.clientID)
    this.provider.broadcastAwareness()
    this.emit()
  }
  setLocalStateField(field: string, value: unknown): void {
    const next = { ...(this.localState ?? blankState()), [field]: value } as UserState
    this.setLocalState(next)
  }
  /** Called by the hub when a peer's awareness changed. */
  receiveRemote(clientID: number, state: UserState | null): void {
    if (state) this.states.set(clientID, state)
    else this.states.delete(clientID)
    this.emit()
  }
  on(_type: 'update', cb: () => void): void {
    this.listeners.add(cb)
  }
  off(_type: 'update', cb: () => void): void {
    this.listeners.delete(cb)
  }
  private emit(): void {
    for (const l of [...this.listeners]) l()
  }
}

function blankState(): UserState {
  return {
    anchorPos: null,
    focusPos: null,
    color: '#000',
    focusing: false,
    name: '',
    awarenessData: {},
  }
}

export class TestHub {
  readonly providers = new Set<TestProvider>()
  broadcastDoc(from: TestProvider, update: Uint8Array): void {
    for (const p of this.providers) if (p !== from && p.connected) p.applyRemote(update)
  }
  broadcastAwareness(from: TestProvider): void {
    const state = from.awareness.getLocalState()
    for (const p of this.providers) {
      if (p !== from && p.connected) p.awareness.receiveRemote(from.awareness.clientID, state)
    }
  }
}

type SyncCb = (isSynced: boolean) => void
type StatusCb = (arg: { status: string }) => void
type UpdateCb = (arg: unknown) => void
type ReloadCb = (doc: YDoc) => void

export class TestProvider implements CollabProvider {
  readonly awareness: TestAwareness
  connected = false
  /** Mirrors a real provider's `synced` flag: true once the initial handshake
   * (our synchronous `connect()`) has completed. Lets tests exercise the
   * already-synced bootstrap path. */
  synced = false
  private readonly syncCbs = new Set<SyncCb>()
  private readonly statusCbs = new Set<StatusCb>()
  private readonly updateCbs = new Set<UpdateCb>()
  private readonly reloadCbs = new Set<ReloadCb>()

  constructor(
    readonly doc: YDoc,
    private readonly hub: TestHub,
  ) {
    this.awareness = new TestAwareness(doc.clientID, this)
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return
      if (this.connected) this.hub.broadcastDoc(this, update)
    })
  }

  broadcastAwareness(): void {
    if (this.connected) this.hub.broadcastAwareness(this)
  }

  applyRemote(update: Uint8Array): void {
    applyUpdate(this.doc, update, REMOTE)
  }

  connect(): void {
    if (this.connected) return
    this.connected = true
    this.hub.providers.add(this)
    // Exchange existing state with already-connected peers.
    for (const p of this.hub.providers) {
      if (p !== this && p.connected) applyUpdate(this.doc, encodeStateAsUpdate(p.doc), REMOTE)
    }
    this.hub.broadcastDoc(this, encodeStateAsUpdate(this.doc))
    // Exchange awareness both ways (real providers sync presence on connect).
    for (const p of this.hub.providers) {
      if (p === this || !p.connected) continue
      this.awareness.receiveRemote(p.awareness.clientID, p.awareness.getLocalState())
      p.awareness.receiveRemote(this.awareness.clientID, this.awareness.getLocalState())
    }
    this.synced = true
    for (const cb of [...this.statusCbs]) cb({ status: 'connected' })
    for (const cb of [...this.syncCbs]) cb(true)
  }

  disconnect(): void {
    if (!this.connected) return
    this.connected = false
    this.hub.providers.delete(this)
    this.hub.broadcastAwareness(this)
    for (const cb of [...this.statusCbs]) cb({ status: 'disconnected' })
  }

  on(type: 'sync', cb: SyncCb): void
  on(type: 'status', cb: StatusCb): void
  on(type: 'update', cb: UpdateCb): void
  on(type: 'reload', cb: ReloadCb): void
  on(type: string, cb: (arg: never) => void): void {
    if (type === 'sync') this.syncCbs.add(cb as SyncCb)
    else if (type === 'status') this.statusCbs.add(cb as StatusCb)
    else if (type === 'update') this.updateCbs.add(cb as UpdateCb)
    else if (type === 'reload') this.reloadCbs.add(cb as ReloadCb)
  }

  off(type: 'sync', cb: SyncCb): void
  off(type: 'status', cb: StatusCb): void
  off(type: 'update', cb: UpdateCb): void
  off(type: 'reload', cb: ReloadCb): void
  off(_type: string, cb: (arg: never) => void): void {
    this.syncCbs.delete(cb as SyncCb)
    this.statusCbs.delete(cb as StatusCb)
    this.updateCbs.delete(cb as UpdateCb)
    this.reloadCbs.delete(cb as ReloadCb)
  }
}

/** Flush pending Lexical reconciles + Yjs relay hops. */
export const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
