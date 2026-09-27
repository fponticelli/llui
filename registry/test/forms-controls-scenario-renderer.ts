/**
 * Registry (copied-skin) renderer for the forms-controls family (#267): one
 * adapter per product whose registry presentation is visually available,
 * rendering a resolved case through the REAL machine -> connect -> copied
 * skin, so the Tailwind recipes in `registry/llui/ui/` are what style it.
 * Kept SEPARATE from the baseline renderer
 * (`packages/components/test/styles/forms-controls-baseline-renderer.ts`); the
 * only seam the two share is the compiled catalog in
 * `forms-controls-scenarios.ts`.
 */
import {
  component,
  div,
  mountApp,
  span,
  text,
  type Mountable,
  type Send,
  type Signal,
} from '@llui/dom'
import type { ProductContract } from '@llui/cli'
import {
  resolveScenarioSelection,
  type CompiledPresentationScenarioFamily,
  type PresentationScenarioEnvironment,
} from '@llui/cli/presentation-scenarios'
import * as angleSlider from '@llui/components/angle-slider'
import * as checkbox from '@llui/components/checkbox'
import * as field from '@llui/components/field'
import * as numberInput from '@llui/components/number-input'
import * as passwordInput from '@llui/components/password-input'
import * as pinInput from '@llui/components/pin-input'
import * as radioGroup from '@llui/components/radio-group'
import * as ratingGroup from '@llui/components/rating-group'
import * as searchField from '@llui/components/search-field'
import * as slider from '@llui/components/slider'
import * as switchMachine from '@llui/components/switch'
import * as tagsInput from '@llui/components/tags-input'
import * as themeSwitch from '@llui/components/theme-switch'
import * as toggle from '@llui/components/toggle'
import * as toggleGroup from '@llui/components/toggle-group'
import * as formField from '@llui/components/patterns/form-field'
import {
  AngleSlider,
  AngleSliderControl,
  AngleSliderThumb,
  AngleSliderValueText,
} from '../llui/ui/angle-slider'
import { Button } from '../llui/ui/button'
import { ButtonGroup } from '../llui/ui/button-group'
import { Checkbox, CheckboxIndicator } from '../llui/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldLabel } from '../llui/ui/field'
import { Form, FormDescription, FormItem, FormLabel, FormMessage } from '../llui/ui/form'
import { Input } from '../llui/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '../llui/ui/input-group'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '../llui/ui/input-otp'
import { Label } from '../llui/ui/label'
import {
  NumberInput,
  NumberInputControl,
  NumberInputDecrement,
  NumberInputIncrement,
} from '../llui/ui/number-input'
import {
  PasswordInput,
  PasswordInputControl,
  PasswordInputVisibilityTrigger,
} from '../llui/ui/password-input'
import {
  RadioGroup,
  RadioGroupIndicator,
  RadioGroupItem,
  RadioGroupLabel,
} from '../llui/ui/radio-group'
import { RatingGroup, RatingGroupItem } from '../llui/ui/rating-group'
import {
  SearchField,
  SearchFieldClearTrigger,
  SearchFieldIcon,
  SearchFieldInput,
  SearchFieldLabel,
} from '../llui/ui/search-field'
import { Slider, SliderControl, SliderRange, SliderThumb, SliderTrack } from '../llui/ui/slider'
import { Spinner } from '../llui/ui/spinner'
import { Switch, SwitchThumb } from '../llui/ui/switch'
import {
  TagsInput,
  TagsInputControl,
  TagsInputTag,
  TagsInputTagRemove,
} from '../llui/ui/tags-input'
import { Textarea } from '../llui/ui/textarea'
import { ThemeSwitch, ThemeSwitchOption } from '../llui/ui/theme-switch'
import { Toggle } from '../llui/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '../llui/ui/toggle-group'
import {
  applicableFormsControlsScenarioIds,
  formsControlsCaseInput,
  type FormsControlsCaseInput,
} from '../../packages/components/test/styles/forms-controls-scenarios'

export interface Disposable {
  dispose(): void
}

export interface RenderContext {
  readonly scenarioId: string
  readonly caseId: string
  readonly environment: PresentationScenarioEnvironment
}

export type Adapter = (
  host: HTMLElement,
  input: FormsControlsCaseInput,
  ctx: RenderContext,
) => Disposable

