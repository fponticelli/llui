import { div, text, type Send, type Signal, type Mountable } from '@llui/dom'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { Label } from '../components/ui/label'
import { Separator } from '../components/ui/separator'
import { row, section } from './shared'

export interface State {
  email: string
  note: string
}

export type Msg = { type: 'setEmail'; value: string } | { type: 'setNote'; value: string }

export const init = (): [State, never[]] => [{ email: '', note: '' }, []]

export function update(state: State, msg: Msg): [State, never[]] {
  switch (msg.type) {
    case 'setEmail':
      return [{ ...state, email: msg.value }, []]
    case 'setNote':
      return [{ ...state, note: msg.value }, []]
  }
}

export function view(state: Signal<State>, send: Send<Msg>): Mountable {
  return section(
    'Input, Textarea, Label & Separator',
    'The caller owns the value binding. An input with a reactive `value` and no onInput is a compile ERROR (controlled-input) — the binding would overwrite every keystroke.',
    [
      div({ class: 'flex flex-col gap-2' }, [
        Label({ for: 'email' }, [text('Email')]),
        Input({
          id: 'email',
          type: 'email',
          placeholder: 'you@example.com',
          value: state.at('email'),
          onInput: (e) => send({ type: 'setEmail', value: (e.target as HTMLInputElement).value }),
        }),
      ]),
      div({ class: 'flex flex-col gap-2' }, [
        Label({ for: 'note' }, [text('Note')]),
        Textarea({
          id: 'note',
          rows: 3,
          placeholder: 'Anything you like…',
          value: state.at('note'),
          onInput: (e) => send({ type: 'setNote', value: (e.target as HTMLTextAreaElement).value }),
        }),
      ]),
      row('States', [
        Input({ placeholder: 'Disabled', disabled: true, class: 'max-w-56' }),
        Input({ placeholder: 'Invalid', 'aria-invalid': 'true', class: 'max-w-56' }),
      ]),
      Separator({ class: 'my-1' }),
      div({ class: 'flex h-8 items-center gap-3 text-sm' }, [
        text('Vertical'),
        Separator({ orientation: 'vertical' }),
        text('separator'),
      ]),
    ],
  )
}
