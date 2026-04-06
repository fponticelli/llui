import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountApp, div, button, text } from '@llui/dom'
import type { ComponentDef } from '@llui/dom'
import { signaturePad, type SignaturePadState, type SignaturePadMsg } from '../../src/components/signature-pad'

type S = { s: SignaturePadState }

describe('signature-pad integration', () => {
  let app: ReturnType<typeof mountApp> | null = null

  beforeEach(() => { document.body.innerHTML = '' })
  afterEach(() => { app?.dispose(); app = null; document.body.innerHTML = '' })

  function mount() {
    let sendRef!: (m: SignaturePadMsg) => void
    const def: ComponentDef<S, SignaturePadMsg, never> = {
      name: 'T',
      init: () => [{ s: signaturePad.init() }, []],
      update: (s, m) => { const [next] = signaturePad.update(s.s, m); return [{ s: next }, []] },
      view: ({ send }) => {
        sendRef = send
        const parts = signaturePad.connect<S>(s => s.s, send)
        return [
          div({ ...parts.root }, [
            button({ ...parts.clearTrigger }, [text('Clear')]),
            button({ ...parts.undoTrigger }, [text('Undo')]),
          ]),
        ]
      },
    }
    const container = document.createElement('div')
    document.body.appendChild(container)
    app = mountApp(container, def)
    return { send: (m: SignaturePadMsg) => sendRef(m), flush: () => app!.flush() }
  }

  it('clear and undo disabled when empty', () => {
    mount()
    const clear = document.querySelector('[data-part="clear-trigger"]') as HTMLButtonElement
    const undo = document.querySelector('[data-part="undo-trigger"]') as HTMLButtonElement
    expect(clear.disabled).toBe(true)
    expect(undo.disabled).toBe(true)
  })

  it('drawing a stroke enables clear', () => {
    const { send, flush } = mount()
    send({ type: 'strokeStart', x: 0, y: 0 })
    send({ type: 'strokePoint', x: 10, y: 10 })
    send({ type: 'strokeEnd' })
    flush()
    const clear = document.querySelector('[data-part="clear-trigger"]') as HTMLButtonElement
    expect(clear.disabled).toBe(false)
  })

  it('root data-drawing reflects state', () => {
    const { send, flush } = mount()
    const root = document.querySelector('[data-part="root"]')!
    expect(root.getAttribute('data-drawing')).toBeNull()
    send({ type: 'strokeStart', x: 0, y: 0 })
    flush()
    expect(root.getAttribute('data-drawing')).toBe('')
  })
})
