import type { InternalSend, Runner } from '../core.js'
import type {
  StorageGetEffect,
  StorageRemoveEffect,
  StorageScope,
  StorageSetEffect,
  StorageWatchEffect,
} from '../types.js'

function getStorage(scope: StorageScope): Storage | null {
  if (typeof window === 'undefined') return null
  return scope === 'local' ? window.localStorage : window.sessionStorage
}

function runStorageSet(effect: StorageSetEffect): void {
  const store = getStorage(effect.scope)
  if (!store) return
  try {
    store.setItem(effect.key, JSON.stringify(effect.value))
  } catch {
    // quota exceeded or serialization failed — silent, same as localStorage itself
  }
}

function runStorageRemove(effect: StorageRemoveEffect): void {
  const store = getStorage(effect.scope)
  if (store) store.removeItem(effect.key)
}

function runStorageGet(effect: StorageGetEffect, send: InternalSend): void {
  const store = getStorage(effect.scope)
  if (!store) {
    send(effect.onLoad(null))
    return
  }
  const raw = store.getItem(effect.key)
  let value: unknown = null
  if (raw !== null) {
    try {
      value = JSON.parse(raw)
    } catch {
      value = null
    }
  }
  send(effect.onLoad(value))
}

function runStorageWatch(
  effect: StorageWatchEffect,
  send: InternalSend,
  signal: AbortSignal,
): void {
  if (typeof window === 'undefined') return
  // `storage` event only fires on localStorage, and only cross-tab.
  // For sessionStorage (single-tab) we have no cross-change signal — watcher is a no-op.
  if (effect.scope !== 'local') return
  const handler = (e: StorageEvent): void => {
    if (e.key !== effect.key) return
    let value: unknown = null
    if (e.newValue !== null) {
      try {
        value = JSON.parse(e.newValue)
      } catch {
        value = null
      }
    }
    send(effect.onChange(value))
  }
  window.addEventListener('storage', handler)
  signal.addEventListener('abort', () => window.removeEventListener('storage', handler), {
    once: true,
  })
}

export const storageSetRunner: Runner = {
  types: ['storage-set'],
  completesWithoutDispatch: true,
  run(effect) {
    runStorageSet(effect as StorageSetEffect)
  },
}

export const storageRemoveRunner: Runner = {
  types: ['storage-remove'],
  completesWithoutDispatch: true,
  run(effect) {
    runStorageRemove(effect as StorageRemoveEffect)
  },
}

export const storageGetRunner: Runner = {
  types: ['storage-get'],
  completesWithoutDispatch: false,
  run(effect, send) {
    runStorageGet(effect as StorageGetEffect, send)
  },
}

export const storageWatchRunner: Runner = {
  types: ['storage-watch'],
  completesWithoutDispatch: false,
  run(effect, send, signal) {
    runStorageWatch(effect as StorageWatchEffect, send, signal)
  },
}
