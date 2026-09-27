import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadProductContract } from '../../packages/components/test/styles/navigation-data-contract-source'
import {
  applicableSpecializedToolsScenarios,
  compileSpecializedToolsCatalog,
  joinSpecializedToolsScenarios,
} from '../../packages/components/test/styles/specialized-tools-scenarios'
import {
  mountRegistrySpecializedToolsScenarios,
  REGISTRY_ADAPTERS,
  type Disposable,
} from './specialized-tools-scenario-renderer'
import { FROZEN_ICONIFY_API } from './specialized-tools-frozen-icons'

const contract = loadProductContract()
const catalog = compileSpecializedToolsCatalog(contract)
const joined = joinSpecializedToolsScenarios(catalog, contract)
const scenarios = applicableSpecializedToolsScenarios(joined, 'registryTailwind')

const MACHINE_FILE: Readonly<Record<string, string>> = {
  wizard: 'components/steps.ts',
}

function publishedParts(productId: string): string[] {
  const file = MACHINE_FILE[productId] ?? `components/${productId}.ts`
  return [
    ...new Set(
      [
        ...readFileSync(
          resolve(import.meta.dirname, '../../packages/components/src', file),
          'utf8',
        ).matchAll(/['"]data-part['"]:\s*['"]([^'"]+)['"]/g),
      ].map(([, part]) => part!),
    ),
  ].sort()
}

/** Parts the gallery deliberately leaves out, with the reason (closed list). */
const UNRENDERED_PARTS: Readonly<Record<string, readonly string[]>> = {
  'color-picker': [
    'saturation-slider',
    'lightness-slider',
    'chroma-slider',
    'oklch-lightness-slider',
    'eyedropper-trigger',
  ],
  'date-picker': ['preset'],
  'file-upload': ['clear-trigger', 'item-preview', 'item-remove'],
  'gradient-picker': [
    'angle-input',
    'center-area',
    'center-thumb',
    'css-error',
    'distribute-button',
    'interpolation-hue-select',
    'interpolation-space-select',
    'repeating-toggle',
    'reverse-button',
  ],
  editable: ['edit-trigger'],
}

/** Registry-only products: no machine, so no parts — just their own markup. */
const MACHINE_FREE = new Set(['aspect-ratio', 'icons'])

describe('registry specialized-tools scenario renderer (#266)', () => {
  let mounted: Disposable | undefined

  afterEach(() => {
    mounted?.dispose()
    mounted = undefined
    document.body.replaceChildren()
    vi.unstubAllGlobals()
  })

  const render = (): HTMLElement => {
    const host = document.createElement('div')
    document.body.append(host)
    mounted = mountRegistrySpecializedToolsScenarios(host, contract, catalog, scenarios)
    return host
  }

  it('binds exactly the products whose registry mode is visually applicable', () => {
    expect(Object.keys(REGISTRY_ADAPTERS).sort()).toEqual(
      scenarios.map(({ scenarioId }) => scenarioId).sort(),
    )
    const host = document.createElement('div')
    expect(() =>
      mountRegistrySpecializedToolsScenarios(host, contract, catalog, scenarios.slice(1)),
    ).toThrow(/do not match applicable/)
  })

  it('renders every applicable case, and every part it publishes through a copied skin', () => {
    const host = render()
    const markers = [...host.querySelectorAll<HTMLElement>('[data-scenario-case]')]
      .map((node) => `${node.dataset.scenarioId}:${node.dataset.scenarioCase}`)
      .sort()
    expect(markers).toEqual(
      scenarios.flatMap((s) => s.cases.map((c) => `${s.scenarioId}:${c.id}`)).sort(),
    )
    for (const scenario of scenarios) {
      if (MACHINE_FREE.has(scenario.productId)) continue
      const scope = scenario.productId === 'wizard' ? 'steps' : scenario.productId
      const nodes = [
        ...host.querySelectorAll<HTMLElement>(
          `[data-scenario-product="${scenario.productId}"] [data-scope="${scope}"][data-part]`,
        ),
      ]
      const rendered = new Set(nodes.map((node) => node.dataset.part!))
      const skipped = new Set(UNRENDERED_PARTS[scenario.productId] ?? [])
      for (const part of publishedParts(scenario.productId)) {
        if (skipped.has(part)) {
          expect(rendered.has(part), `${scenario.productId}: ${part} is rendered now`).toBe(false)
          continue
        }
        expect(rendered.has(part), `${scenario.productId} never renders ${part}`).toBe(true)
      }
      // Through a SKIN: every rendered part carries a recipe class. (The
      // wizard's next/prev go through the Button skin, the rest through Steps.)
      const unskinned = nodes
        .filter((node) => !node.hasAttribute('class') && node.dataset.part !== 'sentinel')
        .map((node) => node.dataset.part)
      expect(unskinned, `${scenario.productId} parts without a recipe`).toEqual([])
    }
  })

  it('draws every icon from the frozen local source — no live network', async () => {
    const network = vi.fn(() => Promise.reject(new Error('network is off in the gallery')))
    vi.stubGlobal('fetch', network)
    const host = render()
    // Let the icon loader's batch macrotask fire and its promise chain settle.
    await new Promise((settle) => setTimeout(settle, 0))
    await new Promise((settle) => setTimeout(settle, 0))
    expect(network).not.toHaveBeenCalled()
    const glyphs = [...host.querySelectorAll('[data-scenario-product="icons"] [data-glyph] svg')]
    expect(glyphs.length).toBeGreaterThan(0)
    expect(glyphs.every((glyph) => glyph.childElementCount > 0)).toBe(true)
    // The sentinel origin never reaches a real request either.
    expect(FROZEN_ICONIFY_API).not.toMatch(/^https?:/)
  })

  it('is deterministic: two renders produce byte-identical markup', () => {
    const first = render().innerHTML
    mounted?.dispose()
    document.body.replaceChildren()
    const second = render().innerHTML
    expect(second).toBe(first)
  })
})
