// Issue #74 — the EMIT ORDERING CONTRACT, checked against the six shipped
// plugins rather than argued from a reading of their reducers.
//
// Before the shared commit hub each plugin owned its own `registerUpdateListener`,
// so one commit ran interleaved: A-refresh → A-emit → B-refresh → B-emit. Plugin
// A's overlay had already reconciled by the time plugin B measured. The hub
// batches instead — every subscriber refreshes inside the one shared read, then
// every emission drains in order (the contract itself is pinned in
// `@llui/lexical`'s `commit.test.ts`).
//
// A plugin can only NOTICE the difference through the editor: `refresh` reads the
// shared facts and its own closure, nothing else. So the two orders are
// observationally equivalent exactly while both of these hold, neither of which
// the types enforce:
//
//   1. Nothing a plugin emits DURING a commit carries an effect — so nothing
//      reached from the drain can write into the document under a measurement
//      another plugin has already taken.
//   2. Every commit-driven overlay is portaled OUT of the editor's root and
//      positioned `fixed` — so reconciling one cannot move the editor's layout
//      either.
//
// Both are pinned below. A seventh plugin (or a change to one of these six) that
// breaks either has to decide deliberately whether interleaving must come back
// for it, instead of finding out from a misplaced overlay.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { $getRoot, type LexicalEditor } from 'lexical'
import { mountApp } from '@llui/dom'
import { markdownEditor } from '../src/editor.js'
import { corePlugin } from '../src/plugins/core.js'
import { codeLanguagePlugin } from '../src/plugins/code-language.js'
import { floatingToolbarPlugin } from '../src/plugins/floating-toolbar.js'
import { mentionPlugin } from '../src/plugins/mention.js'
import { slashPlugin } from '../src/plugins/slash.js'
import { tablePlugin } from '../src/plugins/table.js'
import { wikilinkPlugin } from '../src/plugins/wikilink.js'
import type { MarkdownPlugin } from '../src/plugins/types.js'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const DOC = [
  'Some prose here',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '```ts',
  'const a = 1',
  '```',
  '',
].join('\n')

/** The six overlay plugins issue #74 is about, in editor order. */
const overlayPlugins = (): MarkdownPlugin[] => [
  codeLanguagePlugin(),
  floatingToolbarPlugin(),
  tablePlugin(),
  slashPlugin(),
  mentionPlugin(),
  wikilinkPlugin({ search: () => [] }),
]

let container: HTMLElement
const mounted: Array<ReturnType<typeof mountApp>> = []

// jsdom ships no `Range.prototype.getBoundingClientRect` (every browser does),
// and this is the first test to drive the caret-anchored plugins through their
// real `register` path rather than their reducers. Install a zero rect for the
// duration and take it back out, so the gap never leaks into another file.
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

async function mountWith(plugins: MarkdownPlugin[]): Promise<LexicalEditor> {
  let editor!: LexicalEditor
  mounted.push(
    mountApp(
      container,
      markdownEditor({
        plugins: [corePlugin(), ...plugins],
        defaultValue: DOC,
        onReady: (e) => {
          editor = e
        },
      }),
    ),
  )
  await wait(0)
  return editor
}

/** Put the caret at the end of the first text node containing `needle`. */
const caretAfter = (editor: LexicalEditor, needle: string) => (): void => {
  editor.update(
    () => {
      const node = $getRoot()
        .getAllTextNodes()
        .find((n) => n.getTextContent().includes(needle))
      node?.selectEnd()
    },
    { discrete: true },
  )
}

/** One caret move per surface the six anchor to. */
const caretTour = (editor: LexicalEditor): Array<[string, () => void]> => [
  ['prose', caretAfter(editor, 'prose')],
  ['table cell', caretAfter(editor, '1')],
  ['code block', caretAfter(editor, 'const a = 1')],
  ['back to prose', caretAfter(editor, 'prose')],
]

