import { describe, expect, it } from 'vitest'
import { loadProductContract } from './navigation-data-contract-source'
import { FORM_CONTROL_SCENARIOS, FORM_CONTROL_STATE_IDS } from './fixtures/form-control-scenarios'
import {
  FORMS_CONTROLS_CASE_STATES,
  FORMS_CONTROLS_DEFINITIONS,
  FORMS_CONTROLS_ENVIRONMENT_STATES,
  FORMS_CONTROLS_INTERACTION_STATES,
  applicableFormsControlsScenarioIds,
  compileFormsControlsCatalog,
} from './forms-controls-scenarios'

const contract = loadProductContract()

describe('forms-controls presentation scenarios (#267)', () => {
  it('classifies every declared family state into exactly one bucket', () => {
    const buckets = [
      ...FORMS_CONTROLS_CASE_STATES,
      ...Object.keys(FORMS_CONTROLS_ENVIRONMENT_STATES),
      ...FORMS_CONTROLS_INTERACTION_STATES,
    ]
    expect([...buckets].sort()).toEqual([...FORM_CONTROL_STATE_IDS].sort())
    expect(new Set(buckets).size).toBe(buckets.length)
  })

  it('compiles against the contract with exactly the family scenario ids', () => {
    const catalog = compileFormsControlsCatalog(contract)
    const familyIds = contract.entries
      .filter(({ presentation }) => presentation.family === 'forms-controls')
      .map(({ scenarioId }) => scenarioId)
      .sort()
    expect(catalog.family).toBe('forms-controls')
    expect(catalog.scenarios.map(({ scenarioId }) => scenarioId).sort()).toEqual(familyIds)
  })

  it('derives cases and axes from the family table, not a second list', () => {
    for (const [scenarioId, scenario] of Object.entries(FORM_CONTROL_SCENARIOS)) {
      const definition = FORMS_CONTROLS_DEFINITIONS[scenarioId]!
      const states = scenario.states as readonly string[]
      expect(definition.defaultCaseId, scenarioId).toBe('default')
      expect(
        definition.cases.map(({ id }) => id),
        scenarioId,
      ).toEqual(FORMS_CONTROLS_CASE_STATES.filter((state) => states.includes(state)))
      const axes = Object.entries(FORMS_CONTROLS_ENVIRONMENT_STATES)
        .filter(([state]) => states.includes(state))
        .map(([, axis]) => axis)
      for (const scenarioCase of definition.cases) {
        expect(scenarioCase.environmentAxes, `${scenarioId}/${scenarioCase.id}`).toEqual(axes)
        expect(scenarioCase.input.state).toBe(scenarioCase.id)
        expect(scenarioCase.input.sample).toEqual(scenario.sample)
      }
    }
  })

  it('names the applicable ids per path from presentation coverage', () => {
    expect(applicableFormsControlsScenarioIds(contract, 'baseline')).toEqual([
      'component:angle-slider',
      'component:checkbox',
      'component:field',
      'component:fieldset',
      'component:form',
      'component:listbox',
      'component:number-input',
      'component:password-input',
      'component:pin-input',
      'component:radio-group',
      'component:rating-group',
      'component:slider',
      'component:switch',
      'component:tags-input',
      'component:toggle',
      'component:toggle-group',
      'pattern:form-field',
    ])
    expect(applicableFormsControlsScenarioIds(contract, 'registryTailwind')).toEqual([
      'component:angle-slider',
      'component:checkbox',
      'component:field',
      'component:form',
      'component:number-input',
      'component:password-input',
      'component:pin-input',
      'component:radio-group',
      'component:rating-group',
      'component:search-field',
      'component:slider',
      'component:switch',
      'component:tags-input',
      'component:theme-switch',
      'component:toggle',
      'component:toggle-group',
      'pattern:form-field',
      'registry:button',
      'registry:button-group',
      'registry:input',
      'registry:input-group',
      'registry:label',
      'registry:textarea',
    ])
  })
})
