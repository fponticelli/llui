import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp, button, div, text } from '@llui/dom'
import type { ComponentDef } from '@llui/dom'
import { init, update, connect, overlay } from '../../src/components/popover'
import type { PopoverState, PopoverMsg } from '../../src/components/popover'

type Ctx = { p: PopoverState }

describe('popover.overlay integration', () => {
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

  function makeApp(initialOpen = false): { send: (m: PopoverMsg) => void } {
    let sendRef!: (m: PopoverMsg) => void
    const parts = connect<Ctx>(
      (s) => s.p,
      (m) => sendRef(m),
      { id: 'pop' },
    )
    const def: ComponentDef<Ctx, PopoverMsg, never> = {
      name: 'T',
      init: () => [{ p: init({ open: initialOpen }) }, []],
      update: (state, msg) => {
        const [next] = update(state.p, msg)
        return [{ p: next }, []]
      },
      view: (send) => {
        sendRef = send
        return [
          button({ ...parts.trigger }, [text('Open')]),
          ...overlay<Ctx>({
            get: (s) => s.p,
            send,
            parts,
            content: () => [div({ ...parts.content }, [text('hello')])],
          }),
        ]
      },
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    currentApp = mountApp(container, def)
    return { send: (m) => sendRef(m) }
  }

  it('renders no content when closed', () => {
    makeApp(false)
    expect(document.querySelector('[data-part="content"]')).toBeNull()
  })

  it('opens content in body portal', async () => {
    makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"]')).not.toBeNull()
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

  it('trigger click is ignored by dismissable (ignore list)', async () => {
    const { send } = makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    const trigger = document.getElementById('pop:trigger') as HTMLElement
    trigger.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    // Trigger is in the ignore list — popover stays open
    expect(document.querySelector('[data-part="content"]')).not.toBeNull()
    send({ type: 'close' })
  })

  it('does not lock body scroll (non-modal)', async () => {
    makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})
