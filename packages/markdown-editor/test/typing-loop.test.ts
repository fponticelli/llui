import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp } from '@llui/dom'
import { $getRoot, $getSelection, $isRangeSelection, type LexicalEditor } from 'lexical'
import { markdownEditor } from '../src/editor.js'

let container: HTMLElement
let app: ReturnType<typeof mountApp> | null = null

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  app?.dispose()
  app = null
  document.body.innerHTML = ''
})

const yieldToLoop = () => new Promise((r) => setTimeout(r, 0))

// Type `text` one character at a time, yielding to the event loop between keys
// like a real user (separate input events). Each keystroke is its own committed
// update, exercising the per-commit markdown-shortcut update listener.
async function type(editor: LexicalEditor, text: string): Promise<void> {
  for (const ch of text) {
    editor.update(
      () => {
        const root = $getRoot()
        let sel = $getSelection()
        if (!$isRangeSelection(sel)) sel = root.selectEnd()
        if ($isRangeSelection(sel)) sel.insertText(ch)
      },
      { discrete: true },
    )
    await yieldToLoop()
  }
}

// 480 sequential keystrokes, each its own mounted-editor commit with a macrotask
// yield after it, so the wall time is dominated by the scheduler rather than by
// anything this test measures. It sits close enough to vitest's 5s default that
// a loaded machine — the whole workspace running concurrently — tips it over,
// and the list work added ~35 more mount-based tests to this package. The
// timeout is explicit so a slow machine reports a slow test rather than a
// failure that reads like a regression in the typing loop.
describe(
  'issue #44: typing long prose does not trip Lexical’s enqueue guard',
  { timeout: 30_000 },
  () => {
    it('types ~480 chars of continuous prose without error', async () => {
      let editor!: LexicalEditor
      let onError: unknown = null
      app = mountApp(
        container,
        markdownEditor({
          defaultValue: '',
          onReady: (e) => {
            editor = e
          },
          onChange: () => {},
        }),
      )
      // Capture anything Lexical routes to the editor's error/warn hooks.
      const ed = editor as unknown as {
        _onError?: (e: unknown) => void
        _onWarn?: (e: unknown) => void
        _cascadeCount: number
      }
      const origErr = ed._onError?.bind(ed)
      ed._onError = (e: unknown) => {
        onError = e
        origErr?.(e)
      }
      ed._onWarn = (e: unknown) => {
        onError = e
      }

      const sentence =
        'The ancient citadel loomed over the valley, its spires catching the last light. '
      await type(editor, sentence.repeat(6)) // ~480 chars, well past the ~160 in the report

      expect(onError).toBeNull()
      expect(ed._cascadeCount).toBeLessThan(20)
      expect(container.textContent).toContain('citadel')
    })
  },
)
