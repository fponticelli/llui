// Right-click context menu — a plugin-UI overlay. `register` installs a
// `contextmenu` listener on the editor root and opens the menu at the pointer;
// the plugin-UI renders the menu and runs the chosen command.

import { div, each, text, type Signal } from '@llui/dom'
import { definePluginUI } from './ui.js'
import { OVERLAY_Z, hideOverlay, overlayRoot } from './overlay.js'
import type { CommandItem, MarkdownPlugin } from './types.js'

interface MenuItem {
  id: string
  label: string
}

interface ContextState {
  open: boolean
  x: number
  y: number
  items: MenuItem[]
}

type ContextMsg =
  | { type: 'open'; x: number; y: number; items: MenuItem[] }
  | { type: 'close' }
  | { type: 'choose'; index: number }

type ContextEffect = { type: 'run'; id: string }

export function contextMenuPlugin(): MarkdownPlugin {
  let contextItems: CommandItem[] = []

  return {
    name: 'contextMenu',
    onItems: (items) => {
      // Curated: only items that explicitly opt into the context menu (insert
      // actions, links, history). Inline formatting lives in the floating bar.
      contextItems = items.filter((i) => i.surfaces?.includes('context') ?? false)
    },
    register: (editor, ctx) => {
      const onContext = (e: Event): void => {
        const me = e as MouseEvent
        e.preventDefault()
        ctx.emit({
          type: 'plugin',
          name: 'contextMenu',
          msg: {
            type: 'open',
            x: me.clientX,
            y: me.clientY,
            items: contextItems.map((i) => ({ id: i.id, label: i.label })),
          },
        })
      }
      const root = editor.getRootElement()
      root?.addEventListener('contextmenu', onContext)
      return () => {
        editor.getRootElement()?.removeEventListener('contextmenu', onContext)
      }
    },
    ui: definePluginUI<ContextState, ContextMsg, ContextEffect>({
      init: () => ({ open: false, x: 0, y: 0, items: [] }),
      update: (state, msg) => {
        switch (msg.type) {
          case 'open':
            return { open: msg.items.length > 0, x: msg.x, y: msg.y, items: msg.items }
          case 'close':
            return hideOverlay(state)
          case 'choose': {
            const item = state.items[msg.index]
            if (!item) return hideOverlay(state)
            return [{ ...state, open: false }, [{ type: 'run', id: item.id }]]
          }
        }
      },
      onEffect: (effect, ctx) => {
        ctx.emit({ type: 'runCommand', id: effect.id })
      },
      view: ({ state, send }) =>
        overlayRoot({
          open: state.at('open'),
          x: state.at('x'),
          y: state.at('y'),
          zIndex: OVERLAY_Z.contextMenu,
          attrs: { 'data-scope': 'md-context', 'data-part': 'root' },
          // Backdrop closes the menu on any outside interaction.
          before: () => [
            div({
              'data-scope': 'md-context',
              'data-part': 'backdrop',
              onMouseDown: () => send({ type: 'close' }),
              onContextMenu: (e: Event) => {
                e.preventDefault()
                send({ type: 'close' })
              },
            }),
          ],
          children: () => [
            each(state.at('items') as Signal<MenuItem[]>, {
              key: (it) => it.id,
              render: (item, index) => [
                div(
                  {
                    'data-scope': 'md-context',
                    'data-part': 'option',
                    onMouseDown: (e: MouseEvent) => {
                      e.preventDefault()
                      send({ type: 'choose', index: index.peek() })
                    },
                  },
                  [text(item.map((it) => it.label))],
                ),
              ],
            }),
          ],
        }),
    }),
  }
}
