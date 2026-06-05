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

describe('markdownEditor', () => {
  it('seeds the document from defaultValue (markdown → DOM)', () => {
    app = mountApp(container, markdownEditor({ defaultValue: '# Hello' }))
    expect(container.querySelector('h1')?.textContent).toBe('Hello')
  })

  it('emits debounced markdown on edit', async () => {
    let editor!: LexicalEditor
    const changes: string[] = []
    app = mountApp(
      container,
      markdownEditor({
        defaultValue: 'start',
        changeDebounceMs: 10,
        onReady: (e) => {
          editor = e
        },
        onChange: (md) => changes.push(md),
      }),
    )
    editor.update(() => {
      $getRoot()
        .clear()
        .append($createParagraphNode().append($createTextNode('hello world')))
    })
    await wait(30)
    expect(changes.at(-1)).toBe('hello world')
  })

  it('surfaces selection format to component state', async () => {
    let editor!: LexicalEditor
    app = mountApp(
      container,
      markdownEditor({
        defaultValue: 'plain',
        onReady: (e) => {
          editor = e
        },
      }),
    )
    editor.update(
      () => {
        const text = $createTextNode('styled')
        $getRoot().clear().append($createParagraphNode().append(text))
        text.select(0, 6)
        const sel = $getSelection()
        if ($isRangeSelection(sel)) sel.formatText('bold')
      },
      { discrete: true },
    )
    await wait(0)
    const state = app.getState() as { format: { bold: boolean; blockType: string } }
    expect(state.format.bold).toBe(true)
    expect(state.format.blockType).toBe('paragraph')
  })

  it('accepts external markdown via the setValue handle message', async () => {
    app = mountApp(container, markdownEditor({ defaultValue: 'first' }))
    expect(container.querySelector('p')?.textContent).toBe('first')
    app.send({ type: 'setValue', value: '# Pushed In' })
    await wait(0)
    expect(container.querySelector('h1')?.textContent).toBe('Pushed In')
    const state = app.getState() as { value: string }
    expect(state.value).toBe('# Pushed In')
  })

  it('runs a command intent end-to-end (runCommand → execCommand → editor)', async () => {
    let editor!: LexicalEditor
    app = mountApp(
      container,
      markdownEditor({
        defaultValue: 'turn me into a heading',
        onReady: (e) => {
          editor = e
        },
      }),
    )
    // Put a selection in the paragraph, then dispatch the h1 command intent.
    editor.update(
      () => {
        const root = $getRoot()
        const text = root.getFirstDescendant()
        if (text) text.selectStart()
      },
      { discrete: true },
    )
    app.send({ type: 'runCommand', id: 'h1' })
    await wait(0)
    expect(container.querySelector('h1')).not.toBeNull()
    const state = app.getState() as { format: { blockType: string } }
    expect(state.format.blockType).toBe('h1')
  })
})