function applyEnvironmentAttrs(
  host: HTMLElement,
  environment: PresentationScenarioEnvironment,
): void {
  host.setAttribute('dir', environment.direction)
  host.dataset.theme = environment.theme
  host.dataset.viewport = environment.viewport
  host.dataset.forcedColors = environment.forcedColors
}

function mountMachine<S, M extends { type: string }>(
  host: HTMLElement,
  ctx: RenderContext,
  name: string,
  initial: () => S,
  update: (state: S, msg: M) => readonly [S, readonly unknown[]],
  view: (state: Signal<S>, send: Send<M>) => Mountable | readonly Mountable[],
): Disposable {
  applyEnvironmentAttrs(host, ctx.environment)
  return mountApp(
    host,
    component<S, M, never>({
      name,
      init: () => [initial(), []],
      update: (state, msg) => [update(state, msg)[0], []],
      view: ({ state, send }) => {
        const rendered = view(state, send)
        return Array.isArray(rendered) ? rendered : [rendered]
      },
    }),
  )
}

function mountStatic(
  host: HTMLElement,
  ctx: RenderContext,
  name: string,
  nodes: () => readonly Mountable[],
): Disposable {
  applyEnvironmentAttrs(host, ctx.environment)
  return mountApp(
    host,
    component<Record<string, never>, never, never>({
      name,
      init: () => [{}, []],
      update: (state) => [state, []],
      view: () => nodes(),
    }),
  )
}

const str = (input: FormsControlsCaseInput, key: string, fallback = ''): string => {
  const value = input.sample[key]
  return typeof value === 'string' ? value : fallback
}
const num = (input: FormsControlsCaseInput, key: string, fallback = 0): number => {
  const value = input.sample[key]
  return typeof value === 'number' ? value : fallback
}
const list = (input: FormsControlsCaseInput, key: string): string[] => {
  const value = input.sample[key]
  return Array.isArray(value) ? [...(value as readonly string[])] : []
}

/** ARIA a consumer spreads AFTER a part bag for states its machine does not model. */
function stateAria(state: FormsControlsCaseInput['state']): Record<string, string> {
  if (state === 'invalid') return { 'aria-invalid': 'true' }
  if (state === 'required') return { 'aria-required': 'true' }
  if (state === 'read-only') return { 'aria-readonly': 'true' }
  return {}
}

const ROW = 'flex items-center gap-2'

const angleSliderAdapter: Adapter = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryAngleSliderScenario',
    () =>
      angleSlider.init({
        value: num(data, 'value'),
        min: num(data, 'minimum'),
        max: num(data, 'maximum', 360),
        disabled: data.state === 'disabled',
        readonly: data.state === 'read-only',
        dir: ctx.environment.direction,
      }),
    angleSlider.update,
    (state, send) => {
      const parts = angleSlider.connect(state, send)
      return AngleSlider({ ...parts.root, 'aria-label': str(data, 'label') }, [
        AngleSliderControl({ ...parts.control }, [AngleSliderThumb({ ...parts.thumb })]),
        AngleSliderValueText({ ...parts.valueText }, [
          text(state.at('value').map((value) => `${value}°`)),
        ]),
      ])
    },
  )

const buttonAdapter: Adapter = (host, data, ctx) =>
  mountStatic(host, ctx, 'RegistryButtonScenario', () => [
    Button(
      {
        disabled: data.state === 'disabled' || data.state === 'loading',
        ...(data.state === 'loading' ? { 'aria-busy': 'true' } : {}),
      },
      data.state === 'loading' ? [Spinner(), text(str(data, 'label'))] : [text(str(data, 'label'))],
    ),
  ])

const buttonGroupAdapter: Adapter = (host, data, ctx) =>
  mountStatic(host, ctx, 'RegistryButtonGroupScenario', () => [
    ButtonGroup(
      { 'aria-label': str(data, 'label') },
      list(data, 'actions').map((action, index) =>
        Button(
          {
            variant: 'outline',
            disabled: data.state === 'disabled',
            ...(data.state === 'selected' && index === 0 ? { 'aria-pressed': 'true' } : {}),
          },
          [text(action)],
        ),
      ),
    ),
  ])

