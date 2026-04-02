import { div, button, text, show, type Send } from '@llui/core'

export type AccordionSlice = {
  openItems: string[]
}

export type AccordionMsg =
  | { type: 'accordion:toggle'; item: string }

export interface AccordionItemDef {
  id: string
  label: string
  content: () => Node[]
}

export type AccordionProps<S> = {
  openItems: (s: S) => string[]
  items: AccordionItemDef[]
  multiple?: boolean
}

export function accordionUpdate(
  slice: AccordionSlice,
  msg: AccordionMsg,
  multiple = false,
): AccordionSlice {
  switch (msg.type) {
    case 'accordion:toggle': {
      const isOpen = slice.openItems.includes(msg.item)
      if (isOpen) {
        return { openItems: slice.openItems.filter((id) => id !== msg.item) }
      }
      if (multiple) {
        return { openItems: [...slice.openItems, msg.item] }
      }
      return { openItems: [msg.item] }
    }
  }
}

export function accordionView<S>(
  props: AccordionProps<S>,
  send: Send<AccordionMsg>,
): Node[] {
  return [
    div(
      {
        class: 'accordion',
        'data-scope': 'accordion',
        'data-part': 'root',
      },
      props.items.map((item) =>
        div(
          {
            class: 'accordion-item',
            'data-scope': 'accordion',
            'data-part': 'item',
            'data-value': item.id,
          },
          [
            button(
              {
                class: (s: S) =>
                  props.openItems(s).includes(item.id)
                    ? 'accordion-trigger open'
                    : 'accordion-trigger',
                'aria-expanded': (s: S) =>
                  props.openItems(s).includes(item.id) ? 'true' : 'false',
                'data-scope': 'accordion',
                'data-part': 'item-trigger',
                onClick: () => send({ type: 'accordion:toggle', item: item.id }),
              },
              [text(item.label)],
            ),
            ...show<S>({
              when: (s) => props.openItems(s).includes(item.id),
              render: () => [
                div(
                  {
                    class: 'accordion-content',
                    role: 'region',
                    'data-scope': 'accordion',
                    'data-part': 'item-content',
                    'data-state': 'open',
                  },
                  item.content(),
                ),
              ],
            }),
          ],
        ),
      ),
    ),
  ]
}
