import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp, button, div, text } from '@llui/dom'
import type { ComponentDef } from '@llui/dom'
import { init, update, connect, overlay } from '../../src/components/menu'
import type { MenuState, MenuMsg } from '../../src/components/menu'

type Ctx = { m: MenuState }

describe('menu.overlay integration', () => {
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

  function makeApp(initialOpen = false): { send: (m: MenuMsg) => void } {
    let sendRef!: (m: MenuMsg) => void
    const parts = connect<Ctx>(
      (s) => s.m,
      (m) => sendRef(m),
      { id: 'mn' },
    )
    const def: ComponentDef<Ctx, MenuMsg, never> = {
      name: 'T',
      init: () => [{ m: init({ items: ['a', 'b', 'c'], open: initialOpen }) }, []],
      update: (state, msg) => {
        const [next] = update(state.m, msg)
        return [{ m: next }, []]
      },
      view: ({ send }) => {
        sendRef = send
        return [
          button({ ...parts.trigger }, [text('Menu')]),
          ...overlay<Ctx>({
            get: (s) => s.m,
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

  it('content not present when closed', () => {
    makeApp(false)
    expect(document.querySelector('[data-part="content"]')).toBeNull()
  })

  it('opens into body portal', async () => {
    makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    const content = document.querySelector('[data-part="content"]')
    expect(content).not.toBeNull()
    expect(content?.getAttribute('role')).toBe('menu')
  })

  it('focuses content on open', async () => {
    makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    const content = document.querySelector('[data-part="content"]') as HTMLElement
    expect(document.activeElement).toBe(content)
  })

  it('Esc closes', async () => {
    makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"]')).toBeNull()
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
