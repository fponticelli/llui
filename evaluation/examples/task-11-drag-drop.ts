/**
 * Task 11 — Drag and Drop List (Tier 6)
 * Idiomatic score: 6/6
 */
import { component, div, text, each } from '@llui/dom'

type Item = { id: number; label: string }

type State = {
  items: Item[]
  draggedId: number | null
}

type Msg =
  | { type: 'dragStart'; id: number }
  | { type: 'dragEnd' }
  | { type: 'drop'; targetId: number }

type Effect = never

export const DragDropList = component<State, Msg, Effect>({
  name: 'DragDropList',
  init: () => [
    {
      items: [
        { id: 1, label: 'Item A' },
        { id: 2, label: 'Item B' },
        { id: 3, label: 'Item C' },
        { id: 4, label: 'Item D' },
        { id: 5, label: 'Item E' },
      ],
      draggedId: null,
    },
    [],
  ],
  update: (state, msg) => {
    switch (msg.type) {
      case 'dragStart':
        return [{ ...state, draggedId: msg.id }, []]
      case 'dragEnd':
        return [{ ...state, draggedId: null }, []]
      case 'drop': {
        if (state.draggedId === null || state.draggedId === msg.targetId) {
          return [{ ...state, draggedId: null }, []]
        }
        const items = [...state.items]
        const fromIdx = items.findIndex((i) => i.id === state.draggedId)
        const toIdx = items.findIndex((i) => i.id === msg.targetId)
        if (fromIdx === -1 || toIdx === -1) return [{ ...state, draggedId: null }, []]
        const [moved] = items.splice(fromIdx, 1)
        items.splice(toIdx, 0, moved!)
        return [{ ...state, items, draggedId: null }, []]
      }
    }
  },
  view: ({ send, each }) => [
    div({ class: 'drag-drop-list' }, [
      ...each({
        items: (s) => s.items,
        key: (item) => item.id,
        render: ({ item }) => [
          div(
            {
              class: 'drag-item',
              draggable: 'true',
              'data-testid': item((t) => String(t.id)),
              onDragstart: (e: DragEvent) => {
                const id = item.id()
                e.dataTransfer?.setData('text/plain', String(id))
                send({ type: 'dragStart', id })
              },
              onDragover: (e: DragEvent) => {
                e.preventDefault()
              },
              onDrop: (e: DragEvent) => {
                e.preventDefault()
                send({ type: 'drop', targetId: item.id() })
              },
              onDragend: () => {
                send({ type: 'dragEnd' })
              },
            },
            [text(item((t) => t.label))],
          ),
        ],
      }),
    ]),
  ],
})
