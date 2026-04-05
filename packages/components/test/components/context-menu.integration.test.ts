import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp, div, text } from '@llui/dom'
import type { ComponentDef } from '@llui/dom'
import { init, update, connect, overlay } from '../../src/components/context-menu'
import type { ContextMenuState, ContextMenuMsg } from '../../src/components/context-menu'

type Ctx = { m: ContextMenuState }

describe('context-menu.overlay integration', () => {
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

  function makeApp(initialOpen = false): { send: (m: ContextMenuMsg) => void } {
    let sendRef!: (m: ContextMenuMsg) => void
    const initial = init({ items: ['copy', 'delete'] })
    if (initialOpen) {
      initial.open = true
      initial.x = 100
      initial.y = 50
      initial.highlighted = 'copy'
    }
    const parts = connect<Ctx>((s) => s.m, (m) => sendRef(m), { id: 'cm' })
    const def: ComponentDef<Ctx, ContextMenuMsg, never> = {
      name: 'T',
      init: () => [{ m: initial }, []],
      update: (state, msg) => {
        const [next] = update(state.m, msg)
        return [{ m: next }, []]
      },
      view: (send) => {
        sendRef = send
        return [
          div({ ...parts.trigger }, [text('Right-click me')]),
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

  it('menu not rendered initially', () => {
    makeApp(false)
    expect(document.querySelector('[data-part="content"]')).toBeNull()
  })

  it('opens with positioner at x/y', async () => {
    makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    const pos = document.querySelector('[data-part="positioner"]') as HTMLElement
    expect(pos).not.toBeNull()
    expect(pos.style.top).toBe('50px')
    expect(pos.style.left).toBe('100px')
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
