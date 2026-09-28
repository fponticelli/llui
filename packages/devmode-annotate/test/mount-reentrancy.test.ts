/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountAnnotateHud, type AnnotateHudHandle } from '../src/index.js'
import type { EventSubscription, NotesStore } from '../src/notes-store.js'
import { settle } from '../../../scripts/lib/wait-until.mjs'
import { destroyMountedHud } from './support/hud-teardown.js'

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

// The DOM is only half of what a partial mount can orphan. The HUD's four
// GLOBAL listeners — document `keydown`, window `resize`, and auto-capture's
// window `error` / `unhandledrejection` — used to be created in one block and
// registered as disposers only in a trailing block below it. A throw between
// the two points left all four attached with no handle to remove them: the
// host keeps eating Escape and Cmd+Shift+A forever, and every later uncaught
// error runs a handler whose HUD no longer exists. They are now registered at
// their creation sites, which is what `addCore`-at-creation-time exists for.

/** The four globals a partial mount could orphan. Other listeners the HUD
 *  attaches live on nodes it removes, or on document but only while the
 *  element picker / repro recorder is running, so they are out of scope. */
const TRACKED_TYPES = new Set(['keydown', 'resize', 'error', 'unhandledrejection'])

interface ListenerLedger {
  /** `type` of every tracked listener added and not since removed. */
  outstanding(): string[]
  restore(): void
}

/** Patch `document` + `window` so every tracked add/remove is recorded, and
 *  optionally make one `addEventListener(type)` throw — the injected fault
 *  that stands in for anything going wrong mid-mount. */
function trackGlobalListeners(throwOn?: string): ListenerLedger {
  const live: Array<{ type: string; fn: EventListenerOrEventListenerObject | null }> = []
  const targets: EventTarget[] = [document, window]
  // Restore by ASSIGNING the original back, never by deleting the property:
  // under vitest's jsdom bridge `window.addEventListener` is an accessor on
  // globalThis, so a delete strips the bridge and every later patch stacks on
  // the previous test's wrapper instead of replacing it.
  const originals = targets.map((target) => ({
    target,
    original: { add: target.addEventListener, remove: target.removeEventListener },
    add: target.addEventListener.bind(target),
    remove: target.removeEventListener.bind(target),
  }))

  for (const o of originals) {
    o.target.addEventListener = (type, fn, options): void => {
      if (throwOn !== undefined && type === throwOn) {
        throw new Error(`addEventListener(${type}) boom`)
      }
      o.add(type, fn, options)
      if (TRACKED_TYPES.has(type)) live.push({ type, fn })
    }
    o.target.removeEventListener = (type, fn, options): void => {
      o.remove(type, fn, options)
      const i = live.findIndex((l) => l.type === type && l.fn === fn)
      if (i >= 0) live.splice(i, 1)
    }
  }

  return {
    outstanding: () => live.map((l) => l.type).sort(),
    restore(): void {
      for (const o of originals) {
        o.target.addEventListener = o.original.add
        o.target.removeEventListener = o.original.remove
      }
      // Whatever the mount left attached would otherwise bleed into the next
      // test — remove it with the ORIGINAL methods, which the ledger no longer
      // sees, so `outstanding()` still reports what the mount itself leaked.
      for (const l of live.splice(0)) {
        for (const o of originals) o.remove(l.type, l.fn)
      }
    },
  }
}

describe('a partial mount orphans no global listener', () => {
  let ledger: ListenerLedger | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    ledger?.restore()
    ledger = null
    document.body.innerHTML = ''
  })

  it('control: a complete mount attaches them, and destroy() removes them all', () => {
    ledger = trackGlobalListeners()
    const handle = mountAnnotateHud({ store: fakeStore(), subscribeEvents: false })
    // Negative control — without this the assertions below pass vacuously. A
    // SET, because the embedded editor's overlay plugin attaches a `resize` of
    // its own; what matters is that all four of the HUD's globals are live.
    expect(new Set(ledger.outstanding())).toEqual(
      new Set(['error', 'keydown', 'resize', 'unhandledrejection']),
    )
    handle.destroy()
    expect(ledger.outstanding()).toEqual([])
  })

  it('a throw while installing auto-capture unwinds keydown + resize', () => {
    ledger = trackGlobalListeners('error')
    expect(() => mountAnnotateHud({ store: fakeStore(), subscribeEvents: false })).toThrow(
      'addEventListener(error) boom',
    )
    expect(ledger.outstanding()).toEqual([])
    expect(document.getElementById(HUD_ID)).toBeNull()
  })

  it('a throw between auto-capture’s two listeners unwinds all of them', () => {
    ledger = trackGlobalListeners('unhandledrejection')
    expect(() => mountAnnotateHud({ store: fakeStore(), subscribeEvents: false })).toThrow(
      'addEventListener(unhandledrejection) boom',
    )
    // `installAutoCapture` never returns here, so the HUD never receives an
    // `AutoCapture` to dispose — the half-installed pair has to unwind itself.
    expect(ledger.outstanding()).toEqual([])
    expect(document.getElementById(HUD_ID)).toBeNull()
  })
})

// A HUD whose element a host removed WITHOUT calling `destroy()` (a framework
// re-render clearing `document.body`, a test's `innerHTML = ''`) used to stay
// fully live: its document `keydown`, its console patch, its debounced persist.
// The singleton guard looks the HUD up BY ELEMENT, so the next mount found
// nothing and built a SECOND HUD beside the orphan — and both mirror their
// state into ONE localStorage key. Escape then closed the orphan's invisible
// modal and persisted ITS state over the live HUD's. That was the
// `auto-capture-and-escape.test.ts` "does not close/persist" failure (5 of 5
// runs without retry, and deterministic even alone — it depends on test ORDER,
// not load), which `retry: 2` masked because the first attempt's Escape had
// already closed the orphan's modal.
describe('an orphaned HUD is reclaimed by the next mount', () => {
  const HUD_STATE_KEY = 'llui-devmode-annotate.hud-state'

  afterEach(() => {
    destroyMountedHud()
    document.body.innerHTML = ''
    localStorage.clear()
  })

  it('a detached HUD stops handling Escape and never persists over its successor', async () => {
    const orphan = mountAnnotateHud({ store: fakeStore(), subscribeEvents: false })
    orphan.open()
    // Detach without destroy — what a host re-render does.
    document.body.innerHTML = ''

    const live = mountAnnotateHud({ store: fakeStore(), subscribeEvents: false })
    expect(live).not.toBe(orphan)
    const writes: string[] = []
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    setItem.mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === HUD_STATE_KEY) writes.push(value)
    })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    // The orphan's open() scheduled a debounced persist before it was detached;
    // reclaiming it must cancel that too. Wait out the debounce window — a
    // NEGATIVE assertion, so a longer wait can only catch more.
    await settle(300)
    setItem.mockRestore()
    expect(writes).toEqual([])
    // Exactly one HUD element in the document: the live one.
    expect(document.querySelectorAll(`#${HUD_ID}`)).toHaveLength(1)
  })

  it('a still-attached HUD is returned, not reclaimed', () => {
    const first = mountAnnotateHud({ store: fakeStore(), subscribeEvents: false })
    const second = mountAnnotateHud({ store: fakeStore(), subscribeEvents: false })
    expect(second).toBe(first)
    expect(document.getElementById(HUD_ID)).not.toBeNull()
  })
})
