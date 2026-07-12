import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { component, mountApp, div, text } from '@llui/dom'
import { toolbar, type ToolbarState, type ToolbarMsg } from '../../src/components/toolbar'

type S = { t: ToolbarState }

const ITEMS = ['bold', 'italic', 'underline']

function key(el: Element, k: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
}

describe('toolbar integration — DOM focus follows keyboard', () => {
  let app: ReturnType<typeof mountApp> | null = null
  let container: HTMLElement

  beforeEach(() => {
    document.body.innerHTML = ''
    container = document.createElement('div')
    document.body.appendChild(container)
  })
  afterEach(() => {
    app?.dispose()
    app = null
    document.body.innerHTML = ''
  })

  function mount() {
    const def = component<S, ToolbarMsg, never>({
      name: 'T',
      init: () => [{ t: toolbar.init({ items: ITEMS, focused: 'bold' }) }, []],
      update: (s, m) => [{ t: toolbar.update(s.t, m)[0] }, []],
      view: ({ state, send }) => {
        const parts = toolbar.connect(state.at('t'), send, { id: 'tb' })
        return [
          div(
            { ...parts.root },
            ITEMS.map((v) => div({ ...parts.item(v).root }, [text(v)])),
          ),
        ]
      },
    })
    app = mountApp(container, def)
  }

  const item = (v: string): HTMLElement =>
    container.querySelector(`[data-part="item"][data-value="${v}"]`) as HTMLElement

  it('ArrowRight moves DOM focus to the next item', () => {
    mount()
    item('bold').focus()
    key(item('bold'), 'ArrowRight')
    expect(document.activeElement).toBe(item('italic'))
  })

  it('End moves DOM focus to the last item', () => {
    mount()
    item('bold').focus()
    key(item('bold'), 'End')
    expect(document.activeElement).toBe(item('underline'))
  })

  it('ArrowLeft wraps DOM focus to the last item', () => {
    mount()
    item('bold').focus()
    key(item('bold'), 'ArrowLeft')
    expect(document.activeElement).toBe(item('underline'))
  })
})
