import { afterEach, describe, expect, it } from 'vitest'
import { loadProductContract } from '../../packages/components/test/styles/navigation-data-contract-source'
import {
  applicableFormsControlsScenarioIds,
  compileFormsControlsCatalog,
} from '../../packages/components/test/styles/forms-controls-scenarios'
import {
  REGISTRY_ADAPTERS,
  mountRegistryFormsControlsScenarios,
  type Disposable,
} from './forms-controls-scenario-renderer'
import { installFrozenIconify } from './specialized-tools-frozen-icons'

const contract = loadProductContract()
const catalog = compileFormsControlsCatalog(contract)

let handle: Disposable | undefined
let restoreIcons: (() => void) | undefined
afterEach(() => {
  handle?.dispose()
  restoreIcons?.()
  handle = undefined
  restoreIcons = undefined
  document.body.replaceChildren()
})

function mountAll(): HTMLElement {
  restoreIcons = installFrozenIconify()
  const container = document.createElement('main')
  document.body.append(container)
  handle = mountRegistryFormsControlsScenarios(container, contract, catalog)
  return container
}

const at = (container: HTMLElement, product: string, caseId: string): HTMLElement => {
  const host = container.querySelector<HTMLElement>(
    `[data-scenario-product="${product}"][data-scenario-case="${caseId}"]`,
  )
  if (host === null) throw new Error(`no host for ${product}/${caseId}`)
  return host
}

describe('forms-controls registry renderer (#267)', () => {
  it('binds exactly the contract products with a visual registry presentation', () => {
    expect(Object.keys(REGISTRY_ADAPTERS).sort()).toEqual(
      applicableFormsControlsScenarioIds(contract, 'registryTailwind'),
    )
  })

  it('mounts every case of every bound product through a copied skin', () => {
    const container = mountAll()
    for (const scenario of catalog.scenarios) {
      if (REGISTRY_ADAPTERS[scenario.scenarioId] === undefined) continue
      for (const scenarioCase of scenario.cases) {
        const host = at(container, scenario.productId, scenarioCase.id)
        // Every copied skin carries a Tailwind recipe; a case that rendered
        // nothing, or rendered bare machine markup, has no class at all.
        expect(
          host.querySelector('[class]'),
          `${scenario.productId}/${scenarioCase.id} renders a skinned element`,
        ).not.toBeNull()
      }
    }
  })

  it('realises each state through the machine or standard attributes', () => {
    const container = mountAll()
    const q = (product: string, caseId: string, selector: string) =>
      at(container, product, caseId).querySelector<HTMLElement>(selector)

    expect(q('checkbox', 'checked', '[role="checkbox"]')?.getAttribute('data-state')).toBe(
      'checked',
    )
    expect(q('checkbox', 'invalid', '[role="checkbox"]')?.getAttribute('aria-invalid')).toBe('true')
    expect(q('switch', 'checked', '[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
    expect((q('input', 'disabled', 'input') as HTMLInputElement).disabled).toBe(true)
    expect((q('input', 'read-only', 'input') as HTMLInputElement).readOnly).toBe(true)
    expect(q('input', 'invalid', 'input')?.getAttribute('aria-invalid')).toBe('true')
    expect((q('textarea', 'placeholder', 'textarea') as HTMLTextAreaElement).value).toBe('')
    expect(q('button', 'loading', 'button')?.getAttribute('aria-busy')).toBe('true')
    expect((q('button', 'loading', 'button') as HTMLButtonElement).disabled).toBe(true)
    expect(q('form-field', 'invalid', '[role="alert"]')?.textContent).toBe('Username is required')
    expect(q('theme-switch', 'selected', '[aria-pressed="true"]')?.textContent).toBe('D')
  })
})
