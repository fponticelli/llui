import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp, div, input, text } from '@llui/dom'
import type { ComponentDef } from '@llui/dom'
import { init, update, connect, overlay } from '../../src/components/combobox'
import type { ComboboxState, ComboboxMsg } from '../../src/components/combobox'

type Ctx = { c: ComboboxState }
void text

describe('combobox.overlay integration', () => {
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

  function makeApp(initialOpen = false): { send: (m: ComboboxMsg) => void } {
    let sendRef!: (m: ComboboxMsg) => void
    const initial = init({ items: ['apple', 'banana'] })
    if (initialOpen) initial.open = true
    const parts = connect<Ctx>(
      (s) => s.c,
      (m) => sendRef(m),
      { id: 'cb' },
    )
    const def: ComponentDef<Ctx, ComboboxMsg, never> = {
      name: 'T',
      init: () => [{ c: initial }, []],
      update: (state, msg) => {
        const [next] = update(state.c, msg)
        return [{ c: next }, []]
      },
      view: ({ send }) => {
        sendRef = send
        return [
          input({ ...parts.input }),
          ...overlay<Ctx>({
            get: (s) => s.c,
            send,
            parts,
            content: () => [div({ ...parts.content }, [])],
          }),
        ]
      },
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    currentApp = mountApp(container, def)
    return { send: (m) => sendRef(m) }
  }

  it('listbox appears when open', async () => {
    makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"]')).not.toBeNull()
  })

  it('outside click closes', async () => {
    makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"]')).toBeNull()
  })
})
