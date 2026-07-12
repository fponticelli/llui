import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { component, mountApp, div, input, each, text } from '@llui/dom'
import { tagsInput, type TagsInputState, type TagsInputMsg } from '../../src/components/tags-input'

type S = { t: TagsInputState }

function key(el: Element, k: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
}

describe('tags-input integration — DOM focus follows keyboard', () => {
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
    const def = component<S, TagsInputMsg, never>({
      name: 'T',
      init: () => [{ t: tagsInput.init({ value: ['x', 'y', 'z'] }) }, []],
      update: (s, m) => [{ t: tagsInput.update(s.t, m)[0] }, []],
      view: ({ state, send }) => {
        const parts = tagsInput.connect(state.at('t'), send)
        return [
          div({ ...parts.root }, [
            each(
              state.at('t').map((s) => s.value),
              {
                key: (v) => v,
                render: (v, i) => [div({ ...parts.tag(v.peek(), i.peek()).root }, [text(v)])],
              },
            ),
            input({ ...parts.input }),
          ]),
        ]
      },
    })
    app = mountApp(container, def)
  }

  const tag = (index: number): HTMLElement =>
    container.querySelector(`[data-part="tag"][data-index="${index}"]`) as HTMLElement
  const field = (): HTMLElement => container.querySelector('[data-part="input"]') as HTMLElement

  it('ArrowLeft moves DOM focus to the previous tag', () => {
    mount()
    tag(2).focus()
    key(tag(2), 'ArrowLeft')
    expect(document.activeElement).toBe(tag(1))
  })

  it('ArrowRight past the last tag returns DOM focus to the input', () => {
    mount()
    tag(2).focus()
    key(tag(2), 'ArrowRight')
    expect(document.activeElement).toBe(field())
  })

  it('Backspace on a tag returns DOM focus to the input', () => {
    mount()
    tag(1).focus()
    key(tag(1), 'Backspace')
    expect(document.activeElement).toBe(field())
  })
})
