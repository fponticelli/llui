import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PACKAGE = resolve(import.meta.dirname, '../..')
const REPO = resolve(PACKAGE, '../..')
const STYLES = resolve(PACKAGE, 'src/styles')

type PresentationPath =
  | { mode: 'styled' }
  | { mode: 'partial' | 'styleless' | 'not-applicable'; rationale: string }
  | { mode: 'composed'; products: readonly string[]; rationale: string }

type ProductEntry = {
  name: string
  scenarioId: string
  styling: { baseline: boolean; registryTailwind: boolean; styleless: boolean }
  presentation: {
    family: string
    baseline: PresentationPath
    registryTailwind: PresentationPath
  }
}

const registry = JSON.parse(readFileSync(resolve(REPO, 'registry/registry.json'), 'utf8')) as {
  productContract: { entries: ProductEntry[] }
}

const formProducts = registry.productContract.entries.filter(
  ({ presentation }) => presentation.family === 'forms-controls',
)
const formProductNames = formProducts.map(({ name }) => name).sort()
const formScenarioIds = formProducts.map(({ scenarioId }) => scenarioId).sort()

describe('the forms-controls presentation contract', () => {
  it('tells the truth about the baseline form composition selectors this family owns', () => {
    for (const name of ['field', 'fieldset', 'form', 'form-field']) {
      const product = formProducts.find((entry) => entry.name === name)
      expect(product, name).toBeDefined()
      expect(product?.styling.baseline, `${name} baseline styling flag`).toBe(true)
      expect(product?.presentation.baseline, `${name} baseline presentation`).toEqual({
        mode: 'styled',
      })
    }
  })

  it('keeps angle-slider partial at its artifact-backed ownership boundary', () => {
    const product = formProducts.find(({ name }) => name === 'angle-slider')
    expect(product?.presentation.baseline.mode).toBe('partial')
    expect(product?.presentation.registryTailwind.mode).toBe('partial')

    const baseline = readFileSync(resolve(STYLES, 'form-controls.css'), 'utf8')
    const controlRule = baseline.match(
      /\[data-scope='angle-slider'\]\[data-part='control'\]\s*\{([^}]*)\}/s,
    )?.[1]
    expect(controlRule).toMatch(/user-select:\s*none/)
    expect(controlRule).toMatch(/touch-action:\s*none/)
    expect(controlRule).not.toMatch(
      /(?:^|;)\s*(?:width|height|position|inset|transform|border|background|box-shadow)\s*:/,
    )

    const registryRecipe = readFileSync(resolve(REPO, 'registry/llui/ui/angle-slider.ts'), 'utf8')
    expect(registryRecipe).toMatch(/thumb is positioned by the consumer from[\s\S]*`data-value`/)
    expect(registryRecipe).toContain('size-24 rounded-full border border-input')
    expect(registryRecipe).toContain('absolute size-3 rounded-full border border-primary')
  })

  it('owns every listbox selector in form-controls.css and no other family module', () => {
    const owners = readdirSync(STYLES)
      .filter((file) => file.endsWith('.css'))
      .filter((file) =>
        readFileSync(resolve(STYLES, file), 'utf8').includes("[data-scope='listbox']"),
      )
      .sort()

    expect(owners).toEqual(['form-controls.css'])
  })

  it('projects the canonical family into deterministic renderer-neutral scenarios', async () => {
    const { FORM_CONTROL_SCENARIOS, FORM_CONTROL_STATE_IDS } =
      await import('./fixtures/form-control-scenarios.js')

    expect(Object.keys(FORM_CONTROL_SCENARIOS).sort()).toEqual(formScenarioIds)
    expect(formProductNames).toHaveLength(25)

    const coveredStates = new Set<string>()
    const projectedProductNames: string[] = []
    for (const [scenarioId, scenario] of Object.entries(FORM_CONTROL_SCENARIOS)) {
      projectedProductNames.push(scenario.productId)
      const product = formProducts.find(({ name }) => name === scenario.productId)
      expect(scenario.baseline, `${scenarioId} baseline path`).toBe(
        product?.presentation.baseline.mode,
      )
      expect(scenario.registryTailwind, `${scenarioId} registry path`).toBe(
        product?.presentation.registryTailwind.mode,
      )
      expect(scenario.states, `${scenarioId} states`).toContain('default')
      expect(new Set(scenario.states).size, `${scenarioId} unique states`).toBe(
        scenario.states.length,
      )
      expect(Object.keys(scenario.sample).length, `${scenarioId} sample`).toBeGreaterThan(0)
      expect(JSON.stringify(scenario.sample), `${scenarioId} deterministic sample`).not.toMatch(
        /(?:date|now|random|uuid|https?:)/i,
      )
      for (const state of scenario.states) coveredStates.add(state)
    }

    expect(projectedProductNames.sort()).toEqual(formProductNames)
    expect([...coveredStates].sort()).toEqual([...FORM_CONTROL_STATE_IDS].sort())
    expect(FORM_CONTROL_STATE_IDS).toEqual([
      'default',
      'hover',
      'active',
      'focus',
      'checked',
      'selected',
      'indeterminate',
      'disabled',
      'read-only',
      'invalid',
      'required',
      'placeholder',
      'loading',
      'high-contrast',
      'dark',
      'rtl',
    ])
  })

  it('declares RTL wherever a family-owned compound control has directional chrome', async () => {
    const { FORM_CONTROL_SCENARIOS } = await import('./fixtures/form-control-scenarios.js')
    const byProduct: Map<string, { states: readonly string[] }> = new Map(
      Object.values(FORM_CONTROL_SCENARIOS).map((scenario) => [scenario.productId, scenario]),
    )

    for (const productId of [
      'button-group',
      'field',
      'input-group',
      'number-input',
      'password-input',
      'pin-input',
      'search-field',
      'toggle-group',
    ]) {
      expect(byProduct.get(productId)?.states, productId).toContain('rtl')
    }
  })

  it('keeps every non-styled path explicit rather than silently omitting a product', () => {
    for (const product of formProducts) {
      for (const [pathName, path] of Object.entries({
        baseline: product.presentation.baseline,
        registryTailwind: product.presentation.registryTailwind,
      })) {
        if (path.mode === 'styled') continue
        expect(path.rationale.trim(), `${product.name}.${pathName} rationale`).not.toBe('')
      }
    }
  })
})
