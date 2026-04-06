import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp, div, button, text } from '@llui/dom'
import type { ComponentDef } from '@llui/dom'
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
    const def: ComponentDef<S, NavMenuMsg, never> = {
      name: 'T',
      init: () => [{ n: navigationMenu.init() }, []],
      update: (s, m) => {
        const [n] = navigationMenu.update(s.n, m)
        return [{ n }, []]
      },
      view: ({ send }) => {
        sendRef = send
        const parts = navigationMenu.connect<S>((s) => s.n, send, { id: 'nav' })
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
    }
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
})
