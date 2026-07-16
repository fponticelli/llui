import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { waitFor } from './wait-for'
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
    // wait for the debounced onChange itself, not a fixed delay (load-proof)
    await waitFor(() => changes.at(-1) === 'hello world')
    expect(changes.at(-1)).toBe('hello world')
  })

  it('flushes the final edit to onChange when unmounted within the debounce window', () => {
    // Regression: the component's dispose marks the TEA loop disposed BEFORE the
    // foreign unmount's flush runs, so a flush that routed onChange through `send`
    // was dropped — the last debounce window of typing was lost on unmount.
    // Consumer delivery must be independent of the loop being alive.
    let editor!: LexicalEditor
    const changes: string[] = []
    app = mountApp(
      container,
      markdownEditor({
        defaultValue: 'seed',
        changeDebounceMs: 1000, // long: the timer would NOT fire on its own
        onReady: (e) => {
          editor = e
        },
        onChange: (md) => changes.push(md),
      }),
    )
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append($createParagraphNode().append($createTextNode('final text')))
      },
      { discrete: true },
    )
    expect(changes).not.toContain('final text') // still inside the debounce window
    app.dispose()
    app = null
    // The dispose-time flush delivered the final text to the consumer directly.
    expect(changes).toContain('final text')
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

  it('routes effects to each mount’s OWN editor (per-mount, no cross-wiring)', async () => {
    const c1 = document.createElement('div')
    const c2 = document.createElement('div')
    document.body.append(c1, c2)
    // ONE definition, mounted twice. Each mount's `onReady` fires with its own
    // editor — before the per-mount fix a single def-level ref cross-wired them.
    const editors: LexicalEditor[] = []
    const def = markdownEditor({ defaultValue: 'para', onReady: (e) => editors.push(e) })
    const app1 = mountApp(c1, def)
    const app2 = mountApp(c2, def)
    expect(editors).toHaveLength(2)

    // Put a caret in mount 1's editor and run the h1 command THROUGH mount 1.
    editors[0]!.update(() => $getRoot().getFirstDescendant()?.selectStart(), { discrete: true })
    app1.send({ type: 'runCommand', id: 'h1' })
    await wait(0)

    // Only mount 1's DOM became a heading; mount 2 is untouched.
    expect(c1.querySelector('h1')).not.toBeNull()
    expect(c2.querySelector('h1')).toBeNull()

    // Disposing mount 1 leaves mount 2 fully functional (its ref survives).
    app1.dispose()
    editors[1]!.update(() => $getRoot().getFirstDescendant()?.selectStart(), { discrete: true })
    app2.send({ type: 'runCommand', id: 'h1' })
    await wait(0)
    expect(c2.querySelector('h1')).not.toBeNull()
    app2.dispose()
  })

  it('neutralizes a javascript: link seeded from defaultValue (live XSS guard)', () => {
    // Paren-free scheme so the markdown importer forms a real LinkNode; the global
    // sanitizer transform must unwrap it so no clickable javascript: link renders.
    app = mountApp(container, markdownEditor({ defaultValue: 'a [danger](javascript:evil) link' }))
    expect(container.querySelector('a[href^="javascript"]')).toBeNull()
    expect(container.textContent).toContain('danger')
  })
})
