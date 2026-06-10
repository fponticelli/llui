import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { component, mountApp, div, button, h2, text } from '@llui/dom'
import { init, update, connect, overlay } from '../../src/components/dialog'
import type { DialogState, DialogMsg } from '../../src/components/dialog'
import { rootSignal, read } from '../_signal'

type Ctx = { dlg: DialogState }

describe('dialog reducer', () => {
  it('initializes closed by default', () => {
    expect(init().open).toBe(false)
    expect(init().status).toBe('closed')
  })

  it('initializes open=true when given', () => {
    expect(init({ open: true }).open).toBe(true)
    expect(init({ open: true }).status).toBe('open')
  })

  it('open/close/toggle/setOpen', () => {
    expect(update(init(), { type: 'open' })[0].open).toBe(true)
    expect(update(init({ open: true }), { type: 'close' })[0].open).toBe(false)
    expect(update(init(), { type: 'toggle' })[0].open).toBe(true)
    expect(update(init({ open: true }), { type: 'toggle' })[0].open).toBe(false)
    expect(update(init(), { type: 'setOpen', open: true })[0].open).toBe(true)
  })

  it('skipAnimations (default) closes straight to closed', () => {
    const [s] = update(init({ open: true }), { type: 'close' })
    expect(s.status).toBe('closed')
    expect(s.open).toBe(false)
  })

  it('animated close goes open → closing, then animationEnd → closed', () => {
    const opened = init({ open: true, skipAnimations: false })
    const [closing] = update(opened, { type: 'close' })
    expect(closing.status).toBe('closing')
    expect(closing.open).toBe(false)
    const [closed] = update(closing, { type: 'animationEnd' })
    expect(closed.status).toBe('closed')
  })

  it('animated open goes closed → opening, then transitionEnd → open', () => {
    const start = init({ skipAnimations: false })
    const [opening] = update(start, { type: 'open' })
    expect(opening.status).toBe('opening')
    expect(opening.open).toBe(true)
    const [open] = update(opening, { type: 'transitionEnd' })
    expect(open.status).toBe('open')
  })

  it('animationEnd is a no-op when not animating', () => {
    const open = init({ open: true })
    expect(update(open, { type: 'animationEnd' })[0].status).toBe('open')
  })
})

describe('dialog.connect', () => {
  const parts = connect(rootSignal(), vi.fn(), { id: 'd1' })

  it('trigger.aria-expanded reflects open state', () => {
    expect(read(parts.trigger['aria-expanded'], { open: true })).toBe(true)
    expect(read(parts.trigger['aria-expanded'], { open: false })).toBe(false)
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
    const p = connect(rootSignal(), vi.fn(), { id: 'd2', role: 'alertdialog' })
    expect(p.content.role).toBe('alertdialog')
  })

  it('non-modal omits aria-modal', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'd3', modal: false })
    expect(p.content['aria-modal']).toBeUndefined()
  })

  it('modal includes aria-modal=true', () => {
    expect(parts.content['aria-modal']).toBe('true')
  })

  it('trigger onClick sends open', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    p.trigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'open' })
  })

  it('closeTrigger onClick sends close', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    p.closeTrigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'close' })
  })

  it('closeLabel customizes aria-label', () => {
    const p = connect(rootSignal(), vi.fn(), { id: 'x', closeLabel: 'Dismiss' })
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

  function makeApp(
    initialOpen = false,
    skipAnimations = true,
  ): {
    container: HTMLElement
    send: (m: DialogMsg) => void
    app: ReturnType<typeof mountApp>
  } {
    let sendRef!: (m: DialogMsg) => void
    const def = component<Ctx, DialogMsg, never>({
      name: 'Test',
      init: () => [{ dlg: init({ open: initialOpen, skipAnimations }) }, []],
      update: (state, msg) => {
        const [next] = update(state.dlg, msg)
        return [{ dlg: next }, []]
      },
      view: ({ state, send }) => {
        sendRef = send
        const parts = connect(state.at('dlg'), send, { id: 'test' })
        return [
          button({ ...parts.trigger }, [text('Open')]),
          overlay({
            state: state.at('dlg'),
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
    })
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

  it('non-animated close unmounts synchronously (no hang)', async () => {
    const { send } = makeApp(true, true)
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"]')).not.toBeNull()
    send({ type: 'close' })
    // No animationend fired, yet the node is gone immediately.
    expect(document.querySelector('[data-part="content"]')).toBeNull()
  })

  it('animated close keeps the node mounted as data-state=closing until animationEnd', async () => {
    const { send } = makeApp(true, false)
    await new Promise((r) => setTimeout(r, 0))
    const content = document.querySelector('[data-part="content"]') as HTMLElement
    expect(content).not.toBeNull()
    expect(content.getAttribute('data-state')).toBe('open')

    send({ type: 'close' })
    // Still mounted, now in the closing phase.
    const closing = document.querySelector('[data-part="content"]') as HTMLElement
    expect(closing).not.toBeNull()
    expect(closing.getAttribute('data-state')).toBe('closing')

    // Exit animation ends → DOM removal.
    closing.dispatchEvent(new Event('animationend', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"]')).toBeNull()
  })

  it('animated close runs scroll unlock + aria-hidden restore at close-request time', async () => {
    const { send } = makeApp(true, false)
    await new Promise((r) => setTimeout(r, 0))
    expect(document.body.style.overflow).toBe('hidden')
    const sibling = document.getElementById('sibling')!
    expect(sibling.getAttribute('aria-hidden')).toBe('true')

    send({ type: 'close' })
    // Interaction is over: scroll unlocked and siblings restored even though the
    // content node is still mounted for the exit animation.
    expect(document.body.style.overflow).toBe('')
    expect(sibling.hasAttribute('aria-hidden')).toBe(false)
    expect(document.querySelector('[data-part="content"]')).not.toBeNull()
  })
})
