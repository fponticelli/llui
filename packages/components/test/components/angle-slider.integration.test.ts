import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp, div } from '@llui/dom'
import type { ComponentDef } from '@llui/dom'
import { angleSlider, type AngleSliderState, type AngleSliderMsg } from '../../src/components/angle-slider'

type S = { a: AngleSliderState }

describe('angle-slider integration', () => {
  let app: ReturnType<typeof mountApp> | null = null

  beforeEach(() => { document.body.innerHTML = '' })
  afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = '' })

  function mount(value = 45) {
    let sendRef!: (m: AngleSliderMsg) => void
    const def: ComponentDef<S, AngleSliderMsg, never> = {
      name: 'T',
      init: () => [{ a: angleSlider.init({ value, step: 5 }) }, []],
      update: (s, m) => { const [a] = angleSlider.update(s.a, m); return [{ a }, []] },
      view: ({ send }) => {
        sendRef = send
        const p = angleSlider.connect<S>(s => s.a, send)
        return [
          div({ ...p.root }, [
            div({ ...p.control }, [div({ ...p.thumb }, [])]),
          ]),
        ]
      },
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    app = mountApp(container, def)
    return { send: (m: AngleSliderMsg) => sendRef(m), flush: () => app!.flush() }
  }

  it('renders with aria-valuenow matching initial value', () => {
    mount(90)
    const root = document.querySelector('[data-part="root"]')!
    expect(root.getAttribute('aria-valuenow')).toBe('90')
  })

  it('ArrowRight increments and updates aria-valuenow', () => {
    const { flush } = mount(45)
    const root = document.querySelector('[data-part="root"]') as HTMLElement
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    flush()
    expect(root.getAttribute('aria-valuenow')).toBe('50')
  })

  it('thumb data-value updates on state change', () => {
    const { send, flush } = mount(0)
    const thumb = document.querySelector('[data-part="thumb"]')!
    expect(thumb.getAttribute('data-value')).toBe('0')
    send({ type: 'setValue', value: 180 })
    flush()
    expect(thumb.getAttribute('data-value')).toBe('180')
  })
})
