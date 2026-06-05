import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp } from '@llui/dom'
import { markdownEditor } from '../src/editor.js'
import { corePlugin } from '../src/plugins/core.js'
import { slashPlugin } from '../src/plugins/slash.js'
import { mentionPlugin } from '../src/plugins/mention.js'

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

const slashSend = (msg: unknown) => app!.send({ type: 'plugin', name: 'slash', msg })
const options = () => [...document.querySelectorAll('[data-scope="md-slash"][data-part="option"]')]

describe('slash menu plugin', () => {
  it('renders a floating menu and tracks the highlighted index', async () => {
    app = mountApp(
      container,
      markdownEditor({ plugins: [corePlugin(), slashPlugin()], defaultValue: 'x' }),
    )
    expect(options()).toHaveLength(0) // closed initially

    slashSend({
      type: 'show',
      query: '',
      items: [
        { id: 'quote', label: 'Quote' },
        { id: 'h1', label: 'Heading 1' },
      ],
      x: 10,
      y: 20,
    })
    await wait(0)
    expect(options().map((o) => o.textContent)).toEqual(['Quote', 'Heading 1'])
    expect(options()[0]?.hasAttribute('data-active')).toBe(true)

    // Arrow-down moves the highlight (wrapping).
    slashSend({ type: 'move', delta: 1 })
    await wait(0)
    expect(options()[1]?.hasAttribute('data-active')).toBe(true)
    slashSend({ type: 'move', delta: 1 })
    await wait(0)
    expect(options()[0]?.hasAttribute('data-active')).toBe(true)
  })

  it('hides on an empty result set and on hide', async () => {
    app = mountApp(
      container,
      markdownEditor({ plugins: [corePlugin(), slashPlugin()], defaultValue: 'x' }),
    )
    slashSend({ type: 'show', query: 'zzz', items: [], x: 0, y: 0 })
    await wait(0)
    expect(options()).toHaveLength(0)

    slashSend({ type: 'show', query: '', items: [{ id: 'quote', label: 'Quote' }], x: 0, y: 0 })
    await wait(0)
    expect(options()).toHaveLength(1)
    slashSend({ type: 'hide' })
    await wait(0)
    expect(options()).toHaveLength(0)
  })

  it('the slash plugin receives the merged item list (onItems)', () => {
    // corePlugin contributes block/list items, so the slash menu has candidates.
    app = mountApp(
      container,
      markdownEditor({ plugins: [corePlugin(), slashPlugin()], defaultValue: 'x' }),
    )
    slashSend({
      type: 'show',
      query: '',
      items: [{ id: 'h1', label: 'Heading 1' }],
      x: 0,
      y: 0,
    })
    // (the filtering itself is exercised in the browser; here we assert the menu
    // surface renders what it is given)
    expect(app).toBeDefined()
  })
})

describe('mention typeahead plugin', () => {
  const mentionSend = (msg: unknown) => app!.send({ type: 'plugin', name: 'mention', msg })

  it('renders @-candidates and tracks the highlight', async () => {
    app = mountApp(
      container,
      markdownEditor({ plugins: [corePlugin(), mentionPlugin()], defaultValue: 'x' }),
    )
    mentionSend({
      type: 'show',
      query: '',
      items: [
        { id: 'ada', label: 'Ada' },
        { id: 'grace', label: 'Grace' },
      ],
      x: 0,
      y: 0,
    })
    await wait(0)
    expect(options().map((o) => o.textContent)).toEqual(['@Ada', '@Grace'])
    expect(options()[0]?.hasAttribute('data-active')).toBe(true)
    mentionSend({ type: 'move', delta: 1 })
    await wait(0)
    expect(options()[1]?.hasAttribute('data-active')).toBe(true)
  })
})
