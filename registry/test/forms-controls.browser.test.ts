import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { component, div, li, mountApp, text, type Mountable } from '@llui/dom'
import { compileCandidates } from '../../scripts/lib/tailwind-compile.mjs'
import { ProductContractSchema } from '../../packages/cli/src/product-contract'
import { FORM_CONTROL_SCENARIOS } from '../../packages/components/test/styles/fixtures/form-control-scenarios'
import { AngleSliderControl, AngleSliderThumb } from '../llui/ui/angle-slider'
import { Button } from '../llui/ui/button'
import { ButtonGroup } from '../llui/ui/button-group'
import { Checkbox, CheckboxIndicator } from '../llui/ui/checkbox'
import { Field, FieldErrorList, FieldLabel } from '../llui/ui/field'
import { FormItem } from '../llui/ui/form'
import { Input } from '../llui/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '../llui/ui/input-group'
import { InputOTPGroup, InputOTPSlot } from '../llui/ui/input-otp'
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
import { RadioGroupIndicator, RadioGroupItem } from '../llui/ui/radio-group'
import { RatingGroupItem } from '../llui/ui/rating-group'
import {
  SearchField,
  SearchFieldClearTrigger,
  SearchFieldIcon,
  SearchFieldInput,
} from '../llui/ui/search-field'
import { Slider, SliderControl, SliderRange, SliderThumb, SliderTrack } from '../llui/ui/slider'
import { Switch, SwitchThumb } from '../llui/ui/switch'
import { TagsInput, TagsInputControl, TagsInputTag } from '../llui/ui/tags-input'
import { Textarea } from '../llui/ui/textarea'
import { ThemeSwitchOption } from '../llui/ui/theme-switch'
import { Toggle } from '../llui/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '../llui/ui/toggle-group'

const ROOT = resolve(import.meta.dirname, '../..')
const STYLES = resolve(ROOT, 'packages/components/src/styles')
const registryManifest = JSON.parse(
  readFileSync(resolve(ROOT, 'registry/registry.json'), 'utf8'),
) as {
  productContract?: unknown
}
const formProducts = ProductContractSchema.parse(registryManifest.productContract).entries.filter(
  ({ presentation }) => presentation.family === 'forms-controls',
)
const baselineCss = [
  'semantic-tokens.css',
  'semantic-tokens-dark.css',
  'foundation.css',
  'form-controls.css',
]
  .map((file) => readFileSync(resolve(STYLES, file), 'utf8'))
  .join('\n')

type ScenarioId = keyof typeof FORM_CONTROL_SCENARIOS
type StylingPath = 'baseline' | 'registry'

const applicableProductIds = (path: StylingPath): string[] =>
  formProducts
    .filter(({ presentation }) => {
      const mode =
        path === 'baseline' ? presentation.baseline.mode : presentation.registryTailwind.mode
      return mode === 'styled' || mode === 'partial'
    })
    .map(({ name }) => name)
    .sort()

const renderedProductIds = (markup: string): string[] => {
  const template = document.createElement('template')
  template.innerHTML = markup
  return [...template.content.querySelectorAll<HTMLElement>('[data-scenario-id]')]
    .map((element) => {
      const scenarioId = element.dataset['scenarioId'] as ScenarioId
      return FORM_CONTROL_SCENARIOS[scenarioId].productId
    })
    .sort()
}

const concernProductIds = (
  path: StylingPath,
  concern: 'dark' | 'high-contrast' | 'rtl',
): string[] =>
  Object.values(FORM_CONTROL_SCENARIOS)
    .filter((scenario) => {
      const coverage = path === 'baseline' ? scenario.baseline : scenario.registryTailwind
      return (coverage === 'styled' || coverage === 'partial') && scenario.states.includes(concern)
    })
    .map(({ productId }) => productId)
    .sort()

const scenario = (scenarioId: ScenarioId, children: readonly Mountable[]): Mountable =>
  div({ 'data-scenario-id': scenarioId }, children)

