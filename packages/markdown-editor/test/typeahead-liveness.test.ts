// The guard for the one BEHAVIOURAL change issue #74 made inside a plugin, now
// restated on the gate issue #130 replaced it with.
//
// Before the commit hub, the slash / mention / wikilink key handlers each asked
// the editor directly — `editor.getEditorState().read($readQuery) !== null` — on
// every ArrowUp/ArrowDown/Enter/Escape. #74 replaced that with `liveQuery`, a
// value cached by the plugin's `onCommit` refresh; #130 replaced THAT with the
// only fact that justifies claiming a key at COMMAND_PRIORITY_HIGH: the plugin's
// surface is UP (`PluginUISpec.isOpen`, published per editor and read live).
//
// The two are not the same gate, and this file is where the difference is pinned:
// a live trigger whose query matches NOTHING opens no menu, so it must claim
// nothing — the cached-query gate claimed all four keys there, with an empty
// screen. (The dismissal half — Escape released once the menu is gone — lives in
// `escape-release.test.ts`.)
//
// The rest of the suite cannot see any of this: every other slash/mention/wikilink
// test drives the reducers and views through `send`, never the
// register → commit → key-handler path. So this file drives exactly that path,
// through a real editor, and pins both directions:
//
//   • With no surface up, the handler must be INERT — it returns false so the
//     keystroke falls through to Lexical (ArrowDown moves the caret, Enter splits
//     the block, Escape reaches the host). An `isActive` stuck open swallows all four.
//   • While the surface IS up, the handler must CAPTURE — returning true is what
//     drives the menu and suppresses the default. An `isActive` stuck closed
//     makes the menu unnavigable.
//
// Each key is probed against a FRESHLY opened surface: under the #130 gate a probe
// changes what the next one would see (Enter chooses a row and closes the menu,
// Escape dismisses it), so reusing one open menu for all four would make the
// last three answer a question about the first.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  COMMAND_PRIORITY_NORMAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalCommand,
  type LexicalEditor,
} from 'lexical'
import { mountApp } from '@llui/dom'
import { markdownEditor } from '../src/editor.js'
import { corePlugin } from '../src/plugins/core.js'
import { slashPlugin } from '../src/plugins/slash.js'
import { mentionPlugin } from '../src/plugins/mention.js'
import { wikilinkPlugin } from '../src/plugins/wikilink.js'
import type { MarkdownPlugin } from '../src/plugins/types.js'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

let container: HTMLElement
const mounted: Array<ReturnType<typeof mountApp>> = []
let rangeRectInstalled = false

