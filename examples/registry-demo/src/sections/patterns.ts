import { div, each, p, span, text } from '@llui/dom'
import type { Mountable, Send, Signal } from '@llui/dom'
import * as confirmC from '@llui/components/patterns/confirm-dialog'
import * as formFieldC from '@llui/components/patterns/form-field'
import * as searchableC from '@llui/components/patterns/searchable-select'
import * as wizardC from '@llui/components/patterns/wizard'
import * as dialogC from '@llui/components/dialog'
import { Button } from '../components/ui/button'
import {
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog'
import { DialogBackdrop } from '../components/ui/dialog'
import { Form, FormDescription, FormItem, FormLabel, FormMessage } from '../components/ui/form'
import { Input } from '../components/ui/input'
import { SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { CommandInput, CommandList } from '../components/ui/command'
import { Steps, StepsItem, StepsSeparator, StepsTrigger } from '../components/ui/steps'
import { section, row } from './shared'

const PEOPLE = ['Ada Lovelace', 'Alan Turing', 'Grace Hopper', 'Barbara Liskov', 'Edsger Dijkstra']
const WIZARD_STEPS = ['Account', 'Profile', 'Review']
const FIELDS = ['email', 'name'] as const

/**
 * A minimal Standard Schema. `form-field` takes any `StandardSchemaV1`, so the
 * demo hand-rolls one rather than pulling zod in for two rules — the point is
 * the SHAPE the pattern consumes, which is `~standard.validate` returning
 * either `{ value }` or `{ issues }`.
 */
const signupSchema = {
  '~standard': {
    version: 1 as const,
    vendor: 'demo',
    validate: (value: unknown) => {
      const v = value as Record<string, string>
      const issues: { message: string; path: string[] }[] = []
      if (!/^[^@\s]+@[^@\s]+$/.test(v.email ?? '')) {
        issues.push({ message: 'Enter a valid email address.', path: ['email'] })
      }
      if ((v.name ?? '').trim().length < 2) {
        issues.push({ message: 'Name must be at least 2 characters.', path: ['name'] })
      }
      return issues.length > 0 ? { issues } : { value }
    },
  },
}

export interface State {
  confirm: confirmC.ConfirmDialogState
  signup: formFieldC.FormFieldState
  /** The field VALUES. `form-field` owns validity, touched and submission —
   * never the values themselves, which stay ordinary app state. */
  values: { email: string; name: string }
  picker: searchableC.SearchableSelectState
  wizard: wizardC.WizardState
  /** What the confirm dialog last resolved to, so the `tag` round trip is visible. */
  lastConfirm: string | null
}

export type Msg =
  | { type: 'confirm'; msg: confirmC.ConfirmDialogMsg }
  | { type: 'signup'; msg: formFieldC.FormFieldMsg }
  | { type: 'setValue'; field: 'email' | 'name'; value: string }
  | { type: 'picker'; msg: searchableC.SearchableSelectMsg }
  | { type: 'wizard'; msg: wizardC.WizardMsg }
  | { type: 'askDelete' }

export const init = (): [State, never[]] => [
  {
    confirm: confirmC.init(),
    signup: formFieldC.init({ id: 'demo-signup', fields: FIELDS }),
    values: { email: '', name: '' },
    picker: searchableC.init({ items: PEOPLE, placeholder: 'Select a person' }),
    wizard: wizardC.init({ steps: [...WIZARD_STEPS], linear: true }),
    lastConfirm: null,
  },
  [],
]

export function update(state: State, msg: Msg): [State, never[]] {
  switch (msg.type) {
    case 'askDelete':
      return [
        {
          ...state,
          confirm: confirmC.update(
            state.confirm,
            // `openWith` carries an opaque TAG. That is the pattern's whole
            // point: one dialog slice serves every confirmation on the page,
            // and the reducer branches on the tag to decide what confirming
            // actually did.
            confirmC.openWith('delete-project', {
              title: 'Delete this project?',
              description: 'This cannot be undone. All 12 deployments go with it.',
              confirmLabel: 'Delete',
              destructive: true,
            }),
          )[0],
        },
        [],
      ]
    case 'confirm': {
      const tag = state.confirm.tag
      const confirm = confirmC.update(state.confirm, msg.msg)[0]
      if (msg.msg.type === 'confirm') {
        return [{ ...state, confirm, lastConfirm: `confirmed: ${tag ?? '—'}` }, []]
      }
      if (msg.msg.type === 'cancel') {
        return [{ ...state, confirm, lastConfirm: `cancelled: ${tag ?? '—'}` }, []]
      }
      return [{ ...state, confirm }, []]
    }
    case 'setValue': {
      const values = { ...state.values, [msg.field]: msg.value }
      // Re-validate on every keystroke. The pattern decides whether an error is
      // VISIBLE (touched, or the form was submitted), so validating eagerly does
      // not mean shouting at someone mid-word.
      const signup = formFieldC.update(state.signup, {
        type: 'validate',
        schema: signupSchema,
        values,
      })[0]
      return [{ ...state, values, signup }, []]
    }
    case 'signup': {
      let signup = formFieldC.update(state.signup, msg.msg)[0]
      if (msg.msg.type === 'submit') {
        // Validate first, then decide. `touchAll` is what makes every error
        // visible at once on a failed attempt.
        signup = formFieldC.update(signup, {
          type: 'validate',
          schema: signupSchema,
          values: state.values,
        })[0]
        const ok = signup.issues.length === 0
        signup = formFieldC.update(signup, ok ? { type: 'submitSuccess' } : { type: 'touchAll' })[0]
        if (!ok)
          signup = formFieldC.update(signup, {
            type: 'submitError',
            error: 'Fix the fields above.',
          })[0]
      }
      return [{ ...state, signup }, []]
    }
    case 'picker':
      return [{ ...state, picker: searchableC.update(state.picker, msg.msg)[0] }, []]
    case 'wizard':
      return [{ ...state, wizard: wizardC.update(state.wizard, msg.msg)[0] }, []]
  }
}

export function view(state: Signal<State>, send: Send<Msg>): readonly Mountable[] {
  const cfmSend = (m: confirmC.ConfirmDialogMsg): void => send({ type: 'confirm', msg: m })
  const signupSend = (m: formFieldC.FormFieldMsg): void => send({ type: 'signup', msg: m })
  const pickSend = (m: searchableC.SearchableSelectMsg): void => send({ type: 'picker', msg: m })
  const wizSend = (m: wizardC.WizardMsg): void => send({ type: 'wizard', msg: m })

  // `confirmDialog.view()` is NOT used here. It is a convenience view for
  // consumers of the BASELINE stylesheet: it hardcodes `btn btn-danger`,
  // `confirm-dialog__actions` and friends, which a registry consumer never
  // imports, so calling it would render unstyled buttons. The machine is wired
  // by hand instead — which is all `view()` does, minus the class names.
  const cfmDialog = dialogC.connect(
    state.at('confirm').map((s) => ({ open: s.open, status: s.open ? 'open' : 'closed' })),
    (m) => {
      if (m.type === 'close') cfmSend({ type: 'cancel' })
    },
    { id: 'demo-confirm', role: 'alertdialog' },
  )
  const signup = formFieldC.connect(state.at('signup'), signupSend, {
    id: 'demo-signup',
    fields: FIELDS,
  })
  const pick = searchableC.connect(state.at('picker'), pickSend, { id: 'demo-searchable' })
  const wiz = wizardC.connect(state.at('wizard'), wizSend, { label: 'Signup steps' })

  // shadcn's `FormItem` / `FormLabel` / `FormDescription` / `FormMessage`,
  // bound to `patterns/form-field` where upstream binds react-hook-form. There
  // is no `FormControl`: upstream's is a Slot forwarding id + aria onto its
  // child, and `parts.control` already carries exactly those, reactively.
  const field = (name: 'email' | 'name', label: string, hint: string): Mountable => {
    const parts = signup.formField(name, { hasDescription: true })
    return FormItem({ ...parts.root }, [
      FormLabel({ ...parts.label }, [text(label)]),
      Input({
        ...parts.control,
        value: state.at('values').at(name),
        onInput: (e: Event) =>
          send({ type: 'setValue', field: name, value: (e.target as HTMLInputElement).value }),
      }),
      FormDescription({ ...parts.description }, [text(hint)]),
      // `errorText` is attributes only and carries its own reactive `hidden`:
      // touched OR submitted, which is what stops a form shouting at someone
      // who has typed one character. The element stays MOUNTED so the live
      // region is registered before it has anything to say.
      FormMessage({ ...parts.errorText }, [text(parts.error.message)]),
    ])
  }

  return [
    section(
      'Confirm Dialog',
      'One dialog slice serves every confirmation on the page. `openWith` carries an opaque TAG, and the reducer branches on it to decide what confirming actually did.',
      [
        row('Ask', [
          Button({ variant: 'destructive', onClick: () => send({ type: 'askDelete' }) }, [
            text('Delete project'),
          ]),
          span({ class: 'text-xs text-muted-foreground' }, [
            text(state.at('lastConfirm').map((v) => v ?? 'nothing resolved yet')),
          ]),
        ]),
      ],
    ),
    dialogC.overlay({
      state: state.at('confirm').map((s) => ({ open: s.open, status: s.open ? 'open' : 'closed' })),
      send: (m) => {
        if (m.type === 'close') cfmSend({ type: 'cancel' })
      },
      parts: cfmDialog,
      positionerClass: 'contents',
      content: () => [
        DialogBackdrop({ ...cfmDialog.backdrop }),
        AlertDialogContent({ ...cfmDialog.content }, [
          AlertDialogHeader([
            AlertDialogTitle({ ...cfmDialog.title }, [text(state.at('confirm').at('title'))]),
            AlertDialogDescription({ ...cfmDialog.description }, [
              text(
                state
                  .at('confirm')
                  .at('description')
                  .map((d) => d ?? ''),
              ),
            ]),
          ]),
          AlertDialogFooter([
            Button({ variant: 'outline', onClick: () => cfmSend({ type: 'cancel' }) }, [
              text(state.at('confirm').at('cancelLabel')),
            ]),
            Button({ variant: 'destructive', onClick: () => cfmSend({ type: 'confirm' }) }, [
              text(state.at('confirm').at('confirmLabel')),
            ]),
          ]),
        ]),
      ],
    }),

    section(
      'Form Field',
      'Validation is a REDUCER concern, not a binding one: the schema runs in `update`, the pattern holds validity, touched and submission, and the values stay ordinary app state.',
      [
        Form(
          {
            ...signup.root,
            class: 'max-w-sm',
            onSubmit: (e: Event) => {
              e.preventDefault()
              signupSend({ type: 'submit' })
            },
          },
          [
            field('email', 'Email', 'We only use this to sign you in.'),
            field('name', 'Name', 'How you appear to your team.'),
            div({ class: 'flex items-center gap-3' }, [
              Button({ ...signup.submit }, [text('Create account')]),
              span({ class: 'text-xs text-muted-foreground' }, [
                text(state.at('signup').at('form').at('status')),
              ]),
            ]),
          ],
        ),
      ],
    ),

    section(
      'Searchable Select',
      'Select + Combobox composed: a trigger showing the selection, a filter input inside the panel, and one machine owning both.',
      [
        div({ ...pick.root, class: 'max-w-xs' }, [
          SelectTrigger({ ...pick.trigger }, [SelectValue([text(pick.triggerLabel)])]),
        ]),
      ],
    ),
    searchableC.overlay({
      state: state.at('picker'),
      send: pickSend,
      parts: pick,
      positionerClass: 'z-popover',
      content: () => [
        SelectContent({ ...pick.content }, [
          CommandInput({ ...pick.input, placeholder: 'Filter people…' }),
          // The FILTERED list, from the machine — not the static array. The
          // filter lives in the nested combobox (`inputValue` is the filter,
          // `value` the committed selection), and rendering the source array
          // instead gives a search box that types but never narrows.
          CommandList([
            each(state.at('picker').at('combobox').at('filteredItems'), {
              key: (v: string) => v,
              render: (v: Signal<string>) => {
                const person = v.peek()
                return [SelectItem({ ...pick.item(person).item }, [text(person)])]
              },
            }),
          ]),
        ]),
      ],
    }),

    section(
      'Wizard',
      'Steps plus per-step validation. `next` is GATED — it validates the current step first and only advances if it passes, so the machine cannot be walked past a bad step.',
      [
        Steps({ ...wiz.root }, [
          ...WIZARD_STEPS.map((label, i) => {
            const parts = wiz.item(i)
            return StepsItem({ ...parts.item }, [
              StepsTrigger({ ...parts.trigger }, [text(`${i + 1}. ${label}`)]),
              ...(i < WIZARD_STEPS.length - 1 ? [StepsSeparator({ ...parts.separator })] : []),
            ])
          }),
        ]),
        row('Navigate', [
          Button({ ...wiz.prevTrigger, variant: 'outline', size: 'sm' }, [text('Back')]),
          Button({ ...wiz.nextTrigger, size: 'sm' }, [text('Next')]),
          span({ class: 'text-xs text-muted-foreground' }, [
            text(
              state
                .at('wizard')
                .at('steps')
                .map((s) => `step ${s.current + 1} of ${WIZARD_STEPS.length}`),
            ),
          ]),
        ]),
        p({ class: 'text-xs text-muted-foreground' }, [
          text('Linear: a later step is unreachable until the ones before it complete.'),
        ]),
      ],
    ),
  ]
}
