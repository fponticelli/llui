import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { component, mountApp, type Signal } from '@llui/dom'
import { $getRoot, $createParagraphNode, $createTextNode, type LexicalEditor } from 'lexical'
import { lexicalForeign } from '../src/foreign.js'
import { waitFor } from './wait-for'

interface AppState {
  value: string
  readonly: boolean
}
type AppMsg = { type: 'set'; value: string } | { type: 'setReadOnly'; readonly: boolean }

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
      init: () => ({ value: '', readonly: false }),
      update: (s, m) =>
        m.type === 'set' ? { ...s, value: m.value } : { ...s, readonly: m.readonly },
      view: ({ state }) => [
        lexicalForeign({
          namespace: 'uncontrolled',
          readonly: state.at('readonly'),
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
    await waitFor(() => changes.at(-1) === 'world')
    expect(changes.at(-1)).toBe('world')
  })

  it('toggles editability reactively from the readonly signal', async () => {
    let editor!: LexicalEditor
    const def = component<AppState, AppMsg, never>({
      name: 'ReadOnly',
      init: () => ({ value: '', readonly: true }),
      update: (s, m) =>
        m.type === 'set' ? { ...s, value: m.value } : { ...s, readonly: m.readonly },
      view: ({ state }) => [
        lexicalForeign({
          namespace: 'ro',
          readonly: state.at('readonly'),
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

    app.send({ type: 'setReadOnly', readonly: false })
    await wait(0)
    expect(editor.isEditable()).toBe(true)
  })
})

describe('lexicalForeign (seam options for external doc ownership)', () => {
  it('history: false suppresses the built-in undo stack (canUndo stays false)', async () => {
    let editor!: LexicalEditor
    let lastCanUndo = false
    const def = component<AppState, AppMsg, never>({
      name: 'NoHistory',
      init: () => ({ value: '', readonly: false }),
      update: (s, m) =>
        m.type === 'set' ? { ...s, value: m.value } : { ...s, readonly: m.readonly },
      view: ({ state }) => [
        lexicalForeign({
          namespace: 'no-history',
          readonly: state.at('readonly'),
          serialize,
          deserialize,
          defaultValue: 'seed',
          history: false,
          onReady: (e) => {
            editor = e
          },
          onSelectionChange: (ctx) => {
            lastCanUndo = ctx.canUndo
          },
        }),
      ],
    })
    app = mountApp(container, def)
    // An edit that WOULD push an undo entry if history were registered.
    editor.update(() => {
      $getRoot()
        .clear()
        .append($createParagraphNode().append($createTextNode('edited')))
    })
    await wait(0)
    expect(lastCanUndo).toBe(false)
  })

  it('default (history on) reports canUndo after an edit', async () => {
    let editor!: LexicalEditor
    let lastCanUndo = false
    const def = component<AppState, AppMsg, never>({
      name: 'History',
      init: () => ({ value: '', readonly: false }),
      update: (s, m) =>
        m.type === 'set' ? { ...s, value: m.value } : { ...s, readonly: m.readonly },
      view: ({ state }) => [
        lexicalForeign({
          namespace: 'with-history',
          readonly: state.at('readonly'),
          serialize,
          deserialize,
          defaultValue: 'seed',
          onReady: (e) => {
            editor = e
          },
          onSelectionChange: (ctx) => {
            lastCanUndo = ctx.canUndo
          },
        }),
      ],
    })
    app = mountApp(container, def)
    editor.update(() => {
      $getRoot()
        .clear()
        .append($createParagraphNode().append($createTextNode('edited')))
    })
    await wait(0)
    expect(lastCanUndo).toBe(true)
  })

  it("seedMode: 'deferred' skips the boot-time seed (external owner controls it)", async () => {
    let deserializeCalls = 0
    const trackingDeserialize = (e: LexicalEditor, v: string): void => {
      deserializeCalls++
      deserialize(e, v)
    }
    const def = component<AppState, AppMsg, never>({
      name: 'Deferred',
      init: () => ({ value: '', readonly: false }),
      update: (s, m) =>
        m.type === 'set' ? { ...s, value: m.value } : { ...s, readonly: m.readonly },
      view: ({ state }) => [
        lexicalForeign({
          namespace: 'deferred',
          readonly: state.at('readonly'),
          serialize,
          deserialize: trackingDeserialize,
          defaultValue: 'should-not-appear',
          seedMode: 'deferred',
        }),
      ],
    })
    app = mountApp(container, def)
    expect(deserializeCalls).toBe(0)
    expect(container.textContent).not.toContain('should-not-appear')
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
      init: () => ({ value: 'start', readonly: false }),
      update: (s, m) =>
        m.type === 'set' ? { ...s, value: m.value } : { ...s, readonly: m.readonly },
      view: ({ state }) => [
        lexicalForeign({
          namespace: 'controlled',
          readonly: state.at('readonly'),
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
    await waitFor(() => changes.at(-1) === 'typed')
    expect(changes.at(-1)).toBe('typed')
    const callsBeforeEcho = deserializeCalls
    app.send({ type: 'set', value: 'typed' }) // mirror the emission back into state
    await wait(0)
    expect(deserializeCalls).toBe(callsBeforeEcho) // echo suppressed
  })
})

describe('lexicalForeign — external undo owner (collab) forces history off', () => {
  function mountWith(opts: {
    externalUndo?: (e: LexicalEditor) => () => void
    history?: boolean
  }): ReturnType<typeof mountApp> {
    const def = component<AppState, AppMsg, never>({
      name: 'ExternalUndo',
      init: () => ({ value: '', readonly: false }),
      update: (s) => s,
      view: ({ state }) => [
        lexicalForeign({
          namespace: 'external-undo',
          readonly: state.at('readonly'),
          serialize,
          deserialize,
          defaultValue: 'x',
          ...(opts.externalUndo ? { externalUndo: opts.externalUndo } : {}),
          ...(opts.history !== undefined ? { history: opts.history } : {}),
        }),
      ],
    })
    return mountApp(container, def)
  }

  it('registers the externalUndo owner and disposes it on unmount', async () => {
    let registered = false
    let disposed = false
    app = mountWith({
      externalUndo: () => {
        registered = true
        return () => {
          disposed = true
        }
      },
    })
    await wait(10)
    expect(registered).toBe(true)
    app.dispose()
    app = null
    expect(disposed).toBe(true)
  })

  it('reports the misconfiguration when externalUndo is combined with history:true', async () => {
    const errors: string[] = []
    const orig = console.error
    console.error = (...a: unknown[]) => errors.push(a.map(String).join(' '))
    try {
      app = mountWith({ externalUndo: () => () => {}, history: true })
      await wait(10)
    } finally {
      console.error = orig
    }
    expect(errors.some((e) => /externalUndo/.test(e) && /history/.test(e))).toBe(true)
  })
})
