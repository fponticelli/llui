import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { lintSignalSource, parseModule } from '@llui/compiler'
import { loadProductContract } from './navigation-data-contract-source'
import {
  applicableFormsControlsScenarioIds,
  compileFormsControlsCatalog,
  formsControlsCaseInput,
} from './forms-controls-scenarios'
import {
  BASELINE_ADAPTERS,
  mountBaselineFormsControlsScenarios,
  type Disposable,
} from './forms-controls-baseline-renderer'

const contract = loadProductContract()
const catalog = compileFormsControlsCatalog(contract)

let handle: Disposable | undefined
afterEach(() => {
  handle?.dispose()
  handle = undefined
  document.body.replaceChildren()
})

function mountAll(): HTMLElement {
  const container = document.createElement('main')
  document.body.append(container)
  handle = mountBaselineFormsControlsScenarios(container, contract, catalog)
  return container
}

const at = (container: HTMLElement, product: string, caseId: string): HTMLElement => {
  const host = container.querySelector<HTMLElement>(
    `[data-scenario-product="${product}"][data-scenario-case="${caseId}"]`,
  )
  if (host === null) throw new Error(`no host for ${product}/${caseId}`)
  return host
}

describe('forms-controls baseline renderer (#267)', () => {
  it('binds exactly the contract products with a visual baseline presentation', () => {
    expect(Object.keys(BASELINE_ADAPTERS).sort()).toEqual(
      applicableFormsControlsScenarioIds(contract, 'baseline'),
    )
  })

  it('mounts every case of every bound product, each with baseline-scoped markup', () => {
    const container = mountAll()
    for (const scenario of catalog.scenarios) {
      if (BASELINE_ADAPTERS[scenario.scenarioId] === undefined) continue
      for (const scenarioCase of scenario.cases) {
        const host = at(container, scenario.productId, scenarioCase.id)
        expect(
          host.querySelector('[data-scope]'),
          `${scenario.productId}/${scenarioCase.id} renders machine parts`,
        ).not.toBeNull()
      }
    }
  })

  it('realises each state through the machine or the ARIA the stylesheet keys on', () => {
    const container = mountAll()
    const root = (product: string, caseId: string, scope: string, part = 'root') =>
      at(container, product, caseId).querySelector<HTMLElement>(
        `[data-scope="${scope}"][data-part="${part}"]`,
      )

    expect(root('checkbox', 'default', 'checkbox')?.getAttribute('data-state')).toBe('unchecked')
    expect(root('checkbox', 'checked', 'checkbox')?.getAttribute('data-state')).toBe('checked')
    expect(root('checkbox', 'indeterminate', 'checkbox')?.getAttribute('data-state')).toBe(
      'indeterminate',
    )
    expect(root('checkbox', 'invalid', 'checkbox')?.getAttribute('aria-invalid')).toBe('true')
    expect(root('checkbox', 'required', 'checkbox')?.getAttribute('aria-required')).toBe('true')
    expect(root('checkbox', 'disabled', 'checkbox')?.getAttribute('aria-disabled')).toBe('true')

    expect(root('switch', 'checked', 'switch')?.getAttribute('aria-checked')).toBe('true')
    expect(root('toggle', 'checked', 'toggle')?.getAttribute('aria-pressed')).toBe('true')

    const fieldControl = root('field', 'invalid', 'field', 'control')
    expect(fieldControl?.getAttribute('aria-invalid')).toBe('true')
    const fieldInput = (caseId: string): HTMLInputElement => {
      const node = root('field', caseId, 'field', 'control')
      if (!(node instanceof HTMLInputElement)) {
        throw new Error(`field/${caseId}: the control part is not an <input>`)
      }
      return node
    }
    expect(fieldInput('disabled').disabled).toBe(true)
    expect(fieldInput('read-only').readOnly).toBe(true)
    expect(fieldInput('placeholder').value).toBe('')

    expect(
      at(container, 'form-field', 'invalid').querySelector('[role="alert"]')?.textContent,
    ).toBe('Username is required')
    expect(
      at(container, 'listbox', 'selected').querySelector('[data-state="selected"]')?.textContent,
    ).toBe('Design')
  })

  it('applies the resolved environment to the case host', () => {
    const container = document.createElement('main')
    document.body.append(container)
    const host = document.createElement('section')
    container.append(host)
    const scenario = catalog.scenarios.find(({ productId }) => productId === 'slider')!
    const scenarioCase = scenario.cases.find(({ id }) => id === 'default')!
    handle = BASELINE_ADAPTERS['component:slider']!(
      host,
      formsControlsCaseInput(scenarioCase.input),
      {
        scenarioId: scenario.scenarioId,
        caseId: 'default',
        environment: {
          theme: 'dark',
          direction: 'rtl',
          motion: 'full',
          viewport: 'narrow',
          forcedColors: 'active',
        },
      },
    )
    expect(host.getAttribute('dir')).toBe('rtl')
    expect(host.dataset.theme).toBe('dark')
    expect(host.dataset.viewport).toBe('narrow')
    expect(host.dataset.forcedColors).toBe('active')
  })

  it('rejects a case input that is not the forms-controls shape', () => {
    expect(() => formsControlsCaseInput({ state: 'hover', sample: {} })).toThrow(/unknown state/)
    expect(() => formsControlsCaseInput({ state: 'default', sample: { x: {} } })).toThrow(
      /not a sample value/,
    )
  })
})

describe('forms-controls renderers compile under the framework lint rules (#267)', () => {
  const repoRoot = resolve(import.meta.dirname, '../../../..')
  it.each([
    'packages/components/test/styles/forms-controls-baseline-renderer.ts',
    'registry/test/forms-controls-scenario-renderer.ts',
  ])('%s reports no signal lint diagnostics', (file) => {
    const parsed = parseModule(file, readFileSync(resolve(repoRoot, file), 'utf8'))
    const messages = lintSignalSource(parsed).map(
      (message) => `${message.rule} ${message.line}:${message.column} ${message.message}`,
    )
    expect(messages).toEqual([])
  })
})