const checkboxAdapter: Adapter = (host, data, ctx) => {
  const id = `registry-checkbox-${ctx.caseId}`
  return mountMachine(
    host,
    ctx,
    'RegistryCheckboxScenario',
    () =>
      checkbox.init({
        checked:
          data.state === 'checked'
            ? true
            : data.state === 'indeterminate'
              ? 'indeterminate'
              : false,
        disabled: data.state === 'disabled',
        required: data.state === 'required',
      }),
    checkbox.update,
    (state, send) => {
      const parts = checkbox.connect(state, send)
      return div({ class: ROW }, [
        Checkbox(
          {
            ...parts.root,
            ...(data.state === 'invalid' ? { 'aria-invalid': 'true' } : {}),
            id,
            'aria-labelledby': `${id}-label`,
          },
          [CheckboxIndicator({ ...parts.indicator })],
        ),
        Label({ id: `${id}-label` }, [text(str(data, 'label'))]),
      ])
    },
  )
}

const fieldAdapter: Adapter = (host, data, ctx) => {
  const id = `registry-field-${ctx.caseId}`
  return mountMachine(
    host,
    ctx,
    'RegistryFieldScenario',
    () =>
      field.init({
        id,
        invalid: data.state === 'invalid',
        required: data.state === 'required',
        disabled: data.state === 'disabled',
        readonly: data.state === 'read-only',
        touched: data.state === 'invalid',
      }),
    field.update,
    (state, send) => {
      const parts = field.connect(state, send, { hasDescription: true })
      return Field({ ...parts.root }, [
        FieldLabel({ ...parts.label }, [text(str(data, 'label'))]),
        Input({
          ...parts.control,
          type: 'email',
          placeholder: 'name@company.com',
          value: data.state === 'placeholder' ? '' : 'ada@example.com',
        }),
        FieldDescription({ ...parts.description }, [text(str(data, 'help'))]),
        FieldError({ ...parts.errorText, hidden: state.at('invalid').map((invalid) => !invalid) }, [
          text(str(data, 'error')),
        ]),
      ])
    },
  )
}

/** `form` is COMPOSED on this path from the form-field pattern (contract rationale). */
const formAdapter: Adapter = (host, data, ctx) => {
  const id = `registry-form-${ctx.caseId}`
  const name = 'displayName'
  return mountMachine(
    host,
    ctx,
    'RegistryFormScenario',
    () => {
      const initial = formField.init({ id, fields: [name] })
      const slice = initial.fields[name]!
      const invalid = data.state === 'invalid'
      return {
        ...initial,
        form: {
          ...initial.form,
          touched: { [name]: invalid },
          status: data.state === 'loading' ? ('submitting' as const) : initial.form.status,
        },
        fields: {
          [name]: { ...slice, invalid, touched: invalid, disabled: data.state === 'disabled' },
        },
        issues: invalid ? [{ message: 'Enter a display name.', path: [name] }] : [],
      }
    },
    formField.update,
    (state, send) => {
      const parts = formField.connect(state, send, { id, fields: [name] })
      const fieldParts = parts.formField(name)
      return Form(
        {
          ...parts.root,
          'aria-label': str(data, 'label'),
          onSubmit: (event: Event) => event.preventDefault(),
        },
        [
          FormItem({ ...fieldParts.root }, [
            FormLabel({ ...fieldParts.label }, [text('Display name')]),
            Input({ ...fieldParts.control, value: 'Ada Lovelace' }),
            FormMessage({ ...fieldParts.errorText }, [text(fieldParts.error.message)]),
          ]),
          Button({ ...parts.submit, disabled: data.state !== 'default' }, [
            text(
              state
                .at('form')
                .at('status')
                .map((status) => (status === 'submitting' ? 'Saving…' : str(data, 'submitLabel'))),
            ),
          ]),
        ],
      )
    },
  )
}

