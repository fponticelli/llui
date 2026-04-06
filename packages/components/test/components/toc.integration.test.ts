import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp, div, a, text } from '@llui/dom'
import type { ComponentDef } from '@llui/dom'
import { toc, type TocState, type TocMsg, type TocEntry } from '../../src/components/toc'

type S = { t: TocState }

const entries: TocEntry[] = [
  { id: 'intro', label: 'Introduction', level: 1 },
  { id: 'api', label: 'API', level: 1 },
]

describe('toc integration', () => {
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
    let sendRef!: (m: TocMsg) => void
    const def: ComponentDef<S, TocMsg, never> = {
      name: 'T',
      init: () => [{ t: toc.init({ items: entries, activeId: 'intro' }) }, []],
      update: (s, m) => {
        const [t] = toc.update(s.t, m)
        return [{ t }, []]
      },
      view: ({ send }) => {
        sendRef = send
        const parts = toc.connect<S>((s) => s.t, send)
        return [
          div(
            { ...parts.root },
            entries.map((e) => {
              const p = parts.item(e)
              return div({ ...p.item }, [a({ ...p.link }, [text(e.label)])])
            }),
          ),
        ]
      },
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    app = mountApp(container, def)
    return { send: (m: TocMsg) => sendRef(m), flush: () => app!.flush() }
  }

  it('active item has aria-current=location', () => {
    mount()
    const introLink = document.querySelector('[data-value="intro"] [data-part="link"]')!
    expect(introLink.getAttribute('aria-current')).toBe('location')
  })

  it('inactive item has no aria-current', () => {
    mount()
    const apiLink = document.querySelector('[data-value="api"] [data-part="link"]')!
    expect(apiLink.getAttribute('aria-current')).toBeNull()
  })

  it('setActive switches the highlighted link', () => {
    const { send, flush } = mount()
    send({ type: 'setActive', id: 'api' })
    flush()
    const apiLink = document.querySelector('[data-value="api"] [data-part="link"]')!
    expect(apiLink.getAttribute('aria-current')).toBe('location')
    const introLink = document.querySelector('[data-value="intro"] [data-part="link"]')!
    expect(introLink.getAttribute('aria-current')).toBeNull()
  })

  it('link href includes prefix', () => {
    mount()
    const link = document.querySelector('[data-part="link"]') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('#intro')
  })
})
