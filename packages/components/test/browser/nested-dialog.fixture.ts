import { button, component, div, h2, mountApp, text } from '@llui/dom'
import * as dialog from '../../src/components/dialog.js'

type State = {
  outer: dialog.DialogState
  inner: dialog.DialogState
}

type Msg = { type: 'outer'; msg: dialog.DialogMsg } | { type: 'inner'; msg: dialog.DialogMsg }

declare global {
  interface Window {
    __dialogReady: boolean
    __focusTrace: Array<{ id: string; outerInert: boolean }>
  }
}

window.__dialogReady = false
window.__focusTrace = []

document.addEventListener(
  'focusin',
  (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const outer = document.getElementById('outer:content')
    window.__focusTrace.push({
      id: target.id,
      outerInert: outer?.closest('[inert]') !== null,
    })
  },
  true,
)

const app = component<State, Msg, never>({
  name: 'NestedDialogFocusRestore',
  init: () => [
    {
      outer: dialog.init(),
      inner: dialog.init(),
    },
    [],
  ],
  update: (state, msg) => {
    if (msg.type === 'outer') {
      const [outer] = dialog.update(state.outer, msg.msg)
      return [{ ...state, outer }, []]
    }
    const [inner] = dialog.update(state.inner, msg.msg)
    return [{ ...state, inner }, []]
  },
  view: ({ state, send }) => {
    const outerSend = (msg: dialog.DialogMsg): void => send({ type: 'outer', msg })
    const innerSend = (msg: dialog.DialogMsg): void => send({ type: 'inner', msg })
    const outer = dialog.connect(state.at('outer'), outerSend, { id: 'outer' })
    const inner = dialog.connect(state.at('inner'), innerSend, { id: 'inner' })

    return [
      button({ ...outer.trigger }, [text('Open outer dialog')]),
      dialog.overlay({
        state: state.at('outer'),
        send: outerSend,
        parts: outer,
        content: () => [
          div({ ...outer.content }, [
            h2({ ...outer.title }, [text('Outer dialog')]),
            button({ ...inner.trigger }, [text('Open inner dialog')]),
            button({ ...outer.closeTrigger, id: 'outer:close' }, [text('Close outer dialog')]),
          ]),
        ],
      }),
      dialog.overlay({
        state: state.at('inner'),
        send: innerSend,
        parts: inner,
        content: () => [
          div({ ...inner.content }, [
            h2({ ...inner.title }, [text('Inner dialog')]),
            button({ ...inner.closeTrigger, id: 'inner:close' }, [text('Close inner dialog')]),
          ]),
        ],
      }),
    ]
  },
})

mountApp(document.getElementById('app')!, app)
window.__dialogReady = true
