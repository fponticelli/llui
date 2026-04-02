import {
  div,
  button,
  text,
  show,
  portal,
  onMount,
  type Send,
} from '@llui/core'

export type DialogSlice = {
  open: boolean
}

export type DialogMsg =
  | { type: 'dialog:open' }
  | { type: 'dialog:close' }
  | { type: 'dialog:toggle' }

export type DialogProps<S> = {
  open: (s: S) => boolean
  trigger: () => Node[]
  title: string
  content: () => Node[]
  onConfirm?: () => void
}

export function dialogUpdate(slice: DialogSlice, msg: DialogMsg): DialogSlice {
  switch (msg.type) {
    case 'dialog:open':
      return { open: true }
    case 'dialog:close':
      return { open: false }
    case 'dialog:toggle':
      return { open: !slice.open }
  }
}

export function dialogView<S>(
  props: DialogProps<S>,
  send: Send<DialogMsg>,
): Node[] {
  return [
    div(
      {
        onClick: () => send({ type: 'dialog:toggle' }),
        role: 'button',
        tabIndex: '0',
      },
      props.trigger(),
    ),
    ...show<S>({
      when: props.open,
      render: () =>
        portal({
          target: document.body,
          render: () => [
            // Backdrop
            div(
              {
                class: 'dialog-backdrop',
                'data-scope': 'dialog',
                'data-part': 'backdrop',
                onClick: () => send({ type: 'dialog:close' }),
              },
            ),
            // Positioner + Content
            div(
              {
                class: 'dialog-positioner',
                'data-scope': 'dialog',
                'data-part': 'positioner',
              },
              [
                div(
                  {
                    class: 'dialog-content',
                    role: 'dialog',
                    'aria-modal': 'true',
                    'aria-label': props.title,
                    'data-scope': 'dialog',
                    'data-part': 'content',
                    'data-state': 'open',
                  },
                  [
                    div(
                      {
                        class: 'dialog-header',
                        'data-scope': 'dialog',
                        'data-part': 'title',
                      },
                      [text(props.title)],
                    ),
                    div(
                      {
                        class: 'dialog-body',
                        'data-scope': 'dialog',
                        'data-part': 'description',
                      },
                      props.content(),
                    ),
                    div({ class: 'dialog-footer' }, [
                      button(
                        {
                          class: 'dialog-close',
                          'data-scope': 'dialog',
                          'data-part': 'close-trigger',
                          onClick: () => send({ type: 'dialog:close' }),
                        },
                        [text('Cancel')],
                      ),
                      ...(props.onConfirm
                        ? [
                            button(
                              {
                                class: 'dialog-confirm',
                                onClick: () => {
                                  props.onConfirm!()
                                  send({ type: 'dialog:close' })
                                },
                              },
                              [text('Confirm')],
                            ),
                          ]
                        : []),
                    ]),
                  ],
                ),
              ],
            ),
          ],
        }),
    }),
  ]
}
