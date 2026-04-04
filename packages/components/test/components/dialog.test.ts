import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mountApp, div, button, h2, text } from '@llui/dom'
import type { ComponentDef } from '@llui/dom'
import { init, update, connect, overlay } from '../../src/components/dialog'
import type { DialogState, DialogMsg } from '../../src/components/dialog'

type Ctx = { dlg: DialogState }
const wrap = (d: DialogState): Ctx => ({ dlg: d })

describe('dialog reducer', () => {
  it('initializes closed by default', () => {
    expect(init()).toEqual({ open: false })
  })

  it('initializes open=true when given', () => {
    expect(init({ open: true })).toEqual({ open: true })
  })

  it('open/close/toggle/setOpen', () => {
    expect(update(init(), { type: 'open' })[0].open).toBe(true)
    expect(update(init({ open: true }), { type: 'close' })[0].open).toBe(false)
    expect(update(init(), { type: 'toggle' })[0].open).toBe(true)
    expect(update(init({ open: true }), { type: 'toggle' })[0].open).toBe(false)
    expect(update(init(), { type: 'setOpen', open: true })[0].open).toBe(true)
  })
})

describe('dialog.connect', () => {
  const parts = connect<Ctx>((s) => s.dlg, vi.fn(), { id: 'd1' })

  it('trigger.aria-expanded reflects open state', () => {
    expect(parts.trigger['aria-expanded'](wrap({ open: true }))).toBe(true)
    expect(parts.trigger['aria-expanded'](wrap({ open: false }))).toBe(false)
  })

  it('trigger.aria-controls → content id', () => {
    expect(parts.trigger['aria-controls']).toBe('d1:content')
  })

  it('content.aria-labelledby → title id', () => {
    expect(parts.content['aria-labelledby']).toBe('d1:title')
  })

  it('content.role defaults to dialog', () => {
    expect(parts.content.role).toBe('dialog')
  })

  it('role=alertdialog passes through', () => {
    const p = connect<Ctx>((s) => s.dlg, vi.fn(), { id: 'd2', role: 'alertdialog' })
    expect(p.content.role).toBe('alertdialog')
  })

  it('non-modal omits aria-modal', () => {
    const p = connect<Ctx>((s) => s.dlg, vi.fn(), { id: 'd3', modal: false })
    expect(p.content['aria-modal']).toBeUndefined()
  })

  it('modal includes aria-modal=true', () => {
    expect(parts.content['aria-modal']).toBe('true')
  })

  it('trigger onClick sends open', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.dlg, send, { id: 'x' })
    p.trigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'open' })
  })

  it('closeTrigger onClick sends close', () => {
    const send = vi.fn()
    const p = connect<Ctx>((s) => s.dlg, send, { id: 'x' })
    p.closeTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'close' })
  })

  it('closeLabel customizes aria-label', () => {
    const p = connect<Ctx>((s) => s.dlg, vi.fn(), { id: 'x', closeLabel: 'Dismiss' })
    expect(p.closeTrigger['aria-label']).toBe('Dismiss')
  })
})

describe('dialog.overlay integration', () => {
  let currentApp: ReturnType<typeof mountApp> | null = null

  beforeEach(() => {
    // Give body siblings so aria-hidden has targets
    document.body.innerHTML = ''
    const sibling = document.createElement('aside')
    sibling.id = 'sibling'
    sibling.textContent = 'side content'
    document.body.appendChild(sibling)
  })

  afterEach(() => {
    if (currentApp) {
      currentApp.dispose()
      currentApp = null
    }
    document.body.innerHTML = ''
    document.body.style.overflow = ''
    document.body.style.paddingRight = ''
  })

  function makeApp(initialOpen = false): {
    container: HTMLElement
    send: (m: DialogMsg) => void
    app: ReturnType<typeof mountApp>
  } {
    let sendRef!: (m: DialogMsg) => void
    const parts = connect<Ctx>((s) => s.dlg, (m) => sendRef(m), { id: 'test' })
    const def: ComponentDef<Ctx, DialogMsg, never> = {
      name: 'Test',
      init: () => [{ dlg: init({ open: initialOpen }) }, []],
      update: (state, msg) => {
        const [next] = update(state.dlg, msg)
        return [{ dlg: next }, []]
      },
      view: (send) => {
        sendRef = send
        return [
          button({ ...parts.trigger }, [text('Open')]),
          ...overlay<Ctx>({
            get: (s) => s.dlg,
            send,
            parts,
            content: () => [
              div({ ...parts.content }, [
                h2({ ...parts.title }, [text('Dialog Title')]),
                button({ ...parts.closeTrigger }, [text('Close')]),
              ]),
            ],
          }),
        ]
      },
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    const app = mountApp(container, def)
    currentApp = app
    return { container, send: (m) => sendRef!(m), app }
  }

  it('renders trigger but no dialog when closed', () => {
    const { container } = makeApp(false)
    expect(container.querySelector('[data-part="trigger"]')).not.toBeNull()
    expect(document.querySelector('[data-part="content"]')).toBeNull()
  })

  it('mounts content in body on open', async () => {
    const { send } = makeApp(false)
    send({ type: 'open' })
    await new Promise((r) => setTimeout(r, 0))
    const content = document.querySelector('[data-part="content"]') as HTMLElement
    expect(content).not.toBeNull()
    expect(content.id).toBe('test:content')
    expect(content.getAttribute('role')).toBe('dialog')
  })

  it('removes content on close', async () => {
    const { send } = makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"]')).not.toBeNull()
    send({ type: 'close' })
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"]')).toBeNull()
  })

  it('locks body scroll while open', async () => {
    makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('restores scroll on close', async () => {
    const { send } = makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(document.body.style.overflow).toBe('hidden')
    send({ type: 'close' })
    await new Promise((r) => setTimeout(r, 0))
    expect(document.body.style.overflow).toBe('')
  })

  it('applies aria-hidden to siblings', async () => {
    makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    const sibling = document.getElementById('sibling')!
    expect(sibling.getAttribute('aria-hidden')).toBe('true')
    expect(sibling.hasAttribute('inert')).toBe(true)
  })

  it('removes aria-hidden on close', async () => {
    const { send } = makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    send({ type: 'close' })
    await new Promise((r) => setTimeout(r, 0))
    const sibling = document.getElementById('sibling')!
    expect(sibling.hasAttribute('aria-hidden')).toBe(false)
  })

  it('Escape key closes dialog', async () => {
    makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"]')).toBeNull()
  })

  it('click outside content closes dialog', async () => {
    makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    const outside = document.createElement('div')
    document.body.appendChild(outside)
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"]')).toBeNull()
  })

  it('click inside content does not close', async () => {
    makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    const content = document.querySelector('[data-part="content"]') as HTMLElement
    content.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"]')).not.toBeNull()
  })
})
