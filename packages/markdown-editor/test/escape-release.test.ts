// Issue #130: a dismissed surface must RELEASE the keys it was claiming.
//
// All three typeaheads register KEY_ESCAPE at COMMAND_PRIORITY_HIGH and answer
// `true` to claim it. They used to gate that on a cached query — "the caret is on
// a trigger" — which no dismissal ever clears (dismissing changes no document
// state, so no commit follows, so nothing rewrites the cache). The second Escape
// was therefore swallowed for a menu that was already gone, and a host handler at
// COMMAND_PRIORITY_LOW — majordomo's "move focus out of the editor", a
// surrounding dialog's dismiss — was unreachable with nothing on screen to
// justify it.
//
// Every assertion here goes through the REAL path: a real editor, a real commit,
// the plugin's own `register` handlers, and the surface observed as LIVE DOM
// (the portaled overlay), never as a reducer return value. Two traps this file is
// built around:
//
//   * The menu must be OBSERVED up before Escape is pressed. A test that dismisses
//     a menu that never opened passes for the wrong reason — and in jsdom nothing
//     opens at all unless `Range.prototype.getBoundingClientRect` exists, because
//     the caret measurement throws inside the commit hub, which isolates its
//     subscribers (so the failure is a console line, not a test failure).
//   * "Not consumed" is asserted from a handler registered BELOW the plugins
//     (COMMAND_PRIORITY_LOW — the host's position, and the one the issue names),
//     not from `dispatchCommand`'s return value, which only says somebody handled
//     the key.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  KEY_ESCAPE_COMMAND,
  type LexicalEditor,
} from 'lexical'
import { mountApp } from '@llui/dom'
import { markdownEditor } from '../src/editor.js'
import { corePlugin } from '../src/plugins/core.js'
import { slashPlugin } from '../src/plugins/slash.js'
import { mentionPlugin } from '../src/plugins/mention.js'
import { wikilinkPlugin, type DocCandidate } from '../src/plugins/wikilink.js'
import type { MarkdownPlugin } from '../src/plugins/types.js'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Comfortably past the wikilink search debounce (120ms) plus its promise turn. */
const SEARCH_SETTLE_MS = 200

let container: HTMLElement
const mounted: Array<ReturnType<typeof mountApp>> = []
let rangeRectInstalled = false

