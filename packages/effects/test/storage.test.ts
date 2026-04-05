/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  handleEffects,
  storageLoad,
  storageSet,
  storageRemove,
  storageGet,
  storageWatch,
  type Effect,
} from '../src/index'

describe('storage effects', () => {
  let send: ReturnType<typeof vi.fn>
  let ctrl: AbortController
  let signal: AbortSignal

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    send = vi.fn()
    ctrl = new AbortController()
    signal = ctrl.signal
  })

  afterEach(() => {
    ctrl.abort()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('storageLoad reads + parses JSON from localStorage (default scope)', () => {
    localStorage.setItem('user', JSON.stringify({ name: 'alice' }))
    expect(storageLoad('user')).toEqual({ name: 'alice' })
  })

  it('storageLoad returns null for missing keys', () => {
    expect(storageLoad('missing')).toBe(null)
  })

  it('storageLoad returns null for invalid JSON', () => {
    localStorage.setItem('bad', '{ not valid json')
    expect(storageLoad('bad')).toBe(null)
  })

  it('storageLoad respects session scope', () => {
    sessionStorage.setItem('token', JSON.stringify('abc123'))
    expect(storageLoad('token', 'session')).toBe('abc123')
    expect(storageLoad('token', 'local')).toBe(null)
  })

  it('storageSet writes JSON to localStorage', () => {
    const handler = handleEffects<Effect>().else(() => {})
    handler({ effect: storageSet('count', 42), send, signal })
    expect(localStorage.getItem('count')).toBe('42')
  })

  it('storageRemove deletes the key', () => {
    localStorage.setItem('tmp', '"x"')
    const handler = handleEffects<Effect>().else(() => {})
    handler({ effect: storageRemove('tmp'), send, signal })
    expect(localStorage.getItem('tmp')).toBe(null)
  })

  it('storageGet dispatches onLoad with parsed value', () => {
    localStorage.setItem('theme', '"dark"')
    const handler = handleEffects<Effect>().else(() => {})
    handler({ effect: storageGet('theme', 'themeLoaded'), send, signal })
    expect(send).toHaveBeenCalledWith({ type: 'themeLoaded', value: 'dark' })
  })

  it('storageGet dispatches onLoad with null when key missing', () => {
    const handler = handleEffects<Effect>().else(() => {})
    handler({ effect: storageGet('nope', 'loaded'), send, signal })
    expect(send).toHaveBeenCalledWith({ type: 'loaded', value: null })
  })

  it('storageWatch fires onChange when storage event dispatches for the key', () => {
    const handler = handleEffects<Effect>().else(() => {})
    handler({ effect: storageWatch('settings', 'settingsChanged'), send, signal })

    // Dispatch a storage event (simulates cross-tab write)
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'settings',
        newValue: JSON.stringify({ lang: 'en' }),
      }),
    )

    expect(send).toHaveBeenCalledWith({
      type: 'settingsChanged',
      value: { lang: 'en' },
    })
  })

  it('storageWatch ignores events for other keys', () => {
    const handler = handleEffects<Effect>().else(() => {})
    handler({ effect: storageWatch('a', 'changed'), send, signal })
    window.dispatchEvent(new StorageEvent('storage', { key: 'b', newValue: '"x"' }))
    expect(send).not.toHaveBeenCalled()
  })

  it('storageWatch stops listening on signal abort', () => {
    const handler = handleEffects<Effect>().else(() => {})
    handler({ effect: storageWatch('k', 'changed'), send, signal })
    ctrl.abort()
    window.dispatchEvent(new StorageEvent('storage', { key: 'k', newValue: '"x"' }))
    expect(send).not.toHaveBeenCalled()
  })
})
