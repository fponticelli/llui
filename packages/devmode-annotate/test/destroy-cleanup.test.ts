/// <reference lib="dom" />
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountAnnotateHud } from '../src/index.js'
import type { NotesStore } from '../src/notes-store.js'

const HUD_ID = 'llui-devmode-annotate-root'
const HUD_STATE_KEY = 'llui-devmode-annotate.hud-state'

// Finding 12 — destroy() must leave nothing live: the debounced persist timer,
// toast timers, event subscription, and global listeners are all torn down.

describe('destroy() lifecycle cleanup', () => {
  afterEach(() => {
    document.getElementById(HUD_ID)?.remove()
    document.body.innerHTML = ''
    localStorage.removeItem(HUD_STATE_KEY)
    vi.restoreAllMocks()
  })

  it('cancels the pending persist timer so no write fires after destroy', async () => {
    const handle = mountAnnotateHud({ subscribeEvents: false })
    handle.open() // schedules a debounced persist (setTimeout ~200ms)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    handle.destroy()
    // Give the (now-cancelled) persist timer more than its debounce window.
    await new Promise((r) => setTimeout(r, 300))
    const persistWrites = setItem.mock.calls.filter((c) => c[0] === HUD_STATE_KEY)
    expect(persistWrites).toHaveLength(0)
  })

  it('removes the global keydown listener (Cmd+Shift+A no longer opens)', () => {
    const handle = mountAnnotateHud({ subscribeEvents: false })
    handle.destroy()
    expect(document.getElementById(HUD_ID)).toBeNull()
    // The bootstrap combo must not resurrect a modal / throw now that the HUD
    // and its listeners are gone.
    expect(() =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'A', metaKey: true, shiftKey: true, bubbles: true }),
      ),
    ).not.toThrow()
    expect(document.getElementById(HUD_ID)).toBeNull()
  })

  it('tears down the event subscription', () => {
    const unsubscribe = vi.fn()
    const store = { subscribeEvents: () => unsubscribe } as unknown as NotesStore
    const handle = mountAnnotateHud({ subscribeEvents: true, store })
    handle.destroy()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
