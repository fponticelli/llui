import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp } from '@llui/dom'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  $createTextNode,
  type LexicalEditor,
} from 'lexical'
import { markdownEditor } from '../src/editor.js'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

function selectAll(editor: LexicalEditor): void {
  editor.update(
    () => {
      const text = $createTextNode('hello')
      $getRoot().clear().append($createParagraphNode().append(text))
      text.select(0, 5)
    },
    { discrete: true },
  )
}

describe('toolbar surface', () => {
  it('renders grouped toolbar buttons for surfaced items', () => {
    app = mountApp(container, markdownEditor({ defaultValue: 'x', toolbar: true }))
    const root = container.querySelector('[data-scope="md-toolbar"][data-part="root"]')
    expect(root).not.toBeNull()
    expect(container.querySelector('[data-id="bold"]')).not.toBeNull()
    expect(container.querySelector('[data-id="h1"]')).not.toBeNull()
    expect(container.querySelector('[data-id="bulletList"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-part="group"]').length).toBeGreaterThan(1)
  })

  it('clicking a toolbar button runs the command on the editor', async () => {
    let editor!: LexicalEditor
    app = mountApp(
      container,
      markdownEditor({
        defaultValue: 'hello',
        toolbar: true,
        onReady: (e) => {
          editor = e
        },
      }),
    )
    selectAll(editor)
    await wait(0)

    const boldBtn = container.querySelector<HTMLButtonElement>('[data-id="bold"]')!
    boldBtn.click()
    await wait(0)

    const state = app.getState() as { format: { bold: boolean } }
    expect(state.format.bold).toBe(true)
    const isBold = editor.getEditorState().read(() => {
      const sel = $getSelection()
      return $isRangeSelection(sel) ? sel.hasFormat('bold') : false
    })
    expect(isBold).toBe(true)
  })

  it('reflects active state on the button via data-active', async () => {
    let editor!: LexicalEditor
    app = mountApp(
      container,
      markdownEditor({
        defaultValue: 'hello',
        toolbar: true,
        onReady: (e) => {
          editor = e
        },
      }),
    )
    selectAll(editor)
    await wait(0)
    const boldBtn = container.querySelector<HTMLButtonElement>('[data-id="bold"]')!
    expect(boldBtn.hasAttribute('data-active')).toBe(false)
    boldBtn.click()
    await wait(0)
    expect(boldBtn.hasAttribute('data-active')).toBe(true)
    expect(boldBtn.getAttribute('aria-pressed')).toBe('true')
  })
})