const registryFixture = (): {
  markup: string
  candidates: string[]
} => {
  const host = document.createElement('div')
  document.body.append(host)

  const scenarios: Mountable[] = [
    scenario('component:switch', [
      Switch({ id: 'registry-switch-checked', 'data-state': 'checked' }, [
        SwitchThumb({ id: 'registry-switch-thumb', 'data-state': 'checked' }),
      ]),
      Switch({ id: 'registry-switch-unchecked', 'data-state': 'unchecked' }, [
        SwitchThumb({ 'data-state': 'unchecked' }),
      ]),
    ]),
    scenario('component:password-input', [
      PasswordInput({ id: 'registry-password-root' }, [
        PasswordInputControl({ id: 'registry-password-input', value: 'correct horse' }),
        PasswordInputVisibilityTrigger({ id: 'registry-password-trigger' }, [text('Show')]),
      ]),
    ]),
    scenario('component:pin-input', [
      InputOTPGroup({ id: 'registry-pin-root' }, [
        InputOTPSlot({ id: 'registry-pin-first', value: '2' }),
        InputOTPSlot({ id: 'registry-pin-middle', value: '7' }),
        InputOTPSlot({ id: 'registry-pin-last', value: '0' }),
      ]),
    ]),
    scenario('component:field', [
      Field({ id: 'registry-field', 'data-invalid': '' }, [
        FieldLabel({ id: 'registry-field-label' }, [text('Email')]),
        Input({ id: 'registry-field-control', 'aria-invalid': 'true' }),
        FieldErrorList({ id: 'registry-field-error-list' }, [
          li([text('Email is required')]),
          li([text('Email must be valid')]),
        ]),
      ]),
    ]),
    scenario('pattern:form-field', [
      FormItem({ id: 'registry-form-field', 'data-invalid': '' }, [
        Input({ id: 'registry-form-field-control', 'aria-invalid': 'true' }),
      ]),
    ]),
    scenario('component:angle-slider', [
      AngleSliderControl({ id: 'registry-angle-control' }, [
        AngleSliderThumb({ id: 'registry-angle-thumb' }),
      ]),
    ]),
    scenario('registry:button', [Button({ id: 'registry-button' }, [text('Continue')])]),
    scenario('registry:button-group', [
      ButtonGroup({ id: 'registry-button-group', orientation: 'horizontal' }, [
        Button({ id: 'registry-button-group-first', variant: 'outline' }, [text('Back')]),
        Button({ id: 'registry-button-group-last', variant: 'outline' }, [text('Forward')]),
      ]),
    ]),
    scenario('component:checkbox', [
      Checkbox({ id: 'registry-checkbox-checked', 'data-state': 'checked' }, [
        CheckboxIndicator({ id: 'registry-checkbox-checked-indicator' }),
      ]),
      Checkbox({ id: 'registry-checkbox-unchecked', 'data-state': 'unchecked' }, [
        CheckboxIndicator({ id: 'registry-checkbox-unchecked-indicator' }),
      ]),
      Checkbox({ id: 'registry-checkbox-indeterminate', 'data-state': 'indeterminate' }, [
        CheckboxIndicator({ id: 'registry-checkbox-indeterminate-indicator' }),
      ]),
    ]),
    scenario('component:radio-group', [
      RadioGroupItem({ id: 'registry-radio-checked', 'data-state': 'checked' }, [
        RadioGroupIndicator({ id: 'registry-radio-checked-indicator' }),
      ]),
      RadioGroupItem({ id: 'registry-radio-unchecked', 'data-state': 'unchecked' }, [
        RadioGroupIndicator({ id: 'registry-radio-unchecked-indicator' }),
      ]),
    ]),
    scenario('registry:input', [Input({ id: 'registry-input', value: 'Northstar' })]),
    scenario('registry:input-group', [
      InputGroup({ id: 'registry-input-group' }, [
        InputGroupAddon(
          {
            id: 'registry-input-group-start',
            align: 'inline-start',
            'data-align': 'inline-start',
          },
          [InputGroupButton([text('https://')])],
        ),
        InputGroupInput({ id: 'registry-input-group-control', value: 'llui.dev' }),
        InputGroupAddon(
          {
            id: 'registry-input-group-end',
            align: 'inline-end',
            'data-align': 'inline-end',
          },
          [InputGroupButton([text('.com')])],
        ),
      ]),
      InputGroup({ id: 'registry-input-group-start-only' }, [
        InputGroupAddon({ align: 'inline-start', 'data-align': 'inline-start' }, [
          text('https://'),
        ]),
        InputGroupInput({ id: 'registry-input-group-start-control', value: 'llui.dev' }),
      ]),
      InputGroup({ id: 'registry-input-group-end-only' }, [
        InputGroupInput({ id: 'registry-input-group-end-control', value: 'llui.dev' }),
        InputGroupAddon({ align: 'inline-end', 'data-align': 'inline-end' }, [text('.com')]),
      ]),
    ]),
    scenario('registry:label', [
      Label({ id: 'registry-label', for: 'registry-input' }, [text('Project')]),
    ]),
    scenario('component:number-input', [
      NumberInput({ id: 'registry-number-input' }, [
        NumberInputDecrement({ id: 'registry-number-decrement' }, [text('−')]),
        NumberInputControl({ id: 'registry-number-control', value: '4' }),
        NumberInputIncrement({ id: 'registry-number-increment' }, [text('+')]),
      ]),
    ]),
    scenario('component:rating-group', [
      RatingGroupItem({ id: 'registry-rating-full', 'data-fill': 'full' }, [text('★')]),
      RatingGroupItem({ id: 'registry-rating-half', 'data-fill': 'half' }, [text('★')]),
      RatingGroupItem({ id: 'registry-rating-empty', 'data-fill': 'empty' }, [text('★')]),
    ]),
    scenario('component:slider', [
      Slider({ id: 'registry-slider', 'data-orientation': 'horizontal' }, [
        SliderControl({ style: 'width:10rem' }, [
          SliderTrack({ id: 'registry-slider-track', 'data-orientation': 'horizontal' }, [
            SliderRange({
              id: 'registry-slider-range',
              'data-orientation': 'horizontal',
              style: 'position:absolute;left:0;right:35%',
            }),
          ]),
          SliderThumb({ id: 'registry-slider-thumb' }),
        ]),
      ]),
    ]),
    scenario('component:search-field', [
      SearchField({ id: 'registry-search-field' }, [
        SearchFieldInput({ id: 'registry-search-input', value: 'Ada' }),
        SearchFieldIcon({ id: 'registry-search-icon' }, [text('⌕')]),
        SearchFieldClearTrigger({ id: 'registry-search-clear' }, [text('×')]),
      ]),
    ]),
    scenario('component:theme-switch', [
      ThemeSwitchOption({ id: 'registry-theme-on', 'aria-pressed': 'true' }, [text('Dark')]),
      ThemeSwitchOption({ id: 'registry-theme-off', 'aria-pressed': 'false' }, [text('Light')]),
    ]),
    scenario('component:toggle', [
      Toggle({ id: 'registry-toggle-on', 'data-state': 'on' }, [text('Bold')]),
      Toggle({ id: 'registry-toggle-off', 'data-state': 'off' }, [text('Italic')]),
    ]),
    scenario('component:toggle-group', [
      ToggleGroup({ 'data-variant': 'default', style: '--gap:0.25rem' }, [
        ToggleGroupItem({ id: 'registry-toggle-group-on', 'data-state': 'on' }, [text('Start')]),
        ToggleGroupItem({ id: 'registry-toggle-group-off', 'data-state': 'off' }, [text('End')]),
      ]),
      ToggleGroup(
        {
          id: 'registry-toggle-group-fused',
          'data-variant': 'outline',
          'data-spacing': '0',
          style: '--gap:0',
        },
        [
          ToggleGroupItem(
            {
              id: 'registry-toggle-group-fused-first',
              'data-variant': 'outline',
              'data-spacing': '0',
            },
            [text('Start')],
          ),
          ToggleGroupItem(
            {
              id: 'registry-toggle-group-fused-middle',
              'data-variant': 'outline',
              'data-spacing': '0',
            },
            [text('Center')],
          ),
          ToggleGroupItem(
            {
              id: 'registry-toggle-group-fused-last',
              'data-variant': 'outline',
              'data-spacing': '0',
            },
            [text('End')],
          ),
        ],
      ),
    ]),
    scenario('component:tags-input', [
      TagsInput({ id: 'registry-tags-input' }, [
        TagsInputTag([text('TypeScript')]),
        TagsInputControl({ value: 'Accessibility' }),
      ]),
    ]),
    scenario('registry:textarea', [
      Textarea({ id: 'registry-textarea', value: 'Follow up next week' }),
    ]),
  ]

  const app = mountApp(
    host,
    component<null, never, never>({
      name: 'RegistryFormsFixture',
      init: () => [null, []],
      update: (state) => [state, []],
      view: () => [div({ id: 'registry-fixture' }, scenarios)],
    }),
  )
  const candidates = [
    ...new Set(
      [...host.querySelectorAll<HTMLElement>('[class]')].flatMap((element) => [
        ...element.classList,
      ]),
    ),
  ]
    .filter((candidate) => !/^(?:group|peer)(?:\/|$)/.test(candidate))
    .sort()
  const markup = host.innerHTML
  app.dispose()
  host.remove()
  return { markup, candidates }
}