const formFieldAdapter: Adapter = (host, data, ctx) => {
  const id = `registry-form-field-${ctx.caseId}`
  const name = 'username'
  return mountMachine(
    host,
    ctx,
    'RegistryFormFieldScenario',
    () => {
      const initial = formField.init({ id, fields: [name] })
      const slice = initial.fields[name]!
      const invalid = data.state === 'invalid'
      return {
        ...initial,
        form: {
          ...initial.form,
          touched: { [name]: invalid },
          status: data.state === 'loading' ? ('submitting' as const) : initial.form.status,
        },
        fields: {
          [name]: {
            ...slice,
            invalid,
            touched: invalid,
            required: data.state === 'required',
            disabled: data.state === 'disabled',
            readonly: data.state === 'read-only',
            pending: data.state === 'loading',
          },
        },
        issues: invalid ? [{ message: str(data, 'error'), path: [name] }] : [],
      }
    },
    formField.update,
    (state, send) => {
      const parts = formField.connect(state, send, { id, fields: [name] })
      const fieldParts = parts.formField(name, { hasDescription: true })
      return div({ ...parts.root }, [
        FormItem({ ...fieldParts.root }, [
          FormLabel({ ...fieldParts.label }, [text(str(data, 'label'))]),
          Input({
            ...fieldParts.control,
            placeholder: 'ada',
            value: data.state === 'placeholder' ? '' : 'ada.l',
            ...(data.state === 'loading' ? { 'aria-busy': 'true' } : {}),
          }),
          FormDescription({ ...fieldParts.description }, [text(str(data, 'help'))]),
          FormMessage({ ...fieldParts.errorText }, [text(fieldParts.error.message)]),
        ]),
      ])
    },
  )
}

const inputAdapter: Adapter = (host, data, ctx) => {
  const id = `registry-input-${ctx.caseId}`
  return mountStatic(host, ctx, 'RegistryInputScenario', () => [
    div({ class: 'grid gap-2' }, [
      Label({ for: id }, [text(str(data, 'label'))]),
      Input({
        id,
        placeholder: str(data, 'placeholder'),
        value: data.state === 'placeholder' ? '' : str(data, 'value'),
        disabled: data.state === 'disabled',
        readOnly: data.state === 'read-only',
        required: data.state === 'required',
        ...(data.state === 'invalid' ? { 'aria-invalid': 'true' } : {}),
      }),
    ]),
  ])
}

const inputGroupAdapter: Adapter = (host, data, ctx) => {
  const id = `registry-input-group-${ctx.caseId}`
  return mountStatic(host, ctx, 'RegistryInputGroupScenario', () => [
    div({ class: 'grid gap-2' }, [
      Label({ for: id }, [text(str(data, 'label'))]),
      InputGroup({ ...(data.state === 'disabled' ? { 'data-disabled': '' } : {}) }, [
        InputGroupAddon([text(str(data, 'prefix'))]),
        InputGroupInput({
          id,
          placeholder: 'path',
          value: data.state === 'placeholder' ? '' : str(data, 'value'),
          disabled: data.state === 'disabled',
          readOnly: data.state === 'read-only',
          required: data.state === 'required',
          ...(data.state === 'invalid' ? { 'aria-invalid': 'true' } : {}),
        }),
      ]),
    ]),
  ])
}

const labelAdapter: Adapter = (host, data, ctx) => {
  const id = `registry-label-${ctx.caseId}`
  return mountStatic(host, ctx, 'RegistryLabelScenario', () => [
    div(
      { class: 'grid gap-2', ...(data.state === 'disabled' ? { 'data-disabled': 'true' } : {}) },
      [
        Label({ for: id }, [
          text(str(data, 'label')),
          ...(data.state === 'required' ? [span({ 'aria-hidden': 'true' }, [text(' *')])] : []),
        ]),
        Input({
          id,
          value: 'Ada',
          disabled: data.state === 'disabled',
          required: data.state === 'required',
          ...(data.state === 'invalid' ? { 'aria-invalid': 'true' } : {}),
        }),
      ],
    ),
  ])
}

const numberInputAdapter: Adapter = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryNumberInputScenario',
    () =>
      numberInput.init({
        value: num(data, 'value'),
        min: num(data, 'minimum'),
        max: num(data, 'maximum', 100),
        disabled: data.state === 'disabled',
        readonly: data.state === 'read-only',
      }),
    numberInput.update,
    (state, send) => {
      const parts = numberInput.connect(state, send)
      return NumberInput(
        { ...parts.root, ...stateAria(data.state === 'read-only' ? 'default' : data.state) },
        [
          NumberInputDecrement({ ...parts.decrement }, [text('−')]),
          NumberInputControl({ ...parts.input, 'aria-label': str(data, 'label') }),
          NumberInputIncrement({ ...parts.increment }, [text('+')]),
        ],
      )
    },
  )

