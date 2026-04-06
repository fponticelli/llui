import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp, div, button, text } from '@llui/dom'
import type { ComponentDef } from '@llui/dom'
import { floatingPanel, type FloatingPanelState, type FloatingPanelMsg } from '../../src/components/floating-panel'

type S = { p: FloatingPanelState }

describe('floating-panel integration', () => {
  let app: ReturnType<typeof mountApp> | null = null

  beforeEach(() => { document.body.innerHTML = '' })
  afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = '' })

  function mount(open = true) {
    let sendRef!: (m: FloatingPanelMsg) => void
    const def: ComponentDef<S, FloatingPanelMsg, never> = {
      name: 'T',
      init: () => [{ p: floatingPanel.init({ open }) }, []],
      update: (s, m) => { const [p] = floatingPanel.update(s.p, m); return [{ p }, []] },
      view: ({ send }) => {
        sendRef = send
        const parts = floatingPanel.connect<S>(s => s.p, send)
        return [
          div({ ...parts.root }, [
            div({ ...parts.dragHandle }, [text('Title')]),
            div({ ...parts.content }, [text('Body')]),
            button({ ...parts.minimizeTrigger }, [text('Min')]),
            button({ ...parts.closeTrigger }, [text('Close')]),
          ]),
        ]
      },
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    app = mountApp(container, def)
    return { send: (m: FloatingPanelMsg) => sendRef(m), flush: () => app!.flush() }
  }

  it('renders visible when open', () => {
    mount(true)
    const root = document.querySelector('[data-part="root"]') as HTMLElement
    expect(root.hidden).toBe(false)
  })

  it('close hides the panel', () => {
    const { send, flush } = mount(true)
    send({ type: 'close' })
    flush()
    const root = document.querySelector('[data-part="root"]') as HTMLElement
    expect(root.hidden).toBe(true)
  })

  it('minimize hides content but keeps root visible', () => {
    const { send, flush } = mount(true)
    send({ type: 'minimize' })
    flush()
    const root = document.querySelector('[data-part="root"]') as HTMLElement
    const content = document.querySelector('[data-part="content"]') as HTMLElement
    expect(root.hidden).toBe(false)
    expect(content.hidden).toBe(true)
    expect(root.getAttribute('data-minimized')).toBe('')
  })

  it('root style reflects position + size', () => {
    mount(true)
    const root = document.querySelector('[data-part="root"]') as HTMLElement
    expect(root.style.cssText).toContain('left')
    expect(root.style.cssText).toContain('width')
  })
})
