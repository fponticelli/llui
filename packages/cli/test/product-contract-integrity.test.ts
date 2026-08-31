import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ProductContractSchema, resolveCopiedArtifact } from '../src/product-contract'
import { assertProductInventory } from './product-inventory'

const ROOT = resolve(import.meta.dirname, '../../..')

type PackageJson = {
  exports: Record<string, { import?: string } | string>
}

type SourceRegistry = {
  productContract?: unknown
  items: readonly { name: string; title?: string; type: string }[]
}

const packageJson = JSON.parse(
  readFileSync(resolve(ROOT, 'packages/components/package.json'), 'utf8'),
) as PackageJson
const registry = JSON.parse(
  readFileSync(resolve(ROOT, 'registry/registry.json'), 'utf8'),
) as SourceRegistry

function publicMachineImports(exports = packageJson.exports): string[] {
  return Object.entries(exports)
    .filter(
      ([subpath, target]) =>
        subpath !== './patterns' &&
        /^\.\/dist\/(?:components|patterns)\/[^*]+\.js$/.test(
          typeof target === 'string' ? target : (target.import ?? ''),
        ),
    )
    .map(([subpath]) => `@llui/components/${subpath.slice(2)}`)
    .sort()
}

describe('published LLui product contract', () => {
  it('recognises both conditional and direct package export targets', () => {
    expect(
      publicMachineImports({
        './switch': './dist/components/switch.js',
        './patterns/wizard': { import: './dist/patterns/wizard.js' },
        './patterns': './dist/patterns/index.js',
      }),
    ).toEqual(['@llui/components/patterns/wizard', '@llui/components/switch'])
  })

  it('classifies the exact package-machine and copied-registry sets', () => {
    const contract = ProductContractSchema.parse(registry.productContract)
    const registryItems = registry.items
      .filter(({ type }) => type === 'registry:ui')
      .map(({ name }) => name)
      .sort()

    expect(() =>
      assertProductInventory(contract, {
        machineImports: publicMachineImports(),
        registryItems,
      }),
    ).not.toThrow()
  })

  it('preserves each published item title as copied-artifact identity', () => {
    const contract = ProductContractSchema.parse(registry.productContract)
    const publishedItems = registry.items.filter(({ type }) => type === 'registry:ui')

    for (const item of publishedItems) {
      const resolved = resolveCopiedArtifact(contract, item.name)
      expect(resolved?.artifact.name).toBe(item.name)
      expect(resolved?.artifact.displayName).toBe(item.title)
      expect(resolved?.artifact.styling.registryTailwind).toBe(true)
    }
  })

  it('keeps multi-target installs and aliases artifact-specific', () => {
    const contract = ProductContractSchema.parse(registry.productContract)

    expect(resolveCopiedArtifact(contract, 'calendar')?.artifact).toMatchObject({
      displayName: 'Calendar / Date Picker',
      scenarioId: 'registry:calendar',
      artifactKind: 'skin',
    })
    expect(resolveCopiedArtifact(contract, 'date-picker')?.artifact).toMatchObject({
      displayName: 'Date Picker',
      scenarioId: 'registry:date-picker',
      artifactKind: 'skin',
    })
    expect(resolveCopiedArtifact(contract, 'drawer')?.artifact.scenarioId).toBe('registry:drawer')
    expect(resolveCopiedArtifact(contract, 'sheet')?.artifact).toMatchObject({
      displayName: 'Sheet / Drawer',
      scenarioId: 'registry:sheet',
      artifactKind: 'skin',
    })
    expect(resolveCopiedArtifact(contract, 'command')).toMatchObject({
      alias: { canonicalName: 'command-menu' },
      artifact: { artifactKind: 'pattern' },
    })
  })

  it('keeps patterns and intentionally machine-free products explicit', () => {
    const contract = ProductContractSchema.parse(registry.productContract)
    const patterns = contract.entries.filter(({ artifactKind }) => artifactKind === 'pattern')
    const machineFree = contract.entries.filter(({ machine }) => machine.kind === 'none')

    expect(patterns.map(({ name }) => name).sort()).toEqual([
      'command-menu',
      'confirm-dialog',
      'data-table',
      'form-field',
      'searchable-select',
      'wizard',
    ])
    expect(machineFree.length).toBeGreaterThan(0)
    expect(
      machineFree.every(
        ({ artifactKind, machine }) =>
          machine.kind === 'none' &&
          ((artifactKind === 'presentational' && machine.reason === 'presentational') ||
            (artifactKind === 'skin' && machine.reason === 'application-owned-state')),
      ),
    ).toBe(true)
  })
})
