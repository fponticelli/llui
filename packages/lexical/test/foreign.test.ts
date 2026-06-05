import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { component, mountApp, type Signal } from '@llui/dom'
import { $getRoot, $createParagraphNode, $createTextNode, type LexicalEditor } from 'lexical'
import { lexicalForeign } from '../src/foreign.js'

interface AppState {
  value: string
  readOnly: boolean
}
type AppMsg = { type: 'set'; value: string } | { type: 'setReadOnly'; readOnly: boolean }

function serialize(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => $getRoot().getTextContent())
}

function deserialize(_editor: LexicalEditor, value: string): void {
  const root = $getRoot()
  root.clear()
  root.append($createParagraphNode().append($createTextNode(value)))
}

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

describe('lexicalForeign (uncontrolled)', () => {
  it('seeds the document from defaultValue and emits debounced markdown on edit', async () => {
    let editor!: LexicalEditor
    const changes: string[] = []
    const def = component<AppState, AppMsg, never>({
      name: 'Uncontrolled',
      init: () => ({ value: '', readOnly: false }),
      update: (s, m) =>
        m.type === 'set' ? { ...s, value: m.value } : { ...s, readOnly: m.readOnly },
      view: ({ state }) => [
        lexicalForeign({
          namespace: 'uncontrolled',
          readOnly: state.at('readOnly'),
          serialize,
          deserialize,
          defaultValue: 'hello',
          changeDebounceMs: 10,
          onReady: (e) => {
            editor = e
          },
          onChange: (v) => changes.push(v),
        }),
      ],
    })
    app = mountApp(container, def)

    // The host must be contentEditable (vanilla Lexical does not set this itself;
    // without it the browser shows no caret and ignores typing).
    expect(container.querySelector('[contenteditable="true"]')).not.toBeNull()
    // Seeded content is visible in the contentEditable host.
    expect(container.textContent).toContain('hello')
    // Seeding is programmatic → no outbound emission.
    await wait(30)
    expect(changes).toEqual([])

    // A real edit emits debounced markdown.
    editor.update(() => {
      $getRoot()
        .clear()
        .append($createParagraphNode().append($createTextNode('world')))
    })
    await wait(30)
    expect(changes.at(-1)).toBe('world')
  })

  it('toggles editability reactively from the readOnly signal', async () => {
    let editor!: LexicalEditor
    const def = component<AppState, AppMsg, never>({
      name: 'ReadOnly',
      init: () => ({ value: '', readOnly: true }),
      update: (s, m) =>
        m.type === 'set' ? { ...s, value: m.value } : { ...s, readOnly: m.readOnly },
      view: ({ state }) => [
        lexicalForeign({
          namespace: 'ro',
          readOnly: state.at('readOnly'),
          serialize,
          deserialize,
          defaultValue: 'locked',
          onReady: (e) => {
            editor = e
          },
        }),
      ],
    })
    app = mountApp(container, def)
    expect(editor.isEditable()).toBe(false)
    // The contentEditable attribute is only present when editable.
    expect(container.querySelector('[contenteditable="true"]')).toBeNull()

    app.send({ type: 'setReadOnly', readOnly: false })
    await wait(0)
    expect(editor.isEditable()).toBe(true)
  })
})

describe('lexicalForeign (controlled)', () => {
  it('follows the value signal and suppresses echoes', async () => {
    let editor!: LexicalEditor
    let deserializeCalls = 0
    const changes: string[] = []
    const trackingDeserialize = (e: LexicalEditor, v: string): void => {
      deserializeCalls++
      deserialize(e, v)
    }
    const def = component<AppState, AppMsg, never>({
      name: 'Controlled',
      init: () => ({ value: 'start', readOnly: false }),
      update: (s, m) =>
        m.type === 'set' ? { ...s, value: m.value } : { ...s, readOnly: m.readOnly },
      view: ({ state }) => [
        lexicalForeign({
          namespace: 'controlled',
          readOnly: state.at('readOnly'),
          value: state.at('value') as Signal<string>,
          serialize,
          deserialize: trackingDeserialize,
          changeDebounceMs: 5,
          onReady: (e) => {
            editor = e
          },
          onChange: (v) => changes.push(v),
        }),
      ],
    })
    app = mountApp(container, def)

    // Seeded from controlled value.
    expect(container.textContent).toContain('start')
    const seedCalls = deserializeCalls
    expect(seedCalls).toBeGreaterThanOrEqual(1)

    // A foreign value pushes into the editor.
    app.send({ type: 'set', value: 'external' })
    await wait(0)
    expect(container.textContent).toContain('external')
    expect(deserializeCalls).toBe(seedCalls + 1)

    // An echo (state value === what the editor just emitted) must NOT re-deserialize.
    editor.update(() => {
      $getRoot()
        .clear()
        .append($createParagraphNode().append($createTextNode('typed')))
    })
    await wait(20)
    expect(changes.at(-1)).toBe('typed')
    const callsBeforeEcho = deserializeCalls
    app.send({ type: 'set', value: 'typed' }) // mirror the emission back into state
    await wait(0)
    expect(deserializeCalls).toBe(callsBeforeEcho) // echo suppressed
  })
})
