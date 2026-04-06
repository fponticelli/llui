import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp, div, input } from '@llui/dom'
import type { ComponentDef } from '@llui/dom'
import { dateInput, type DateInputState, type DateInputMsg } from '../../src/components/date-input'

type S = { d: DateInputState }

describe('date-input integration', () => {
  let app: ReturnType<typeof mountApp> | null = null

  beforeEach(() => { document.body.innerHTML = '' })
  afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = '' })

  function mount() {
    let sendRef!: (m: DateInputMsg) => void
    const def: ComponentDef<S, DateInputMsg, never> = {
      name: 'T',
      init: () => [{ d: dateInput.init({ min: new Date(2024, 0, 1), max: new Date(2024, 11, 31) }) }, []],
      update: (s, m) => { const [d] = dateInput.update(s.d, m); return [{ d }, []] },
      view: ({ send }) => {
        sendRef = send
        const p = dateInput.connect<S>(s => s.d, send, { placeholder: 'YYYY-MM-DD' })
        return [
          div({ ...p.root }, [
            input({ ...p.input }),
            div({ ...p.errorText }, []),
          ]),
        ]
      },
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    app = mountApp(container, def)
    return { send: (m: DateInputMsg) => sendRef(m), flush: () => app!.flush() }
  }

  it('renders empty input with placeholder', () => {
    mount()
    const inp = document.querySelector('[data-part="input"]') as HTMLInputElement
    expect(inp.placeholder).toBe('YYYY-MM-DD')
    expect(inp.value).toBe('')
  })

  it('valid date hides error', () => {
    const { send, flush } = mount()
    send({ type: 'setInput', value: '2024-06-15' })
    flush()
    const err = document.querySelector('[data-part="error-text"]') as HTMLElement
    expect(err.hidden).toBe(true)
  })

  it('invalid date shows error', () => {
    const { send, flush } = mount()
    send({ type: 'setInput', value: 'not-a-date' })
    flush()
    const err = document.querySelector('[data-part="error-text"]') as HTMLElement
    expect(err.hidden).toBe(false)
    const inp = document.querySelector('[data-part="input"]') as HTMLInputElement
    expect(inp.getAttribute('aria-invalid')).toBe('true')
  })

  it('out-of-range date shows error', () => {
    const { send, flush } = mount()
    send({ type: 'setInput', value: '2025-06-15' })
    flush()
    const root = document.querySelector('[data-part="root"]')!
    expect(root.getAttribute('data-invalid')).toBe('')
  })
})
