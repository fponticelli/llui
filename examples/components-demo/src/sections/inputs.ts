import {
  div,
  button,
  span,
  label,
  input,
  fieldset as fieldsetEl,
  legend,
  form as formEl,
  p,
  each,
  show,
  branch,
  onMount,
  text,
} from '@llui/dom'
import type { Send, Signal } from '@llui/dom'
import { switchMachine } from '@llui/components/switch'
import { toggle } from '@llui/components/toggle'
import { checkbox } from '@llui/components/checkbox'
import { radioGroup } from '@llui/components/radio-group'
import { toggleGroup } from '@llui/components/toggle-group'
import { numberInput } from '@llui/components/number-input'
import { passwordInput } from '@llui/components/password-input'
import { pinInput } from '@llui/components/pin-input'
import { tagsInput } from '@llui/components/tags-input'
import { ratingGroup } from '@llui/components/rating-group'
import { slider } from '@llui/components/slider'
import { progress } from '@llui/components/progress'
import { field } from '@llui/components/field'
import { fieldset } from '@llui/components/fieldset'
import { form } from '@llui/components/form'
import { meter } from '@llui/components/meter'
import { searchField } from '@llui/components/search-field'
import { formField } from '@llui/components/patterns/form-field'
import {
  wizard,
  type WizardState,
  type WizardMsg,
  type WizardEffect,
  type WizardValidators,
} from '@llui/components/patterns/wizard'
import { sectionGroup, card } from '../shared/ui'
import {
  composeModules,
  mergeHandlers,
  type ModulesState,
  type ModulesMsg,
} from '../shared/modules'

// ── Form-field demo schema (no external validation lib) ──────────────
//
// A minimal, structurally-compatible Standard Schema (https://standardschema.dev)
// so the demo stays dependency-free — we declare just the slice of the spec the
// form-field pattern consumes. It validates `{ email, username }`: email must
// look like an address and username must be at least 3 chars. Issue paths map
// to field names, which is how form-field flips each field's validity.
interface LocalIssue {
  readonly message: string
  readonly path?: ReadonlyArray<PropertyKey>
}
type LocalResult =
  | { readonly value: unknown; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<LocalIssue> }
interface LocalSchema {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => LocalResult
    readonly types?: { readonly input: unknown; readonly output: unknown } | undefined
  }
}

const profileSchema: LocalSchema = {
  '~standard': {
    version: 1,
    vendor: 'components-demo',
    validate: (value): LocalResult => {
      const v = value as { email?: string; username?: string }
      const issues: LocalIssue[] = []
      if (!v.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) {
        issues.push({ message: 'Enter a valid email address.', path: ['email'] })
      }
      if (!v.username || v.username.length < 3) {
        issues.push({ message: 'Username must be at least 3 characters.', path: ['username'] })
      }
      return issues.length > 0 ? { issues } : { value: v }
    },
  },
}

// ── Wizard validators ────────────────────────────────────────────────
//
// Step 0 requires a non-empty name. The validator is async (returns a
// Promise) so `wizard.update`'s `next` always emits a `validateStep`
// EFFECT rather than resolving synchronously — that routes the decision
// through this section's exported `onEffect`. The name lives in a
// module-local captured by the step-0 input handler (demo-simple; the
// reducer stays pure + JSON-serializable).
let wizardName = ''

const wizardValidators: WizardValidators = {
  0: () => Promise.resolve(wizardName.trim().length > 0),
}

/** Run a wizard validator synchronously for the demo's onEffect. */
function runWizardStep(step: number): boolean {
  if (step === 0) return wizardName.trim().length > 0
  return true
}

// Wizard module wrapper: injects the async validators into `wizard.update`
// (composeModules only forwards two args, so the validators must be bound
// here) and exposes the standard { init, update } module shape.
const wizardModule = {
  init: wizard.init,
  update: (state: WizardState, msg: WizardMsg): [WizardState, WizardEffect[]] =>
    wizard.update(state, msg, wizardValidators),
}

