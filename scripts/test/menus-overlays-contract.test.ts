import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ProductContractSchema, type ProductEntry } from '../../packages/cli/src/product-contract'
import {
  MENUS_OVERLAYS_ENVIRONMENT_AXES,
  MENUS_OVERLAYS_SCENARIO_DEFINITIONS,
  menusOverlaysScenarios,
  type MenusOverlaysScenarioId,
} from '../lib/menus-overlays-scenarios'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const registry = JSON.parse(readFileSync(resolve(ROOT, 'registry/registry.json'), 'utf8')) as {
  productContract?: unknown
  items?: { name: string; registryDependencies?: string[] }[]
}
const contract = ProductContractSchema.parse(registry.productContract)
const canonicalFamily = contract.entries.filter(
  (entry) => entry.presentation.family === 'menus-overlays',
)
const scenarios = menusOverlaysScenarios(contract)
const baselineCss = readFileSync(
  resolve(ROOT, 'packages/components/src/styles/menus-overlays.css'),
  'utf8',
)

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function machineSource(entry: ProductEntry): string {
  if (entry.machine.kind !== 'public') return ''
  const relative = entry.machine.importPath.replace('@llui/components/', '')
  const base = relative.startsWith('patterns/')
    ? resolve(ROOT, 'packages/components/src')
    : resolve(ROOT, 'packages/components/src/components')
  return readFileSync(resolve(base, `${relative}.ts`), 'utf8')
}

function directBaselineEvidence(entry: ProductEntry): boolean {
  const name = escapeRegex(entry.name)
  return (
    new RegExp(`\\[data-scope=['"]${name}['"]\\]`).test(baselineCss) ||
    new RegExp(`\\.${name}(?![a-z0-9-])`).test(baselineCss)
  )
}

