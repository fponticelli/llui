import { div, each, text, type Mountable, type Send, type Signal } from '@llui/dom'
import * as checkboxC from '@llui/components/checkbox'
import * as radioGroup from '@llui/components/radio-group'
import * as switchC from '@llui/components/switch'
import * as toggleC from '@llui/components/toggle'
import * as toggleGroup from '@llui/components/toggle-group'
import * as sliderC from '@llui/components/slider'
import * as numberInput from '@llui/components/number-input'
import * as pinInput from '@llui/components/pin-input'
import * as tagsInput from '@llui/components/tags-input'
import { Input } from '../components/ui/input'
import { InputGroup, InputGroupAddon } from '../components/ui/input-group'
import { Textarea } from '../components/ui/textarea'
import { Label } from '../components/ui/label'
import { Field, FieldDescription, FieldError, FieldLabel } from '../components/ui/field'
import { Checkbox, CheckboxHiddenInput, CheckboxIndicator } from '../components/ui/checkbox'
import {
  RadioGroup,
  RadioGroupIndicator,
  RadioGroupItem,
  RadioGroupLabel,
} from '../components/ui/radio-group'
import { Switch, SwitchThumb } from '../components/ui/switch'
import { Toggle } from '../components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group'
import {
  Slider,
  SliderControl,
  SliderRange,
  SliderThumb,
  SliderTrack,
} from '../components/ui/slider'
import {
  NumberInput,
  NumberInputControl,
  NumberInputDecrement,
  NumberInputIncrement,
} from '../components/ui/number-input'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '../components/ui/input-otp'
import {
  TagsInput,
  TagsInputControl,
  TagsInputTag,
  TagsInputTagRemove,
} from '../components/ui/tags-input'
import { row, section } from './shared'

export interface State {
  email: string
  note: string
  terms: checkboxC.CheckboxState
  plan: radioGroup.RadioGroupState
  wifi: switchC.SwitchState
  locked: switchC.SwitchState
  bold: toggleC.ToggleState
  align: toggleGroup.ToggleGroupState
  volume: sliderC.SliderState
  qty: numberInput.NumberInputState
  otp: pinInput.PinInputState
  tags: tagsInput.TagsInputState
}

export type Msg =
  | { type: 'setEmail'; value: string }
  | { type: 'setNote'; value: string }
  | { type: 'terms'; msg: checkboxC.CheckboxMsg }
  | { type: 'plan'; msg: radioGroup.RadioGroupMsg }
  | { type: 'wifi'; msg: switchC.SwitchMsg }
  | { type: 'locked'; msg: switchC.SwitchMsg }
  | { type: 'bold'; msg: toggleC.ToggleMsg }
  | { type: 'align'; msg: toggleGroup.ToggleGroupMsg }
  | { type: 'volume'; msg: sliderC.SliderMsg }
  | { type: 'qty'; msg: numberInput.NumberInputMsg }
  | { type: 'otp'; msg: pinInput.PinInputMsg }
  | { type: 'tags'; msg: tagsInput.TagsInputMsg }

const PLANS = ['free', 'pro', 'team']
const ALIGN = ['left', 'center', 'right']

export const init = (): [State, never[]] => [
  {
    email: '',
    note: '',
    terms: checkboxC.init(),
    plan: radioGroup.init({ items: PLANS, value: 'pro' }),
    wifi: switchC.init({ checked: true }),
    locked: switchC.init({ disabled: true }),
    bold: toggleC.init({ pressed: true }),
    align: toggleGroup.init({ items: ALIGN, type: 'single', value: ['center'] }),
    volume: sliderC.init({ value: [40], min: 0, max: 100 }),
    qty: numberInput.init({ value: 1, min: 0, max: 99 }),
    otp: pinInput.init({ length: 6 }),
    tags: tagsInput.init({ value: ['llui', 'shadcn'] }),
  },
  [],
]