describe('#74 batched emit ordering, verified against the six shipped plugins', () => {
  it('carries no effect on any message the six emit during a commit', async () => {
    // Capture what each plugin ACTUALLY emits from inside a commit — wrapping the
    // `ctx.emit` its `register` receives, which is the plugin contract and not an
    // internal — then replay those messages through the same plugin's reducer, in
    // order, from its own initial state.
    //
    // "No effect at all" is deliberately stricter than "no effect that writes to
    // the editor": every plugin effect handler here reaches for `ctx.editor()`, so
    // a new one is a write until proven otherwise, and it should have to be
    // argued rather than discovered.
    const emitted = new Map<string, unknown[]>()
    const spied = overlayPlugins().map((plugin): MarkdownPlugin => {
      const inner = plugin.register
      if (!inner) return plugin
      return {
        ...plugin,
        register: (editor, ctx) =>
          inner(editor, {
            ...ctx,
            emit: (msg) => {
              // Only this plugin's own UI messages are its reducer's business;
              // `runCommand` and friends are host messages by design.
              if (msg.type === 'plugin' && msg.name === plugin.name) {
                const list = emitted.get(plugin.name)
                if (list) list.push(msg.msg)
                else emitted.set(plugin.name, [msg.msg])
              }
              ctx.emit(msg)
            },
          }),
      }
    })

    const editor = await mountWith(spied)
    for (const [, move] of caretTour(editor)) move()
    await wait(0)

    // Non-vacuity: the tour really did drive several plugins, not zero.
    expect(emitted.size).toBeGreaterThanOrEqual(3)

    for (const plugin of spied) {
      const messages = emitted.get(plugin.name) ?? []
      const reduce = plugin.ui?.update
      if (messages.length === 0 || !reduce) continue
      let state = plugin.ui?.init()
      for (const msg of messages) {
        const result = reduce(state, msg)
        expect([plugin.name, Array.isArray(result)]).toEqual([plugin.name, false])
        state = result
      }
    }
  })

  it('never writes back into the editor from a commit-time emission', async () => {
    // The same property observed from the other end: a caret move is ONE
    // `editor.update`, and a reducer or effect reached from the drain that dirtied
    // the document would make it two.
    //
    // Caret moves only, on purpose. A commit that changes TEXT also runs
    // `@lexical/markdown`'s shortcut listener, which legitimately writes back —
    // that is a Lexical update listener of core's, not a plugin emission, and
    // counting it here would make the assertion about the wrong thing.
    const editor = await mountWith(overlayPlugins())
    for (const [what, move] of caretTour(editor)) {
      expect([what, countUpdates(editor, move)]).toEqual([what, 1])
    }
  })

  it('renders every commit-driven overlay outside the editor root, positioned fixed', async () => {
    const editor = await mountWith(overlayPlugins())
    // Park the caret in the fenced block: element-anchored, so the badge opens
    // even in jsdom (where every rect is zero-sized and the selection-anchored
    // bubble correctly declines to show).
    caretAfter(editor, 'const a = 1')()
    await wait(0)

    const root = editor.getRootElement()
    expect(root).not.toBeNull()
    // `data-llui-nested-layer` is stamped on every `overlayRoot` positioned div,
    // so this finds the live overlays without naming each plugin's scope.
    const overlays = Array.from(document.querySelectorAll('[data-llui-nested-layer]'))
    // Non-vacuity: at least one plugin really did open a surface for this commit.
    expect(overlays.length).toBeGreaterThan(0)
    for (const el of overlays) {
      expect(root?.contains(el)).toBe(false)
      expect(el.getAttribute('style') ?? '').toContain('position:fixed')
    }
  })
})

/**
 * Run `fn` and count how many `editor.update` calls happened, including any
 * raised re-entrantly from the commit's own listeners. Shadowing the instance
 * method catches a nested write whoever made it; deleting the own property
 * restores the prototype one.
 */
function countUpdates(editor: LexicalEditor, fn: () => void): number {
  type Update = LexicalEditor['update']
  let calls = 0
  const original: Update = editor.update.bind(editor)
  const counted: Update = (updateFn, options) => {
    calls++
    return original(updateFn, options)
  }
  editor.update = counted
  try {
    fn()
  } finally {
    Reflect.deleteProperty(editor, 'update')
  }
  return calls
}
