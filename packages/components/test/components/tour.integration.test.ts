import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp, div, button, text } from '@llui/dom'
import type { ComponentDef } from '@llui/dom'
import { tour, type TourState, type TourMsg, type TourStep } from '../../src/components/tour'

type S = { t: TourState }

const steps: TourStep[] = [
  { id: 'a', title: 'Step A', description: 'First', target: '#x' },
  { id: 'b', title: 'Step B', description: 'Second', target: '#x' },
]

describe('tour integration', () => {
  let app: ReturnType<typeof mountApp> | null = null

  beforeEach(() => { document.body.innerHTML = '' })
  afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = '' })

  function mount() {
    let sendRef!: (m: TourMsg) => void
    const parts = tour.connect<S>(s => s.t, m => sendRef(m), { id: 'tour' })
    const def: ComponentDef<S, TourMsg, never> = {
      name: 'T',
      init: () => [{ t: tour.init({ steps }) }, []],
      update: (s, m) => { const [t] = tour.update(s.t, m); return [{ t }, []] },
      view: ({ send }) => {
        sendRef = send
        return [
          div({ ...parts.root }, [
            div({ ...parts.title }, [text((s: S) => tour.currentStep(s.t)?.title ?? '')]),
            button({ ...parts.nextTrigger }, [text('Next')]),
            button({ ...parts.prevTrigger }, [text('Prev')]),
          ]),
        ]
      },
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    app = mountApp(container, def)
    return { send: (m: TourMsg) => sendRef(m), flush: () => app!.flush() }
  }

  it('root is hidden when tour is closed', () => {
    mount()
    const root = document.querySelector('[data-part="root"]') as HTMLElement
    expect(root.hidden).toBe(true)
  })

  it('start opens tour and shows first step title', () => {
    const { send, flush } = mount()
    send({ type: 'start' })
    flush()
    const root = document.querySelector('[data-part="root"]') as HTMLElement
    expect(root.hidden).toBe(false)
    expect(document.querySelector('[data-part="title"]')!.textContent).toBe('Step A')
  })

  it('next advances to second step', () => {
    const { send, flush } = mount()
    send({ type: 'start' })
    flush()
    send({ type: 'next' })
    flush()
    expect(document.querySelector('[data-part="title"]')!.textContent).toBe('Step B')
  })

  it('prev is disabled on first step', () => {
    const { send, flush } = mount()
    send({ type: 'start' })
    flush()
    const prev = document.querySelector('[data-part="prev-trigger"]') as HTMLButtonElement
    expect(prev.disabled).toBe(true)
  })
})
