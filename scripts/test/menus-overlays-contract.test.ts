import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ProductContractSchema, type ProductEntry } from '../../packages/cli/src/product-contract'
import {
  MENUS_OVERLAYS_ENVIRONMENTS,
  menusOverlaysScenarios,
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
  it('projects the sole canonical inventory into deterministic product-keyed scenarios', () => {
    const expectedIds = canonicalFamily.map(({ name }) => name)
    expect(expectedIds).toHaveLength(17)
    expect(scenarios).toMatchObject({
      family: 'menus-overlays',
      environments: MENUS_OVERLAYS_ENVIRONMENTS,
      productIds: expectedIds,
    })
    expect(Object.keys(scenarios.byProductId)).toEqual(expectedIds)
    expect(
      scenarios.productIds.map((productId) => scenarios.byProductId[productId]?.scenarioId),
    ).toEqual(canonicalFamily.map(({ scenarioId }) => scenarioId))
  })

  it('preserves profiles, copied-artifact scenarios, and public imports without a second classification', () => {
    for (const entry of canonicalFamily) {
      const scenario = scenarios.byProductId[entry.name]
      expect(scenario, entry.name).toEqual({
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
    }
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
