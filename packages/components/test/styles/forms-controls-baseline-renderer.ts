/**
 * Baseline renderer for the forms-controls family (#267): one adapter per
 * product whose baseline presentation is visually available, each rendering
 * a resolved case through the REAL machine -> connect -> baseline markup, so
 * the plain-CSS `theme.css` is what styles it. Kept SEPARATE from
 * `registry/test/forms-controls-scenario-renderer.ts`; the only seam the two
 * share is the compiled catalog in `forms-controls-scenarios.ts`.
 *
 * A case's `state` is realised through the machine wherever the machine
 * models it (`disabled`, `readonly`, `checked`, `invalid` on field …) and
 * through the standard ARIA attribute a consumer spreads after the part bag
 * where it does not (`aria-invalid` on a checkbox root, `readOnly` on a pin
 * cell) — the same attribute the baseline stylesheet keys on.
 */
import {
  button,
  component,
  div,
  fieldset as fieldsetElement,
  form as formElement,
  input,
  label,
  legend,
  mountApp,
  p,
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
import * as angleSlider from '../../src/components/angle-slider'
import * as checkbox from '../../src/components/checkbox'
import * as field from '../../src/components/field'
import * as fieldset from '../../src/components/fieldset'
import * as formMachine from '../../src/components/form'
import * as listbox from '../../src/components/listbox'
import * as numberInput from '../../src/components/number-input'
import * as passwordInput from '../../src/components/password-input'
import * as pinInput from '../../src/components/pin-input'
import * as radioGroup from '../../src/components/radio-group'
import * as ratingGroup from '../../src/components/rating-group'
import { sliderPointerWiring } from './pointer-wiring'
import * as slider from '../../src/components/slider'
import * as switchMachine from '../../src/components/switch'
import * as tagsInput from '../../src/components/tags-input'
import * as toggle from '../../src/components/toggle'
import * as toggleGroup from '../../src/components/toggle-group'
import * as formField from '../../src/patterns/form-field'
import {
  applicableFormsControlsScenarioIds,
  formsControlsCaseInput,
  type FormsControlsCaseInput,
} from './forms-controls-scenarios'

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
/** Inline, so this file names no class that some stylesheet would have to define. */
const ROW_STYLE = 'display:flex;align-items:center;gap:0.5rem'

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-')

/** ARIA a consumer spreads AFTER a part bag for states its machine does not model. */
function stateAria(state: FormsControlsCaseInput['state']): Record<string, string> {
  if (state === 'invalid') return { 'aria-invalid': 'true' }
  if (state === 'required') return { 'aria-required': 'true' }
  if (state === 'read-only') return { 'aria-readonly': 'true' }
  return {}
}

/**
 * The same state ARIA split by where ARIA ALLOWS it (#268 audit): the global
 * `aria-invalid` stays on the role-less root the skins style, while
 * `aria-required`/`aria-readonly` go on the element whose role models them
 * (spinbutton, slider, textbox). `slider` has no `aria-required` at all.
 */
function rootStateAria(state: FormsControlsCaseInput['state']): Record<string, string> {
  return state === 'invalid' ? stateAria(state) : {}
}
function controlStateAria(
  state: FormsControlsCaseInput['state'],
  { required = true, readOnly = true }: { required?: boolean; readOnly?: boolean } = {},
): Record<string, string> {
  if (state === 'required' && required) return stateAria(state)
  if (state === 'read-only' && readOnly) return stateAria(state)
  return {}
}

const angleSliderAdapter: Adapter = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineAngleSliderScenario',
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
      return div({ ...parts.root, 'aria-label': str(data, 'label') }, [
        div({ ...parts.control }, [div({ ...parts.thumb })]),
        span({ ...parts.valueText }, [text(state.at('value').map((v) => `${v}°`))]),
      ])
    },
  )

const checkboxAdapter: Adapter = (host, data, ctx) => {
  const id = `baseline-checkbox-${ctx.caseId}`
  return mountMachine(
    host,
    ctx,
    'BaselineCheckboxScenario',
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
      return div({ style: ROW_STYLE }, [
        div(
          {
            ...parts.root,
            ...stateAria(data.state === 'required' ? 'default' : data.state),
            id,
            'aria-labelledby': `${id}-label`,
          },
          [
            span({ ...parts.indicator }, [
              text(
                state
                  .at('checked')
                  .map((c) => (c === true ? '✓' : c === 'indeterminate' ? '−' : '')),
              ),
            ]),
          ],
        ),
        span({ id: `${id}-label` }, [text(str(data, 'label'))]),
      ])
    },
  )
}

