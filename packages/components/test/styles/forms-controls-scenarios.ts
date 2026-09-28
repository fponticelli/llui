/**
 * The forms-controls family's presentation-scenario catalog (#267), in the
 * protocol shape the other three families already use (#270): semantic
 * cases keyed by the ProductContract `scenarioId`, compiled against the
 * contract by `compileScenarioFamily`, which rejects a missing or stale key.
 *
 * It is DERIVED, not written a second time. `FORM_CONTROL_SCENARIOS`
 * (`fixtures/form-control-scenarios.ts`, #263) already declares, per product,
 * the states the family owns and a deterministic sample. Restating those as
 * case literals here would be a second inventory that drifts; instead the
 * projection below reads that table and classifies each state once:
 *
 *  - a DETERMINISTIC RENDER STATE becomes a case (`FORMS_CONTROLS_CASE_STATES`):
 *    it is a value the machine or markup can be put in and held — checked,
 *    disabled, invalid, loading …;
 *  - an ENVIRONMENT concern becomes an axis every case of that product
 *    declares: `dark` → `theme`, `rtl` → `direction`, `high-contrast` →
 *    `forcedColors`;
 *  - an INTERACTION pseudo-state (`hover`, `active`, `focus`) is neither: it
 *    is the browser's `:hover`/`:active`/`:focus-visible`, which no
 *    deterministic mount can hold, and it is what a person does TO the
 *    rendered case. The browser suites drive those with real input.
 *
 * `forms-controls-scenarios.test.ts` asserts the classification is total (no
 * state falls through) and that every declared state lands in exactly one
 * bucket.
 */
import {
  compileScenarioFamily,
  type CompiledPresentationScenarioFamily,
  type PresentationScenarioDefinition,
  type PresentationScenarioEnvironmentAxis,
} from '@llui/cli/presentation-scenarios'
import type { ProductContract } from '@llui/cli'
import {
  FORM_CONTROL_SCENARIOS,
  type FormControlScenario,
  type FormControlStateId,
} from './fixtures/form-control-scenarios'

/** States that become cases, in the order a gallery lists them. */
export const FORMS_CONTROLS_CASE_STATES = [
  'default',
  'checked',
  'selected',
  'indeterminate',
  'disabled',
  'read-only',
  'invalid',
  'required',
  'placeholder',
  'loading',
] as const satisfies readonly FormControlStateId[]

export type FormsControlsCaseState = (typeof FORMS_CONTROLS_CASE_STATES)[number]

/** States that widen every case's environment instead of becoming one. */
export const FORMS_CONTROLS_ENVIRONMENT_STATES = {
  dark: 'theme',
  rtl: 'direction',
  'high-contrast': 'forcedColors',
} as const satisfies Partial<Record<FormControlStateId, PresentationScenarioEnvironmentAxis>>

/** Pointer/focus pseudo-states: real input on a rendered case, never a case. */
export const FORMS_CONTROLS_INTERACTION_STATES = [
  'hover',
  'active',
  'focus',
] as const satisfies readonly FormControlStateId[]

const CASE_LABELS: Readonly<Record<FormsControlsCaseState, string>> = {
  default: 'Default',
  checked: 'Checked',
  selected: 'Selected',
  indeterminate: 'Indeterminate',
  disabled: 'Disabled',
  'read-only': 'Read-only',
  invalid: 'Invalid',
  required: 'Required',
  placeholder: 'Placeholder',
  loading: 'Loading',
}

type SampleValue = string | number | boolean | readonly string[]

/** The one input shape every forms-controls case carries. */
export interface FormsControlsCaseInput {
  readonly state: FormsControlsCaseState
  readonly sample: Readonly<Record<string, SampleValue>>
}

function isCaseState(state: string): state is FormsControlsCaseState {
  return FORMS_CONTROLS_CASE_STATES.some((candidate) => candidate === state)
}

function isSampleValue(value: unknown): value is SampleValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true
  }
  if (!Array.isArray(value)) return false
  const items: readonly unknown[] = value
  return items.every((item) => typeof item === 'string')
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Decode a resolved case's JSON `input` into the typed shape adapters read.
 * The protocol hands renderers `PresentationScenarioJson`; this is the one
 * place that narrows it, by checking rather than casting.
 */
export function formsControlsCaseInput(json: unknown): FormsControlsCaseInput {
  if (!isRecord(json)) throw new TypeError('forms-controls case input must be an object')
  const { state, sample } = json
  if (typeof state !== 'string' || !isCaseState(state)) {
    throw new TypeError(`forms-controls case input has an unknown state ${JSON.stringify(state)}`)
  }
  if (!isRecord(sample)) throw new TypeError('forms-controls case sample must be an object')
  const decoded: Record<string, SampleValue> = {}
  for (const [key, value] of Object.entries(sample)) {
    if (!isSampleValue(value)) {
      throw new TypeError(
        `forms-controls sample field ${JSON.stringify(key)} is not a sample value`,
      )
    }
    decoded[key] = value
  }
  return { state, sample: decoded }
}

function environmentAxesFor(
  states: readonly FormControlStateId[],
): PresentationScenarioEnvironmentAxis[] {
  const axes: PresentationScenarioEnvironmentAxis[] = []
  for (const [state, axis] of Object.entries(FORMS_CONTROLS_ENVIRONMENT_STATES)) {
    if (states.some((declared) => declared === state)) axes.push(axis)
  }
  return axes
}

function definitionFor(scenario: FormControlScenario): PresentationScenarioDefinition<{
  id: string
  label: string
  input: { state: FormsControlsCaseState; sample: Record<string, SampleValue> }
  environmentAxes: PresentationScenarioEnvironmentAxis[]
}> {
  const axes = environmentAxesFor(scenario.states)
  const cases = FORMS_CONTROLS_CASE_STATES.filter((state) =>
    scenario.states.some((declared) => declared === state && isCaseState(declared)),
  ).map((state) => ({
    id: state,
    label: CASE_LABELS[state],
    input: { state, sample: { ...scenario.sample } },
    environmentAxes: [...axes],
  }))
  return { defaultCaseId: 'default', cases }
}

/** Protocol definitions, keyed by ProductContract `scenarioId`. */
export const FORMS_CONTROLS_DEFINITIONS: Readonly<
  Record<string, ReturnType<typeof definitionFor>>
> = Object.fromEntries(
  Object.entries(FORM_CONTROL_SCENARIOS).map(([scenarioId, scenario]) => [
    scenarioId,
    definitionFor(scenario),
  ]),
)

export type FormsControlsScenarioId = keyof typeof FORM_CONTROL_SCENARIOS & string
export type FormsControlsCatalog = CompiledPresentationScenarioFamily

/** Compile against a real ProductContract; throws on any key disagreement. */
export function compileFormsControlsCatalog(contract: ProductContract): FormsControlsCatalog {
  return compileScenarioFamily(contract, 'forms-controls', FORMS_CONTROLS_DEFINITIONS)
}

function isVisuallyApplicable(mode: string): boolean {
  return mode === 'styled' || mode === 'partial' || mode === 'composed'
}

/** Scenario ids a renderer path must be able to draw. */
export function applicableFormsControlsScenarioIds(
  contract: ProductContract,
  path: 'baseline' | 'registryTailwind',
): string[] {
  return contract.entries
    .filter(
      ({ presentation }) =>
        presentation.family === 'forms-controls' && isVisuallyApplicable(presentation[path].mode),
    )
    .map(({ scenarioId }) => scenarioId)
    .sort()
}
