// The guard for the one BEHAVIOURAL change issue #74 made inside a plugin.
//
// Before the commit hub, the slash / mention / wikilink key handlers each asked
// the editor directly — `editor.getEditorState().read($readQuery) !== null` — on
// every ArrowUp/ArrowDown/Enter/Escape. They now read `liveQuery`, a plain value
// captured by that plugin's `onCommit` refresh, and the two are only equivalent
// because a keydown is dispatched BEFORE the commit it causes, so the last
// commit's query is what a fresh read would return.
//
// That premise is stated as a comment in three plugins and enforced by nothing,
// and the rest of the suite cannot see it: every other slash/mention/wikilink
// test drives the reducers and views through `send`, never the
// register → commit → key-handler path. Replacing all three `isActive`
// implementations with `() => false` leaves the whole suite green.
//
// So this file drives exactly that path, through the real editor, and pins both
// directions of the gate:
//
//   • BEFORE the query commits, the handler must be INERT — it returns false so
//     the keystroke falls through to Lexical (ArrowDown moves the caret, Enter
//     splits the block). An `isActive` stuck open swallows all four keys.
//   • AFTER the query commits, the handler must CAPTURE — returning true is what
//     drives the menu and suppresses the default. An `isActive` stuck closed
//     (the mutation above) makes the menu unnavigable.
//   • After a commit that CLOSES the query it must be inert again — the case a
//     cached value gets wrong if the refresh ever stops writing it.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
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

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.dispose()
  document.body.innerHTML = ''
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

/**
 * The four keys every typeahead gates on `isActive()`, and whether the typeahead
 * CAPTURED each one.
 *
 * Not `dispatchCommand`'s return value: rich-text also handles Enter (it splits
 * the block) and answers true whenever there is a selection at all, so that
 * return value says "somebody handled it", not "the typeahead did". Instead a
 * sentinel is registered at `COMMAND_PRIORITY_NORMAL`, strictly below the
 * typeaheads' `COMMAND_PRIORITY_HIGH` and strictly above rich-text's `EDITOR`:
 * reaching the sentinel means the typeahead declined. It returns true so the
 * probe never lets a keystroke edit the document out from under the next probe.
 */
function keyVerdicts(editor: LexicalEditor): Record<string, boolean> {
  const keys: Array<[string, LexicalCommand<KeyboardEvent | null>]> = [
    ['ArrowDown', KEY_ARROW_DOWN_COMMAND],
    ['ArrowUp', KEY_ARROW_UP_COMMAND],
    ['Enter', KEY_ENTER_COMMAND],
    ['Escape', KEY_ESCAPE_COMMAND],
  ]
  const out: Record<string, boolean> = {}
  for (const [name, command] of keys) {
    let declined = false
    const unregister = editor.registerCommand(
      command,
      () => {
        declined = true
        return true
      },
      COMMAND_PRIORITY_NORMAL,
    )
    // A real KeyboardEvent: the handlers call `preventDefault()` on capture, and
    // passing null would hide a handler that forgot to guard the optional.
    editor.dispatchCommand(command, new KeyboardEvent('keydown', { key: name }))
    unregister()
    out[name] = !declined
  }
  return out
}

const INERT = { ArrowDown: false, ArrowUp: false, Enter: false, Escape: false }
const CAPTURED = { ArrowDown: true, ArrowUp: true, Enter: true, Escape: true }

interface Case {
  /** Plugin under test. */
  plugin: () => MarkdownPlugin
  /** Text whose commit opens the typeahead. */
  open: string
  /** Text whose commit closes it again (breaks the trigger's end-anchored match). */
  close: string
}

const CASES: Record<string, Case> = {
  slash: { plugin: () => slashPlugin(), open: ' /he', close: ' ' },
  mention: { plugin: () => mentionPlugin(), open: ' @he', close: ' ' },
  // `search` is what arms wikilink's typeahead at all; without it the plugin
  // registers no key handlers and the probe would pass vacuously.
  wikilink: {
    plugin: () => wikilinkPlugin({ search: () => [{ target: 'Home', label: 'Home' }] }),
    open: ' [[he',
    close: ']',
  },
}

describe.each(Object.entries(CASES))('%s typeahead — key handlers follow the commit', (_, cs) => {
  it('is inert before the query commits, captures after, and goes inert again', async () => {
    const editor = await mountWith(cs.plugin())

    // No query yet: every key must fall through to Lexical's own handling.
    expect(keyVerdicts(editor)).toEqual(INERT)

    type(editor, cs.open)
    // The commit has run its `onCommit` refresh, so the cached query is live and
    // the menu owns the four keys.
    expect(keyVerdicts(editor)).toEqual(CAPTURED)

    type(editor, cs.close)
    // The query is gone. A cached value that stopped tracking the document would
    // leave the handlers armed here and swallow Enter for the rest of the session.
    expect(keyVerdicts(editor)).toEqual(INERT)
  })
})