const fieldAdapter: Adapter = (host, data, ctx) => {
  const id = `baseline-field-${ctx.caseId}`
  return mountMachine(
    host,
    ctx,
    'BaselineFieldScenario',
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
      return div({ ...parts.root }, [
        label({ ...parts.label }, [text(str(data, 'label'))]),
        input({
          ...parts.control,
          type: 'email',
          placeholder: 'name@company.com',
          value: data.state === 'placeholder' ? '' : 'ada@example.com',
        }),
        p({ ...parts.description }, [text(str(data, 'help'))]),
        p({ ...parts.errorText, hidden: state.at('invalid').map((invalid) => !invalid) }, [
          text(str(data, 'error')),
        ]),
      ])
    },
  )
}

const fieldsetAdapter: Adapter = (host, data, ctx) => {
  const id = `baseline-fieldset-${ctx.caseId}`
  return mountMachine(
    host,
    ctx,
    'BaselineFieldsetScenario',
    () =>
      fieldset.init({
        id,
        disabled: data.state === 'disabled',
        invalid: data.state === 'invalid',
      }),
    fieldset.update,
    (state, send) => {
      const parts = fieldset.connect(state, send)
      // ARIA gives a fieldset's `group` role no `aria-required` (#268 audit):
      // a required GROUP says so in its legend, as the registry path does.
      return fieldsetElement({ ...parts.root }, [
        legend({ ...parts.legend }, [
          text(str(data, 'legend')),
          ...(data.state === 'required' ? [span({ 'aria-hidden': 'true' }, [text(' *')])] : []),
        ]),
        label([input({ type: 'checkbox', name: `${id}-email`, checked: true }), text(' Email')]),
        label([input({ type: 'checkbox', name: `${id}-sms` }), text(' SMS')]),
        p([text(str(data, 'help'))]),
        p({ ...parts.errorText, hidden: state.at('invalid').map((invalid) => !invalid) }, [
          text('Choose at least one option.'),
        ]),
      ])
    },
  )
}

const formAdapter: Adapter = (host, data, ctx) => {
  const id = `baseline-form-${ctx.caseId}`
  return mountMachine(
    host,
    ctx,
    'BaselineFormScenario',
    () => {
      const initial = formMachine.init()
      if (data.state === 'loading') return { ...initial, status: 'submitting' as const }
      if (data.state === 'invalid') {
        return { ...initial, status: 'error' as const, submitError: 'Fix the highlighted field.' }
      }
      return initial
    },
    formMachine.update,
    (state, send) => {
      const parts = formMachine.connect(state, send, { id })
      return formElement(
        {
          ...parts.root,
          'aria-label': str(data, 'label'),
          onSubmit: (event: Event) => event.preventDefault(),
        },
        [
          label({ for: `${id}-name` }, [text('Display name')]),
          input({
            id: `${id}-name`,
            name: 'name',
            value: 'Ada Lovelace',
            disabled: data.state === 'disabled',
            ...(data.state === 'invalid' ? { 'aria-invalid': 'true' } : {}),
          }),
          p({ role: 'alert', hidden: state.at('submitError').map((error) => error === null) }, [
            text(state.at('submitError').map((error) => error ?? '')),
          ]),
          button({ ...parts.submit, ...(data.state === 'disabled' ? { disabled: true } : {}) }, [
            text(
              state
                .at('status')
                .map((status) => (status === 'submitting' ? 'Saving…' : str(data, 'submitLabel'))),
            ),
          ]),
        ],
      )
    },
  )
}

const listboxAdapter: Adapter = (host, data, ctx) => {
  const options = list(data, 'options')
  return mountMachine(
    host,
    ctx,
    'BaselineListboxScenario',
    () =>
      listbox.init({
        items: options,
        value: data.state === 'selected' ? options.slice(0, 1) : [],
        disabled: data.state === 'disabled',
      }),
    listbox.update,
    (state, send) => {
      const parts = listbox.connect(state, send, { id: `baseline-listbox-${ctx.caseId}` })
      return div(
        { ...parts.root, 'aria-label': str(data, 'label') },
        options.map((option, index) => div({ ...parts.item(option, index).root }, [text(option)])),
      )
    },
  )
}

const numberInputAdapter: Adapter = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineNumberInputScenario',
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
      return div({ ...parts.root, ...rootStateAria(data.state) }, [
        button({ ...parts.decrement }, [text('−')]),
        input({
          ...parts.input,
          // read-only: the machine already publishes `aria-readonly` here.
          ...controlStateAria(data.state, { readOnly: false }),
          'aria-label': str(data, 'label'),
        }),
        button({ ...parts.increment }, [text('+')]),
      ])
    },
  )

