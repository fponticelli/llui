import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp, div, text, type Signal } from '@llui/dom'
import type { LexicalEditor } from 'lexical'
import { markdownEditor } from '../src/editor.js'
import { corePlugin } from '../src/plugins/core.js'
import { linkPlugin } from '../src/plugins/link.js'
import { definePluginUI } from '../src/plugins/ui.js'
import type { MarkdownPlugin } from '../src/plugins/types.js'

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

interface CounterState {
  count: number
  lastEditorSeen: boolean
}
type CounterMsg = { type: 'inc' } | { type: 'probeEditor' } | { type: 'sawEditor' }
type CounterEffect = { type: 'checkEditor' }

/** A toy plugin exercising state slice + view + effect (with editor access). */
function counterPlugin(): MarkdownPlugin {
  return {
    name: 'counter',
    ui: definePluginUI<CounterState, CounterMsg, CounterEffect>({
      init: () => ({ count: 0, lastEditorSeen: false }),
      update: (state, msg) => {
        if (msg.type === 'inc') return { ...state, count: state.count + 1 }
        if (msg.type === 'probeEditor') return [state, [{ type: 'checkEditor' }]]
        if (msg.type === 'sawEditor') return { ...state, lastEditorSeen: true }
        return state
      },
      view: ({ state }) => [
        div({ 'data-test-counter': '' }, [text(state.at('count') as Signal<number>)]),
      ],
      onEffect: (_effect, ctx) => {
        if (ctx.editor()) ctx.send({ type: 'sawEditor' })
      },
    }),
  }
}

describe('plugin UI extensions', () => {
  it('mounts a plugin view and routes messages to its slice', async () => {
    app = mountApp(
      container,
      markdownEditor({ plugins: [corePlugin(), counterPlugin()], defaultValue: 'hi' }),
    )
    // The plugin's view rendered, seeded from its own init().
    const node = container.querySelector('[data-test-counter]')
    expect(node).not.toBeNull()
    expect(node?.textContent).toBe('0')

    // A plugin-routed message updates only that plugin's slice + view.
    app.send({ type: 'plugin', name: 'counter', msg: { type: 'inc' } })
    app.send({ type: 'plugin', name: 'counter', msg: { type: 'inc' } })
    await wait(0)
    expect(container.querySelector('[data-test-counter]')?.textContent).toBe('2')
    const state = app.getState() as { plugins: { counter: CounterState } }
    expect(state.plugins.counter.count).toBe(2)
  })

  it('runs a plugin effect with live-editor access', async () => {
    app = mountApp(
      container,
      markdownEditor({ plugins: [corePlugin(), counterPlugin()], defaultValue: 'hi' }),
    )
    app.send({ type: 'plugin', name: 'counter', msg: { type: 'probeEditor' } })
    await wait(0)
    const state = app.getState() as { plugins: { counter: CounterState } }
    expect(state.plugins.counter.lastEditorSeen).toBe(true)
  })

  it('isolates slices: a message to one plugin does not touch another', async () => {
    app = mountApp(
      container,
      markdownEditor({
        plugins: [corePlugin(), counterPlugin(), linkPlugin()],
        defaultValue: 'hi',
      }),
    )
    app.send({ type: 'plugin', name: 'counter', msg: { type: 'inc' } })
    await wait(0)
    const state = app.getState() as {
      plugins: { counter: CounterState; link: { dialog: { open: boolean } } }
    }
    expect(state.plugins.counter.count).toBe(1)
    expect(state.plugins.link.dialog.open).toBe(false)
  })
})

describe('link plugin', () => {
  it('opens its dialog (state + DOM) when the link command runs', async () => {
    let editor!: LexicalEditor
    app = mountApp(
      container,
      markdownEditor({
        plugins: [corePlugin(), linkPlugin()],
        defaultValue: 'some text',
        onReady: (e) => {
          editor = e
        },
      }),
    )
    expect(editor).toBeDefined()
    // Open via the command intent (toolbar/handle path).
    app.send({ type: 'runCommand', id: 'link' })
    await wait(0)
    const state = app.getState() as { plugins: { link: { dialog: { open: boolean } } } }
    expect(state.plugins.link.dialog.open).toBe(true)
    expect(document.querySelector('[data-md-link="box"]')).not.toBeNull()
  })
})