const children = {
  switch: switchMachine,
  toggle,
  checkbox,
  radio: radioGroup,
  togGroup: toggleGroup,
  number: numberInput,
  password: passwordInput,
  pinInput,
  tagsInput,
  rating: ratingGroup,
  slider,
  progress,
  meter,
  search: searchField,
  field,
  fieldset,
  form,
  formField,
  wizard: wizardModule,
} as const

export type State = ModulesState<typeof children>
export type Msg = ModulesMsg<typeof children>
export type Effect = WizardEffect

export const init = (): [State, never[]] => [
  {
    switch: switchMachine.init({ checked: false }),
    toggle: toggle.init({ pressed: false }),
    checkbox: checkbox.init({ checked: 'indeterminate' }),
    radio: radioGroup.init({ items: ['small', 'medium', 'large'], value: 'medium' }),
    togGroup: toggleGroup.init({
      items: ['bold', 'italic', 'underline'],
      value: ['bold'],
      type: 'multiple',
    }),
    number: numberInput.init({ value: 10, min: 0, max: 100, step: 1 }),
    password: passwordInput.init({ value: 'hunter2' }),
    pinInput: pinInput.init({ length: 4, type: 'numeric' }),
    tagsInput: tagsInput.init({ value: ['typescript', 'vite'], unique: true, max: 5 }),
    rating: ratingGroup.init({ value: 3, count: 5, allowHalf: true }),
    slider: slider.init({ value: [40], min: 0, max: 100, step: 5 }),
    progress: progress.init({ value: 65 }),
    meter: meter.init({ value: 72, min: 0, max: 100, low: 50, high: 85, optimum: 30 }),
    search: searchField.init({ value: '' }),
    field: field.init({ id: 'demo-field' }),
    fieldset: fieldset.init({ id: 'demo-fieldset' }),
    form: form.init(),
    formField: formField.init({ id: 'profile', fields: ['email', 'username'] }),
    wizard: wizard.init({ steps: ['Account', 'Profile', 'Review'], linear: true }),
  },
  [],
]

export const update = mergeHandlers<State, Msg, Effect>(
  composeModules<State, Msg, Effect>(children),
)

/**
 * Route this section's effects. Only the wizard emits effects: a
 * `validateStep` asks us to run the step's validator and dispatch the
 * `stepValid` / `stepInvalid` result back into `wizard.update`.
 */
export function onEffect(effect: Effect, send: Send<Msg>): void {
  if (effect.type === 'validateStep') {
    const ok = runWizardStep(effect.step)
    send({
      type: 'wizard',
      msg: ok
        ? { type: 'stepValid', step: effect.step }
        : { type: 'stepInvalid', step: effect.step },
    })
  }
}

// Plain mirror of the form-field input values, kept in a module-local so the
// hand-rolled schema can validate them without threading a separate state
// slice through the demo's module map. (Demo-only convenience.)
const profileValues = { email: '', username: '' }