const baselineScenario = (scenarioId: ScenarioId, markup: string): string =>
  `<section data-scenario-id="${scenarioId}">${markup}</section>`

const baselineMarkup = [
  baselineScenario(
    'component:switch',
    `<button id="baseline-switch-root" data-scope="switch" data-part="root" data-state="checked">
      <span id="baseline-switch-checked" data-scope="switch" data-part="track" data-state="checked">
        <span id="baseline-switch-thumb" data-scope="switch" data-part="thumb" data-state="checked"></span>
      </span>
    </button>
    <button data-scope="switch" data-part="root" data-state="unchecked">
      <span id="baseline-switch-unchecked" data-scope="switch" data-part="track" data-state="unchecked">
        <span data-scope="switch" data-part="thumb" data-state="unchecked"></span>
      </span>
    </button>`,
  ),
  baselineScenario(
    'component:password-input',
    `<div id="baseline-password-root" data-scope="password-input" data-part="root">
      <input id="baseline-password-input" data-scope="password-input" data-part="input" value="correct horse" />
      <button id="baseline-password-trigger" data-scope="password-input" data-part="visibility-trigger">Show</button>
    </div>`,
  ),
  baselineScenario(
    'component:pin-input',
    `<div id="baseline-pin-root" data-scope="pin-input" data-part="root">
      <input id="baseline-pin-first" data-scope="pin-input" data-part="input" value="2" />
      <input id="baseline-pin-middle" data-scope="pin-input" data-part="input" value="7" />
      <input id="baseline-pin-last" data-scope="pin-input" data-part="input" value="0" />
    </div>`,
  ),
  baselineScenario(
    'component:field',
    `<div id="baseline-field" data-scope="field" data-part="root" data-invalid>
      <label data-scope="field" data-part="label">Email</label>
      <input id="baseline-field-control" data-scope="field" data-part="control" aria-invalid="true" />
    </div>`,
  ),
  baselineScenario(
    'pattern:form-field',
    `<div id="baseline-form-field" data-scope="form-field" data-part="field" data-invalid>
      <label data-scope="form-field" data-part="label">Email</label>
      <input id="baseline-form-field-control" data-scope="form-field" data-part="control" aria-invalid="true" />
    </div>`,
  ),
  baselineScenario(
    'component:checkbox',
    `<button id="baseline-checkbox-checked" data-scope="checkbox" data-part="root" data-state="checked"><span id="baseline-checkbox-checked-indicator" data-scope="checkbox" data-part="indicator" data-state="checked">✓</span></button>
     <button id="baseline-checkbox-unchecked" data-scope="checkbox" data-part="root" data-state="unchecked"></button>
     <button id="baseline-checkbox-indeterminate" data-scope="checkbox" data-part="root" data-state="indeterminate"><span id="baseline-checkbox-indeterminate-indicator" data-scope="checkbox" data-part="indicator" data-state="indeterminate">−</span></button>`,
  ),
  baselineScenario(
    'component:listbox',
    `<div data-scope="listbox" data-part="root">
      <div id="baseline-listbox-selected" data-scope="listbox" data-part="item" data-state="selected">Selected</div>
      <div id="baseline-listbox-default" data-scope="listbox" data-part="item">Default</div>
    </div>`,
  ),
  baselineScenario(
    'component:radio-group',
    `<button id="baseline-radio-checked" data-scope="radio-group" data-part="item" data-state="checked"><span id="baseline-radio-checked-indicator" data-scope="radio-group" data-part="indicator" data-state="checked"></span></button>
     <button id="baseline-radio-unchecked" data-scope="radio-group" data-part="item" data-state="unchecked"><span id="baseline-radio-unchecked-indicator" data-scope="radio-group" data-part="indicator" data-state="unchecked"></span></button>`,
  ),
  baselineScenario(
    'component:rating-group',
    `<span id="baseline-rating-full" data-scope="rating-group" data-part="item" data-fill="full">★</span>
     <span id="baseline-rating-half" data-scope="rating-group" data-part="item" data-fill="half">★</span>
     <span id="baseline-rating-empty" data-scope="rating-group" data-part="item" data-fill="empty">★</span>`,
  ),
  baselineScenario(
    'component:slider',
    `<div data-scope="slider" data-part="control" data-orientation="horizontal" style="width:10rem">
      <div id="baseline-slider-track" data-scope="slider" data-part="track" data-orientation="horizontal">
        <div id="baseline-slider-range" data-scope="slider" data-part="range" data-orientation="horizontal" style="position:absolute;left:0;right:35%"></div>
      </div>
      <button id="baseline-slider-thumb" data-scope="slider" data-part="thumb" data-orientation="horizontal"></button>
    </div>`,
  ),
  baselineScenario(
    'component:toggle',
    `<button id="baseline-toggle-on" data-scope="toggle" data-part="root" data-state="on">Bold</button>
     <button id="baseline-toggle-off" data-scope="toggle" data-part="root" data-state="off">Italic</button>`,
  ),
  baselineScenario(
    'component:toggle-group',
    `<div data-scope="toggle-group" data-part="root">
      <button id="baseline-toggle-group-on" data-scope="toggle-group" data-part="item" data-state="on">Start</button>
      <button id="baseline-toggle-group-off" data-scope="toggle-group" data-part="item" data-state="off">End</button>
    </div>`,
  ),
  baselineScenario(
    'component:angle-slider',
    `<div data-scope="angle-slider" data-part="root">
      <button id="baseline-angle-control" data-scope="angle-slider" data-part="control">
        <span id="baseline-angle-thumb" data-scope="angle-slider" data-part="thumb"></span>
      </button>
    </div>`,
  ),
  baselineScenario(
    'component:fieldset',
    `<fieldset id="baseline-fieldset" data-scope="fieldset" data-part="root">
      <legend data-scope="fieldset" data-part="legend">Contact preferences</legend>
      <p data-scope="fieldset" data-part="error">Choose one option</p>
    </fieldset>`,
  ),
  baselineScenario(
    'component:form',
    `<form id="baseline-form" data-scope="form" data-part="root">
      <div data-scope="form" data-part="field">Profile field</div>
    </form>`,
  ),
  baselineScenario(
    'component:number-input',
    `<div id="baseline-number-input" data-scope="number-input" data-part="root">
      <button data-scope="number-input" data-part="decrement">−</button>
      <input data-scope="number-input" data-part="input" value="4" />
      <button data-scope="number-input" data-part="increment">+</button>
    </div>`,
  ),
  baselineScenario(
    'component:tags-input',
    `<div id="baseline-tags-input" data-scope="tags-input" data-part="root">
      <span data-scope="tags-input" data-part="tag">TypeScript</span>
      <input data-scope="tags-input" data-part="input" value="Accessibility" />
    </div>`,
  ),
].join('\n')

