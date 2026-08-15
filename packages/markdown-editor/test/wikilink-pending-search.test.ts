// @vitest-environment jsdom
//
// Issue #183: a dismissal must cancel the search the plugin has not finished yet.
//
// `wikilinkPlugin({ search })` debounces the host search by 120 ms and the host's
// own promise takes however long it takes. Nothing used to cancel either window,
// so `[[ho` + Escape opened the panel ~120 ms LATER — on top of a user who had
// already dismissed it and (since #170) a host that had already handled the key.
//
// Every assertion here goes through the REAL path: a real editor, a real commit,
// the plugin's own `register` handlers, and the surface observed as LIVE DOM (the
// portaled overlay). Three traps this file is built around, two of which have
// produced vacuous green in this suite before:
//
//   * jsdom ships no `Range.prototype.getBoundingClientRect`. Without it the
//     caret measurement throws INSIDE the commit hub, which isolates its
//     subscribers — so no overlay ever opens, the failure is a console line
//     rather than a test failure, and every "the panel did not open" assertion
//     passes for the wrong reason. It is installed below, and every
//     did-not-open test here is paired with a CONTROL that watches the same
//     panel actually open.
//   * "The plugin declined the key" is asserted from a handler registered at
//     COMMAND_PRIORITY_LOW actually RECEIVING it — the host's position — never
//     from `dispatchCommand`'s return value, which only says somebody handled it.
//   * The dismissal has to land INSIDE the window. Typing goes through a discrete
//     update (so the plugin's `onCommit` refresh has run, and the timer is armed,
//     by the time it returns) and the Escape follows immediately, hundreds of
//     milliseconds inside the 120 ms debounce.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  $getRoot,
  $isElementNode,
  COMMAND_PRIORITY_LOW,
  KEY_ESCAPE_COMMAND,
  type LexicalEditor,
} from 'lexical'
import { mountApp } from '@llui/dom'
import { markdownEditor } from '../src/editor.js'
import { corePlugin } from '../src/plugins/core.js'
import { wikilinkPlugin, type DocCandidate } from '../src/plugins/wikilink.js'

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Comfortably past the 120 ms search debounce plus its promise turn. */
const SETTLE_MS = 250

const PANEL = '[data-scope="md-wikilink"][data-part="panel-root"]'
const CANDIDATES: readonly DocCandidate[] = [{ target: 'Home' }, { target: 'Homepage' }]

let container: HTMLElement
const mounted: Array<ReturnType<typeof mountApp>> = []
let rangeRectInstalled = false

beforeEach(() => {
  if (typeof Range.prototype.getBoundingClientRect !== 'function') {
    Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0)
    rangeRectInstalled = true
  }
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.dispose()
  document.body.innerHTML = ''
  if (rangeRectInstalled) {
    Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
    rangeRectInstalled = false
  }
})

interface Mounted {
  editor: LexicalEditor
  /** Dispose THIS mount (and take it out of the afterEach sweep). */
  dispose: () => void
}

async function mountWith(
  search: (q: string) => readonly DocCandidate[] | Promise<readonly DocCandidate[]>,
  value = 'x',
): Promise<Mounted> {
  let editor!: LexicalEditor
  const handle = mountApp(
    container,
    markdownEditor({
      plugins: [corePlugin(), wikilinkPlugin({ search })],
      defaultValue: value,
      onReady: (e) => {
        editor = e
      },
    }),
  )
  mounted.push(handle)
  await wait(0)
  return {
    editor,
    dispose: () => {
      const i = mounted.indexOf(handle)
      if (i >= 0) mounted.splice(i, 1)
      handle.dispose()
    },
  }
}

/** A host `search` whose promises are resolved by the test, not by a timer —
 * the only way to hold one ON THE WIRE across a dismissal or a `dispose()`. */
function deferredSearch(): {
  fn: (q: string) => Promise<readonly DocCandidate[]>
  queries: string[]
  settle: () => Promise<void>
  resolveQuery: (q: string) => Promise<void>
  rejectQuery: (q: string) => Promise<void>
} {
  interface Call {
    query: string
    resolve: (items: readonly DocCandidate[]) => void
    reject: (err: unknown) => void
  }
  const pending: Call[] = []
  const queries: string[] = []
  // Let the `.then`/`.catch` chains (and the reduce + reconcile they trigger)
  // run to completion.
  const drain = async (): Promise<void> => {
    await wait(0)
    await wait(0)
  }
  /** Take every outstanding call for `query` (or all of them). */
  const take = (query?: string): Call[] => {
    const taken = pending.filter((c) => query === undefined || c.query === query)
    for (const c of taken) pending.splice(pending.indexOf(c), 1)
    return taken
  }
  return {
    fn: (q) =>
      new Promise<readonly DocCandidate[]>((resolve, reject) => {
        queries.push(q)
        pending.push({ query: q, resolve, reject })
      }),
    queries,
    settle: async () => {
      for (const c of take()) c.resolve(CANDIDATES)
      await drain()
    },
    resolveQuery: async (q) => {
      const taken = take(q)
      expect(taken.length).toBeGreaterThan(0)
      for (const c of taken) c.resolve(CANDIDATES)
      await drain()
    },
    rejectQuery: async (q) => {
      const taken = take(q)
      expect(taken.length).toBeGreaterThan(0)
      for (const c of taken) c.reject(new Error(`search failed: ${q}`))
      await drain()
    },
  }
}

