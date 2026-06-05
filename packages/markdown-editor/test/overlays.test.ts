import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp } from '@llui/dom'
import { markdownEditor } from '../src/editor.js'
import { corePlugin } from '../src/plugins/core.js'
import { linkPlugin } from '../src/plugins/link.js'
import { contextMenuPlugin } from '../src/plugins/context-menu.js'
import { floatingToolbarPlugin } from '../src/plugins/floating-toolbar.js'

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

describe('context menu plugin', () => {
  it('opens at a point, lists items, and closes', async () => {
    app = mountApp(
      container,
      markdownEditor({
        plugins: [corePlugin(), linkPlugin(), contextMenuPlugin()],
        defaultValue: 'x',
      }),
    )
    app.send({
      type: 'plugin',
      name: 'contextMenu',
      msg: {
        type: 'open',
        x: 30,
        y: 40,
        items: [
          { id: 'link', label: 'Link' },
          { id: 'undo', label: 'Undo' },
        ],
      },
    })
    await wait(0)
    const root = document.querySelector(
      '[data-scope="md-context"][data-part="root"]',
    ) as HTMLElement
    expect(root).not.toBeNull()
    expect(root.getAttribute('style')).toContain('left:30px')
    expect(document.querySelectorAll('[data-scope="md-context"][data-part="option"]').length).toBe(
      2,
    )

    app.send({ type: 'plugin', name: 'contextMenu', msg: { type: 'close' } })
    await wait(0)
    expect(document.querySelector('[data-scope="md-context"][data-part="root"]')).toBeNull()
  })
})

describe('floating toolbar plugin', () => {
  it('renders a bubble with active state and runs a command', async () => {
    app = mountApp(
      container,
      markdownEditor({ plugins: [corePlugin(), floatingToolbarPlugin()], defaultValue: 'hello' }),
    )
    app.send({
      type: 'plugin',
      name: 'floatingToolbar',
      msg: {
        type: 'show',
        x: 100,
        y: 50,
        items: [
          { id: 'bold', label: 'Bold', glyph: 'B', active: true },
          { id: 'italic', label: 'Italic', glyph: 'I', active: false },
        ],
      },
    })
    await wait(0)
    const items = [...document.querySelectorAll('[data-scope="md-floating"][data-part="item"]')]
    expect(items).toHaveLength(2)
    expect(items[0]?.hasAttribute('data-active')).toBe(true)
    expect(items[1]?.hasAttribute('data-active')).toBe(false)

    app.send({ type: 'plugin', name: 'floatingToolbar', msg: { type: 'hide' } })
    await wait(0)
    expect(document.querySelector('[data-scope="md-floating"][data-part="bar"]')).toBeNull()
  })
})
