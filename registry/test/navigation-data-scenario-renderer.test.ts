import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  applicableNavigationDataScenarios,
  projectNavigationDataScenarios,
  type NavigationDataContractEntry,
} from '../../packages/components/test/styles/navigation-data-scenarios'
import { mountRegistryNavigationDataScenarios } from './navigation-data-scenario-renderer'

const contract = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../registry.json'), 'utf8'),
) as {
  productContract: { entries: NavigationDataContractEntry[] }
}
const scenarios = applicableNavigationDataScenarios(
  projectNavigationDataScenarios(contract.productContract.entries),
  'registryTailwind',
)
const entryByProduct = new Map(contract.productContract.entries.map((entry) => [entry.name, entry]))

function publicParts(productId: string): string[] {
  const files =
    productId === 'data-table'
      ? [
          '../../packages/components/src/patterns/data-table.ts',
          '../../packages/components/src/components/table.ts',
          '../../packages/components/src/components/pagination.ts',
        ]
      : [`../../packages/components/src/components/${productId}.ts`]
  return [
    ...new Set(
      files.flatMap((file) =>
        [
          ...readFileSync(resolve(import.meta.dirname, file), 'utf8').matchAll(
            /['"]data-part['"]:\s*['"]([^'"]+)['"]/g,
          ),
        ].map(([, part]) => part!),
      ),
    ),
  ].sort()
}
let app: { dispose(): void } | undefined

function render(candidate = scenarios): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  app = mountRegistryNavigationDataScenarios(host, candidate)
  return host
}

afterEach(() => {
  app?.dispose()
  app = undefined
  document.body.replaceChildren()
})

describe('registry navigation/data scenario renderer', () => {
  it('renders every applicable semantic case with canonical markers', () => {
    const host = render()
    const markers = [
      ...host.querySelectorAll<HTMLElement>('[data-scenario-id][data-scenario-case]'),
    ]
      .map((node) => `${node.dataset.scenarioId}:${node.dataset.scenarioCase}`)
      .sort()
    const expected = scenarios
      .flatMap((scenario) =>
        scenario.cases.map((scenarioCase) => `${scenario.scenarioId}:${scenarioCase.id}`),
      )
      .sort()

    expect(markers).toEqual(expected)
  })

  it('routes every public machine part through each product default skin composition', () => {
    const host = render()
    for (const scenario of scenarios) {
      if (entryByProduct.get(scenario.productId)?.machine.kind !== 'public') continue
      const root = host.querySelector<HTMLElement>(
        `[data-scenario-id="${scenario.scenarioId}"][data-scenario-case="${scenario.defaultCaseId}"]`,
      )!
      const rendered = [
        ...new Set(
          [...root.querySelectorAll<HTMLElement>('[data-part]')].map((node) => node.dataset.part!),
        ),
      ]
      expect(rendered, scenario.productId).toEqual(
        expect.arrayContaining(publicParts(scenario.productId)),
      )
    }
  })

  it('a behavior-sensitive dimension mutation changes the connected machine output', () => {
    const host = render(
      scenarios.map((scenario) =>
        scenario.productId === 'carousel'
          ? {
              ...scenario,
              cases: scenario.cases.map((scenarioCase) =>
                scenarioCase.id === 'active'
                  ? {
                      ...scenarioCase,
                      input: { ...scenarioCase.input, index: 2 },
                    }
                  : scenarioCase,
              ),
            }
          : scenario,
      ),
    )
    const active = host.querySelector<HTMLElement>(
      '[data-scenario-id="component:carousel"][data-scenario-case="active"] [data-part="indicator"][aria-selected="true"]',
    )!

    expect(active.dataset.index).toBe('2')
    const next = host.querySelector<HTMLButtonElement>(
      '[data-scenario-id="component:carousel"][data-scenario-case="active"] [data-part="next-trigger"]',
    )!
    next.click()
    expect(
      host.querySelector<HTMLElement>(
        '[data-scenario-id="component:carousel"][data-scenario-case="active"] [data-part="indicator"][aria-selected="true"]',
      )?.dataset.index,
    ).toBe('0')
  })

  it('consumes every applicable compact-density case on the live skinned root', () => {
    const host = render()
    const compact = [...host.querySelectorAll<HTMLElement>('[data-scenario-case="compact"]')]
    expect(compact.map((node) => node.dataset.scenarioId).sort()).toEqual([
      'component:avatar',
      'component:table',
      'pattern:data-table',
      'registry:item',
      'registry:sidebar',
    ])
    for (const scenarioRoot of compact) {
      expect(
        scenarioRoot.querySelector<HTMLElement>('[data-density="compact"]'),
        scenarioRoot.dataset.scenarioId,
      ).not.toBeNull()
    }
  })

  it('fails closed when renderer bindings drift from ProductContract applicability', () => {
    expect(() => mountRegistryNavigationDataScenarios(document.body, scenarios.slice(1))).toThrow(
      /bindings do not match applicable ProductContract products/i,
    )
  })
})