/** Append `text` at the end of the document and commit — one real commit, which
 * is what feeds the plugin's `onCommit` refresh and arms the debounce. */
function type(editor: LexicalEditor, text: string): void {
  editor.update(
    () => {
      const block = $getRoot().getLastChild()
      if (!$isElementNode(block)) return
      block.selectEnd().insertText(text)
    },
    { discrete: true },
  )
}

/** Is the plugin's portaled overlay live in the document? */
const panelUp = (): boolean => document.querySelector(PANEL) !== null

/**
 * Dispatch one Escape and report whether it reached a handler at
 * COMMAND_PRIORITY_LOW — i.e. whether the plugin DECLINED it. That is the host's
 * position and sits strictly below the plugin's COMMAND_PRIORITY_HIGH. The probe
 * returns false so the key keeps travelling.
 */
function escapeReachesHost(editor: LexicalEditor): boolean {
  let reached = false
  const unregister = editor.registerCommand(
    KEY_ESCAPE_COMMAND,
    () => {
      reached = true
      return false
    },
    COMMAND_PRIORITY_LOW,
  )
  editor.dispatchCommand(KEY_ESCAPE_COMMAND, new KeyboardEvent('keydown', { key: 'Escape' }))
  unregister()
  return reached
}

describe('wikilink typing search — a dismissal inside the debounce window', () => {
  it('CONTROL: undismissed, the debounced search completes and opens the panel', async () => {
    const { editor } = await mountWith(() => CANDIDATES)
    expect(panelUp()).toBe(false)

    type(editor, ' [[ho')
    // Nothing yet — the search is still in its debounce window, which is the
    // state every test below presses Escape in.
    expect(panelUp()).toBe(false)

    await wait(SETTLE_MS)
    expect(panelUp()).toBe(true)
  }, 15_000)

  it('an Escape the plugin DECLINED cancels it — and still reaches the host', async () => {
    const { editor } = await mountWith(() => CANDIDATES)

    type(editor, ' [[ho')
    expect(panelUp()).toBe(false)

    // Nothing is on screen, so the plugin has no business claiming the key: the
    // host must receive it (#130). Cancelling our own pending work is a separate
    // act that does not need the key, and #183 is that it was not happening.
    expect(escapeReachesHost(editor)).toBe(true)

    await wait(SETTLE_MS)
    expect(panelUp()).toBe(false)
  }, 15_000)

  it('an Escape the plugin CLAIMED cancels the search the last keystroke armed', async () => {
    const { editor } = await mountWith(() => CANDIDATES)

    type(editor, ' [[ho')
    await wait(SETTLE_MS)
    // Non-vacuity: from here on the panel is REALLY on screen.
    expect(panelUp()).toBe(true)

    // One more character arms a fresh search for `hom` while the panel from `ho`
    // is still up. Escape is claimed (there is a surface) and closes it — and
    // must take the armed search with it.
    type(editor, 'm')
    expect(escapeReachesHost(editor)).toBe(false)
    expect(panelUp()).toBe(false)

    await wait(SETTLE_MS)
    expect(panelUp()).toBe(false)
  }, 15_000)

  it('a click that moves nothing must NOT kill the pending typing search', async () => {
    const { editor } = await mountWith(() => CANDIDATES)

    type(editor, ' [[ho')
    expect(panelUp()).toBe(false)

    // `CLICK_COMMAND` fires on every click, including one that lands where the
    // caret already is — so no selection change, no commit, and NOTHING to
    // re-arm a search cancelled here. This is why the click-path cancel is
    // scoped to the repoint branch (`if (editing)`) rather than to every
    // click-elsewhere: the typing search is not the user saying "not this".
    editor.getRootElement()?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    await wait(SETTLE_MS)
    expect(panelUp()).toBe(true)
  }, 15_000)

  it('a search already ON THE WIRE is dropped by a dismissal, not just a pending timer', async () => {
    const search = deferredSearch()
    const { editor } = await mountWith(search.fn)

    type(editor, ' [[ho')
    // Past the debounce: the timer has fired and the host promise is in flight,
    // so clearing a timer can no longer help. Non-vacuity for the window itself.
    await wait(SETTLE_MS)
    expect(search.queries).toEqual(['ho'])
    expect(panelUp()).toBe(false)

    expect(escapeReachesHost(editor)).toBe(true)

    await search.settle()
    expect(panelUp()).toBe(false)
  }, 15_000)
})

