import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ProductContractSchema } from '@llui/cli'
import { PRESENTATION_SCENARIO_ENVIRONMENT_VALUES } from '@llui/cli/presentation-scenarios'
import {
  MENUS_OVERLAYS_DEFINITIONS,
  compileMenusOverlaysCatalog,
  joinMenusOverlaysScenarios,
  type MenusOverlaysDefinitionScenarioId,
} from './menus-overlays-scenarios'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const registry = JSON.parse(readFileSync(resolve(ROOT, 'registry/registry.json'), 'utf8')) as {
  productContract?: unknown
  items?: { name: string; registryDependencies?: string[] }[]
}
const contract = ProductContractSchema.parse(registry.productContract)
const canonicalFamily = contract.entries.filter(
  (entry) => entry.presentation.family === 'menus-overlays',
)

describe('menus-overlays real per-product scenario catalog (compileScenarioFamily)', () => {
  it('joins the sole canonical 17-product inventory with no missing/stale scenarioId', () => {
    const expectedScenarioIds = canonicalFamily.map(({ scenarioId }) => scenarioId)
    expect(expectedScenarioIds).toHaveLength(17)
    expect(Object.keys(MENUS_OVERLAYS_DEFINITIONS).sort()).toEqual([...expectedScenarioIds].sort())

    const catalog = compileMenusOverlaysCatalog(contract)
    expect(catalog.family).toBe('menus-overlays')
    expect(catalog.scenarios.map(({ scenarioId }) => scenarioId).sort()).toEqual(
      [...expectedScenarioIds].sort(),
    )
  })

  it('throws PresentationScenarioError on a stale/missing scenarioId in either direction', () => {
    const removed = canonicalFamily[0]!
    const withoutCanonicalProduct = {
      ...contract,
      entries: contract.entries.map((entry) =>
        entry.name === removed.name
          ? { ...entry, presentation: { ...entry.presentation, family: 'forms-controls' as const } }
          : entry,
      ),
    }
    expect(() => compileMenusOverlaysCatalog(withoutCanonicalProduct)).toThrow()
  })

  it('every case input is JSON-serializable and every declared axis is a real environment axis', () => {
    const catalog = compileMenusOverlaysCatalog(contract)
    for (const scenario of catalog.scenarios) {
      const caseIds = scenario.cases.map(({ id }) => id)
      expect(caseIds, scenario.scenarioId).toContain(scenario.defaultCaseId)
      expect(new Set(caseIds).size, scenario.scenarioId).toBe(caseIds.length)
      for (const scenarioCase of scenario.cases) {
        expect(() => JSON.parse(JSON.stringify(scenarioCase.input)), scenarioCase.id).not.toThrow()
        for (const axis of scenarioCase.environmentAxes) {
          expect(
            axis in PRESENTATION_SCENARIO_ENVIRONMENT_VALUES,
            `${scenario.scenarioId}:${axis}`,
          ).toBe(true)
        }
      }
    }
  })

  it('joinMenusOverlaysScenarios attaches real ProductContract metadata per scenario', () => {
    const catalog = compileMenusOverlaysCatalog(contract)
    const joined = joinMenusOverlaysScenarios(catalog, contract)
    const entryByName = new Map(canonicalFamily.map((entry) => [entry.name, entry]))
    for (const scenario of joined) {
      const entry = entryByName.get(scenario.productId)!
      expect(scenario.displayName).toBe(entry.displayName)
      expect(scenario.presentation).toEqual(entry.presentation)
      expect(scenario.copiedArtifacts).toEqual(entry.copiedArtifacts)
      expect(scenario.machine).toEqual(entry.machine)
    }
  })

  it('declares only reachable presence phases per product (#265 finding: split by real lifecycle)', () => {
    const caseIds = (id: MenusOverlaysDefinitionScenarioId) =>
      MENUS_OVERLAYS_DEFINITIONS[id].cases.map(({ id: caseId }) => caseId)
    // Four-phase products expose opening/closing.
    expect(caseIds('component:dialog')).toEqual(expect.arrayContaining(['opening', 'closing']))
    expect(caseIds('component:menu')).toEqual(expect.arrayContaining(['opening', 'closing']))
    // Mounted-open-only products (synchronous machines) expose neither.
    for (const id of [
      'component:select',
      'component:combobox',
      'component:menubar',
      'pattern:searchable-select',
    ] as const) {
      const cases = MENUS_OVERLAYS_DEFINITIONS[id].cases as readonly { readonly id: string }[]
      expect(
        cases.some((c) => c.id === 'opening' || c.id === 'closing'),
        id,
      ).toBe(false)
    }
    // Toolbar carries no presence field at all.
    const toolbarCases = MENUS_OVERLAYS_DEFINITIONS['component:toolbar'].cases
    for (const toolbarCase of toolbarCases) {
      expect('presence' in toolbarCase.input, toolbarCase.id).toBe(false)
    }
    // Navigation-menu: content itself is synchronous; no opening/closing case.
    const navCases = caseIds('component:navigation-menu')
    expect(navCases).not.toContain('opening')
    expect(navCases).not.toContain('closing')
  })
})