const passwordInputAdapter: Adapter = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryPasswordInputScenario',
    () =>
      passwordInput.init({
        value: data.state === 'placeholder' ? '' : 'correct horse',
        visible: data.sample['revealed'] === true,
        disabled: data.state === 'disabled',
      }),
    passwordInput.update,
    (state, send) => {
      const parts = passwordInput.connect(state, send)
      return PasswordInput({ ...parts.root }, [
        PasswordInputControl({
          ...parts.input,
          ...stateAria(data.state),
          'aria-label': str(data, 'label'),
          placeholder: str(data, 'placeholder'),
          ...(data.state === 'read-only' ? { readOnly: true } : {}),
          ...(data.state === 'required' ? { required: true } : {}),
        }),
        PasswordInputVisibilityTrigger({ ...parts.visibilityTrigger }, [
          text(state.at('visible').map((visible) => (visible ? 'Hide' : 'Show'))),
        ]),
      ])
    },
  )

const pinInputAdapter: Adapter = (host, data, ctx) => {
  const length = num(data, 'length', 6)
  const value = str(data, 'value')
  return mountMachine(
    host,
    ctx,
    'RegistryPinInputScenario',
    () =>
      pinInput.init({
        length,
        type: 'numeric',
        disabled: data.state === 'disabled',
        values: data.state === 'placeholder' ? [] : value.split('').slice(0, length),
      }),
    pinInput.update,
    (state, send) => {
      const parts = pinInput.connect(state, send, { id: `registry-pin-${ctx.caseId}` })
      return InputOTP({ ...parts.root, 'aria-label': str(data, 'label') }, [
        InputOTPGroup(
          Array.from({ length }, (_, index) =>
            InputOTPSlot({
              ...parts.input(index),
              ...stateAria(data.state === 'read-only' ? 'default' : data.state),
              ...(data.state === 'placeholder' ? { placeholder: '○' } : {}),
              ...(data.state === 'read-only' ? { readOnly: true } : {}),
            }),
          ),
        ),
      ])
    },
  )
}

const radioGroupAdapter: Adapter = (host, data, ctx) => {
  const options = list(data, 'options')
  return mountMachine(
    host,
    ctx,
    'RegistryRadioGroupScenario',
    () =>
      radioGroup.init({
        items: options,
        value: data.state === 'checked' ? str(data, 'value') : null,
        disabled: data.state === 'disabled',
        dir: ctx.environment.direction,
      }),
    radioGroup.update,
    (state, send) => {
      const parts = radioGroup.connect(state, send, { id: `registry-radio-${ctx.caseId}` })
      return RadioGroup(
        { ...parts.root, ...stateAria(data.state), 'aria-label': str(data, 'label') },
        options.map((option) => {
          const item = parts.item(option)
          return div({ class: ROW }, [
            RadioGroupItem({ ...item.root, 'aria-label': option }, [
              RadioGroupIndicator({ ...item.indicator }),
            ]),
            RadioGroupLabel({ ...item.label }, [text(option)]),
          ])
        }),
      )
    },
  )
}

const ratingGroupAdapter: Adapter = (host, data, ctx) => {
  const count = num(data, 'maximum', 5)
  return mountMachine(
    host,
    ctx,
    'RegistryRatingGroupScenario',
    () =>
      ratingGroup.init({
        value: data.state === 'default' ? 0 : num(data, 'value'),
        count,
        disabled: data.state === 'disabled',
        readonly: data.state === 'read-only',
        dir: ctx.environment.direction,
      }),
    ratingGroup.update,
    (state, send) => {
      const parts = ratingGroup.connect(state, send, { label: str(data, 'label') })
      return RatingGroup(
        { ...parts.root },
        Array.from({ length: count }, (_, index) =>
          RatingGroupItem({ ...parts.item(index).root }, [text('★')]),
        ),
      )
    },
  )
}

const searchFieldAdapter: Adapter = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistrySearchFieldScenario',
    () =>
      searchField.init({
        value: data.state === 'placeholder' ? '' : str(data, 'value'),
        disabled: data.state === 'disabled',
      }),
    searchField.update,
    (state, send) => {
      const parts = searchField.connect(state, send)
      return SearchField(
        { ...parts.root, ...(data.state === 'loading' ? { 'aria-busy': 'true' } : {}) },
        [
          SearchFieldLabel({ ...parts.label, class: 'sr-only' }, [text(str(data, 'label'))]),
          SearchFieldIcon([data.state === 'loading' ? Spinner() : text('⌕')]),
          SearchFieldInput({
            ...parts.input,
            ...stateAria(data.state === 'read-only' ? 'default' : data.state),
            placeholder: str(data, 'placeholder'),
            ...(data.state === 'read-only' ? { readOnly: true } : {}),
            ...(data.state === 'required' ? { required: true } : {}),
          }),
          SearchFieldClearTrigger({ ...parts.clearTrigger }, [text('×')]),
        ],
      )
    },
  )