function composedBaselineEvidence(entry: ProductEntry): boolean {
  const source = machineSource(entry)
  const importedComponents = [
    ...source.matchAll(/from ['"]\.\.?(?:\/components)?\/([^'"]+)\.js['"]/g),
  ]
    .map((match) => match[1]!)
    .filter((name) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
  return importedComponents.some((name) => {
    const escaped = escapeRegex(name)
    return new RegExp(`\\[data-scope=['"]${escaped}['"]\\]`).test(baselineCss)
  })
}

describe('menus-overlays presentation contract', () => {
  it('projects the sole canonical inventory into scenario-keyed cases and orthogonal axes', () => {
    const expectedScenarioIds = canonicalFamily.map(({ scenarioId }) => scenarioId)
    expect(expectedScenarioIds).toHaveLength(17)
    expect(scenarios).toMatchObject({
      family: 'menus-overlays',
      environmentAxes: MENUS_OVERLAYS_ENVIRONMENT_AXES,
    })
    expect(scenarios.scenarios.map(({ scenarioId }) => scenarioId)).toEqual(expectedScenarioIds)
    expect(Object.keys(scenarios.byScenarioId)).toEqual(expectedScenarioIds)
    expect(Object.keys(MENUS_OVERLAYS_SCENARIO_DEFINITIONS)).toEqual(expectedScenarioIds)
    expect(MENUS_OVERLAYS_ENVIRONMENT_AXES).toEqual({
      theme: ['light', 'dark'],
      direction: ['ltr', 'rtl'],
      motion: ['full', 'reduced'],
      viewport: ['wide', 'narrow'],
      forcedColors: [false, true],
    })
    for (const scenario of scenarios.scenarios) {
      const caseIds = scenario.cases.map(({ id }) => id)
      expect(caseIds, scenario.scenarioId).toContain(scenario.defaultCaseId)
      expect(new Set(caseIds).size, scenario.scenarioId).toBe(caseIds.length)
      for (const scenarioCase of scenario.cases) {
        expect(() => {
          JSON.parse(JSON.stringify(scenarioCase.input))
        }, scenarioCase.id).not.toThrow()
        expect(
          scenarioCase.environmentAxes.every((axis) => axis in MENUS_OVERLAYS_ENVIRONMENT_AXES),
          `${scenario.scenarioId}:${scenarioCase.id}`,
        ).toBe(true)
      }
    }
  })

  it('preserves profiles, copied-artifact scenarios, and public imports without a second classification', () => {
    for (const entry of canonicalFamily) {
      const scenario = scenarios.byScenarioId[entry.scenarioId as MenusOverlaysScenarioId]
      expect(scenario, entry.scenarioId).toMatchObject({
        productId: entry.name,
        scenarioId: entry.scenarioId,
        displayName: entry.displayName,
        artifactKind: entry.artifactKind,
        machineImport: entry.machine.kind === 'public' ? entry.machine.importPath : null,
        presentation: entry.presentation,
        copiedArtifacts: entry.copiedArtifacts.map((artifact) => ({
          name: artifact.name,
          scenarioId: artifact.scenarioId ?? entry.scenarioId,
        })),
      })
      for (const scenarioCase of scenario.cases) {
        expect(scenarioCase.input.content).toEqual({
          label: `${entry.displayName}: ${scenarioCase.label}`,
          detail: `Semantic ${scenarioCase.id} presentation for ${entry.scenarioId}.`,
        })
        expect(scenarioCase.input.overflow, `${entry.name}:${scenarioCase.id}`).toEqual(
          scenarioCase.id === 'overflow' ? { itemCount: 24 } : undefined,
        )
      }
    }
  })

  it('changes renderer content when canonical display semantics change', () => {
    const target = canonicalFamily[0]!
    const renamed = {
      ...contract,
      entries: contract.entries.map((entry) =>
        entry.name === target.name ? { ...entry, displayName: 'Mutated display name' } : entry,
      ),
    }

    const renamedScenario =
      menusOverlaysScenarios(renamed).byScenarioId[target.scenarioId as MenusOverlaysScenarioId]
    for (const scenarioCase of renamedScenario.cases) {
      expect(scenarioCase.input.content.label).toBe(`Mutated display name: ${scenarioCase.label}`)
      expect(scenarioCase.input.content.detail).toBe(
        `Semantic ${scenarioCase.id} presentation for ${target.scenarioId}.`,
      )
    }
  })

  it('rejects either side of case-definition drift against canonical scenario membership', () => {
    const removed = canonicalFamily[0]!
    const added = contract.entries.find((entry) => entry.presentation.family !== 'menus-overlays')!
    const withoutCanonicalProduct = {
      ...contract,
      entries: contract.entries.map((entry) =>
        entry.name === removed.name
          ? { ...entry, presentation: { ...entry.presentation, family: 'forms-controls' as const } }
          : entry,
      ),
    }
    const withUnconfiguredProduct = {
      ...contract,
      entries: contract.entries.map((entry) =>
        entry.name === added.name
          ? { ...entry, presentation: { ...entry.presentation, family: 'menus-overlays' as const } }
          : entry,
      ),
    }

    expect(() => menusOverlaysScenarios(withoutCanonicalProduct)).toThrow(
      new RegExp(`extras: .*${removed.scenarioId}`),
    )
    expect(() => menusOverlaysScenarios(withUnconfiguredProduct)).toThrow(
      new RegExp(`missing: .*${added.scenarioId}`),
    )
  })

  it('declares only applicable stable cases for unlike products', () => {
    const caseIds = (scenarioId: MenusOverlaysScenarioId) =>
      scenarios.byScenarioId[scenarioId].cases.map(({ id }) => id)
    expect(caseIds('component:menu')).toEqual(['open', 'opening', 'closing', 'overflow'])
    expect(caseIds('component:combobox')).toEqual([
      'open',
      'loading',
      'empty',
      'error',
      'closed',
      'overflow',
    ])
    expect(caseIds('component:toast')).toEqual([
      'info',
      'success',
      'warning',
      'error',
      'loading',
      'custom',
      'placement-top',
      'placement-top-start',
      'placement-top-end',
      'placement-bottom',
      'placement-bottom-start',
      'closing',
      'overflow',
    ])
    const toolbar = scenarios.byScenarioId['component:toolbar']
    expect(caseIds('component:toolbar')).toEqual(['horizontal', 'vertical', 'overflow'])
    expect(toolbar.cases.every(({ input }) => input.presence === undefined)).toBe(true)
    expect(caseIds('component:navigation-menu')).not.toContain('vertical')
    expect(
      scenarios.byScenarioId['component:navigation-menu'].unsupportedCases.map(({ id }) => id),
    ).toContain('vertical')
  })

  it('has observable baseline evidence or an explicit partial/styleless boundary for every entry', () => {
    const problems: string[] = []
    for (const entry of canonicalFamily) {
      const coverage = entry.presentation.baseline
      if (coverage.mode === 'styled') {
        if (!directBaselineEvidence(entry) && !composedBaselineEvidence(entry)) {
          problems.push(`${entry.name}: styled without a direct or composed baseline selector`)
        }
      } else if (coverage.mode === 'partial' || coverage.mode === 'styleless') {
        if (coverage.rationale.trim() === '')
          problems.push(`${entry.name}: empty ${coverage.mode} rationale`)
        if (
          coverage.mode === 'partial' &&
          !directBaselineEvidence(entry) &&
          !composedBaselineEvidence(entry)
        ) {
          problems.push(`${entry.name}: partial without any adopted baseline selector`)
        }
        if (coverage.mode === 'styleless' && directBaselineEvidence(entry)) {
          problems.push(`${entry.name}: styleless but owns a direct baseline selector`)
        }
      } else {
        problems.push(`${entry.name}: unexpected baseline mode ${coverage.mode}`)
      }
    }
    expect(problems).toEqual([])
  })

  it('keeps every family copied skin installable with a closed registry dependency graph', () => {
    const items = new Map((registry.items ?? []).map((item) => [item.name, item]))
    const problems: string[] = []
    for (const entry of canonicalFamily) {
      for (const artifact of entry.copiedArtifacts) {
        if (!artifact.styling.registryTailwind) continue
        const item = items.get(artifact.name)
        if (item === undefined) {
          problems.push(`${entry.name}: missing copied artifact ${artifact.name}`)
          continue
        }
        for (const dependency of item.registryDependencies ?? []) {
          if (!items.has(dependency))
            problems.push(`${artifact.name}: missing dependency ${dependency}`)
        }
      }
    }
    expect(problems).toEqual([])
  })
})
