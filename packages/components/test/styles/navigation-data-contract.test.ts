// @vitest-environment node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applicableNavigationDataScenarios,
  navigationDataScenarios,
  type NavigationDataContractEntry,
  projectNavigationDataScenarios,
  scenarioDensityProfile,
  scenarioEnvironmentProductIds,
} from './navigation-data-scenarios'

type ContractEntry = NavigationDataContractEntry & {
  machine: { kind: 'public' | 'none' }
  styling: { baseline: boolean; registryTailwind: boolean }
}

const ROOT = resolve(import.meta.dirname, '../../../..')
const contract = JSON.parse(readFileSync(resolve(ROOT, 'registry/registry.json'), 'utf8')) as {
  productContract: { entries: ContractEntry[] }
}
const family = contract.productContract.entries.filter(
  (entry) => entry.presentation.family === 'navigation-data',
)
const projected = projectNavigationDataScenarios(contract.productContract.entries)

const styleSources = ['disclosure-navigation.css', 'data-display.css'].map((file) =>
  readFileSync(resolve(ROOT, 'packages/components/src/styles', file), 'utf8'),
)
const ownedScopes = new Set(
  styleSources.flatMap((css) =>
    [...css.matchAll(/\[data-scope='([^']+)'\]/g)].map((match) => match[1]!),
  ),
)

describe('navigation/data presentation contract', () => {
  it('uses ProductContract as the exact 29-product scenario inventory', () => {
    const canonicalIds = family.map(({ name }) => name).sort()
    const canonicalScenarioIds = family.map(({ scenarioId }) => scenarioId).sort()
    expect(canonicalIds).toHaveLength(29)
    expect(Object.keys(navigationDataScenarios).sort()).toEqual(canonicalScenarioIds)
    expect(projected.map(({ productId }) => productId).sort()).toEqual(canonicalIds)
  })

  it('derives renderer membership from visually applicable ProductContract modes', () => {
    const entry = (
      name: string,
      mode: NavigationDataContractEntry['presentation']['baseline']['mode'],
    ) => ({
      name,
      presentation: {
        family: 'navigation-data',
        baseline: { mode },
        registryTailwind: { mode },
      },
    })
    const entries = [
      entry('styled', 'styled'),
      entry('partial', 'partial'),
      entry('composed', 'composed'),
      entry('styleless', 'styleless'),
      entry('not-applicable', 'not-applicable'),
      {
        name: 'other-family',
        presentation: {
          family: 'forms-controls',
          baseline: { mode: 'styled' as const },
          registryTailwind: { mode: 'styled' as const },
        },
      },
    ]

    const definitions = Object.fromEntries(
      entries
        .filter(({ presentation }) => presentation.family === 'navigation-data')
        .map(({ name }) => [
          `test:${name}`,
          {
            defaultCaseId: 'default',
            cases: [
              { id: 'default', label: 'Default', input: { state: name }, environmentAxes: [] },
            ],
          },
        ]),
    )
    const withScenarioIds: NavigationDataContractEntry[] = entries.map((item) => ({
      ...item,
      displayName: item.name,
      scenarioId: `test:${item.name}`,
      machine: { kind: 'none' },
      copiedArtifacts: [],
    }))

    expect(
      applicableNavigationDataScenarios(
        projectNavigationDataScenarios(withScenarioIds, definitions),
        'baseline',
      ).map(({ productId }) => productId),
    ).toEqual(['styled', 'partial', 'composed'])
  })

  it('projects path coverage and copied artifacts from ProductContract instead of duplicating them', () => {
    for (const entry of family) {
      const scenario = projected.find(({ productId }) => productId === entry.name)
      expect(scenario, entry.name).toMatchObject({
        displayName: entry.displayName,
        scenarioId: entry.scenarioId,
        presentation: entry.presentation,
        copiedArtifacts: entry.copiedArtifacts,
      })
      expect(scenario?.cases[0]?.input.contract, entry.name).toEqual({
        productId: entry.name,
        displayName: entry.displayName,
        copiedArtifacts: entry.copiedArtifacts.map(({ name }) => name),
      })
    }
  })

  it('defines stable, nonempty semantic cases and orthogonal environment axes', () => {
    for (const scenario of projected) {
      const caseIds = scenario.cases.map(({ id }) => id)
      expect(new Set(caseIds).size, scenario.productId).toBe(caseIds.length)
      expect(caseIds, scenario.productId).toContain(scenario.defaultCaseId)
      for (const scenarioCase of scenario.cases) {
        expect(scenarioCase.label.trim(), `${scenario.productId}/${scenarioCase.id}`).not.toBe('')
        expect(
          Object.keys(scenarioCase.input),
          `${scenario.productId}/${scenarioCase.id}`,
        ).not.toEqual([])
        expect(
          new Set(scenarioCase.environmentAxes.map(({ axis, value }) => `${axis}:${String(value)}`))
            .size,
          `${scenario.productId}/${scenarioCase.id}`,
        ).toBe(scenarioCase.environmentAxes.length)
      }
    }
  })

  it('classifies density once in family scenarios with concrete not-applicable rationales', () => {
    const profiles = projected.map((scenario) => ({
      productId: scenario.productId,
      profile: scenarioDensityProfile(scenario),
    }))
    expect(
      profiles
        .filter(({ profile }) => profile.mode === 'applicable')
        .map(({ productId }) => productId)
        .sort(),
    ).toEqual(['avatar', 'data-table', 'item', 'sidebar', 'table'])

    for (const { productId, profile } of profiles) {
      if (profile.mode === 'applicable') {
        expect(profile.caseIds.length, productId).toBeGreaterThanOrEqual(2)
        expect(profile.caseIds, productId).toContain('compact')
      } else {
        expect(profile.rationale, productId).toContain(
          projected.find((scenario) => scenario.productId === productId)!.displayName,
        )
        expect(profile.rationale, productId).toMatch(/target size|information hierarchy/i)
      }
    }
  })

  it('pairs every forced-colors environment with a concrete non-colour cue', () => {
    for (const scenario of projected) {
      expect(
        scenarioEnvironmentProductIds(projected, 'forcedColors', 'active').includes(
          scenario.productId,
        ),
        `${scenario.productId} forced-colors environment`,
      ).toBe(scenario.forcedColorCue !== undefined)
    }
  })

  it('rejects a missing or foreign family definition instead of creating a shadow inventory', () => {
    const missing = { ...navigationDataScenarios }
    delete (missing as Record<string, unknown>)[family[0]!.scenarioId]
    expect(() => projectNavigationDataScenarios(contract.productContract.entries, missing)).toThrow(
      /missing navigation\/data scenario definition/i,
    )

    expect(() =>
      projectNavigationDataScenarios(contract.productContract.entries, {
        ...navigationDataScenarios,
        'component:not-canonical': navigationDataScenarios['component:accordion'],
      }),
    ).toThrow(/unknown navigation\/data scenario definition/i)
  })

  it('rejects duplicate case ids and a dangling default case at projection time', () => {
    const original = navigationDataScenarios['component:accordion']
    expect(() =>
      projectNavigationDataScenarios(contract.productContract.entries, {
        ...navigationDataScenarios,
        'component:accordion': {
          ...original,
          cases: [original.cases[0]!, original.cases[0]!],
        },
      }),
    ).toThrow(/duplicate case ids/i)

    expect(() =>
      projectNavigationDataScenarios(contract.productContract.entries, {
        ...navigationDataScenarios,
        'component:accordion': { ...original, defaultCaseId: 'missing' },
      }),
    ).toThrow(/default case missing does not exist/i)
  })

  it('ships a baseline selector surface for every styled or partial family product', () => {
    const expected = family
      .filter(({ presentation }) => ['styled', 'partial'].includes(presentation.baseline.mode))
      .map(({ name }) => name)
      .sort()

    expect([...ownedScopes].sort()).toEqual(expected)
  })

  it('leaves no public navigation/data machine visually styleless', () => {
    const styleless = family
      .filter(
        ({ machine, presentation }) =>
          machine.kind === 'public' && presentation.baseline.mode === 'styleless',
      )
      .map(({ name }) => name)
    expect(styleless).toEqual([])
  })

  it('keeps machine-free registry products explicitly inapplicable on the package path', () => {
    const exceptions = family
      .filter(
        ({ machine, presentation }) =>
          machine.kind === 'none' && presentation.baseline.mode !== 'not-applicable',
      )
      .map(({ name }) => name)
    expect(exceptions).toEqual(['chip'])

    for (const entry of family.filter(
      ({ presentation }) => presentation.baseline.mode === 'not-applicable',
    )) {
      expect(entry.machine.kind, entry.name).toBe('none')
      expect(entry.styling.baseline, entry.name).toBe(false)
      expect(entry.presentation.baseline.rationale, entry.name).toMatch(
        /no baseline package artifact/i,
      )
    }
  })

  it('names the direct-versus-consumer boundary for both partial products', () => {
    const partial = family.filter(({ presentation }) => presentation.baseline.mode === 'partial')
    expect(partial.map(({ name }) => name).sort()).toEqual(['data-table', 'marquee'])
    for (const entry of partial) {
      expect(entry.styling.baseline, entry.name).toBe(true)
      expect(entry.presentation.baseline.rationale, entry.name).toMatch(/directly owns/i)
      expect(entry.presentation.baseline.rationale, entry.name).toMatch(/consumer/i)
    }
  })
})
