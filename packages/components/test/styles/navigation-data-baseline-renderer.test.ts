import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  applicableNavigationDataScenarios,
  projectNavigationDataScenarios,
  type NavigationDataContractEntry,
} from './navigation-data-scenarios'
import {
  mutateScenarioInput,
  mountBaselineNavigationDataScenarios,
} from './navigation-data-baseline-renderer'

const contract = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../../../registry/registry.json'), 'utf8'),
) as { productContract: { entries: NavigationDataContractEntry[] } }
const scenarios = applicableNavigationDataScenarios(
  projectNavigationDataScenarios(contract.productContract.entries),
  'baseline',
)
const entryByProduct = new Map(contract.productContract.entries.map((entry) => [entry.name, entry]))

function publicParts(productId: string): string[] {
  const files =
    productId === 'data-table'
      ? [
          '../../src/patterns/data-table.ts',
          '../../src/components/table.ts',
          '../../src/components/pagination.ts',
        ]
      : [`../../src/components/${productId}.ts`]
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

describe('baseline navigation/data scenario renderer', () => {
  let mounted: { dispose(): void } | undefined

  const render = (candidate = scenarios): HTMLElement => {
    const host = document.createElement('div')
    document.body.append(host)
    mounted = mountBaselineNavigationDataScenarios(host, candidate)
    return host
  }

  afterEach(() => {
    mounted?.dispose()
    mounted = undefined
    document.body.replaceChildren()
  })

  it('renders every applicable semantic case with its canonical markers', () => {
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

  it('routes every public machine part through each product default composition', () => {
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
    const carousel = scenarios.find(({ productId }) => productId === 'carousel')!
    const originalHost = render()
    const originalSelected = originalHost.querySelector<HTMLElement>(
      '[data-scenario-case="active"] [data-part="indicator"][aria-selected="true"]',
    )
    expect(originalSelected?.dataset.index).toBe('1')
    mounted?.dispose()
    originalHost.remove()

    const mutatedHost = render(
      scenarios.map((scenario) =>
        scenario.productId === 'carousel'
          ? mutateScenarioInput(carousel, 'active', 'index', 2)
          : scenario,
      ),
    )
    const mutatedSelected = mutatedHost.querySelector<HTMLElement>(
      '[data-scenario-id="component:carousel"][data-scenario-case="active"] [data-part="indicator"][aria-selected="true"]',
    )
    expect(mutatedSelected?.dataset.index).toBe('2')

    const next = mutatedHost.querySelector<HTMLButtonElement>(
      '[data-scenario-case="active"] [data-part="next-trigger"]',
    )!
    next.click()
    expect(
      mutatedHost.querySelector<HTMLElement>(
        '[data-scenario-case="active"] [data-part="indicator"][aria-selected="true"]',
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
    ])
    for (const scenarioRoot of compact) {
      expect(
        scenarioRoot.querySelector<HTMLElement>('[data-density="compact"]'),
        scenarioRoot.dataset.scenarioId,
      ).not.toBeNull()
    }
  })

  it('fails closed when renderer bindings drift from ProductContract applicability', () => {
    expect(() => mountBaselineNavigationDataScenarios(document.body, scenarios.slice(1))).toThrow(
      /bindings do not match applicable ProductContract products/i,
    )
  })
})