const sliderAdapter: Adapter = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistrySliderScenario',
    () =>
      slider.init({
        value: [num(data, 'value')],
        min: num(data, 'minimum'),
        max: num(data, 'maximum', 100),
        disabled: data.state === 'disabled',
        dir: ctx.environment.direction,
      }),
    slider.update,
    (state, send) => {
      const parts = slider.connect(state, send)
      return Slider({ ...parts.root, ...stateAria(data.state), class: 'w-64' }, [
        SliderControl({ ...parts.control }, [
          SliderTrack({ ...parts.track }, [SliderRange({ ...parts.range })]),
          SliderThumb({ ...parts.thumb(0).thumb, 'aria-label': str(data, 'label') }),
        ]),
      ])
    },
  )

const switchAdapter: Adapter = (host, data, ctx) => {
  const id = `registry-switch-${ctx.caseId}`
  return mountMachine(
    host,
    ctx,
    'RegistrySwitchScenario',
    () =>
      switchMachine.init({
        checked: data.state === 'checked',
        disabled: data.state === 'disabled',
      }),
    switchMachine.update,
    (state, send) => {
      const parts = switchMachine.connect(state, send)
      return div({ class: ROW }, [
        Switch({ ...parts.root, ...stateAria(data.state), 'aria-labelledby': `${id}-label` }, [
          SwitchThumb({ ...parts.thumb }),
        ]),
        Label({ id: `${id}-label` }, [text(str(data, 'label'))]),
      ])
    },
  )
}

const tagsInputAdapter: Adapter = (host, data, ctx) => {
  const values = data.state === 'placeholder' ? [] : list(data, 'values')
  return mountMachine(
    host,
    ctx,
    'RegistryTagsInputScenario',
    () => ({
      ...tagsInput.init({ value: values, disabled: data.state === 'disabled' }),
      focusedIndex: data.state === 'selected' ? values.length - 1 : null,
    }),
    tagsInput.update,
    (state, send) => {
      const parts = tagsInput.connect(state, send, { inputLabel: str(data, 'label') })
      return TagsInput({ ...parts.root, ...stateAria(data.state), class: 'max-w-80' }, [
        ...values.map((value, index) => {
          const tag = parts.tag(value, index)
          return TagsInputTag({ ...tag.root }, [
            text(value),
            TagsInputTagRemove({ ...tag.remove }, [text('×')]),
          ])
        }),
        TagsInputControl({
          ...parts.input,
          placeholder: 'Add a skill',
          ...(data.state === 'read-only' ? { readOnly: true } : {}),
        }),
      ])
    },
  )
}

const textareaAdapter: Adapter = (host, data, ctx) => {
  const id = `registry-textarea-${ctx.caseId}`
  return mountStatic(host, ctx, 'RegistryTextareaScenario', () => [
    div({ class: 'grid gap-2' }, [
      Label({ for: id }, [text(str(data, 'label'))]),
      Textarea({
        id,
        rows: 3,
        placeholder: str(data, 'placeholder'),
        value: data.state === 'placeholder' ? '' : str(data, 'value'),
        disabled: data.state === 'disabled',
        readOnly: data.state === 'read-only',
        required: data.state === 'required',
        ...(data.state === 'invalid' ? { 'aria-invalid': 'true' } : {}),
      }),
    ]),
  ])
}

const THEMES = ['light', 'system', 'dark'] as const

const themeSwitchAdapter: Adapter = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryThemeSwitchScenario',
    () => themeSwitch.init(data.state === 'selected' ? 'dark' : 'system'),
    themeSwitch.update,
    (state, send) => {
      const parts = themeSwitch.connect(state, send, {
        id: `registry-theme-switch-${ctx.caseId}`,
        label: str(data, 'label'),
      })
      return ThemeSwitch(
        { ...parts.root },
        THEMES.map((theme, index) =>
          ThemeSwitchOption(
            {
              ...parts.option(theme),
              ...(data.state === 'disabled' ? { disabled: true } : {}),
            },
            [text(list(data, 'options')[index]?.slice(0, 1) ?? theme.slice(0, 1))],
          ),
        ),
      )
    },
  )

