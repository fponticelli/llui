import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { component, mountApp, button, div, text } from '@llui/dom'
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

  function makeApp(initialOpen = false, skipAnimations = true): { send: (m: MenuMsg) => void } {
    let sendRef!: (m: MenuMsg) => void
    const def = component<Ctx, MenuMsg, never>({
      name: 'T',
      init: () => [
        {
          m: init({
            items: [
              { value: 'a', kind: 'action' },
              { value: 'b', kind: 'action' },
              { value: 'c', kind: 'action' },
            ],
            open: initialOpen,
            skipAnimations,
          }),
        },
        [],
      ],
      update: (state, msg) => {
        const [next] = update(state.m, msg)
        return [{ m: next }, []]
      },
      view: ({ state, send }) => {
        sendRef = send
        const m = state.map((s) => s.m)
        const parts = connect(m, send, { id: 'mn' })
        return [
          button({ ...parts.trigger }, [text('Menu')]),
          overlay({
            state: m,
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

  function makeAppWithSub(): { send: (m: MenuMsg) => void; peek: () => MenuState } {
    let sendRef!: (m: MenuMsg) => void
    let stateRef!: () => MenuState
    const def = component<Ctx, MenuMsg, never>({
      name: 'TSub',
      init: () => [
        {
          m: init({
            items: [
              { value: 'a', kind: 'action' },
              {
                value: 'sub',
                kind: 'action',
                children: [
                  { value: 's1', kind: 'action' },
                  { value: 's2', kind: 'action' },
                ],
              },
            ],
            open: true,
            skipAnimations: true,
          }),
        },
        [],
      ],
      update: (state, msg) => {
        const [next] = update(state.m, msg)
        return [{ m: next }, []]
      },
      view: ({ state, send }) => {
        sendRef = send
        stateRef = () => state.peek().m
        const m = state.map((s) => s.m)
        const parts = connect(m, send, { id: 'mn' })
        return [
          button({ ...parts.trigger }, [text('Menu')]),
          overlay({
            state: m,
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
    return { send: (m) => sendRef(m), peek: () => stateRef() }
  }

  it('Escape unwinds one submenu level before closing the whole menu', async () => {
    const { send, peek } = makeAppWithSub()
    await new Promise((r) => setTimeout(r, 0))
    // Open the submenu.
    send({ type: 'openSub', value: 'sub' })
    await new Promise((r) => setTimeout(r, 0))
    expect(peek().openPath).toEqual(['sub'])

    // First Escape: only the submenu closes; the menu itself stays open/mounted.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(peek().openPath).toEqual([])
    expect(peek().open).toBe(true)
    expect(document.querySelector('[data-part="content"]')).not.toBeNull()

    // Second Escape: the whole menu closes.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(peek().open).toBe(false)
    expect(document.querySelector('[data-part="content"]')).toBeNull()
  })

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

  it('animated close tears down interaction at close-request while the node lingers', async () => {
    const { send } = makeApp(true, false)
    await new Promise((r) => setTimeout(r, 0))
    const content = document.querySelector('[data-part="content"]') as HTMLElement
    expect(content).not.toBeNull()

    // Close request → 'closing': the node stays mounted for the exit animation,
    // but the inner interaction block (floating + dismissable + focus) unmounts now.
    send({ type: 'close' })
    await new Promise((r) => setTimeout(r, 0))
    const closing = document.querySelector('[data-part="content"]') as HTMLElement
    expect(closing).not.toBeNull()
    expect(closing.getAttribute('data-state')).toBe('closing')

    // Prove the dismissable was popped at close-request: its onDismiss focuses the
    // trigger, so were it still listening, this outside pointerdown would steal
    // focus back. With the teardown it does not.
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(document.activeElement).toBe(outside)
    // The node is still present, waiting for its exit animation.
    expect(document.querySelector('[data-part="content"]')).not.toBeNull()

    // animationEnd completes the unmount.
    closing.dispatchEvent(new Event('animationend', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 0))
    expect(document.querySelector('[data-part="content"]')).toBeNull()
  })
})
