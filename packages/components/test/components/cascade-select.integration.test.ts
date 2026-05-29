import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { component, mountApp, div, text } from '@llui/dom/signals'
import {
  cascadeSelect,
  type CascadeSelectState,
  type CascadeSelectMsg,
  type CascadeLevel,
} from '../../src/components/cascade-select'

type S = { c: CascadeSelectState }

const levels: CascadeLevel[] = [
  { id: 'country', label: 'Country', options: [{ value: 'US', label: 'US' }] },
  { id: 'region', label: 'Region', options: [{ value: 'CA', label: 'California' }] },
]

describe('cascade-select integration', () => {
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
    let sendRef!: (m: CascadeSelectMsg) => void
    const def = component<S, CascadeSelectMsg, never>({
      name: 'T',
      init: () => [{ c: cascadeSelect.init({ levels }) }, []],
      update: (s, m) => {
        const [c] = cascadeSelect.update(s.c, m)
        return [{ c }, []]
      },
      view: ({ state, send }) => {
        sendRef = send
        const parts = cascadeSelect.connect(state.at('c'), send, { id: 'cs' })
        return [
          div({ ...parts.root }, [
            div({ ...parts.level(0).select }, []),
            div({ ...parts.level(1).select }, []),
            text(state.at('c').map((c) => c.values.filter(Boolean).join(' → ') || '(none)')),
          ]),
        ]
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    app = mountApp(container, def)
    return { send: (m: CascadeSelectMsg) => sendRef(m), flush: () => app!.flush() }
  }

  it('second level not ready until first is set', () => {
    mount()
    const level1 = document.getElementById('cs:level:1') as HTMLElement
    expect(level1.getAttribute('data-ready')).toBeNull()
  })

  it('selecting first level makes second ready', () => {
    const { send, flush } = mount()
    send({ type: 'setValue', levelIndex: 0, value: 'US' })
    flush()
    const level1 = document.getElementById('cs:level:1') as HTMLElement
    expect(level1.getAttribute('data-ready')).toBe('')
  })

  it('data-complete removed when first level changes', () => {
    const { send, flush } = mount()
    send({ type: 'setValue', levelIndex: 0, value: 'US' })
    send({ type: 'setValue', levelIndex: 1, value: 'CA' })
    flush()
    const root = document.querySelector('[data-part="root"]')!
    expect(root.getAttribute('data-complete')).toBe('')
    send({ type: 'setValue', levelIndex: 0, value: 'US' })
    flush()
    // Re-setting country clears region → no longer complete
    expect(root.getAttribute('data-complete')).toBeNull()
  })

  it('root data-complete when all levels set', () => {
    const { send, flush } = mount()
    send({ type: 'setValue', levelIndex: 0, value: 'US' })
    flush()
    send({ type: 'setValue', levelIndex: 1, value: 'CA' })
    flush()
    const root = document.querySelector('[data-part="root"]')!
    expect(root.getAttribute('data-complete')).toBe('')
  })
})
