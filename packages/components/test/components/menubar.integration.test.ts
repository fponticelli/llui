import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { component, mountApp, button, div, text } from '@llui/dom'
import { init, update, connect, overlay } from '../../src/components/menubar'
import type { MenubarState, MenubarMsg } from '../../src/components/menubar'

type Ctx = { mb: MenubarState }

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('menubar.overlay integration', () => {
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

  interface Harness {
    send: (m: MenubarMsg) => void
    peek: () => MenubarState
    /** The id the BAR renders for the `file` trigger — read through the same
     * `connect()` call a consumer makes, so the assertion cannot drift. */
    triggerId: string
  }

  function makeApp(renderTriggers = true): Harness {
    let sendRef!: (m: MenubarMsg) => void
    let stateRef!: () => MenubarState
    let triggerIdRef!: string
    const def = component<Ctx, MenubarMsg, never>({
      name: 'MB',
      init: () => [
        {
          mb: init({
            menus: [
              {
                id: 'file',
                items: [
                  { value: 'new', kind: 'action' },
                  { value: 'open', kind: 'action' },
                ],
              },
              { id: 'edit', items: [{ value: 'cut', kind: 'action' }] },
            ],
          }),
        },
        [],
      ],
      update: (state, msg) => {
        const [next] = update(state.mb, msg)
        return [{ mb: next }, []]
      },
      view: ({ state, send }) => {
        sendRef = send
        stateRef = () => state.peek().mb
        const mb = state.map((s) => s.mb)
        const parts = connect(mb, send, { id: 'mb' })
        triggerIdRef = parts.menuTrigger('file').id
        const fileMenu = parts.menu('file')
        return [
          ...(renderTriggers
            ? [
                div({ ...parts.root }, [
                  button({ ...parts.menuTrigger('file') }, [text('File')]),
                  button({ ...parts.menuTrigger('edit') }, [text('Edit')]),
                ]),
              ]
            : []),
          overlay({
            state: mb,
            send,
            menuId: 'file',
            parts: fileMenu,
            content: () => [div({ ...fileMenu.content }, [])],
          }),
        ]
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    currentApp = mountApp(container, def)
    return { send: (m) => sendRef(m), peek: () => stateRef(), triggerId: triggerIdRef }
  }

  it('anchors on the trigger element the bar actually renders', async () => {
    const h = makeApp()
    h.send({ type: 'openMenu', id: 'file' })
    await tick()

    // Non-vacuous: both the dropdown and the bar's trigger must exist, and the
    // trigger resolved by the rendered id must be the node inside the bar.
    const content = document.querySelector('[data-scope="menu"][data-part="content"]')
    expect(content).not.toBeNull()
    const trigger = document.getElementById(h.triggerId)
    expect(trigger).not.toBeNull()
    const inBar = document
      .querySelector('[data-scope="menubar"][data-part="root"]')
      ?.querySelector('[data-part="trigger"][data-value="file"]')
    expect(inBar).toBe(trigger)

    // Escape closes and restores focus to that very element — only reachable
    // when the overlay's placement relationship resolved to it.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await tick()
    expect(h.peek().open).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('clicking an open trigger closes the menu instead of re-opening it', async () => {
    const h = makeApp()
    h.send({ type: 'openMenu', id: 'file' })
    await tick()
    expect(h.peek().open).toBe('file')

    const trigger = document.getElementById(h.triggerId)
    expect(trigger).not.toBeNull()
    // A real click is pointerdown THEN click. With the trigger outside the
    // dismissable's ignore set the pointerdown closes and the click re-opens.
    trigger!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await tick()
    expect(h.peek().open).toBeNull()
    expect(document.querySelector('[data-scope="menu"][data-part="content"]')).toBeNull()
  })

  it('warns about unresolved ownership before a missing placement trigger bails out', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const h = makeApp(false)
    h.send({ type: 'openMenu', id: 'file' })
    await tick()

    // The content mounted, so the interaction phase reached relationship
    // resolution. The shared trigger id resolves for neither placement nor
    // ownership; placement may bail, but must not swallow the ownership warning.
    expect(document.getElementById('mb:file:content')).not.toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('nested-layer owner'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(h.triggerId))
    warn.mockRestore()
  })
})