type Coverage = Readonly<{
  baseline: { mode: 'asserted' } | { mode: 'not-applicable'; rationale: string }
  registry: { mode: 'asserted' } | { mode: 'not-applicable'; rationale: string }
}>

const HIGH_CONTRAST_COVERAGE = {
  'component:angle-slider': {
    baseline: {
      mode: 'not-applicable',
      rationale:
        'The baseline artifact owns interaction resets only; consumer geometry paints the dial.',
    },
    registry: { mode: 'asserted' },
  },
  'component:checkbox': { baseline: { mode: 'asserted' }, registry: { mode: 'asserted' } },
  'component:field': { baseline: { mode: 'asserted' }, registry: { mode: 'asserted' } },
  'component:listbox': {
    baseline: { mode: 'asserted' },
    registry: {
      mode: 'not-applicable',
      rationale:
        'The registry contract intentionally ships the listbox machine without a copied skin.',
    },
  },
  'component:radio-group': { baseline: { mode: 'asserted' }, registry: { mode: 'asserted' } },
  'component:rating-group': { baseline: { mode: 'asserted' }, registry: { mode: 'asserted' } },
  'component:slider': { baseline: { mode: 'asserted' }, registry: { mode: 'asserted' } },
  'component:switch': { baseline: { mode: 'asserted' }, registry: { mode: 'asserted' } },
  'component:theme-switch': {
    baseline: {
      mode: 'not-applicable',
      rationale: 'The baseline path intentionally exposes only the headless theme-switch machine.',
    },
    registry: { mode: 'asserted' },
  },
  'component:toggle': { baseline: { mode: 'asserted' }, registry: { mode: 'asserted' } },
  'component:toggle-group': { baseline: { mode: 'asserted' }, registry: { mode: 'asserted' } },
  'pattern:form-field': { baseline: { mode: 'asserted' }, registry: { mode: 'asserted' } },
  'registry:button': {
    baseline: {
      mode: 'not-applicable',
      rationale: 'The copied button recipe has no canonical baseline-selector counterpart.',
    },
    registry: { mode: 'asserted' },
  },
} as const satisfies Record<string, Coverage>

type GeometrySnapshot = {
  fieldGap: string
  formFieldGap: string
  password: {
    rootWidth: number
    inputWidth: number
    height: number
    fontFamily: string
    fontSize: string
    lineHeight: string
    paddingInlineStart: string
    paddingInlineEnd: string
    triggerInlineEnd: number
  }
  switch: {
    track: { width: number; height: number }
    thumb: { width: number; height: number }
    inlineStartGap: number
    inlineEndGap: number
    contained: boolean
  }
  pinOrder: 'ascending' | 'descending'
  pin: Array<{
    borderInlineStart: string
    borderInlineEnd: string
    radiusStartStart: string
    radiusStartEnd: string
    radiusEndStart: string
    radiusEndEnd: string
  }>
  compactControls: {
    checkbox: {
      width: number
      height: number
      fontSize: string
      borderRadius: string
      borderWidth: string
    }
    radio: {
      width: number
      height: number
      fontSize: string
      borderWidth: string
      round: boolean
    }
    sliderTrack: { height: number; round: boolean }
    sliderThumb: {
      width: number
      height: number
      fontSize: string
      borderWidth: string
      round: boolean
    }
    toggle: {
      height: number
      minWidth: string
      fontSize: string
      fontFamily: string
      fontWeight: string
      lineHeight: string
      borderRadius: string
      borderWidth: string
      paddingInline: string
    }
    toggleGroup: {
      height: number
      minWidth: string
      fontSize: string
      fontFamily: string
      fontWeight: string
      lineHeight: string
      borderRadius: string
      borderWidth: string
      paddingInline: string
    }
  }
}

const geometry = async (
  page: Page,
  path: StylingPath,
  dir: 'ltr' | 'rtl',
): Promise<GeometrySnapshot> =>
  page.evaluate(
    ({ pathName, direction }) => {
      const prefix = pathName === 'baseline' ? 'baseline' : 'registry'
      const element = (name: string): HTMLElement =>
        document.querySelector<HTMLElement>(`#${prefix}-${name}`)!
      const style = (name: string): CSSStyleDeclaration => getComputedStyle(element(name))
      const rect = (name: string): DOMRect => element(name).getBoundingClientRect()
      const trackRect = rect('switch-checked')
      const thumbRect = rect('switch-thumb')
      const inlineStartGap =
        direction === 'ltr' ? thumbRect.left - trackRect.left : trackRect.right - thumbRect.right
      const inlineEndGap =
        direction === 'ltr' ? trackRect.right - thumbRect.right : thumbRect.left - trackRect.left
      const passwordRoot = rect('password-root')
      const passwordTrigger = rect('password-trigger')
      const pinNames = ['pin-first', 'pin-middle', 'pin-last']
      const pinLefts = pinNames.map((name) => rect(name).left)
      const compactControl = (name: string) => {
        const computed = style(name)
        const bounds = rect(name)
        return {
          width: bounds.width,
          height: bounds.height,
          minWidth: computed.minWidth,
          fontSize: computed.fontSize,
          fontFamily: computed.fontFamily,
          fontWeight: computed.fontWeight,
          lineHeight: computed.lineHeight,
          borderRadius: computed.borderRadius,
          borderWidth: computed.borderWidth,
          paddingInline: computed.paddingInline,
          round:
            Number.parseFloat(computed.borderRadius) >= Math.min(bounds.width, bounds.height) / 2,
        }
      }

      return {
        fieldGap: style('field').gap,
        formFieldGap: style('form-field').gap,
        password: {
          rootWidth: passwordRoot.width,
          inputWidth: rect('password-input').width,
          height: rect('password-input').height,
          fontFamily: style('password-input').fontFamily,
          fontSize: style('password-input').fontSize,
          lineHeight: style('password-input').lineHeight,
          paddingInlineStart: style('password-input').paddingInlineStart,
          paddingInlineEnd: style('password-input').paddingInlineEnd,
          triggerInlineEnd:
            direction === 'ltr'
              ? passwordRoot.right - passwordTrigger.right
              : passwordTrigger.left - passwordRoot.left,
        },
        switch: {
          track: { width: trackRect.width, height: trackRect.height },
          thumb: { width: thumbRect.width, height: thumbRect.height },
          inlineStartGap,
          inlineEndGap,
          contained:
            thumbRect.left >= trackRect.left - 0.01 && thumbRect.right <= trackRect.right + 0.01,
        },
        pinOrder: pinLefts[0]! < pinLefts[2]! ? 'ascending' : 'descending',
        pin: pinNames.map((name) => {
          const computed = style(name)
          return {
            borderInlineStart: computed.borderInlineStartWidth,
            borderInlineEnd: computed.borderInlineEndWidth,
            radiusStartStart: computed.borderStartStartRadius,
            radiusStartEnd: computed.borderStartEndRadius,
            radiusEndStart: computed.borderEndStartRadius,
            radiusEndEnd: computed.borderEndEndRadius,
          }
        }),
        compactControls: {
          checkbox: (({ width, height, fontSize, borderRadius, borderWidth }) => ({
            width,
            height,
            fontSize,
            borderRadius,
            borderWidth,
          }))(compactControl('checkbox-checked')),
          radio: (({ width, height, fontSize, borderWidth, round }) => ({
            width,
            height,
            fontSize,
            borderWidth,
            round,
          }))(compactControl('radio-checked')),
          sliderTrack: (({ height, round }) => ({ height, round }))(compactControl('slider-track')),
          sliderThumb: (({ width, height, fontSize, borderWidth, round }) => ({
            width,
            height,
            fontSize,
            borderWidth,
            round,
          }))(compactControl('slider-thumb')),
          toggle: (({
            height,
            minWidth,
            fontSize,
            fontFamily,
            fontWeight,
            lineHeight,
            borderRadius,
            borderWidth,
            paddingInline,
          }) => ({
            height,
            minWidth,
            fontSize,
            fontFamily,
            fontWeight,
            lineHeight,
            borderRadius,
            borderWidth,
            paddingInline,
          }))(compactControl('toggle-on')),
          toggleGroup: (({
            height,
            minWidth,
            fontSize,
            fontFamily,
            fontWeight,
            lineHeight,
            borderRadius,
            borderWidth,
            paddingInline,
          }) => ({
            height,
            minWidth,
            fontSize,
            fontFamily,
            fontWeight,
            lineHeight,
            borderRadius,
            borderWidth,
            paddingInline,
          }))(compactControl('toggle-group-on')),
        },
      }
    },
    { pathName: path, direction: dir },
  )