export function view(state: Signal<State>, send: Send<Msg>): Node[] {
  const sw = switchMachine.connect(state.at('switch'), (m) => send({ type: 'switch', msg: m }))
  const tog = toggle.connect(state.at('toggle'), (m) => send({ type: 'toggle', msg: m }))
  const cb = checkbox.connect(state.at('checkbox'), (m) => send({ type: 'checkbox', msg: m }))
  const rg = radioGroup.connect(state.at('radio'), (m) => send({ type: 'radio', msg: m }), {
    id: 'radio-demo',
  })
  const tg = toggleGroup.connect(state.at('togGroup'), (m) => send({ type: 'togGroup', msg: m }))
  const ni = numberInput.connect(state.at('number'), (m) => send({ type: 'number', msg: m }))
  const pw = passwordInput.connect(state.at('password'), (m) => send({ type: 'password', msg: m }))
  const pin = pinInput.connect(state.at('pinInput'), (m) => send({ type: 'pinInput', msg: m }), {
    id: 'pin-demo',
  })
  const ti = tagsInput.connect(state.at('tagsInput'), (m) => send({ type: 'tagsInput', msg: m }))
  const ra = ratingGroup.connect(state.at('rating'), (m) => send({ type: 'rating', msg: m }), {
    label: 'Rate',
  })
  const sl = slider.connect(state.at('slider'), (m) => send({ type: 'slider', msg: m }))
  const pr = progress.connect(state.at('progress'), (m) => send({ type: 'progress', msg: m }))
  const mt = meter.connect(state.at('meter'), (m) => send({ type: 'meter', msg: m }), {
    label: 'Disk usage',
  })
  const sf = searchField.connect(state.at('search'), (m) => send({ type: 'search', msg: m }))
  const fd = field.connect(state.at('field'), (m) => send({ type: 'field', msg: m }), {
    id: 'demo-field',
    hasDescription: true,
  })
  const fs = fieldset.connect(state.at('fieldset'), (m) => send({ type: 'fieldset', msg: m }), {
    id: 'demo-fieldset',
  })
  const fm = form.connect(state.at('form'), (m) => send({ type: 'form', msg: m }), {
    id: 'demo-form',
  })
  const ff = formField.connect(state.at('formField'), (m) => send({ type: 'formField', msg: m }), {
    id: 'profile',
    fields: ['email', 'username'],
  })
  const emailParts = ff.formField('email', { hasDescription: true })
  const usernameParts = ff.formField('username')
  const wz = wizard.connect(state.at('wizard'), (m) => send({ type: 'wizard', msg: m }), {
    label: 'Onboarding',
  })

  // Pin input focus advance
  const pinFocusMount = onMount(() => {
    const inputs = document.querySelectorAll<HTMLInputElement>(
      '[data-scope="pin-input"][data-part="input"]',
    )
    const h = (e: Event): void => {
      const el = e.target as HTMLInputElement
      if (el.value.length > 0) {
        const i = parseInt(el.dataset.index ?? '0', 10)
        inputs[i + 1]?.focus()
      }
    }
    inputs.forEach((el) => el.addEventListener('input', h))
    return () => inputs.forEach((el) => el.removeEventListener('input', h))
  })

  // Slider pointer drag
  const sliderDragMount = onMount(() => {
    const control = document.querySelector<HTMLElement>(
      '[data-scope="slider"][data-part="control"]',
    )
    if (!control) return
    let dragging = false
    const compute = (x: number): number => {
      const r = control.getBoundingClientRect()
      const pct = Math.max(0, Math.min(1, (x - r.left) / r.width))
      return Math.round((pct * 100) / 5) * 5
    }
    const onDown = (e: PointerEvent): void => {
      dragging = true
      control.setPointerCapture(e.pointerId)
      send({ type: 'slider', msg: { type: 'setThumb', index: 0, value: compute(e.clientX) } })
    }
    const onMove = (e: PointerEvent): void => {
      if (dragging)
        send({ type: 'slider', msg: { type: 'setThumb', index: 0, value: compute(e.clientX) } })
    }
    const onUp = (e: PointerEvent): void => {
      dragging = false
      if (control.hasPointerCapture(e.pointerId)) control.releasePointerCapture(e.pointerId)
    }
    control.addEventListener('pointerdown', onDown)
    control.addEventListener('pointermove', onMove)
    control.addEventListener('pointerup', onUp)
    control.addEventListener('pointercancel', onUp)
    return () => {
      control.removeEventListener('pointerdown', onDown)
      control.removeEventListener('pointermove', onMove)
      control.removeEventListener('pointerup', onUp)
      control.removeEventListener('pointercancel', onUp)
    }
  })

  const progressBtn = (txt: string, v: number | null): Node =>
    button(
      {
        class: 'btn btn-secondary text-xs',
        onClick: () => send({ type: 'progress', msg: { type: 'setValue', value: v } }),
      },
      [text(txt)],
    )

  const meterBtn = (txt: string, v: number): Node =>
    button(
      {
        class: 'btn btn-secondary text-xs',
        onClick: () => send({ type: 'meter', msg: { type: 'setValue', value: v } }),
      },
      [text(txt)],
    )

  // Validated input helper for the form-field cards.
  const validatedInput = (
    parts: ReturnType<typeof ff.formField>,
    labelText: string,
    description: string,
    placeholder: string,
    fieldName: 'email' | 'username',
    type: string,
  ): Node =>
    div({ ...parts.root, class: 'flex flex-col gap-1' }, [
      label({ ...parts.label, class: 'text-sm font-medium' }, [text(labelText)]),
      input({
        ...parts.control,
        type,
        placeholder,
        class: 'input',
        onInput: (e: Event) => {
          profileValues[fieldName] = (e.target as HTMLInputElement).value
        },
      }),
      p({ ...parts.description, class: 'text-xs text-text-muted' }, [text(description)]),
      show(parts.errorVisible, () => {
        const { message: _msg, issues: _issues, ...errProps } = parts.errorText
        return [p({ ...errProps, class: 'text-xs text-error' }, [text(parts.errorText.message)])]
      }),
    ])

  return [
    // Placed so the pin-focus and slider-drag onMount callbacks register
    // (a discarded onMount() is inert — its Mountable never materializes).
    pinFocusMount,
    sliderDragMount,
    sectionGroup('Form controls', [
      card('Switch', [
        label({ class: 'flex items-center gap-3' }, [
          button({ ...sw.root }, [div({ ...sw.track }, [div({ ...sw.thumb }, [])])]),
          span({ class: 'text-sm' }, [
            text(
              state
                .at('switch')
                .map((sw) => (sw.checked ? 'Notifications on' : 'Notifications off')),
            ),
          ]),
        ]),
      ]),
      card('Toggle', [
        div({ class: 'flex items-center gap-3' }, [
          button({ ...tog.root, class: 'btn btn-secondary' }, [text('B')]),
          span({ class: 'text-sm' }, [
            text(state.at('toggle').map((t) => (t.pressed ? 'Bold on' : 'Bold off'))),
          ]),
        ]),
      ]),
      card('Checkbox', [
        label({ class: 'flex items-center gap-3' }, [
          div({ ...cb.root }, [
            span({ ...cb.indicator }, [
              text(
                state
                  .at('checkbox')
                  .map((c) =>
                    c.checked === true ? '✓' : c.checked === 'indeterminate' ? '−' : '',
                  ),
              ),
            ]),
          ]),
          span({ class: 'text-sm' }, [
            text(
              state
                .at('checkbox')
                .map((c) =>
                  c.checked === true
                    ? 'Checked'
                    : c.checked === 'indeterminate'
                      ? 'Indeterminate'
                      : 'Unchecked',
                ),
            ),
          ]),
        ]),
        div({ class: 'mt-3 flex gap-2' }, [
          button(
            {
              class: 'btn btn-secondary text-xs',
              onClick: () =>
                send({ type: 'checkbox', msg: { type: 'setChecked', checked: 'indeterminate' } }),
            },
            [text('Set indeterminate')],
          ),
        ]),
      ]),
      card('Radio Group', [
        div(
          { ...rg.root, class: 'flex flex-col gap-2' },
          ['small', 'medium', 'large'].map((v) => {
            const p = rg.item(v)
            const labelText = v.charAt(0).toUpperCase() + v.slice(1)
            return label({ class: 'flex items-center gap-2 cursor-pointer' }, [
              div({ ...p.root, 'aria-label': labelText }, [div({ ...p.indicator }, [])]),
              span({ class: 'text-sm' }, [text(labelText)]),
            ])
          }),
        ),
        div({ class: 'mt-3 text-sm text-text-muted' }, [
          text('Size: '),
          text(state.at('radio').map((r) => r.value ?? 'none')),
        ]),
      ]),
      card('Toggle Group', [
        div(
          { ...tg.root },
          ['bold', 'italic', 'underline'].map((v) =>
            button({ ...tg.item(v).root }, [text(v.charAt(0).toUpperCase())]),
          ),
        ),
        div({ class: 'mt-3 text-sm text-text-muted' }, [
          text('Active: '),
          text(state.at('togGroup').map((t) => (t.value.length > 0 ? t.value.join(', ') : 'none'))),
        ]),
      ]),
      card('Number Input', [
        div({ ...ni.root }, [
          button({ ...ni.decrement }, [text('−')]),
          input({ ...ni.input, 'aria-label': 'Quantity' }),
          button({ ...ni.increment }, [text('+')]),
        ]),
        div({ class: 'mt-3 text-sm text-text-muted' }, [
          text('Quantity: '),
          text(state.at('number').map((n) => String(n.value ?? 0))),
        ]),
      ]),
      card('Password Input', [
        div({ ...pw.root }, [
          input({ ...pw.input, 'aria-label': 'Password' }),
          button({ ...pw.visibilityTrigger }, [
            text(state.at('password').map((p) => (p.visible ? 'Hide' : 'Show'))),
          ]),
        ]),
      ]),
      card('Pin Input (OTP)', [
        div({ ...pin.root, class: 'flex gap-2' }, [
          div({ ...pin.label }, [text('Verification code')]),
          input({ ...pin.input(0) }),
          input({ ...pin.input(1) }),
          input({ ...pin.input(2) }),
          input({ ...pin.input(3) }),
        ]),
        div({ class: 'mt-3 text-sm text-text-muted' }, [
          text('Code: '),
          text(state.at('pinInput').map((p) => p.values.join('') || '(empty)')),
        ]),
      ]),
      card('Tags Input', [
        div({ ...ti.root }, [
          each(state.at('tagsInput.value'), {
            key: (t) => t,
            render: (item, index) => {
              const tag = ti.tag(item.peek(), index.peek())
              return [span({ ...tag.root }, [text(item), button({ ...tag.remove }, [text('×')])])]
            },
          }),
          input({ ...ti.input, placeholder: 'Enter to add' }),
        ]),
      ]),
      card('Rating', [
        div({ ...ra.root }, [
          div({ ...ra.item(0).root }, [text('★')]),
          div({ ...ra.item(1).root }, [text('★')]),
          div({ ...ra.item(2).root }, [text('★')]),
          div({ ...ra.item(3).root }, [text('★')]),
          div({ ...ra.item(4).root }, [text('★')]),
        ]),
        div({ class: 'mt-3 text-sm text-text-muted' }, [
          text('Rating: '),
          text(state.at('rating').map((r) => String(r.value))),
          text(' / '),
          text(state.at('rating').map((r) => String(r.count))),
        ]),
      ]),
      card('Slider', [
        div({ ...sl.root, class: 'relative' }, [
          div({ ...sl.control }, [
            div({ ...sl.track }, [div({ ...sl.range }, [])]),
            div({ ...sl.thumb(0).thumb, 'aria-label': 'Volume' }, []),
          ]),
        ]),
        div({ class: 'mt-2 text-sm text-text-muted' }, [
          text('Value: '),
          text(state.at('slider').map((s) => String(s.value[0] ?? 0))),
        ]),
      ]),
      card('Progress', [
        div({ ...pr.root, 'aria-label': 'Upload progress' }, [
          div({ ...pr.track }, [div({ ...pr.range }, [])]),
        ]),
        div({ class: 'mt-2 text-sm text-text-muted' }, [text(pr.valueText)]),
        div({ class: 'mt-3 flex gap-2' }, [
          progressBtn('25%', 25),
          progressBtn('65%', 65),
          progressBtn('100%', 100),
          progressBtn('Indeterminate', null),
        ]),
      ]),
      card('Meter', [
        div({ ...mt.root, class: 'relative' }, [
          div({ ...mt.track, class: 'h-2 rounded bg-surface-2 overflow-hidden' }, [
            div({ ...mt.range, class: 'h-full bg-accent' }, []),
          ]),
        ]),
        div({ class: 'mt-2 text-sm text-text-muted' }, [
          text('Disk usage: '),
          text(mt.valueText),
          text(' — '),
          text(state.at('meter').map((m) => meter.thresholdState(m))),
        ]),
        div({ class: 'mt-3 flex gap-2' }, [
          meterBtn('30%', 30),
          meterBtn('72%', 72),
          meterBtn('92%', 92),
        ]),
      ]),
      card('Search Field', [
        div({ ...sf.root, class: 'flex items-center gap-2' }, [
          input({ ...sf.input, placeholder: 'Search…', 'aria-label': 'Search', class: 'input' }),
          button({ ...sf.clearTrigger, class: 'btn btn-secondary text-xs' }, [text('×')]),
        ]),
        div({ class: 'mt-2 text-sm text-text-muted' }, [
          text('Query: '),
          text(state.at('search').map((s) => (s.value === '' ? '(empty)' : s.value))),
        ]),
      ]),
    ]),
    sectionGroup('Form structure & validation', [
      card('Field', [
        div({ ...fd.root, class: 'flex flex-col gap-1' }, [
          label({ ...fd.label, class: 'text-sm font-medium' }, [text('Email')]),
          input({ ...fd.control, type: 'email', placeholder: 'you@example.com', class: 'input' }),
          p({ ...fd.description, class: 'text-xs text-text-muted' }, [
            text('We never share your email.'),
          ]),
          show(state.at('field').at('invalid'), () => [
            p({ ...fd.errorText, class: 'text-xs text-error' }, [
              text('Please enter a valid email.'),
            ]),
          ]),
        ]),
        div({ class: 'mt-3 flex gap-2' }, [
          button(
            {
              class: 'btn btn-secondary text-xs',
              onClick: () =>
                send({
                  type: 'field',
                  msg: {
                    type: 'setInvalid',
                    invalid: !state.at('field').at('invalid').peek(),
                  },
                }),
            },
            [
              text(
                state
                  .at('field')
                  .at('invalid')
                  .map((inv) => (inv ? 'Clear error' : 'Show error')),
              ),
            ],
          ),
        ]),
      ]),
      card('Fieldset', [
        fieldsetEl({ ...fs.root, class: 'flex flex-col gap-2 rounded border border-border p-3' }, [
          legend({ ...fs.legend, class: 'text-sm font-medium px-1' }, [text('Shipping address')]),
          input({ placeholder: 'Street', 'aria-label': 'Street', class: 'input' }),
          input({ placeholder: 'City', 'aria-label': 'City', class: 'input' }),
        ]),
        div({ class: 'mt-3 flex items-center gap-2' }, [
          button(
            {
              class: 'btn btn-secondary text-xs',
              onClick: () =>
                send({
                  type: 'fieldset',
                  msg: {
                    type: 'setDisabled',
                    disabled: !state.at('fieldset').at('disabled').peek(),
                  },
                }),
            },
            [
              text(
                state
                  .at('fieldset')
                  .at('disabled')
                  .map((d) => (d ? 'Enable group' : 'Disable group')),
              ),
            ],
          ),
          span({ class: 'text-sm text-text-muted' }, [
            text(
              state
                .at('fieldset')
                .at('disabled')
                .map((d) => (d ? 'Group disabled' : 'Group enabled')),
            ),
          ]),
        ]),
      ]),
      card('Form', [
        formEl(
          {
            ...fm.root,
            class: 'flex flex-col gap-3',
            onSubmit: (e: Event) => {
              e.preventDefault()
              send({ type: 'form', msg: { type: 'submit' } })
              send({ type: 'form', msg: { type: 'submitSuccess' } })
            },
          },
          [
            input({ placeholder: 'Your name', 'aria-label': 'Your name', class: 'input' }),
            div({ class: 'flex gap-2' }, [
              button({ ...fm.submit, class: 'btn btn-primary text-sm' }, [text('Submit')]),
              button(
                {
                  type: 'button',
                  class: 'btn btn-secondary text-sm',
                  onClick: () => send({ type: 'form', msg: { type: 'reset' } }),
                },
                [text('Reset')],
              ),
            ]),
            div({ class: 'text-sm text-text-muted' }, [
              text('Status: '),
              text(state.at('form').at('status')),
            ]),
          ],
        ),
      ]),
      card('Form Field (pattern)', [
        div({ ...ff.root, class: 'flex flex-col gap-3' }, [
          validatedInput(
            emailParts,
            'Email',
            'Used for sign-in.',
            'you@example.com',
            'email',
            'email',
          ),
          validatedInput(
            usernameParts,
            'Username',
            'At least 3 characters.',
            'jane',
            'username',
            'text',
          ),
          button(
            {
              class: 'btn btn-primary text-sm self-start',
              onClick: () => {
                send({ type: 'formField', msg: { type: 'touchAll' } })
                send({
                  type: 'formField',
                  msg: {
                    type: 'validate',
                    schema: profileSchema,
                    values: profileValues,
                  },
                })
              },
            },
            [text('Validate')],
          ),
        ]),
      ]),
      card('Wizard (pattern)', [
        // `wz.root` carries the baked steps-strip styling (a horizontal flex
        // row). It must wrap ONLY the step indicator — the panels and nav are
        // siblings in the card body (which stacks block children vertically).
        // Nesting everything inside `wz.root` collapsed the whole wizard into
        // one cramped flex row. The numbered circle uses the baked
        // `stepTrigger` part (current → primary, completed → green); the step
        // name sits beside it, with separators connecting the steps.
        div(
          { ...wz.root, 'aria-label': 'Account setup', class: 'mb-4' },
          ['Account', 'Profile', 'Review'].flatMap((stepName, i, all) => {
            const it = wz.item(i)
            const step = div({ ...it.item, class: 'flex items-center gap-2' }, [
              button({ ...wz.stepTrigger(i) }, [text(String(i + 1))]),
              span({ class: 'text-sm whitespace-nowrap' }, [text(stepName)]),
            ])
            return i < all.length - 1 ? [step, span({ ...it.separator })] : [step]
          }),
        ),
        branch(state.at('wizard').at('steps').at('current'), {
          0: () => [
            div({ class: 'flex flex-col gap-1' }, [
              label({ class: 'text-sm font-medium', for: 'wizard-name-input' }, [
                text('Account name'),
              ]),
              input({
                id: 'wizard-name-input',
                placeholder: 'Required to continue',
                class: 'input',
                value: '',
                onInput: (e: Event) => {
                  wizardName = (e.target as HTMLInputElement).value
                },
              }),
              p({ class: 'text-xs text-text-muted' }, [
                text('Next is blocked until this is filled in.'),
              ]),
            ]),
          ],
          1: () => [
            p({ class: 'text-sm' }, [text('Step 2 — tell us about your profile (no validation).')]),
          ],
          2: () => [p({ class: 'text-sm' }, [text('Step 3 — review and finish.')])],
        }),
        div({ class: 'mt-3 flex gap-2' }, [
          button({ ...wz.prevTrigger, class: 'btn btn-secondary text-sm' }, [text('Back')]),
          button({ ...wz.nextTrigger, class: 'btn btn-primary text-sm' }, [text('Next')]),
        ]),
        div({ class: 'mt-2 text-sm text-text-muted' }, [
          text(
            state
              .at('wizard')
              .at('steps')
              .map((s) =>
                s.errors.includes(s.current)
                  ? 'This step is invalid — enter a name to continue.'
                  : `Step ${s.current + 1} of ${s.steps.length}`,
              ),
          ),
        ]),
      ]),
    ]),
  ]
}
