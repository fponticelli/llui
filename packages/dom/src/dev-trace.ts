/**
 * Dev-only runtime trace ring buffer. Built to bridge the
 * Playwright-vs-real-Chrome gap on the nested-each reactivity bug:
 * Playwright headless can't reproduce, so we instrument the runtime
 * itself and have the user dump the buffer after reproducing in their
 * real Chrome.
 *
 * Gated entirely on `import.meta.env?.DEV` — production builds dead-
 * code the module via the same DCE pattern the rest of @llui/dom uses
 * for dev-time trackers (each-diff log, disposer log, etc.).
 *
 * Surface:
 *   window.__lluiTrace        — Array of entries (capped at 2000)
 *   window.__lluiTraceDump()  — Console-print all entries
 *   window.__lluiTraceClear() — Reset the buffer
 *   window.__lluiTraceEnable(true|false) — toggle capture
 *
 * The buffer captures three event kinds today:
 *
 *   { kind: 'dispatch', msgType, dirty, dirtyHi, queueLen, path }
 *     — fired once per message processed by _handleMsg / genericUpdate
 *
 *   { kind: 'reconcile', blockId, mask, dirty, gateOpen, itemsLenBefore,
 *     itemsLenAfter, itemsRefChanged, keysBefore, keysAfter, fastPath }
 *     — fired by each.block.reconcile around the items() call and
 *     reconcileEntries dispatch
 *
 *   { kind: 'entry', op: 'build' | 'dispose', blockId, key, scopeId }
 *     — fired by each.buildEntry and removeEntry / disposeLifetime
 *
 * Block IDs are stable per each() construction: `each#${siteCounter}`
 * incremented module-side. That's the same scheme `_eachDiffLog`'s
 * `eachSiteId` uses; we re-use that counter so cross-referencing the
 * existing tracker output works without extra bookkeeping.
 */

declare global {
  interface Window {
    __lluiTrace?: TraceEntry[]
    __lluiTraceEnabled?: boolean
    __lluiTraceDump?: () => void
    __lluiTraceClear?: () => void
    __lluiTraceEnable?: (on: boolean) => void
  }
}

export type TraceEntry =
  | {
      kind: 'dispatch'
      t: number
      msgType: string | null
      dirty: number
      dirtyHi: number
      queueLen: number
      path: 'fast' | 'generic'
      blocksCount: number
      blockMasks: Array<{ id: string; mask: number; maskHi: number; gateOpen: boolean }>
    }
  | {
      kind: 'reconcile'
      t: number
      blockId: string
      mask: number
      maskHi: number
      dirty: number
      dirtyHi: number
      gateOpen: boolean
      itemsLenBefore: number
      itemsLenAfter: number
      itemsRefChanged: boolean
      keysBefore: Array<string | number>
      keysAfter: Array<string | number>
    }
  | {
      kind: 'entry'
      t: number
      blockId: string
      op: 'build' | 'dispose'
      key: string | number
      scopeId: string | number
    }
  | {
      kind: 'block'
      t: number
      blockId: string
      op: 'register' | 'unregister'
      mask: number
      maskHi: number
      parentLifetimeId: string | number
    }

const MAX = 2000
const isDev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV ?? false

export function pushTrace(entry: TraceEntry): void {
  if (!isDev) return
  const w = globalThis as unknown as Window
  if (w.__lluiTraceEnabled === false) return
  const buf = w.__lluiTrace
  if (!buf) return
  if (buf.length >= MAX) buf.shift()
  buf.push(entry)
}

export function installTraceGlobals(): void {
  if (!isDev) return
  const w = globalThis as unknown as Window
  if (w.__lluiTrace) return // idempotent
  w.__lluiTrace = []
  w.__lluiTraceEnabled = true
  w.__lluiTraceDump = (): void => {
    // eslint-disable-next-line no-console
    console.log(
      `[lluiTrace] ${w.__lluiTrace?.length ?? 0} entries:\n` +
        JSON.stringify(w.__lluiTrace, null, 2),
    )
  }
  w.__lluiTraceClear = (): void => {
    if (w.__lluiTrace) w.__lluiTrace.length = 0
  }
  w.__lluiTraceEnable = (on: boolean): void => {
    w.__lluiTraceEnabled = on
  }
}
