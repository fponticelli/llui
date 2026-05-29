import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { component, mountApp, button, div, text } from '@llui/dom/signals'
import { init, update, connect, overlay } from '../../src/components/select'
import type { SelectState, SelectMsg } from '../../src/components/select'

type Ctx = { s: SelectState }

describe('select.overlay integration', () => {
  let currentApp: ReturnType<typeof mountApp> | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    if (currentApp) {
      currentApp.dispose()
      currentApp = null
    }
    document.body.innerHTML = ''
  })

  function makeApp(initialOpen = false): { send: (m: SelectMsg) => void } {
    let sendRef!: (m: SelectMsg) => void
    const initial = init({ items: ['a', 'b'] })
    if (initialOpen) initial.open = true
    const def = component<Ctx, SelectMsg, never>({
      name: 'T',
      init: () => [{ s: initial }, []],
      update: (state, msg) => {
        const [next] = update(state.s, msg)
        return [{ s: next }, []]
      },
      view: ({ state, send }) => {
        sendRef = send
        const parts = connect(state.at('s'), send, { id: 'sel' })
        return [
          button({ ...parts.trigger }, [text('Select')]),
          overlay({
            state: state.at('s'),
            send,
            parts,
            content: () => [div({ ...parts.content }, [])],
          }),
        ]
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    currentApp = mountApp(container, def)
    return { send: (m) => sendRef(m) }
  }

  it('listbox appears when open', async () => {
    makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    const listbox = document.querySelector('[data-part="content"]')
    expect(listbox).not.toBeNull()
    expect(listbox?.getAttribute('role')).toBe('listbox')
  })

  it('Esc closes', async () => {
    makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"]')).toBeNull()
  })
})
