// Signals showcase — Editor.
//
// Covers: foreign() — an imperative widget integrated as a LiveSignal boundary.
// Declared `state` signals are materialized to LiveSignals for `mount`; the
// widget pushes edits back out via `send`. Also a derived word count via .map().

import { component, div, text, foreign } from '@llui/dom'

interface State {
  content: string
  words: number
}
type Msg = { type: 'edited'; content: string }

/** A tiny imperative editor (stands in for ProseMirror/Monaco/CodeMirror). */
class PlainEditor {
  readonly el: HTMLElement
  constructor(host: Element, onInput: (value: string) => void) {
    this.el = host.ownerDocument.createElement('div')
    this.el.contentEditable = 'true'
    this.el.className = 'editor'
    host.appendChild(this.el)
    this.el.addEventListener('input', () => onInput(this.el.textContent ?? ''))
  }
  setContent(value: string): void {
    if (this.el.textContent !== value) this.el.textContent = value
  }
  destroy(): void {
    this.el.remove()
  }
}

export const Editor = component<State, Msg>({
  init: () => ({ content: '', words: 0 }),

  update: (_s, m) => {
    const trimmed = m.content.trim()
    return { content: m.content, words: trimmed ? trimmed.split(/\s+/).length : 0 }
  },

  view: ({ state, send }) => [
    div({ class: 'wordcount' }, [text(state.at('words').map((w) => `${w} words`))]),
    foreign({
      tag: 'div',
      // declared input: the editor reacts to `content` changing
      state: { content: state.at('content') },
      mount: ({ el, state: sig }) => {
        const ed = new PlainEditor(el, (value) => send({ type: 'edited', content: value }))
        // bind fires immediately with the current value, then on every change
        sig.content.bind((c) => ed.setContent(c))
        return ed
      },
      unmount: (ed) => ed.destroy(),
    }),
  ],
})