beforeEach(() => {
  // jsdom ships no `Range.prototype.getBoundingClientRect` (every browser does).
  // The typeaheads measure the caret to place their overlay, and the commit hub
  // ISOLATES its subscribers — so without this the measurement throws, no menu
  // ever opens, and the "captures" half of every assertion below would be a lie.
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

async function mountWith(plugin: MarkdownPlugin): Promise<LexicalEditor> {
  let editor!: LexicalEditor
  mounted.push(
    mountApp(
      container,
      markdownEditor({
        plugins: [corePlugin(), plugin],
        defaultValue: 'x',
        onReady: (e) => {
          editor = e
        },
      }),
    ),
  )
  await wait(0)
  return editor
}

/** Append `text` at the end of the document and commit — one real commit, which
 * is what feeds the plugin's `onCommit` refresh. */
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

/** Put the document back to a bare `x` with the caret at its end — no trigger, no
 * surface — so the next probe starts from a known state whatever the last one did
 * to the document (Enter runs a slash command / inserts a mention). */
function reset(editor: LexicalEditor): void {
  editor.update(
    () => {
      const root = $getRoot()
      root.clear()
      const block = $createParagraphNode()
      block.append($createTextNode('x'))
      root.append(block)
      block.selectEnd()
    },
    { discrete: true },
  )
}

// A real KeyboardEvent: the handlers call `preventDefault()` on capture, and
// passing null would hide a handler that forgot to guard the optional.
const key = (name: string): KeyboardEvent => new KeyboardEvent('keydown', { key: name })

/** Dispatch one key command and report whether the typeahead CAPTURED it.
 *
 * Not `dispatchCommand`'s return value: rich-text also handles Enter (it splits
 * the block) and answers true whenever there is a selection at all, so that
 * return value says "somebody handled it", not "the typeahead did". Instead a
 * sentinel is registered at `COMMAND_PRIORITY_NORMAL`, strictly below the
 * typeaheads' `COMMAND_PRIORITY_HIGH` and strictly above rich-text's `EDITOR`:
 * reaching the sentinel means the typeahead declined. It returns true so the
 * probe never lets a keystroke edit the document out from under the next probe.
 */
function probeKey<T>(editor: LexicalEditor, command: LexicalCommand<T>, payload: T): boolean {
  let declined = false
  const unregister = editor.registerCommand(
    command,
    () => {
      declined = true
      return true
    },
    COMMAND_PRIORITY_NORMAL,
  )
  editor.dispatchCommand(command, payload)
  unregister()
  return !declined
}

// Probed one command at a time rather than through a shared array, because the
// four do not agree on their payload type: ENTER carries `KeyboardEvent | null`
// while the arrows and ESCAPE carry `KeyboardEvent`. Lexical 0.49 made
// `LexicalCommand<T>` INVARIANT in T — 0.48's `{ type?: string }` was structurally
// identical for every payload, so no single element type ever had to hold them
// all. Inferring T per call site keeps each pairing exact and needs no cast.
const PROBES: Array<[string, (editor: LexicalEditor) => boolean]> = [
  ['ArrowDown', (e) => probeKey(e, KEY_ARROW_DOWN_COMMAND, key('ArrowDown'))],
  ['ArrowUp', (e) => probeKey(e, KEY_ARROW_UP_COMMAND, key('ArrowUp'))],
  ['Enter', (e) => probeKey(e, KEY_ENTER_COMMAND, key('Enter'))],
  ['Escape', (e) => probeKey(e, KEY_ESCAPE_COMMAND, key('Escape'))],
]

interface Case {
  /** Plugin under test. */
  plugin: () => MarkdownPlugin
  /** Text whose commit opens the surface (its query must match something). */
  open: string
  /** Text whose commit closes it again (breaks the trigger's end-anchored match). */
  close: string
  /** A live trigger whose query matches NOTHING — no surface, so no claim. */
  barren: string
  /** CSS selector for the plugin's live overlay root. */
  root: string
  /** Extra settle time after a commit (the wikilink search is debounced). */
  settleMs: number
}

const CASES: Record<string, Case> = {
  slash: {
    plugin: () => slashPlugin(),
    open: ' /he',
    close: ' ',
    barren: ' /zzzz',
    root: '[data-scope="md-slash"][data-part="root"]',
    settleMs: 0,
  },
  mention: {
    plugin: () => mentionPlugin(),
    open: ' @fr',
    close: ' ',
    barren: ' @zzzz',
    root: '[data-scope="md-slash"][data-part="root"]',
    settleMs: 0,
  },
  // `search` is what arms wikilink's typeahead at all; without it the plugin
  // registers no key handlers and the probe would pass vacuously. It answers for
  // every query except the barren one, which is what makes that case a real
  // "trigger live, nothing on screen".
  wikilink: {
    plugin: () =>
      wikilinkPlugin({ search: (q) => (q.startsWith('zzz') ? [] : [{ target: 'Home' }]) }),
    open: ' [[ho',
    close: ']',
    barren: ' [[zzzz',
    root: '[data-scope="md-wikilink"][data-part="panel-root"]',
    settleMs: 200,
  },
}

describe.each(Object.entries(CASES))('%s typeahead — key handlers follow the surface', (_, cs) => {
  /** Open the surface from a clean document, and prove it really is up. Only the
   * OPENING needs `settleMs` — a reset or a broken trigger hides synchronously
   * (and cancels wikilink's pending search) on the commit itself. */
  async function open(editor: LexicalEditor): Promise<void> {
    reset(editor)
    type(editor, cs.open)
    await wait(cs.settleMs)
    expect(document.querySelector(cs.root)).not.toBeNull()
  }

  it('is inert with no surface up, captures while it is, and goes inert again', async () => {
    const editor = await mountWith(cs.plugin())

    for (const [name, probe] of PROBES) {
      // No trigger at all: every key must fall through to Lexical's own handling.
      reset(editor)
      await wait(0)
      expect([name, 'no trigger', probe(editor)]).toEqual([name, 'no trigger', false])

      // Surface up: the menu owns the key.
      await open(editor)
      expect([name, 'surface up', probe(editor)]).toEqual([name, 'surface up', true])

      // The query is gone. A gate that stopped tracking would leave the handlers
      // armed here and swallow Enter for the rest of the session.
      await open(editor)
      type(editor, cs.close)
      await wait(0)
      expect(document.querySelector(cs.root)).toBeNull()
      expect([name, 'query closed', probe(editor)]).toEqual([name, 'query closed', false])
    }
    // A real editor mount plus twelve open/close rounds — and wikilink's search
    // is debounced, so its rounds each wait one debounce window. Comfortably
    // inside this budget standalone; the allowance is for a loaded CI box.
  }, 30_000)

  it('claims nothing while the trigger is live but the query matches nothing', async () => {
    const editor = await mountWith(cs.plugin())
    reset(editor)
    type(editor, cs.barren)
    await wait(cs.settleMs)

    // The trigger IS live — this is the state the pre-#130 cached gate read as
    // "active" — and yet there is nothing on screen to drive.
    expect(document.querySelector(cs.root)).toBeNull()
    for (const [name, probe] of PROBES) {
      expect([name, probe(editor)]).toEqual([name, false])
    }
  }, 15_000)
})