export function update(state: State, msg: Msg): [State, never[]] {
  switch (msg.type) {
    case 'setEmail':
      return [{ ...state, email: msg.value }, []]
    case 'setNote':
      return [{ ...state, note: msg.value }, []]
    case 'terms':
      return [{ ...state, terms: checkboxC.update(state.terms, msg.msg)[0] }, []]
    case 'plan':
      return [{ ...state, plan: radioGroup.update(state.plan, msg.msg)[0] }, []]
    case 'wifi':
      return [{ ...state, wifi: switchC.update(state.wifi, msg.msg)[0] }, []]
    case 'locked':
      return [{ ...state, locked: switchC.update(state.locked, msg.msg)[0] }, []]
    case 'bold':
      return [{ ...state, bold: toggleC.update(state.bold, msg.msg)[0] }, []]
    case 'align':
      return [{ ...state, align: toggleGroup.update(state.align, msg.msg)[0] }, []]
    case 'volume':
      return [{ ...state, volume: sliderC.update(state.volume, msg.msg)[0] }, []]
    case 'qty':
      return [{ ...state, qty: numberInput.update(state.qty, msg.msg)[0] }, []]
    case 'otp':
      return [{ ...state, otp: pinInput.update(state.otp, msg.msg)[0] }, []]
    case 'tags':
      return [{ ...state, tags: tagsInput.update(state.tags, msg.msg)[0] }, []]
  }
}