beforeEach(() => {
  // jsdom ships no `Range.prototype.getBoundingClientRect`; every browser does.
  // Without it the typeaheads' caret measurement throws and NO overlay ever opens
  // — see the header. Installed per file and taken back out, as in
  // `commit-ordering.test.ts`.
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

async function mountWith(plugin: MarkdownPlugin, value = 'x'): Promise<LexicalEditor> {
  let editor!: LexicalEditor
  mounted.push(
    mountApp(
      container,
      markdownEditor({
        plugins: [corePlugin(), plugin],
        defaultValue: value,
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

/** Is the plugin's portaled overlay live in the document? */
const surfaceUp = (selector: string): boolean => document.querySelector(selector) !== null

/**
 * Dispatch one Escape and report whether it reached a handler at
 * COMMAND_PRIORITY_LOW — i.e. whether the typeahead RELEASED it. That priority is
 * the host's (the issue's motivating case) and sits strictly below the plugins'
 * COMMAND_PRIORITY_HIGH. The probe returns false so the key keeps travelling and
 * nothing about the next probe depends on this one.
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

/** The text before the caret — the trigger the plugin's old gate keyed off. Read
 * from the live editor so "the caret is still on the trigger" is a fact, not an
 * assumption about what the previous step left behind. */
function textBeforeCaret(editor: LexicalEditor): string | null {
  return editor.getEditorState().read(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null
    const node = selection.anchor.getNode()
    return $isTextNode(node) ? node.getTextContent().slice(0, selection.anchor.offset) : null
  })
}

interface Case {
  plugin: () => MarkdownPlugin
  /** Typed to open the surface (must yield at least one result). */
  open: string
  /** Typed after a dismissal — the query changes, so the surface must re-open. */
  more: string
  /** CSS selector for the plugin's live overlay root. */
  root: string
  /** Extra settle time after a commit (the wikilink search is debounced). */
  settleMs: number
}

const CASES: Record<string, Case> = {
  slash: {
    plugin: () => slashPlugin(),
    open: ' /he',
    more: 'a',
    root: '[data-scope="md-slash"][data-part="root"]',
    settleMs: 0,
  },
  mention: {
    plugin: () => mentionPlugin(),
    open: ' @fr',
    more: 'a',
    root: '[data-scope="md-slash"][data-part="root"]',
    settleMs: 0,
  },
  wikilink: {
    plugin: () => wikilinkPlugin({ search: () => [{ target: 'Home' }] }),
    open: ' [[ho',
    more: 'm',
    root: '[data-scope="md-wikilink"][data-part="panel-root"]',
    settleMs: SEARCH_SETTLE_MS,
  },
}

describe.each(Object.entries(CASES))('%s typeahead — Escape after a dismissal', (_, cs) => {
  it('closes on the first Escape, releases the second, and re-opens on the next keystroke', async () => {
    const editor = await mountWith(cs.plugin())
    expect(surfaceUp(cs.root)).toBe(false)

    type(editor, cs.open)
    await wait(cs.settleMs)
    // Non-vacuity: everything below is about a menu that is REALLY on screen.
    expect(surfaceUp(cs.root)).toBe(true)

    // ── The first Escape closes it, and IS consumed ──────────────────────────
    expect(escapeReachesHost(editor)).toBe(false)
    expect(surfaceUp(cs.root)).toBe(false)

    // ── The second Escape is NOT consumed — with the caret still on the trigger
    // (the state the old cached gate stayed latched in), and a host handler at
    // COMMAND_PRIORITY_LOW must receive it.
    expect(textBeforeCaret(editor)).toBe(`x${cs.open}`)
    expect(escapeReachesHost(editor)).toBe(true)
    expect(surfaceUp(cs.root)).toBe(false)

    // ── Re-typing re-opens: a dismissal must not latch the trigger off ───────
    type(editor, cs.more)
    await wait(cs.settleMs)
    expect(surfaceUp(cs.root)).toBe(true)

    // And the re-opened menu owns Escape again.
    expect(escapeReachesHost(editor)).toBe(false)
    expect(surfaceUp(cs.root)).toBe(false)
    // Real mounts + a debounced search: generous, for a loaded CI box.
  }, 15_000)
})

describe('wikilink repoint panel — Escape after a dismissal', () => {
  const PANEL = '[data-scope="md-wikilink"][data-part="panel-root"]'
  const search = (): readonly DocCandidate[] => [{ target: 'Home' }, { target: 'Page' }]

  /** Click the rendered wikilink — the path that opens the repoint panel. The
   * click is a real DOM event, so it travels Lexical's own CLICK_COMMAND. */
  async function clickLink(): Promise<void> {
    const el = document.querySelector('[data-wikilink]')
    expect(el).not.toBeNull()
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    // The panel opens from the host `search` promise, one turn later.
    await wait(0)
  }

  it('closes on the first Escape, releases the second, and re-opens on the next click', async () => {
    const editor = await mountWith(wikilinkPlugin({ search }), 'see [[Page]] here')
    expect(surfaceUp(PANEL)).toBe(false)

    await clickLink()
    // Non-vacuity: the EDIT panel specifically — it carries its own query input,
    // which the caret-driven typing panel never renders.
    expect(surfaceUp(PANEL)).toBe(true)
    expect(document.querySelector('[data-part="edit-input"]')).not.toBeNull()

    // The first Escape closes it and is consumed.
    expect(escapeReachesHost(editor)).toBe(false)
    expect(surfaceUp(PANEL)).toBe(false)

    // The second is released — the caret is sitting on/next to the wikilink, which
    // is exactly the position the old gate could not tell apart from an open panel.
    expect(escapeReachesHost(editor)).toBe(true)

    // Clicking again re-opens it: dismissing must not latch the link off.
    await clickLink()
    expect(surfaceUp(PANEL)).toBe(true)
    expect(escapeReachesHost(editor)).toBe(false)
    expect(surfaceUp(PANEL)).toBe(false)
  }, 15_000)
})
