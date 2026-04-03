import { div, h1, form, fieldset, input, textarea, button, text } from '@llui/dom'
import type { State, Msg } from '../types'
import type { Send } from '@llui/dom'
import { errorList } from './auth'

export function editorPage(s: State, send: Send<Msg>): HTMLElement[] {
  return [
    div({ class: 'editor-page' }, [
      div({ class: 'container page' }, [
        div({ class: 'row' }, [
          div({ class: 'col-md-10 offset-md-1 col-xs-12' }, [
            errorList(s.errors),
            form({
              onSubmit: (e: Event) => {
                e.preventDefault()
                send({ type: 'submitArticle' })
              },
            }, [
              fieldset({}, [
                fieldset({ class: 'form-group' }, [
                  input({
                    class: 'form-control form-control-lg',
                    type: 'text',
                    placeholder: 'Article Title',
                    value: s.editorTitle,
                    onInput: (e: Event) => send({ type: 'setField', field: 'editorTitle', value: (e.target as HTMLInputElement).value }),
                  }),
                ]),
                fieldset({ class: 'form-group' }, [
                  input({
                    class: 'form-control',
                    type: 'text',
                    placeholder: "What's this article about?",
                    value: s.editorDescription,
                    onInput: (e: Event) => send({ type: 'setField', field: 'editorDescription', value: (e.target as HTMLInputElement).value }),
                  }),
                ]),
                fieldset({ class: 'form-group' }, [
                  textarea({
                    class: 'form-control',
                    placeholder: 'Write your article (in markdown)',
                    value: s.editorBody,
                    onInput: (e: Event) => send({ type: 'setField', field: 'editorBody', value: (e.target as HTMLTextAreaElement).value }),
                  }),
                ]),
                fieldset({ class: 'form-group' }, [
                  input({
                    class: 'form-control',
                    type: 'text',
                    placeholder: 'Enter tags (comma separated)',
                    value: s.editorTags,
                    onInput: (e: Event) => send({ type: 'setField', field: 'editorTags', value: (e.target as HTMLInputElement).value }),
                  }),
                ]),
                button({
                  class: 'btn btn-lg pull-xs-right btn-primary',
                  type: 'submit',
                  disabled: s.loading,
                }, [text('Publish Article')]),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]),
  ]
}
