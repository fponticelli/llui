import {
  component,
  mergeHandlers,
  childHandlers,
  div,
  button,
  span,
  text,
  label,
  input,
  onMount,
} from '@llui/dom'
import type { ChildState, ChildMsg } from '@llui/dom'
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
import { sectionGroup, card } from '../shared/ui'

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
} as const

type State = ChildState<typeof children>
type Msg = ChildMsg<typeof children>

const init = (): [State, never[]] => [
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
  },
  [],
]

const update = mergeHandlers<State, Msg, never>(childHandlers<State, Msg, never>(children))

export const App = component<State, Msg, never>({
  name: 'InputsSection',
  init,
  update,
  view: ({ send, each }) => {
    const sw = switchMachine.connect<State>(
      (s) => s.switch,
      (m) => send({ type: 'switch', msg: m }),
    )
    const tog = toggle.connect<State>(
      (s) => s.toggle,
      (m) => send({ type: 'toggle', msg: m }),
    )
    const cb = checkbox.connect<State>(
      (s) => s.checkbox,
      (m) => send({ type: 'checkbox', msg: m }),
    )
    const rg = radioGroup.connect<State>(
      (s) => s.radio,
      (m) => send({ type: 'radio', msg: m }),
      { id: 'radio-demo' },
    )
    const tg = toggleGroup.connect<State>(
      (s) => s.togGroup,
      (m) => send({ type: 'togGroup', msg: m }),
    )
    const ni = numberInput.connect<State>(
      (s) => s.number,
      (m) => send({ type: 'number', msg: m }),
    )
    const pw = passwordInput.connect<State>(
      (s) => s.password,
      (m) => send({ type: 'password', msg: m }),
    )
    const pin = pinInput.connect<State>(
      (s) => s.pinInput,
      (m) => send({ type: 'pinInput', msg: m }),
      { id: 'pin-demo' },
    )
    const ti = tagsInput.connect<State>(
      (s) => s.tagsInput,
      (m) => send({ type: 'tagsInput', msg: m }),
    )
    const ra = ratingGroup.connect<State>(
      (s) => s.rating,
      (m) => send({ type: 'rating', msg: m }),
      { label: 'Rate' },
    )
    const sl = slider.connect<State>(
      (s) => s.slider,
      (m) => send({ type: 'slider', msg: m }),
    )
    const pr = progress.connect<State>(
      (s) => s.progress,
      (m) => send({ type: 'progress', msg: m }),
    )

    // Pin input focus advance
    onMount(() => {
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
    onMount(() => {
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

    return [
      sectionGroup('Form controls', [
        card('Switch', [
          label({ class: 'flex items-center gap-3' }, [
            button({ ...sw.root }, [div({ ...sw.track }, [div({ ...sw.thumb }, [])])]),
            span({ class: 'text-sm' }, [
              text((s: State) => (s.switch.checked ? 'Notifications on' : 'Notifications off')),
            ]),
          ]),
        ]),
        card('Toggle', [
          div({ class: 'flex items-center gap-3' }, [
            button({ ...tog.root, class: 'btn btn-secondary' }, [text('B')]),
            span({ class: 'text-sm' }, [
              text((s: State) => (s.toggle.pressed ? 'Bold on' : 'Bold off')),
            ]),
          ]),
        ]),
        card('Checkbox', [
          label({ class: 'flex items-center gap-3' }, [
            div({ ...cb.root }, [
              span({ ...cb.indicator }, [
                text((s: State) =>
                  s.checkbox.checked === true
                    ? '✓'
                    : s.checkbox.checked === 'indeterminate'
                      ? '−'
                      : '',
                ),
              ]),
            ]),
            span({ class: 'text-sm' }, [
              text((s: State) =>
                s.checkbox.checked === true
                  ? 'Checked'
                  : s.checkbox.checked === 'indeterminate'
                    ? 'Indeterminate'
                    : 'Unchecked',
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
            text((s: State) => s.radio.value ?? 'none'),
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
            text((s: State) =>
              s.togGroup.value.length > 0 ? s.togGroup.value.join(', ') : 'none',
            ),
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
            text((s: State) => String(s.number.value ?? 0)),
          ]),
        ]),
        card('Password Input', [
          div({ ...pw.root }, [
            input({ ...pw.input, 'aria-label': 'Password' }),
            button({ ...pw.visibilityTrigger }, [
              text((s: State) => (s.password.visible ? 'Hide' : 'Show')),
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
            text((s: State) => s.pinInput.values.join('') || '(empty)'),
          ]),
        ]),
        card('Tags Input', [
          div({ ...ti.root }, [
            ...each({
              items: (s) => s.tagsInput.value,
              key: (t) => t,
              render: ({ item, index }) => {
                const value = item((t: string) => t)()
                const idx = index()
                const tag = ti.tag(value, idx)
                return [
                  span({ ...tag.root }, [text(value), button({ ...tag.remove }, [text('×')])]),
                ]
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
            text((s: State) => String(s.rating.value)),
            text(' / '),
            text((s: State) => String(s.rating.count)),
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
            text((s: State) => String(s.slider.value[0] ?? 0)),
          ]),
        ]),
        card('Progress', [
          div({ ...pr.root, 'aria-label': 'Upload progress' }, [
            div({ ...pr.track }, [div({ ...pr.range }, [])]),
          ]),
          div({ class: 'mt-2 text-sm text-text-muted' }, [text((s: State) => pr.valueText(s))]),
          div({ class: 'mt-3 flex gap-2' }, [
            progressBtn('25%', 25),
            progressBtn('65%', 65),
            progressBtn('100%', 100),
            progressBtn('Indeterminate', null),
          ]),
        ]),
      ]),
    ]
  },
})
