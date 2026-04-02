import {
  div,
  span,
  button,
  input,
  label,
  text,
  each,
  show,
  memo,
  portal,
  table,
  thead,
  tbody,
  tr,
  th,
  td,
  type Send,
} from '@llui/core'

type Contact = { id: number; name: string; email: string; company: string; tag: string }
type ContactForm = { name: string; email: string; company: string; tag: string }

export type ContactsSlice = {
  items: Contact[]
  search: string
  editingId: number | null
  dialogOpen: boolean
  form: ContactForm
}

export type ContactsMsg =
  | { type: 'setSearch'; value: string }
  | { type: 'openAdd' }
  | { type: 'openEdit'; id: number }
  | { type: 'closeDialog' }
  | { type: 'setField'; field: keyof ContactForm; value: string }
  | { type: 'save' }
  | { type: 'delete'; id: number }

let nextId = 100

export const initialContacts: Contact[] = [
  { id: 1, name: 'Alice Johnson', email: 'alice@example.com', company: 'TechCorp', tag: 'vip' },
  { id: 2, name: 'Bob Smith', email: 'bob@example.com', company: 'DataInc', tag: 'active' },
  { id: 3, name: 'Carol Lee', email: 'carol@example.com', company: 'DesignCo', tag: 'new' },
  { id: 4, name: 'David Park', email: 'david@example.com', company: 'TechCorp', tag: 'active' },
  { id: 5, name: 'Eva Martinez', email: 'eva@example.com', company: 'StartupXYZ', tag: 'vip' },
]

export function contactsUpdate(slice: ContactsSlice, msg: ContactsMsg): ContactsSlice {
  switch (msg.type) {
    case 'setSearch':
      return { ...slice, search: msg.value }
    case 'openAdd':
      return { ...slice, dialogOpen: true, editingId: null, form: { name: '', email: '', company: '', tag: 'active' } }
    case 'openEdit': {
      const contact = slice.items.find((c) => c.id === msg.id)
      if (!contact) return slice
      return { ...slice, dialogOpen: true, editingId: msg.id, form: { name: contact.name, email: contact.email, company: contact.company, tag: contact.tag } }
    }
    case 'closeDialog':
      return { ...slice, dialogOpen: false, editingId: null }
    case 'setField':
      return { ...slice, form: { ...slice.form, [msg.field]: msg.value } }
    case 'save': {
      if (!slice.form.name.trim() || !slice.form.email.trim()) return slice
      if (slice.editingId !== null) {
        return {
          ...slice,
          dialogOpen: false,
          editingId: null,
          items: slice.items.map((c) =>
            c.id === slice.editingId
              ? { ...c, name: slice.form.name, email: slice.form.email, company: slice.form.company, tag: slice.form.tag }
              : c,
          ),
        }
      }
      const newContact: Contact = { id: nextId++, ...slice.form }
      return { ...slice, dialogOpen: false, items: [...slice.items, newContact] }
    }
    case 'delete':
      return { ...slice, items: slice.items.filter((c) => c.id !== msg.id) }
  }
}

export type ContactsProps<S> = {
  contacts: (s: S) => ContactsSlice
}

export function contactsView<S>(
  props: ContactsProps<S>,
  send: Send<ContactsMsg>,
): Node[] {
  const filtered = memo((s: S) => {
    const c = props.contacts(s)
    const q = c.search.toLowerCase()
    if (!q) return c.items
    return c.items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.email.toLowerCase().includes(q) ||
        item.company.toLowerCase().includes(q),
    )
  })

  return [
    div({ class: 'table-container' }, [
      div({ class: 'table-header' }, [
        input({
          type: 'text',
          placeholder: 'Search contacts...',
          value: (s: S) => props.contacts(s).search,
          onInput: (e: Event) =>
            send({ type: 'setSearch', value: (e.target as HTMLInputElement).value }),
        }),
        button(
          { class: 'btn btn-primary', onClick: () => send({ type: 'openAdd' }) },
          [text('+ Add Contact')],
        ),
      ]),
      table({}, [
        thead({}, [
          tr({}, [
            th({}, [text('Name')]),
            th({}, [text('Email')]),
            th({}, [text('Company')]),
            th({}, [text('Tag')]),
            th({}, [text('')]),
          ]),
        ]),
        tbody(
          {},
          each<S, Contact>({
            items: filtered,
            key: (c) => c.id,
            render: (item) => [
              tr({}, [
                td({}, [text(item((c) => c.name))]),
                td({}, [text(item((c) => c.email))]),
                td({}, [text(item((c) => c.company))]),
                td({}, [
                  span(
                    { class: item((c) => `tag ${c.tag}`) },
                    [text(item((c) => c.tag))],
                  ),
                ]),
                td({}, [
                  button(
                    {
                      class: 'btn btn-ghost btn-sm',
                      onClick: () => send({ type: 'openEdit', id: item((c) => c.id)() }),
                    },
                    [text('Edit')],
                  ),
                  button(
                    {
                      class: 'btn btn-danger btn-sm',
                      onClick: () => send({ type: 'delete', id: item((c) => c.id)() }),
                    },
                    [text('Delete')],
                  ),
                ]),
              ]),
            ],
          }),
        ),
      ]),
    ]),

    // Add/Edit dialog
    ...show<S>({
      when: (s) => props.contacts(s).dialogOpen,
      render: () =>
        portal({
          target: document.body,
          render: () => [
            div({ class: 'dialog-backdrop', onClick: () => send({ type: 'closeDialog' }), role: 'presentation' }),
            div({ class: 'dialog-positioner' }, [
              div({ class: 'dialog-content', role: 'dialog', 'aria-modal': 'true' }, [
                div({ class: 'dialog-header' }, [
                  text((s: S) => props.contacts(s).editingId ? 'Edit Contact' : 'New Contact'),
                ]),
                div({ class: 'dialog-body' }, [
                  formField('Name', 'name', send, props),
                  formField('Email', 'email', send, props),
                  formField('Company', 'company', send, props),
                ]),
                div({ class: 'dialog-footer' }, [
                  button(
                    { class: 'btn btn-ghost', onClick: () => send({ type: 'closeDialog' }) },
                    [text('Cancel')],
                  ),
                  button(
                    { class: 'btn btn-primary', onClick: () => send({ type: 'save' }) },
                    [text('Save')],
                  ),
                ]),
              ]),
            ]),
          ],
        }),
    }),
  ]
}

function formField<S>(
  labelText: string,
  field: keyof ContactForm,
  send: Send<ContactsMsg>,
  props: ContactsProps<S>,
): HTMLElement {
  return div({ class: 'form-group' }, [
    label({}, [text(labelText)]),
    input({
      type: 'text',
      value: (s: S) => props.contacts(s).form[field],
      onInput: (e: Event) =>
        send({ type: 'setField', field, value: (e.target as HTMLInputElement).value }),
    }),
  ])
}
