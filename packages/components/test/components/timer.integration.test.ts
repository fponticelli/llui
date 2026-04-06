import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp, div, text, button } from '@llui/dom'
import type { ComponentDef } from '@llui/dom'
import { timer, type TimerState, type TimerMsg } from '../../src/components/timer'

type S = { t: TimerState }

describe('timer integration', () => {
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
    let sendRef!: (m: TimerMsg) => void
    const def: ComponentDef<S, TimerMsg, never> = {
      name: 'T',
      init: () => [{ t: timer.init({ direction: 'up' }) }, []],
      update: (s, m) => {
        const [t] = timer.update(s.t, m)
        return [{ t }, []]
      },
      view: ({ send }) => {
        sendRef = send
        const p = timer.connect<S>((s) => s.t, send)
        return [
          div({ ...p.root }, [
            div({ ...p.display }, [text((s: S) => timer.formatMs(timer.display(s.t), 'mm:ss'))]),
            button({ ...p.startTrigger }, [text('Start')]),
            button({ ...p.pauseTrigger }, [text('Pause')]),
          ]),
        ]
      },
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    app = mountApp(container, def)
    return { send: (m: TimerMsg) => sendRef(m), flush: () => app!.flush() }
  }

  it('renders timer display at 00:00 initially', () => {
    mount()
    const display = document.querySelector('[data-part="display"]')!
    expect(display.textContent).toBe('00:00')
  })

  it('start button disables while running', () => {
    const { send, flush } = mount()
    const startBtn = document.querySelector('[data-part="start-trigger"]') as HTMLButtonElement
    expect(startBtn.disabled).toBe(false)
    send({ type: 'start', now: 1000 })
    flush()
    expect(startBtn.disabled).toBe(true)
  })

  it('root data-running reflects state', () => {
    const { send, flush } = mount()
    const root = document.querySelector('[data-part="root"]')!
    expect(root.getAttribute('data-running')).toBeNull()
    send({ type: 'start', now: 1000 })
    flush()
    expect(root.getAttribute('data-running')).toBe('')
  })
})
