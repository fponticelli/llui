/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mountAnnotateHud, type AnnotateHudHandle } from '../src/index.js'
import type { EventSubscription, NotesStore } from '../src/notes-store.js'

// Issue #115 — `mountAnnotateHud` read its in-progress guard (the mounted
// element's `_lluiHandle`) at the top but only SET it on the last line, after
// the DOM was appended and after `store.subscribeEvents` had already been
// called. A store whose `subscribeEvents` re-entered the mount therefore built
// a SECOND HUD sharing one element id, and `outer.destroy()` left the other
// one running. The same window orphaned the appended DOM when a mount threw.

const HUD_ID = 'llui-devmode-annotate-root'
const noop = (): void => {}

function fakeStore(over: Partial<NotesStore> = {}): NotesStore {
  return {
    createNote: async () => ({ id: '001', filename: 'x.md', path: '/x', sessionId: 's1' }),
    listSessions: async () => [],
    currentSession: async () => ({ sessionId: 's1', startedAt: '', notesDir: '' }),
    listNotes: async () => ({ sessionId: 's1', notes: [], total: 0 }),
    readNote: async () => null,
    getStatus: async () => ({ current: null, history: [] }),
    getQueue: async () => ({ queue: [] }),
    deleteNote: async () => {},
    updateNote: async () => {},
    postStatus: async () => {},
    screenshotUrl: () => '',
    subscribeEvents: () => noop,
    dispose: noop,
    ...over,
  }
}

describe('mountAnnotateHud re-entrancy', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('a mount re-entered from subscribeEvents yields exactly one HUD', () => {
    let reentered: AnnotateHudHandle | null = null
    let attempted = false
    let unsubscribes = 0
    const store: NotesStore = fakeStore({
      subscribeEvents: (_sub: EventSubscription) => {
        // Re-enter once, and flag it BEFORE the call: a nested mount that
        // reached this line again would recurse until the stack blew.
        if (!attempted) {
          attempted = true
          reentered = mountAnnotateHud({ store, subscribeEvents: true })
        }
        return () => {
          unsubscribes += 1
        }
      },
    })

    const outer = mountAnnotateHud({ store, subscribeEvents: true })

    expect(reentered).not.toBeNull()
    expect(document.querySelectorAll(`#${HUD_ID}`)).toHaveLength(1)

    // The re-entrant caller gets the handle of the one live HUD — driving it
    // drives that HUD, not a second one.
    reentered!.open()
    const modals = document.querySelectorAll<HTMLElement>('[data-llui-modal]')
    expect(modals).toHaveLength(1)
    expect(modals[0]!.style.display).toBe('block')

    // destroy() leaves nothing running: one HUD, one teardown.
    outer.destroy()
    expect(document.querySelectorAll(`#${HUD_ID}`)).toHaveLength(0)
    expect(unsubscribes).toBe(1)
    expect(() => reentered!.destroy()).not.toThrow()
    expect(document.querySelectorAll(`#${HUD_ID}`)).toHaveLength(0)
  })

  it('a mount that throws partway leaves no orphaned DOM', () => {
    const store = fakeStore({
      subscribeEvents: () => {
        // Thrown after the HUD DOM is appended and the component is mounted.
        throw new Error('subscribe boom')
      },
    })

    expect(() => mountAnnotateHud({ store, subscribeEvents: true })).toThrow('subscribe boom')
    expect(document.getElementById(HUD_ID)).toBeNull()
    expect(document.body.innerHTML).toBe('')
  })

  it('a throwing mount does not poison the next mount', () => {
    const boom = fakeStore({
      subscribeEvents: () => {
        throw new Error('subscribe boom')
      },
    })
    expect(() => mountAnnotateHud({ store: boom, subscribeEvents: true })).toThrow()

    const handle = mountAnnotateHud({ store: fakeStore(), subscribeEvents: false })
    expect(document.querySelectorAll(`#${HUD_ID}`)).toHaveLength(1)
    handle.destroy()
  })

  it('an isolate-mode mount that throws partway removes its shadow host', () => {
    const store = fakeStore({
      subscribeEvents: () => {
        throw new Error('subscribe boom')
      },
    })
    expect(() =>
      mountAnnotateHud({ store, subscribeEvents: true, isolate: true, allowProduction: true }),
    ).toThrow('subscribe boom')
    expect(document.getElementById(HUD_ID)).toBeNull()
    expect(document.body.innerHTML).toBe('')
  })
})