export function view(state: Signal<State>, send: Send<Msg>): readonly Mountable[] {
  const terms = checkboxC.connect(state.at('terms'), (m) => send({ type: 'terms', msg: m }))
  const plan = radioGroup.connect(state.at('plan'), (m) => send({ type: 'plan', msg: m }), {
    id: 'plan',
  })
  const wifi = switchC.connect(state.at('wifi'), (m) => send({ type: 'wifi', msg: m }))
  const locked = switchC.connect(state.at('locked'), (m) => send({ type: 'locked', msg: m }))
  const bold = toggleC.connect(state.at('bold'), (m) => send({ type: 'bold', msg: m }))
  const align = toggleGroup.connect(state.at('align'), (m) => send({ type: 'align', msg: m }))
  const volume = sliderC.connect(state.at('volume'), (m) => send({ type: 'volume', msg: m }))
  const qty = numberInput.connect(state.at('qty'), (m) => send({ type: 'qty', msg: m }))
  const otp = pinInput.connect(state.at('otp'), (m) => send({ type: 'otp', msg: m }), { id: 'otp' })
  const tags = tagsInput.connect(state.at('tags'), (m) => send({ type: 'tags', msg: m }))

  return [
    section(
      'Input, Textarea, Label & Field',
      'The caller owns the value binding — a reactive `value` with no onInput is a compile ERROR (controlled-input), because the binding would overwrite every keystroke.',
      [
        Field([
          FieldLabel({ for: 'email' }, [text('Email')]),
          Input({
            id: 'email',
            type: 'email',
            placeholder: 'you@example.com',
            value: state.at('email'),
            onInput: (e) => send({ type: 'setEmail', value: (e.target as HTMLInputElement).value }),
          }),
          FieldDescription([text('We only use this to send the release notes.')]),
        ]),
        Field([
          FieldLabel({ for: 'note' }, [text('Note')]),
          Textarea({
            id: 'note',
            rows: 3,
            placeholder: 'Anything you like…',
            value: state.at('note'),
            onInput: (e) =>
              send({ type: 'setNote', value: (e.target as HTMLTextAreaElement).value }),
          }),
        ]),
        Field([
          FieldLabel([text('Invalid state')]),
          Input({ placeholder: 'Invalid', 'aria-invalid': 'true' }),
          FieldError([text('That address is already registered.')]),
        ]),
        row('Input group', [
          InputGroup({ class: 'max-w-64' }, [
            InputGroupAddon([text('🔍')]),
            Input({ placeholder: 'Search components…' }),
          ]),
          InputGroup({ class: 'max-w-64' }, [
            Input({ placeholder: 'llui' }),
            InputGroupAddon([text('.dev')]),
          ]),
        ]),
        row('Disabled', [Input({ placeholder: 'Disabled', disabled: true, class: 'max-w-56' })]),
      ],
    ),

    section(
      'Checkbox, Radio, Switch & Toggle',
      'Every visual state below comes from the data-state / data-disabled attributes the part bags emit — no view here reads state to build a class.',
      [
        row('Checkbox', [
          div({ class: 'flex items-center gap-2' }, [
            Checkbox({ ...terms.root, id: 'terms' }, [CheckboxIndicator({ ...terms.indicator })]),
            CheckboxHiddenInput({ ...terms.hiddenInput }),
            Label({ for: 'terms' }, [text('Accept terms')]),
          ]),
        ]),
        row('Radio group', [
          RadioGroup(
            { ...plan.root, class: 'grid-flow-col auto-cols-max gap-4' },
            PLANS.map((value) => {
              const parts = plan.item(value)
              return div({ class: 'flex items-center gap-2' }, [
                RadioGroupItem({ ...parts.root }, [RadioGroupIndicator({ ...parts.indicator })]),
                RadioGroupLabel({ ...parts.label }, [text(value)]),
              ])
            }),
          ),
        ]),
        row('Switch', [
          div({ class: 'flex items-center gap-2' }, [
            Switch({ ...wifi.root, id: 'wifi' }, [SwitchThumb({ ...wifi.thumb })]),
            Label({ for: 'wifi' }, [text('Wi-Fi')]),
          ]),
          div({ class: 'flex items-center gap-2' }, [
            Switch({ ...locked.root, id: 'locked' }, [SwitchThumb({ ...locked.thumb })]),
            Label({ for: 'locked', class: 'text-muted-foreground' }, [text('Disabled')]),
          ]),
        ]),
        row('Toggle & toggle group', [
          Toggle({ ...bold.root, variant: 'outline', 'aria-label': 'Bold' }, [text('B')]),
          ToggleGroup(
            { ...align.root },
            ALIGN.map((value) => ToggleGroupItem({ ...align.item(value).root }, [text(value)])),
          ),
        ]),
      ],
    ),

    section('Slider, Number, OTP & Tags', 'Value controls the package fully owns.', [
      row('Slider', [
        div({ class: 'w-64' }, [
          Slider({ ...volume.root }, [
            SliderControl({ ...volume.control }, [
              SliderTrack({ ...volume.track }, [SliderRange({ ...volume.range })]),
              SliderThumb({ ...volume.thumb(0).thumb }),
            ]),
          ]),
        ]),
      ]),
      row('Number input', [
        NumberInput({ ...qty.root }, [
          NumberInputDecrement({ ...qty.decrement }, [text('−')]),
          NumberInputControl({ ...qty.input }),
          NumberInputIncrement({ ...qty.increment }, [text('+')]),
        ]),
      ]),
      row('One-time code', [
        InputOTP({ ...otp.root }, [
          InputOTPGroup([0, 1, 2, 3, 4, 5].map((i) => InputOTPSlot({ ...otp.input(i) }))),
        ]),
      ]),
      row('Tags', [
        TagsInput({ ...tags.root, class: 'max-w-80' }, [
          // `parts.tag(value, index)` closes over the index it was BUILT with —
          // `removeTag` sends that number. Inside a keyed row the index is a
          // signal that changes as the list shrinks, so a bag built from
          // `index.peek()` deletes the wrong tag after any middle removal.
          //
          // Keying by index instead is not an option (`key` is item-only, by
          // design). So the bag is spread for its ARIA and data attributes, and
          // the one index-dependent handler is replaced with a `.peek()` read
          // taken WHEN THE CLICK HAPPENS. `peek()` in a handler is a live read;
          // `peek()` in a view slot is frozen forever. That distinction is the
          // whole of it.
          each(state.at('tags').at('value'), {
            key: (tag: string) => tag,
            render: (tag: Signal<string>, index: Signal<number>) => {
              const parts = tags.tag(tag.peek(), index.peek())
              return [
                TagsInputTag({ ...parts.root, 'data-value': tag }, [
                  text(tag),
                  TagsInputTagRemove(
                    {
                      ...parts.remove,
                      onClick: () =>
                        send({ type: 'tags', msg: { type: 'removeTag', index: index.peek() } }),
                    },
                    [text('×')],
                  ),
                ]),
              ]
            },
          }),
          TagsInputControl({ ...tags.input }),
        ]),
      ]),
    ]),
  ]
}
