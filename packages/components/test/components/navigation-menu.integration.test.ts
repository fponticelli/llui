import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { component, mountApp, div, button, text } from '@llui/dom'
import {
  navigationMenu,
  type NavMenuState,
  type NavMenuMsg,
} from '../../src/components/navigation-menu'

type S = { n: NavMenuState }

describe('navigation-menu integration', () => {
  let app: ReturnType<typeof mountApp> | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    app?.dispose()
    app = null
    document.body.innerHTML = ''
  })

  function mount() {
    let sendRef!: (m: NavMenuMsg) => void
    const def = component<S, NavMenuMsg, never>({
      name: 'T',
      init: () => [{ n: navigationMenu.init() }, []],
      update: (s, m) => {
        const [n] = navigationMenu.update(s.n, m)
        return [{ n }, []]
      },
      view: ({ state, send }) => {
        sendRef = send
        const parts = navigationMenu.connect(state.at('n'), send, { id: 'nav' })
        const file = parts.item('file', { isBranch: true })
        const help = parts.item('help', { isBranch: false })
        return [
          div({ ...parts.root }, [
            button({ ...file.trigger }, [text('File')]),
            div({ ...file.content }, [text('File menu')]),
            button({ ...help.trigger }, [text('Help')]),
          ]),
        ]
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    app = mountApp(container, def)
    return { send: (m: NavMenuMsg) => sendRef(m), flush: () => app!.flush() }
  }

  it('branch content is hidden initially', () => {
    mount()
    const content = document.querySelector('[data-part="content"]') as HTMLElement
    expect(content.hidden).toBe(true)
  })

  it('openBranch shows content', () => {
    const { send, flush } = mount()
    send({ type: 'openBranch', id: 'file', ancestorIds: [] })
    flush()
    const content = document.querySelector('[data-part="content"]') as HTMLElement
    expect(content.hidden).toBe(false)
    expect(content.textContent).toBe('File menu')
  })

  it('trigger data-state reflects open state', () => {
    const { send, flush } = mount()
    const trigger = document.getElementById('nav:trigger:file')!
    expect(trigger.getAttribute('data-state')).toBe('closed')
    send({ type: 'openBranch', id: 'file', ancestorIds: [] })
    flush()
    expect(trigger.getAttribute('data-state')).toBe('open')
  })

  it('leaf trigger has no aria-haspopup', () => {
    mount()
    const help = document.getElementById('nav:trigger:help')!
    expect(help.getAttribute('aria-haspopup')).toBeNull()
  })

  /**
   * The tab stop has to land on something a Tab press can actually reach, and
   * membership alone does not decide that: a submenu entry lives in a panel
   * that carries `hidden`, so the stop can be present, unique and STILL leave
   * the nav with no tabbable element (#145). Only the live DOM shows it, which
   * is why these two run here rather than against `connect` in isolation.
   */
  function mountNested(focused: string | null = null) {
    let sendRef!: (m: NavMenuMsg) => void
    const def = component<S, NavMenuMsg, never>({
      name: 'TN',
      init: () => [{ n: navigationMenu.init({ focused }) }, []],
      update: (s, m) => {
        const [n] = navigationMenu.update(s.n, m)
        return [{ n }, []]
      },
      view: ({ state, send }) => {
        sendRef = send
        const parts = navigationMenu.connect(state.at('n'), send, { id: 'nav' })
        const file = parts.item('file', { isBranch: true })
        const open = parts.item('file-open', { isBranch: false, ancestorIds: ['file'] })
        const help = parts.item('help', { isBranch: false })
        return [
          div({ ...parts.root }, [
            button({ ...file.trigger }, [text('File')]),
            div({ ...file.content }, [button({ ...open.trigger }, [text('Open')])]),
            button({ ...help.trigger }, [text('Help')]),
          ]),
        ]
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    app = mountApp(container, def)
    return { send: (m: NavMenuMsg) => sendRef(m), flush: () => app!.flush() }
  }

  /** Triggers reading `tabindex="0"` that are not sealed inside a hidden panel. */
  const tabbableStops = (): string[] =>
    [...document.querySelectorAll('[data-part="trigger"][tabindex="0"]')]
      .filter((el) => el.closest('[hidden]') === null)
      .map((el) => el.getAttribute('data-value')!)

  const allStops = (): string[] =>
    [...document.querySelectorAll('[data-part="trigger"][tabindex="0"]')].map(
      (el) => el.getAttribute('data-value')!,
    )

  it('keeps a TABBABLE stop after a focused submenu item is closed away', () => {
    // Every step is one of the machine's own messages, on a static menu with
    // no `items` list — the documented configuration for one. Hover a branch,
    // let its submenu trigger take focus, then let the pointer leave: the
    // consumer's close timer fires `closeAll` and the panel goes `hidden`.
    const { send, flush } = mountNested()
    send({ type: 'openBranch', id: 'file', ancestorIds: [] })
    send({ type: 'focus', id: 'file-open' })
    flush()
    expect(tabbableStops()).toEqual(['file-open'])

    send({ type: 'closeAll' })
    flush()
    const content = document.querySelector('[data-part="content"]') as HTMLElement
    expect(content.hidden).toBe(true)
    // Before #145's second half this was `['file-open']` with the panel hidden:
    // exactly one stop by the letter of the pattern, and zero tabbable elements.
    expect(allStops()).toEqual(['file'])
    expect(tabbableStops()).toEqual(['file'])
  })

  it('seats exactly one stop at mount when `focused` names nothing rendered', () => {
    // A `focused` id that no `item()` ever saw used to own the stop on trust,
    // so EVERY trigger read -1. It is now pruned against the rendered ids, and
    // the assertion is made against the FIRST commit specifically: `item()`
    // runs during view construction and the tabindex bindings produce during
    // materialisation, so the registry is whole before any of them is read.
    mountNested('gone')
    expect(tabbableStops()).toEqual(['file'])
  })
})