describe('wikilink repoint search — a dismissal while the click search is in flight', () => {
  /** Click the nth rendered wikilink — the path that opens the repoint panel. */
  function clickLink(index = 0): void {
    const el = document.querySelectorAll('[data-wikilink]')[index]
    expect(el).toBeDefined()
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }

  /**
   * Click somewhere in the editor that is NOT a wikilink, the way a browser
   * does it: the click travels `CLICK_COMMAND` AND the caret moves (a caret
   * move is its own commit, which is what feeds the plugin's refresh).
   */
  function clickElsewhere(editor: LexicalEditor): void {
    editor.getRootElement()?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    editor.update(
      () => {
        const block = $getRoot().getLastChild()
        if ($isElementNode(block)) block.selectEnd()
      },
      { discrete: true },
    )
  }

  it('CONTROL: undismissed, the click search opens the repoint panel', async () => {
    const search = deferredSearch()
    await mountWith(search.fn, 'see [[Page]] here')

    clickLink()
    expect(search.queries).toEqual(['Page'])
    expect(panelUp()).toBe(false)

    await search.settle()
    expect(panelUp()).toBe(true)
    expect(document.querySelector('[data-part="edit-input"]')).not.toBeNull()
  }, 15_000)

  it('an Escape the plugin DECLINED drops the in-flight repoint search', async () => {
    const search = deferredSearch()
    const { editor } = await mountWith(search.fn, 'see [[Page]] here')

    clickLink()
    expect(search.queries).toEqual(['Page'])
    expect(panelUp()).toBe(false)

    // The panel is not up yet, so the plugin declines — same trace as the typing
    // path, on the other of the two searches it runs.
    expect(escapeReachesHost(editor)).toBe(true)

    await search.settle()
    expect(panelUp()).toBe(false)
  }, 15_000)

  it('a click ELSEWHERE drops the in-flight repoint search, and a later click still opens it', async () => {
    const search = deferredSearch()
    const { editor } = await mountWith(search.fn, 'see [[Page]] here')

    clickLink()
    expect(search.queries).toEqual(['Page'])
    expect(panelUp()).toBe(false)

    // Clicking away is as unambiguous a "not this" as Escape — and it is the
    // gesture issue #183 names in its own bullet list. The dismissal itself
    // shows nothing, so the assertion that matters is the one after the search
    // lands.
    clickElsewhere(editor)
    expect(panelUp()).toBe(false)

    await search.settle()
    expect(panelUp()).toBe(false)

    // CONTROL, in this exact test: the cancel latches nothing off — clicking the
    // link again opens the repoint panel as usual. (This also re-resolves the
    // abandoned first call, which must stay dropped: one panel, from the second
    // click.)
    clickLink()
    await search.resolveQuery('Page')
    expect(panelUp()).toBe(true)
    expect(document.querySelector('[data-part="edit-input"]')).not.toBeNull()
  }, 15_000)

  it('a SUPERSEDED repoint search that REJECTS does not clear a live panel', async () => {
    const search = deferredSearch()
    const { editor } = await mountWith(search.fn, 'see [[Page]] and [[Other]] here')

    // Two clicks in a row: the second supersedes the first, which is left on the
    // wire with nobody waiting for it.
    clickLink(0)
    clickLink(1)
    expect(search.queries).toEqual(['Page', 'Other'])

    // The winner lands and the repoint panel is really up.
    await search.resolveQuery('Other')
    expect(panelUp()).toBe(true)

    // The loser then FAILS. Its `.catch` must be as stale-aware as its `.then`:
    // clearing edit mode here belongs to a panel that is no longer this search's
    // to close, and the next commit would act on it.
    await search.rejectQuery('Page')
    type(editor, ' x')
    expect(panelUp()).toBe(true)
  }, 15_000)
})

describe('wikilink search resolving after dispose()', () => {
  it('CONTROL: the same deferred search, left to land on a LIVE mount, opens the panel', async () => {
    const search = deferredSearch()
    const { editor } = await mountWith(search.fn)

    type(editor, ' [[ho')
    await wait(SETTLE_MS)
    expect(search.queries).toEqual(['ho'])

    await search.settle()
    // So the resolve path below really does reach `emit` — the test after this
    // one is about that emit being dropped, not about a path that never runs.
    expect(panelUp()).toBe(true)
  }, 15_000)

  it('does not emit into the torn-down loop', async () => {
    const search = deferredSearch()
    const { editor, dispose } = await mountWith(search.fn)

    type(editor, ' [[ho')
    await wait(SETTLE_MS)
    // Non-vacuity: the host promise is genuinely outstanding at teardown, so
    // clearing the debounce timer can no longer help.
    expect(search.queries).toEqual(['ho'])

    const afterDispose = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const dropped = (): number =>
      afterDispose.mock.calls.filter((c) => String(c[0]).includes('send() after dispose()')).length
    try {
      dispose()
      await wait(0)
      // The baseline is taken AFTER teardown has settled, and deliberately does
      // NOT assert it is zero: tearing the editor down commits one last time,
      // and the plugin's `onCommit` refresh emits a (no-op) `searchHide` into
      // the already-disposed loop from there. That is a SEPARATE, pre-existing
      // defect on the synchronous commit path — not the pending-async one this
      // file is about — so it is measured out rather than silently folded in.
      const baseline = dropped()
      await search.settle()
      expect(dropped()).toBe(baseline)
    } finally {
      afterDispose.mockRestore()
    }
  }, 15_000)
})
