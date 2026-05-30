import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { component, mountApp, div, button, text } from '@llui/dom'
import { init, update, connect, overlay } from '../../src/components/drawer'
import type { DrawerState, DrawerMsg } from '../../src/components/drawer'
import { rootSignal, read } from '../_signal'

type Ctx = { d: DrawerState }

describe('drawer reducer', () => {
  it('initializes closed', () => {
    expect(init()).toEqual({ open: false })
  })

  it('open/close/toggle', () => {
    expect(update(init(), { type: 'open' })[0].open).toBe(true)
    expect(update(init({ open: true }), { type: 'close' })[0].open).toBe(false)
    expect(update(init(), { type: 'toggle' })[0].open).toBe(true)
  })
})

describe('drawer.connect', () => {
  const parts = connect(rootSignal(), vi.fn(), { id: 'dr1' })

  it('content role=dialog with aria-modal', () => {
    expect(parts.content.role).toBe('dialog')
    expect(parts.content['aria-modal']).toBe('true')
  })

  it('data-side reflects side option', () => {
    const right = connect(rootSignal(), vi.fn(), { id: 'x', side: 'right' })
    const left = connect(rootSignal(), vi.fn(), { id: 'y', side: 'left' })
    expect(right.content['data-side']).toBe('right')
    expect(left.content['data-side']).toBe('left')
    expect(right.positioner['data-side']).toBe('right')
  })

  it('default side is right', () => {
    expect(parts.content['data-side']).toBe('right')
  })

  it('data-state tracks open', () => {
    expect(read(parts.content['data-state'], { open: true })).toBe('open')
    expect(read(parts.trigger['data-state'], { open: false })).toBe('closed')
  })

  it('trigger opens drawer', () => {
    const send = vi.fn()
    const p = connect(rootSignal(), send, { id: 'x' })
    p.trigger.onClick(new MouseEvent('click'))
    expect(send).toHaveBeenCalledWith({ type: 'open' })
  })
})

describe('drawer.overlay integration', () => {
  let currentApp: ReturnType<typeof mountApp> | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
    const sibling = document.createElement('aside')
    sibling.id = 'sibling'
    document.body.appendChild(sibling)
  })

  afterEach(() => {
    if (currentApp) {
      currentApp.dispose()
      currentApp = null
    }
    document.body.innerHTML = ''
    document.body.style.overflow = ''
  })

  function makeApp(initialOpen = false): { send: (m: DrawerMsg) => void } {
    let sendRef!: (m: DrawerMsg) => void
    const def = component<Ctx, DrawerMsg, never>({
      name: 'Test',
      init: () => [{ d: init({ open: initialOpen }) }, []],
      update: (state, msg) => {
        const [next] = update(state.d, msg)
        return [{ d: next }, []]
      },
      view: ({ state, send }) => {
        sendRef = send
        const parts = connect(state.at('d'), send, { id: 'test', side: 'right' })
        return [
          button({ ...parts.trigger }, [text('Open')]),
          overlay({
            state: state.at('d'),
            send,
            parts,
            content: () => [
              div({ ...parts.content }, [button({ ...parts.closeTrigger }, [text('×')])]),
            ],
          }),
        ]
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    currentApp = mountApp(container, def)
    return { send: (m) => sendRef(m) }
  }

  it('renders drawer content in body when open', async () => {
    makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"][data-side="right"]')).not.toBeNull()
  })

  it('locks scroll while open', async () => {
    makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('Esc closes', async () => {
    makeApp(true)
    await new Promise((r) => setTimeout(r, 0))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"]')).toBeNull()
  })
})
