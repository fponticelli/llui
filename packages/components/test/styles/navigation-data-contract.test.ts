// @vitest-environment node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeScenarioFamily } from '@llui/cli/presentation-scenarios'
import { loadProductContract } from './navigation-data-contract-source'
import {
  applicableNavigationDataScenarios,
  compileNavigationDataCatalog,
  DENSITY_APPLICABLE_PRODUCT_IDS,
  DENSITY_RATIONALES,
  forcedColorScenarios,
  joinNavigationDataScenarios,
  NAVIGATION_DATA_DEFINITIONS,
  scenarioEnvironmentProductIds,
} from './navigation-data-scenarios'

const ROOT = resolve(import.meta.dirname, '../../../..')
const contract = loadProductContract()
const family = contract.entries.filter((entry) => entry.presentation.family === 'navigation-data')
const catalog = compileNavigationDataCatalog(contract)
const joined = joinNavigationDataScenarios(catalog, contract)

const styleSources = ['disclosure-navigation.css', 'data-display.css'].map((file) =>
  readFileSync(resolve(ROOT, 'packages/components/src/styles', file), 'utf8'),
)
const ownedScopes = new Set(
  styleSources.flatMap((css) =>
    [...css.matchAll(/\[data-scope='([^']+)'\]/g)].map((match) => match[1]!),
  ),
)

describe('navigation/data presentation contract', () => {
  it('compiles the family with the exact 29-product ProductContract inventory (zero missing, zero stale)', () => {
    const canonicalIds = family.map(({ name }) => name).sort()
    const canonicalScenarioIds = family.map(({ scenarioId }) => scenarioId).sort()
    expect(canonicalIds).toHaveLength(29)
    expect(Object.keys(NAVIGATION_DATA_DEFINITIONS).sort()).toEqual(canonicalScenarioIds)
    expect(catalog.scenarios.map(({ productId }) => productId).sort()).toEqual(canonicalIds)
  })

  it('rejects a family missing a canonical scenario, and a family carrying a stale one', () => {
    const { 'component:accordion': _omitted, ...missingAccordion } = NAVIGATION_DATA_DEFINITIONS
    expect(() => decodeScenarioFamily(contract, 'navigation-data', missingAccordion)).toThrow(
      /missing definition for product/i,
    )

    const withStaleKey = {
      ...NAVIGATION_DATA_DEFINITIONS,
      'component:not-canonical': NAVIGATION_DATA_DEFINITIONS['component:accordion'],
    }
    expect(() => decodeScenarioFamily(contract, 'navigation-data', withStaleKey)).toThrow(
      /stale definition for presentation family/i,
    )
  })

  it('derives renderer applicability from ProductContract presentation modes only', () => {
    const baseline = applicableNavigationDataScenarios(joined, 'baseline')
    const registryTailwind = applicableNavigationDataScenarios(joined, 'registryTailwind')
    const expectedBaseline = family
      .filter(({ presentation }) =>
        ['styled', 'partial', 'composed'].includes(presentation.baseline.mode),
      )
      .map(({ name }) => name)
      .sort()
    const expectedRegistry = family
      .filter(({ presentation }) =>
        ['styled', 'partial', 'composed'].includes(presentation.registryTailwind.mode),
      )
      .map(({ name }) => name)
      .sort()
    expect(baseline.map(({ productId }) => productId).sort()).toEqual(expectedBaseline)
    expect(registryTailwind.map(({ productId }) => productId).sort()).toEqual(expectedRegistry)
  })

  it('defines stable, nonempty semantic cases with a real default and no duplicate axes', () => {
    for (const scenario of catalog.scenarios) {
      const caseIds = scenario.cases.map(({ id }) => id)
      expect(new Set(caseIds).size, scenario.productId).toBe(caseIds.length)
      expect(caseIds, scenario.productId).toContain(scenario.defaultCaseId)
      for (const scenarioCase of scenario.cases) {
        expect(scenarioCase.label.trim(), `${scenario.productId}/${scenarioCase.id}`).not.toBe('')
        expect(
          new Set(scenarioCase.environmentAxes).size,
          `${scenario.productId}/${scenarioCase.id}`,
        ).toBe(scenarioCase.environmentAxes.length)
      }
    }
  })

  it('classifies collection density on exactly the products with a real density axis', () => {
    const withCompactCase = joined
      .filter(({ cases }) => cases.some(({ id }) => id === 'compact'))
      .map(({ productId }) => productId)
      .sort()
    expect(withCompactCase).toEqual(DENSITY_APPLICABLE_PRODUCT_IDS)
  })

  it('registers exactly one specific density-N/A rationale per non-applicable product, each backed by a real absence of a density/size field in its checked sources', () => {
    const applicableSet = new Set(DENSITY_APPLICABLE_PRODUCT_IDS)
    const naProductIds = family
      .map(({ name }) => name)
      .filter((name) => !applicableSet.has(name))
      .sort()
    expect(Object.keys(DENSITY_RATIONALES).sort()).toEqual(naProductIds)

    const displayNameByProductId = new Map(
      family.map(({ name, displayName }) => [name, displayName]),
    )
    for (const [productId, rationale] of Object.entries(DENSITY_RATIONALES)) {
      const displayName = displayNameByProductId.get(productId)!
      // The rationale must actually name its own product, not a copy-pasted
      // sibling's — a bare template can pass `.toContain(displayName)`
      // trivially by construction; asserting per-product text prevents that.
      expect(rationale.text, productId).toContain(displayName)
      expect(rationale.checkedSources.length, productId).toBeGreaterThan(0)
      for (const relPath of rationale.checkedSources) {
        const source = readFileSync(resolve(ROOT, relPath), 'utf8')
        expect(source, `${productId}: ${relPath}`).not.toMatch(/density/i)
      }
    }
  })

  it('pairs every forced-colors-capable scenario with a concrete non-colour cue', () => {
    const withForcedColors = scenarioEnvironmentProductIds(joined, 'forcedColors')
    const cued = forcedColorScenarios(joined)
    expect(cued.map(({ productId }) => productId)).toEqual(withForcedColors)
    expect(cued.every(({ cue }) => typeof cue === 'string' && cue.length > 0)).toBe(true)
  })

  it('ships a baseline selector surface for every styled-or-partial family product', () => {
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

  it('keeps machine-free registry products explicitly inapplicable on the baseline path, except chip', () => {
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
      if (entry.presentation.baseline.mode === 'not-applicable') {
        expect(entry.presentation.baseline.rationale, entry.name).toMatch(
          /no baseline package artifact/i,
        )
      }
    }
  })

  it('names the direct-versus-consumer boundary for both partial products', () => {
    const partial = family.filter(({ presentation }) => presentation.baseline.mode === 'partial')
    expect(partial.map(({ name }) => name).sort()).toEqual(['data-table', 'marquee'])
    for (const entry of partial) {
      expect(entry.styling.baseline, entry.name).toBe(true)
      if (entry.presentation.baseline.mode === 'partial') {
        expect(entry.presentation.baseline.rationale, entry.name).toMatch(/directly owns/i)
        expect(entry.presentation.baseline.rationale, entry.name).toMatch(/consumer/i)
      }
    }
  })
})