const passwordInputAdapter: Adapter = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselinePasswordInputScenario',
    () =>
      passwordInput.init({
        value: data.state === 'placeholder' ? '' : 'correct horse',
        visible: data.sample['revealed'] === true,
        disabled: data.state === 'disabled',
      }),
    passwordInput.update,
    (state, send) => {
      const parts = passwordInput.connect(state, send)
      return div({ ...parts.root }, [
        input({
          ...parts.input,
          ...stateAria(data.state),
          'aria-label': str(data, 'label'),
          placeholder: str(data, 'placeholder'),
          ...(data.state === 'read-only' ? { readOnly: true } : {}),
          ...(data.state === 'required' ? { required: true } : {}),
        }),
        button({ ...parts.visibilityTrigger }, [
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
    'BaselinePinInputScenario',
    () =>
      pinInput.init({
        length,
        type: 'numeric',
        disabled: data.state === 'disabled',
        values: data.state === 'placeholder' ? [] : value.split('').slice(0, length),
      }),
    pinInput.update,
    (state, send) => {
      const parts = pinInput.connect(state, send, { id: `baseline-pin-${ctx.caseId}` })
      return div({ ...parts.root }, [
        span({ ...parts.label }, [text(str(data, 'label'))]),
        ...Array.from({ length }, (_, index) =>
          input({
            ...parts.input(index),
            ...stateAria(data.state === 'read-only' ? 'default' : data.state),
            ...(data.state === 'placeholder' ? { placeholder: '○' } : {}),
            ...(data.state === 'read-only' ? { readOnly: true } : {}),
          }),
        ),
      ])
    },
  )
}

const radioGroupAdapter: Adapter = (host, data, ctx) => {
  const options = list(data, 'options')
  const id = `baseline-radio-${ctx.caseId}`
  return mountMachine(
    host,
    ctx,
    'BaselineRadioGroupScenario',
    () =>
      radioGroup.init({
        items: options,
        value: data.state === 'checked' ? str(data, 'value') : null,
        disabled: data.state === 'disabled',
        dir: ctx.environment.direction,
      }),
    radioGroup.update,
    (state, send) => {
      const parts = radioGroup.connect(state, send, { id })
      return div(
        { ...parts.root, ...stateAria(data.state), 'aria-label': str(data, 'label') },
        options.map((option) => {
          const item = parts.item(option)
          return div({ style: ROW_STYLE }, [
            div({ ...item.root, 'aria-label': option }, [div({ ...item.indicator })]),
            span({ ...item.label }, [text(option)]),
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
    'BaselineRatingGroupScenario',
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
      return div(
        { ...parts.root },
        Array.from({ length: count }, (_, index) =>
          div({ ...parts.item(index).root }, [text('★')]),
        ),
      )
    },
  )
}

const sliderAdapter: Adapter = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineSliderScenario',
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
      return [
        sliderPointerWiring(state, send),
        div({ ...parts.root, ...rootStateAria(data.state) }, [
          div({ ...parts.control }, [
            div({ ...parts.track }, [div({ ...parts.range })]),
            div({
              ...parts.thumb(0).thumb,
              ...controlStateAria(data.state, { required: false }),
              'aria-label': str(data, 'label'),
            }),
          ]),
        ]),
      ]
    },
  )

const switchAdapter: Adapter = (host, data, ctx) => {
  const id = `baseline-switch-${ctx.caseId}`
  return mountMachine(
    host,
    ctx,
    'BaselineSwitchScenario',
    () =>
      switchMachine.init({
        checked: data.state === 'checked',
        disabled: data.state === 'disabled',
      }),
    switchMachine.update,
    (state, send) => {
      const parts = switchMachine.connect(state, send)
      return div({ style: ROW_STYLE }, [
        button({ ...parts.root, ...stateAria(data.state), 'aria-labelledby': `${id}-label` }, [
          span({ ...parts.track }, [span({ ...parts.thumb })]),
        ]),
        span({ id: `${id}-label` }, [text(str(data, 'label'))]),
      ])
    },
  )
}

const tagsInputAdapter: Adapter = (host, data, ctx) => {
  const values = data.state === 'placeholder' ? [] : list(data, 'values')
  return mountMachine(
    host,
    ctx,
    'BaselineTagsInputScenario',
    () => ({
      ...tagsInput.init({ value: values, disabled: data.state === 'disabled' }),
      focusedIndex: data.state === 'selected' ? values.length - 1 : null,
    }),
    tagsInput.update,
    (state, send) => {
      const parts = tagsInput.connect(state, send, { inputLabel: str(data, 'label') })
      return div({ ...parts.root, ...rootStateAria(data.state) }, [
        ...values.map((value, index) => {
          const tag = parts.tag(value, index)
          return span({ ...tag.root }, [text(value), button({ ...tag.remove }, [text('×')])])
        }),
        input({
          ...parts.input,
          ...controlStateAria(data.state),
          placeholder: 'Add a skill',
          ...(data.state === 'read-only' ? { readOnly: true } : {}),
        }),
      ])
    },
  )
}

const toggleAdapter: Adapter = (host, data, ctx) =>
  mountMachine(
    host,
    ctx,
    'BaselineToggleScenario',
    () => toggle.init({ pressed: data.state === 'checked', disabled: data.state === 'disabled' }),
    toggle.update,
    (state, send) => {
      const parts = toggle.connect(state, send)
      return button({ ...parts.root, 'aria-label': str(data, 'label') }, [text('B')])
    },
  )

const toggleGroupAdapter: Adapter = (host, data, ctx) => {
  const options = list(data, 'options')
  return mountMachine(
    host,
    ctx,
    'BaselineToggleGroupScenario',
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
      return div(
        { ...parts.root, 'aria-label': str(data, 'label') },
        options.map((option) => button({ ...parts.item(option).root }, [text(option)])),
      )
    },
  )
}

const formFieldAdapter: Adapter = (host, data, ctx) => {
  const id = `baseline-form-field-${ctx.caseId}`
  const name = 'username'
  return mountMachine(
    host,
    ctx,
    'BaselineFormFieldScenario',
    () => {
      const initial = formField.init({ id, fields: [name] })
      const slice = initial.fields[name]!
      const invalid = data.state === 'invalid'
      return {
        ...initial,
        form: {
          ...initial.form,
          // An error is shown only for a TOUCHED field (or after submit).
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
        div({ ...fieldParts.root }, [
          label({ ...fieldParts.label }, [text(str(data, 'label'))]),
          input({
            ...fieldParts.control,
            placeholder: 'ada',
            value: data.state === 'placeholder' ? '' : 'ada.l',
            ...(data.state === 'loading' ? { 'aria-busy': 'true' } : {}),
          }),
          p({ ...fieldParts.description }, [text(str(data, 'help'))]),
          p({ ...fieldParts.errorText }, [text(fieldParts.error.message)]),
        ]),
      ])
    },
  )
}

/** Keyed by `scenarioId`; exactly the products with a visual baseline presentation. */
export const BASELINE_ADAPTERS: Readonly<Record<string, Adapter>> = {
  'component:angle-slider': angleSliderAdapter,
  'component:checkbox': checkboxAdapter,
  'component:field': fieldAdapter,
  'component:fieldset': fieldsetAdapter,
  'component:form': formAdapter,
  'component:listbox': listboxAdapter,
  'component:number-input': numberInputAdapter,
  'component:password-input': passwordInputAdapter,
  'component:pin-input': pinInputAdapter,
  'component:radio-group': radioGroupAdapter,
  'component:rating-group': ratingGroupAdapter,
  'component:slider': sliderAdapter,
  'component:switch': switchAdapter,
  'component:tags-input': tagsInputAdapter,
  'component:toggle': toggleAdapter,
  'component:toggle-group': toggleGroupAdapter,
  'pattern:form-field': formFieldAdapter,
}

/** Mount every case of every applicable product (tests and fixtures). */
export function mountBaselineFormsControlsScenarios(
  container: HTMLElement,
  contract: ProductContract,
  catalog: CompiledPresentationScenarioFamily,
): Disposable {
  const expected = applicableFormsControlsScenarioIds(contract, 'baseline')
  const bound = Object.keys(BASELINE_ADAPTERS).sort()
  if (JSON.stringify(expected) !== JSON.stringify(bound)) {
    throw new Error(
      `Baseline forms-controls bindings do not match the contract: expected ${expected.join(', ')}; received ${bound.join(', ')}`,
    )
  }
  const handles: Disposable[] = []
  for (const scenario of catalog.scenarios) {
    const adapter = BASELINE_ADAPTERS[scenario.scenarioId]
    if (adapter === undefined) continue
    for (const scenarioCase of scenario.cases) {
      const resolved = resolveScenarioSelection(contract, catalog, {
        productId: scenario.productId,
        caseId: scenarioCase.id,
        path: 'baseline',
      })
      const host = document.createElement('section')
      host.id = `baseline-${scenario.productId}--${slug(scenarioCase.id)}`
      host.dataset.scenarioRenderer = 'baseline'
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