const signature = async (page: Page, selector: string): Promise<Record<string, string>> =>
  page.locator(selector).evaluate((node) => {
    const computed = getComputedStyle(node)
    return {
      color: computed.color,
      backgroundColor: computed.backgroundColor,
      backgroundImage: computed.backgroundImage,
      borderColor: computed.borderColor,
      borderStyle: computed.borderStyle,
      opacity: computed.opacity,
      visibility: computed.visibility,
      textDecoration: computed.textDecorationLine,
      textFill: computed.webkitTextFillColor,
      fontWeight: computed.fontWeight,
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      lineHeight: computed.lineHeight,
      borderWidth: computed.borderWidth,
      backgroundClip: computed.backgroundClip,
      forcedColorAdjust: computed.forcedColorAdjust,
    }
  })

describe('forms-controls baseline/registry parity in real Tailwind + Chromium', () => {
  let browser: Browser
  let registryCss = ''
  let registryMarkup = ''

  beforeAll(async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          width: 24,
          height: 24,
          icons: {
            check: { body: '<path d="m5 12 4 4L19 6"/>' },
            circle: { body: '<circle cx="12" cy="12" r="8" fill="currentColor"/>' },
            minus: { body: '<path d="M5 12h14"/>' },
          },
        }),
      })),
    )
    const fixture = registryFixture()
    registryMarkup = fixture.markup
    const compiled = await compileCandidates(fixture.candidates)
    expect(compiled.dead).toEqual([])
    registryCss = compiled.css
    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => {
    await browser?.close()
    vi.unstubAllGlobals()
  })

  const render = async (
    page: Page,
    path: StylingPath,
    dir: 'ltr' | 'rtl',
    forcedColors = false,
  ): Promise<void> => {
    await page.emulateMedia({ forcedColors: forcedColors ? 'active' : 'none' })
    await page.setContent(`<!doctype html><html><head><style>${
      path === 'baseline' ? baselineCss : registryCss
    }</style></head><body style="font-family:Arial,sans-serif;font-size:16px">
      <div aria-hidden="true" style="position:absolute;inset-inline-start:-10000px">
        <span id="system-highlight" style="forced-color-adjust:none;color:Highlight;background:Highlight;border:1px solid Highlight"></span>
        <span id="system-highlight-text" style="forced-color-adjust:none;color:HighlightText;background:HighlightText;border:1px solid HighlightText"></span>
        <span id="system-gray-text" style="forced-color-adjust:none;color:GrayText;background:GrayText;border:1px solid GrayText"></span>
        <span id="system-button-text" style="forced-color-adjust:none;color:ButtonText;background:ButtonText;border:1px solid ButtonText"></span>
        <span id="system-canvas" style="forced-color-adjust:none;color:Canvas;background:Canvas;border:1px solid Canvas"></span>
        <span id="system-mark" style="forced-color-adjust:none;color:Mark;background:Mark;border:1px solid Mark"></span>
      </div>
      <main dir="${dir}" style="width:20rem">${
        path === 'baseline' ? baselineMarkup : registryMarkup
      }</main></body></html>`)
  }

  it('renders every canonical product on each visually applicable path', () => {
    expect(renderedProductIds(baselineMarkup), 'baseline renderer bindings').toEqual(
      applicableProductIds('baseline'),
    )
    expect(renderedProductIds(registryMarkup), 'registry renderer bindings').toEqual(
      applicableProductIds('registry'),
    )

    for (const product of formProducts) {
      for (const [pathName, path] of Object.entries({
        baseline: product.presentation.baseline,
        registry: product.presentation.registryTailwind,
      })) {
        if (path.mode === 'styled' || path.mode === 'partial') continue
        expect(path.rationale.trim(), `${product.name}.${pathName}`).not.toBe('')
        if (path.mode === 'composed') {
          expect(path.products.length, `${product.name}.${pathName} composition`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('routes every declared media and direction concern through a rendered applicable recipe', () => {
    for (const [path, markup] of [
      ['baseline', baselineMarkup],
      ['registry', registryMarkup],
    ] as const) {
      const rendered = renderedProductIds(markup)
      for (const concern of ['dark', 'high-contrast', 'rtl'] as const) {
        const selected = concernProductIds(path, concern)
        expect(selected.length, `${path}.${concern} has applicable scenarios`).toBeGreaterThan(0)
        expect(
          selected.every((productId) => rendered.includes(productId)),
          `${path}.${concern} renderer coverage`,
        ).toBe(true)
      }
    }
  })

  it.each(['ltr', 'rtl'] as const)(
    'keeps compound registry chrome on logical start/end edges in %s',
    async (dir) => {
      const page = await browser.newPage()
      await render(page, 'registry', dir)
      const result = await page.evaluate(() => {
        const element = (selector: string): HTMLElement =>
          document.querySelector<HTMLElement>(selector)!
        const rect = (selector: string): DOMRect => element(selector).getBoundingClientRect()
        const logical = (selector: string) => {
          const style = getComputedStyle(element(selector))
          return {
            borderInlineStart: style.borderInlineStartWidth,
            borderInlineEnd: style.borderInlineEndWidth,
            radiusStartStart: style.borderStartStartRadius,
            radiusEndStart: style.borderEndStartRadius,
            radiusStartEnd: style.borderStartEndRadius,
            radiusEndEnd: style.borderEndEndRadius,
            marginInlineStart: style.marginInlineStart,
            marginInlineEnd: style.marginInlineEnd,
            paddingInlineStart: style.paddingInlineStart,
            paddingInlineEnd: style.paddingInlineEnd,
          }
        }
        return {
          buttonGroup: {
            firstLeft: rect('#registry-button-group-first').left,
            lastLeft: rect('#registry-button-group-last').left,
            first: logical('#registry-button-group-first'),
            last: logical('#registry-button-group-last'),
          },
          toggleGroup: {
            firstLeft: rect('#registry-toggle-group-fused-first').left,
            lastLeft: rect('#registry-toggle-group-fused-last').left,
            first: logical('#registry-toggle-group-fused-first'),
            middle: logical('#registry-toggle-group-fused-middle'),
            last: logical('#registry-toggle-group-fused-last'),
          },
          inputGroup: {
            startLeft: rect('#registry-input-group-start').left,
            endLeft: rect('#registry-input-group-end').left,
            start: logical('#registry-input-group-start'),
            end: logical('#registry-input-group-end'),
            startControl: logical('#registry-input-group-start-control'),
            endControl: logical('#registry-input-group-end-control'),
          },
          search: {
            iconLeft: rect('#registry-search-icon').left,
            clearLeft: rect('#registry-search-clear').left,
          },
          number: {
            decrementLeft: rect('#registry-number-decrement').left,
            incrementLeft: rect('#registry-number-increment').left,
            decrement: logical('#registry-number-decrement'),
            increment: logical('#registry-number-increment'),
          },
          fieldErrors: logical('#registry-field-error-list'),
        }
      })

      const startComesAfter = dir === 'rtl'
      expect(result.buttonGroup.firstLeft > result.buttonGroup.lastLeft).toBe(startComesAfter)
      expect(result.buttonGroup.first.radiusStartStart).not.toBe('0px')
      expect(result.buttonGroup.first.radiusEndStart).not.toBe('0px')
      expect(result.buttonGroup.first.radiusStartEnd).toBe('0px')
      expect(result.buttonGroup.last.radiusStartStart).toBe('0px')
      expect(result.buttonGroup.last.radiusStartEnd).not.toBe('0px')
      expect(result.buttonGroup.last.radiusEndEnd).not.toBe('0px')
      expect(result.buttonGroup.last.borderInlineStart).toBe('0px')

      expect(result.toggleGroup.firstLeft > result.toggleGroup.lastLeft).toBe(startComesAfter)
      expect(result.toggleGroup.first.radiusStartStart).not.toBe('0px')
      expect(result.toggleGroup.first.radiusStartEnd).toBe('0px')
      expect(result.toggleGroup.middle.borderInlineStart).toBe('0px')
      expect(result.toggleGroup.last.radiusStartStart).toBe('0px')
      expect(result.toggleGroup.last.radiusStartEnd).not.toBe('0px')

      expect(result.inputGroup.startLeft > result.inputGroup.endLeft).toBe(startComesAfter)
      expect(Number.parseFloat(result.inputGroup.start.marginInlineStart)).toBeLessThan(0)
      expect(Number.parseFloat(result.inputGroup.end.marginInlineEnd)).toBeLessThan(0)
      expect(result.inputGroup.startControl.paddingInlineStart).toBe('8px')
      expect(result.inputGroup.endControl.paddingInlineEnd).toBe('8px')

      expect(result.search.iconLeft > result.search.clearLeft).toBe(startComesAfter)
      expect(result.number.decrementLeft > result.number.incrementLeft).toBe(startComesAfter)
      expect(result.number.decrement.radiusStartStart).not.toBe('0px')
      expect(result.number.decrement.radiusStartEnd).toBe('0px')
      expect(result.number.increment.radiusStartStart).toBe('0px')
      expect(result.number.increment.radiusStartEnd).not.toBe('0px')
      expect(result.fieldErrors.marginInlineStart).toBe('16px')
      expect(result.fieldErrors.marginInlineEnd).toBe('0px')

      await page.close()
    },
  )

  it('keeps compact registry controls visually small while their real pointer targets reach 24px', async () => {
    const page = await browser.newPage()
    await render(page, 'registry', 'ltr')

    for (const selector of [
      '#registry-checkbox-checked',
      '#registry-radio-checked',
      '#registry-switch-checked',
    ]) {
      const target = page.locator(selector)
      const measurement = await target.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const hitArea = getComputedStyle(element, '::before')
        element.setAttribute('data-test-clicks', '0')
        element.addEventListener('click', () => {
          element.setAttribute(
            'data-test-clicks',
            String(Number(element.getAttribute('data-test-clicks')) + 1),
          )
        })
        return {
          visualWidth: rect.width,
          visualHeight: rect.height,
          targetWidth: hitArea.width,
          targetHeight: hitArea.height,
          clickX: rect.left + rect.width / 2,
          clickY: rect.bottom + 2,
        }
      })
      expect(Math.min(measurement.visualWidth, measurement.visualHeight)).toBeLessThan(24)
      expect(measurement.targetWidth).toBe('24px')
      expect(measurement.targetHeight).toBe('24px')
      expect(
        await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, {
          x: measurement.clickX,
          y: measurement.clickY,
        }),
        `${selector} hit-test owner`,
      ).toBe(selector.slice(1))
      await page.mouse.click(measurement.clickX, measurement.clickY)
      expect(await target.getAttribute('data-test-clicks'), `${selector} extended hit area`).toBe(
        '1',
      )
    }

    await page.close()
  })

  it('derives high-contrast coverage from canonical scenario IDs with explicit path truth', () => {
    const canonical = Object.entries(FORM_CONTROL_SCENARIOS)
      .filter(([, value]) => value.states.includes('high-contrast'))
      .map(([scenarioId]) => scenarioId)
      .sort()
    expect(Object.keys(HIGH_CONTRAST_COVERAGE).sort()).toEqual(canonical)

    for (const [scenarioId, coverage] of Object.entries(HIGH_CONTRAST_COVERAGE)) {
      for (const path of ['baseline', 'registry'] as const) {
        const decision = coverage[path]
        if (decision.mode === 'not-applicable') {
          expect(decision.rationale.trim(), `${scenarioId}.${path}`).not.toBe('')
          continue
        }
        const markup = path === 'baseline' ? baselineMarkup : registryMarkup
        expect(markup, `${scenarioId}.${path}`).toContain(`data-scenario-id="${scenarioId}"`)
      }
    }
  })

  it.each(['ltr', 'rtl'] as const)(
    'matches canonical field/form/password/switch/PIN geometry in %s',
    async (dir) => {
      const baseline = await browser.newPage()
      const registry = await browser.newPage()
      await render(baseline, 'baseline', dir)
      await render(registry, 'registry', dir)

      const baselineGeometry = await geometry(baseline, 'baseline', dir)
      const registryGeometry = await geometry(registry, 'registry', dir)
      expect.soft(baselineGeometry.fieldGap, 'field gap').toBe(registryGeometry.fieldGap)
      expect
        .soft(baselineGeometry.formFieldGap, 'form-field gap')
        .toBe(registryGeometry.formFieldGap)
      expect.soft(baselineGeometry.password, 'password geometry').toEqual(registryGeometry.password)
      expect
        .soft(baselineGeometry.switch.track, 'switch track')
        .toEqual(registryGeometry.switch.track)
      expect
        .soft(baselineGeometry.switch.thumb, 'switch thumb')
        .toEqual(registryGeometry.switch.thumb)
      expect.soft(baselineGeometry.switch.contained, 'baseline switch contained').toBe(true)
      expect.soft(registryGeometry.switch.contained, 'registry switch contained').toBe(true)
      expect
        .soft(baselineGeometry.switch.inlineEndGap, 'baseline switch checked endpoint')
        .toBeLessThanOrEqual(1.01)
      expect
        .soft(registryGeometry.switch.inlineEndGap, 'registry switch checked endpoint')
        .toBeLessThanOrEqual(1.01)
      expect.soft(baselineGeometry.pinOrder, 'PIN physical order').toBe(registryGeometry.pinOrder)
      expect.soft(baselineGeometry.pin, 'PIN logical borders/radii').toEqual(registryGeometry.pin)
      expect
        .soft(baselineGeometry.compactControls, 'compact control scale')
        .toEqual(registryGeometry.compactControls)

      await baseline.close()
      await registry.close()
    },
  )

  it.each([375, 1280])(
    'matches the actual responsive input typography at a %ipx viewport',
    async (width) => {
      const baseline = await browser.newPage({ viewport: { width, height: 720 } })
      const registry = await browser.newPage({ viewport: { width, height: 720 } })
      await render(baseline, 'baseline', 'ltr')
      await render(registry, 'registry', 'ltr')

      const baselineStyle = await signature(baseline, '#baseline-password-input')
      const registryStyle = await signature(registry, '#registry-password-input')
      expect(baselineStyle.fontFamily).toBe(registryStyle.fontFamily)
      expect(baselineStyle.fontSize).toBe(registryStyle.fontSize)
      expect(baselineStyle.lineHeight).toBe(registryStyle.lineHeight)

      await baseline.close()
      await registry.close()
    },
  )

  it.each(['baseline', 'registry'] as const)(
    'keeps full, half, and empty rating fills distinct in both directions on the %s path',
    async (path) => {
      for (const dir of ['ltr', 'rtl'] as const) {
        const page = await browser.newPage()
        await render(page, path, dir)
        const prefix = path === 'baseline' ? 'baseline' : 'registry'
        const [full, half, empty] = await Promise.all([
          signature(page, `#${prefix}-rating-full`),
          signature(page, `#${prefix}-rating-half`),
          signature(page, `#${prefix}-rating-empty`),
        ])

        expect
          .soft(new Set([full, half, empty].map((state) => JSON.stringify(state))).size, dir)
          .toBe(3)
        expect.soft(half.backgroundImage, `${dir} half fill`).not.toBe('none')
        expect.soft(half.backgroundClip, `${dir} half clip`).toBe('text')
        expect.soft(half.textFill, `${dir} half text`).toBe('rgba(0, 0, 0, 0)')
        expect
          .soft(half.backgroundImage, `${dir} logical fill direction`)
          .toContain(dir === 'ltr' ? 'to right' : 'to left')

        await page.close()
      }
    },
  )

  it.each(['baseline', 'registry'] as const)(
    'preserves every asserted high-contrast distinction in the %s path',
    async (path) => {
      const page = await browser.newPage()
      await render(page, path, 'ltr', true)
      const prefix = path === 'baseline' ? 'baseline' : 'registry'

      const distinct = async (...selectors: string[]): Promise<void> => {
        const states = await Promise.all(selectors.map((selector) => signature(page, selector)))
        expect
          .soft(new Set(states.map((state) => JSON.stringify(state))).size, selectors.join(' ≠ '))
          .toBe(states.length)
      }

      const [highlight, highlightText, grayText, buttonText, canvas, mark] = await Promise.all([
        signature(page, '#system-highlight'),
        signature(page, '#system-highlight-text'),
        signature(page, '#system-gray-text'),
        signature(page, '#system-button-text'),
        signature(page, '#system-canvas'),
        signature(page, '#system-mark'),
      ])

      await distinct(`#${prefix}-checkbox-checked`, `#${prefix}-checkbox-unchecked`)
      await distinct(`#${prefix}-checkbox-indeterminate`, `#${prefix}-checkbox-unchecked`)
      const checkboxChecked = await signature(page, `#${prefix}-checkbox-checked`)
      const checkboxIndeterminate = await signature(page, `#${prefix}-checkbox-indeterminate`)
      const checkboxUnchecked = await signature(page, `#${prefix}-checkbox-unchecked`)
      expect
        .soft(checkboxChecked.backgroundColor, 'checked checkbox')
        .toBe(highlight.backgroundColor)
      expect
        .soft(checkboxIndeterminate.backgroundColor, 'indeterminate checkbox')
        .toBe(highlight.backgroundColor)
      expect
        .soft(checkboxUnchecked.backgroundColor, 'unchecked checkbox')
        .toBe(canvas.backgroundColor)
      if (path === 'baseline') {
        expect(await page.locator('#baseline-checkbox-checked-indicator').textContent()).toBe('✓')
        expect(await page.locator('#baseline-checkbox-indeterminate-indicator').textContent()).toBe(
          '−',
        )
      } else {
        const glyphDisplay = await page.evaluate(() => {
          const display = (selector: string): string =>
            getComputedStyle(document.querySelector<SVGElement>(selector)!).display
          return {
            checkedCheck: display('#registry-checkbox-checked-indicator > svg:first-of-type'),
            checkedMinus: display('#registry-checkbox-checked-indicator > svg:last-of-type'),
            indeterminateCheck: display(
              '#registry-checkbox-indeterminate-indicator > svg:first-of-type',
            ),
            indeterminateMinus: display(
              '#registry-checkbox-indeterminate-indicator > svg:last-of-type',
            ),
          }
        })
        expect.soft(glyphDisplay.checkedCheck).not.toBe('none')
        expect.soft(glyphDisplay.checkedMinus).toBe('none')
        expect.soft(glyphDisplay.indeterminateCheck).toBe('none')
        expect.soft(glyphDisplay.indeterminateMinus).not.toBe('none')
      }
      await distinct(`#${prefix}-radio-checked-indicator`, `#${prefix}-radio-unchecked-indicator`)
      const radioChecked = await signature(page, `#${prefix}-radio-checked`)
      const radioUnchecked = await signature(page, `#${prefix}-radio-unchecked`)
      expect.soft(radioChecked.borderColor, 'checked radio').toBe(highlight.borderColor)
      expect.soft(radioUnchecked.borderColor, 'unchecked radio').toBe(buttonText.borderColor)
      expect.soft(radioUnchecked.backgroundColor, 'unchecked radio').toBe(canvas.backgroundColor)
      await distinct(`#${prefix}-rating-full`, `#${prefix}-rating-half`, `#${prefix}-rating-empty`)
      const half = await signature(page, `#${prefix}-rating-half`)
      const full = await signature(page, `#${prefix}-rating-full`)
      const empty = await signature(page, `#${prefix}-rating-empty`)
      expect.soft(full.color, 'full rating').toBe(highlight.color)
      expect.soft(empty.color, 'empty rating').toBe(grayText.color)
      expect.soft(half.opacity).not.toBe('0')
      expect.soft(half.visibility).toBe('visible')
      expect.soft(half.backgroundImage, 'half rating fill').not.toBe('none')
      expect.soft(half.backgroundImage, 'half rating highlight').toContain(highlight.color)
      expect.soft(half.backgroundImage, 'half rating empty color').toContain(grayText.color)
      expect.soft(half.backgroundClip, 'half rating clip').toBe('text')
      expect.soft(half.textFill, 'half rating text').toBe('rgba(0, 0, 0, 0)')
      await distinct(`#${prefix}-slider-track`, `#${prefix}-slider-range`)
      const sliderTrack = await signature(page, `#${prefix}-slider-track`)
      const sliderRange = await signature(page, `#${prefix}-slider-range`)
      expect.soft(sliderTrack.backgroundColor, 'slider track').toBe(grayText.backgroundColor)
      expect.soft(sliderRange.backgroundColor, 'slider range').toBe(highlight.backgroundColor)
      await distinct(`#${prefix}-switch-checked`, `#${prefix}-switch-unchecked`)
      const switchChecked = await signature(page, `#${prefix}-switch-checked`)
      const switchUnchecked = await signature(page, `#${prefix}-switch-unchecked`)
      expect.soft(switchChecked.backgroundColor, 'checked switch').toBe(highlight.backgroundColor)
      expect.soft(switchUnchecked.backgroundColor, 'unchecked switch').toBe(canvas.backgroundColor)
      await distinct(`#${prefix}-toggle-on`, `#${prefix}-toggle-off`)
      const toggleOn = await signature(page, `#${prefix}-toggle-on`)
      const toggleOff = await signature(page, `#${prefix}-toggle-off`)
      expect.soft(toggleOn.backgroundColor, 'on toggle').toBe(highlight.backgroundColor)
      expect.soft(toggleOff.backgroundColor, 'off toggle').toBe(canvas.backgroundColor)
      await distinct(`#${prefix}-toggle-group-on`, `#${prefix}-toggle-group-off`)
      const toggleGroupOn = await signature(page, `#${prefix}-toggle-group-on`)
      const toggleGroupOff = await signature(page, `#${prefix}-toggle-group-off`)
      expect
        .soft(toggleGroupOn.backgroundColor, 'on toggle-group item')
        .toBe(highlight.backgroundColor)
      expect
        .soft(toggleGroupOff.backgroundColor, 'off toggle-group item')
        .toBe(canvas.backgroundColor)

      expect
        .soft((await signature(page, `#${prefix}-field-control`)).borderColor, 'invalid field')
        .toBe(mark.borderColor)
      expect
        .soft(
          (await signature(page, `#${prefix}-form-field-control`)).borderColor,
          'invalid form-field',
        )
        .toBe(mark.borderColor)

      if (path === 'baseline') {
        await distinct('#baseline-listbox-selected', '#baseline-listbox-default')
        const listboxSelected = await signature(page, '#baseline-listbox-selected')
        expect
          .soft(listboxSelected.backgroundColor, 'selected listbox item')
          .toBe(highlight.backgroundColor)
        expect.soft(listboxSelected.color, 'selected listbox item text').toBe(highlightText.color)
      } else {
        await distinct('#registry-theme-on', '#registry-theme-off')
        const themeOn = await signature(page, '#registry-theme-on')
        const themeOff = await signature(page, '#registry-theme-off')
        expect.soft(themeOn.backgroundColor, 'on theme option').toBe(highlight.backgroundColor)
        expect.soft(themeOff.backgroundColor, 'off theme option').toBe(canvas.backgroundColor)
        const button = await signature(page, '#registry-button')
        expect.soft(button.borderStyle).not.toBe('none')
        expect.soft(button.borderWidth).not.toBe('0px')
        expect.soft(button.borderColor).toBe(buttonText.borderColor)
        expect.soft(button.backgroundColor).toBe(canvas.backgroundColor)
        const control = await page.locator('#registry-angle-control').boundingBox()
        const thumb = await page.locator('#registry-angle-thumb').boundingBox()
        expect.soft(control?.width).toBeGreaterThan(thumb?.width ?? Infinity)
        expect.soft(control?.height).toBeGreaterThan(thumb?.height ?? Infinity)
        expect
          .soft((await signature(page, '#registry-angle-control')).borderColor, 'angle control')
          .toBe(buttonText.borderColor)
        expect
          .soft((await signature(page, '#registry-angle-thumb')).borderColor, 'angle thumb')
          .toBe(highlight.borderColor)
      }

      await page.close()
    },
  )
})