const toggleAdapter: Adapter = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'RegistryToggleScenario',
    () => toggle.init({ pressed: data.state === 'checked', disabled: data.state === 'disabled' }),
    toggle.update,
    (state, send) => {
      const parts = toggle.connect(state, send)
      return Toggle({ ...parts.root, variant: 'outline', 'aria-label': str(data, 'label') }, [
        text('B'),
      ])
    },
  )

const toggleGroupAdapter: Adapter = (host, data, ctx) => {
  const options = list(data, 'options')
  return mountMachine(
    host,
    ctx,
    'RegistryToggleGroupScenario',
    () =>
      toggleGroup.init({
        items: options,
        type: data.state === 'selected' ? 'multiple' : 'single',
        value:
          data.state === 'checked'
            ? [str(data, 'value')]
            : data.state === 'selected'
              ? options.slice(0, 2)
              : [],
        disabled: data.state === 'disabled',
        dir: ctx.environment.direction,
      }),
    toggleGroup.update,
    (state, send) => {
      const parts = toggleGroup.connect(state, send)
      return ToggleGroup(
        { ...parts.root, 'aria-label': str(data, 'label') },
        options.map((option) => ToggleGroupItem({ ...parts.item(option).root }, [text(option)])),
      )
    },
  )
}

/** Keyed by `scenarioId`; exactly the products with a visual registry presentation. */
export const REGISTRY_ADAPTERS: Readonly<Record<string, Adapter>> = {
  'component:angle-slider': angleSliderAdapter,
  'component:checkbox': checkboxAdapter,
  'component:field': fieldAdapter,
  'component:form': formAdapter,
  'component:number-input': numberInputAdapter,
  'component:password-input': passwordInputAdapter,
  'component:pin-input': pinInputAdapter,
  'component:radio-group': radioGroupAdapter,
  'component:rating-group': ratingGroupAdapter,
  'component:search-field': searchFieldAdapter,
  'component:slider': sliderAdapter,
  'component:switch': switchAdapter,
  'component:tags-input': tagsInputAdapter,
  'component:theme-switch': themeSwitchAdapter,
  'component:toggle': toggleAdapter,
  'component:toggle-group': toggleGroupAdapter,
  'pattern:form-field': formFieldAdapter,
  'registry:button': buttonAdapter,
  'registry:button-group': buttonGroupAdapter,
  'registry:input': inputAdapter,
  'registry:input-group': inputGroupAdapter,
  'registry:label': labelAdapter,
  'registry:textarea': textareaAdapter,
}

/** Mount every case of every applicable product (tests and fixtures). */
export function mountRegistryFormsControlsScenarios(
  container: HTMLElement,
  contract: ProductContract,
  catalog: CompiledPresentationScenarioFamily,
): Disposable {
  const expected = applicableFormsControlsScenarioIds(contract, 'registryTailwind')
  const bound = Object.keys(REGISTRY_ADAPTERS).sort()
  if (JSON.stringify(expected) !== JSON.stringify(bound)) {
    throw new Error(
      `Registry forms-controls bindings do not match the contract: expected ${expected.join(', ')}; received ${bound.join(', ')}`,
    )
  }
  const handles: Disposable[] = []
  for (const scenario of catalog.scenarios) {
    const adapter = REGISTRY_ADAPTERS[scenario.scenarioId]
    if (adapter === undefined) continue
    for (const scenarioCase of scenario.cases) {
      const resolved = resolveScenarioSelection(contract, catalog, {
        productId: scenario.productId,
        caseId: scenarioCase.id,
        path: 'registryTailwind',
      })
      const host = document.createElement('section')
      host.id = `registry-${scenario.productId}--${scenarioCase.id}`
      host.dataset.scenarioRenderer = 'registryTailwind'
      host.dataset.scenarioProduct = scenario.productId
      host.dataset.scenarioId = scenario.scenarioId
      host.dataset.scenarioCase = scenarioCase.id
      container.append(host)
      handles.push(
        adapter(host, formsControlsCaseInput(resolved.case.input), {
          scenarioId: resolved.scenarioId,
          caseId: resolved.case.id,
          environment: resolved.environment,
        }),
      )
    }
  }
  return {
    dispose: () => {
      for (let index = handles.length - 1; index >= 0; index -= 1) handles[index]!.dispose()
    },
  }
}
