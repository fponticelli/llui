import { button, component, div, mountApp, text } from '@llui/dom'
import * as contextMenu from '../../src/components/context-menu.js'
import * as dialog from '../../src/components/dialog.js'

type State = {
  menu: contextMenu.ContextMenuState
  dialog: dialog.DialogState
}

type Msg =
  | { type: 'menu'; msg: contextMenu.ContextMenuMsg }
  | { type: 'dialog'; msg: dialog.DialogMsg }

declare global {
  interface Window {
    __contextMenuReady: boolean
    __selectedContextItem: string | null
    __openDialog: () => void
    __closeDialog: () => void
    __closeContextMenu: () => void
    __serializedState: () => string
    __contextMenuWasOpenAtEvent: boolean[]
  }
}

window.__contextMenuReady = false
window.__selectedContextItem = null
window.__contextMenuWasOpenAtEvent = []

document.addEventListener(
  'contextmenu',
  () => {
    window.__contextMenuWasOpenAtEvent.push(document.getElementById('cm:content') !== null)
  },
  true,
)

let sendRef!: (msg: Msg) => void

const app = component<State, Msg, never>({
  name: 'ContextMenuOwnershipFixture',
  init: () => [
    {
      menu: contextMenu.init({
        items: [
          { value: 'a', kind: 'action' },
          { value: 'b', kind: 'action' },
        ],
      }),
      dialog: dialog.init(),
    },
    [],
  ],
  update: (state, msg) => {
    if (msg.type === 'menu') {
      const [menu] = contextMenu.update(state.menu, msg.msg)
      return [{ ...state, menu }, []]
    }
    const [nextDialog] = dialog.update(state.dialog, msg.msg)
    return [{ ...state, dialog: nextDialog }, []]
  },
  view: ({ state, send }) => {
    sendRef = send
    const menuSend = (msg: contextMenu.ContextMenuMsg): void => send({ type: 'menu', msg })
    const dialogSend = (msg: dialog.DialogMsg): void => send({ type: 'dialog', msg })
    const menu = contextMenu.connect(state.at('menu'), menuSend, {
      id: 'cm',
      onSelect: (value) => {
        window.__selectedContextItem = value
      },
    })
    const modal = dialog.connect(state.at('dialog'), dialogSend, { id: 'dlg' })

    return [
      button({ id: 'before' }, [text('Before')]),
      div({ ...menu.trigger, id: 'outside-region', tabindex: 0 }, [text('Outside region')]),
      contextMenu.overlay({
        state: state.at('menu'),
        send: menuSend,
        parts: menu,
        content: () => [
          div({ ...menu.content }, [
            button({ ...menu.item('a').item }, [text('A')]),
            button({ ...menu.item('b').item }, [text('B')]),
            button({ id: 'cm-extra' }, [text('Extra action')]),
          ]),
        ],
      }),
      button({ ...modal.trigger }, [text('Open dialog')]),
      dialog.overlay({
        state: state.at('dialog'),
        send: dialogSend,
        parts: modal,
        content: () => [
          div({ ...modal.content }, [
            button({ id: 'dlg-action' }, [text('Dialog action')]),
            div({ ...menu.trigger, id: 'inside-region', tabindex: 0 }, [text('Inside region')]),
          ]),
        ],
      }),
    ]
  },
})

const handle = mountApp(document.getElementById('app')!, app)
window.__openDialog = () => sendRef({ type: 'dialog', msg: { type: 'open' } })
window.__closeDialog = () => sendRef({ type: 'dialog', msg: { type: 'close' } })
window.__closeContextMenu = () => sendRef({ type: 'menu', msg: { type: 'close' } })
window.__serializedState = () => JSON.stringify(handle.getState())
window.__contextMenuReady = true
