import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { component, mountApp, div, text } from '@llui/dom'
import {
  ratingGroup,
  type RatingGroupState,
  type RatingGroupMsg,
} from '../../src/components/rating-group'

type S = { r: RatingGroupState }

function key(el: Element, k: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
}

describe('rating-group integration — DOM focus follows keyboard', () => {
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

  function mount(value: number) {
    const def = component<S, RatingGroupMsg, never>({
      name: 'T',
      init: () => [{ r: ratingGroup.init({ value, count: 5 }) }, []],
      update: (s, m) => [{ r: ratingGroup.update(s.r, m)[0] }, []],
      view: ({ state, send }) => {
        const parts = ratingGroup.connect(state.at('r'), send)
        return [
          div(
            { ...parts.root },
            Array.from({ length: 5 }, (_, i) =>
              div({ ...parts.item(i).root }, [text(String(i + 1))]),
            ),
          ),
        ]
      },
    })
    app = mountApp(container, def)
  }

  const item = (v: number): HTMLElement =>
    container.querySelector(`[data-part="item"][data-value="${v}"]`) as HTMLElement

  it('ArrowRight moves DOM focus to the newly-active star', () => {
    mount(3)
    item(3).focus()
    expect(document.activeElement).toBe(item(3))
    key(item(3), 'ArrowRight')
    expect(document.activeElement).toBe(item(4))
  })

  it('ArrowLeft moves DOM focus down a star', () => {
    mount(3)
    item(3).focus()
    key(item(3), 'ArrowLeft')
    expect(document.activeElement).toBe(item(2))
  })

  it('End moves DOM focus to the last star', () => {
    mount(2)
    item(2).focus()
    key(item(2), 'End')
    expect(document.activeElement).toBe(item(5))
  })
})
