import { afterEach, describe, expect, it } from 'vitest'
import { loadProductContract } from '../../packages/components/test/styles/navigation-data-contract-source'
import {
  applicableSpecializedToolsScenarios,
  compileSpecializedToolsCatalog,
  joinSpecializedToolsScenarios,
} from '../../packages/components/test/styles/specialized-tools-scenarios'
import { mountBaselineSpecializedToolsScenarios } from '../../packages/components/test/styles/specialized-tools-baseline-renderer'
import { mountRegistrySpecializedToolsScenarios } from './specialized-tools-scenario-renderer'

/**
 * STATE parity across the two styling paths (#266): for every case both paths
 * render, the machine parts publish the same state. The paths may differ in
 * markup (the registry calendar is a table, the baseline a grid of buttons)
 * and naturally differ in classes, but a case that shows "unavailable",
 * "uploading 42%" or "copy refused" on one path must show it on the other —
 * otherwise the gallery compares two different states and calls it a style
 * difference. Identity attributes derived from each renderer's own id prefix
 * (`id`, `for`, `aria-controls`, …) are excluded.
 */

const contract = loadProductContract()
const catalog = compileSpecializedToolsCatalog(contract)
const joined = joinSpecializedToolsScenarios(catalog, contract)
const both = applicableSpecializedToolsScenarios(joined, 'baseline').filter((scenario) =>
  applicableSpecializedToolsScenarios(joined, 'registryTailwind').some(
    (candidate) => candidate.scenarioId === scenario.scenarioId,
  ),
)

const IDENTITY = new Set([
  'id',
  'for',
  'aria-controls',
  'aria-labelledby',
  'aria-describedby',
  'aria-activedescendant',
  'class',
  'style',
])

/** `scope/part` -> sorted state attributes, per case host. */
function publishedState(caseHost: Element): string[] {
  return [...caseHost.querySelectorAll('[data-scope][data-part]')]
    .map((node) => {
      const attrs = [...node.attributes]
        .filter(
          ({ name }) =>
            !IDENTITY.has(name) &&
            (name.startsWith('data-') ||
              name.startsWith('aria-') ||
              name === 'role' ||
              name === 'disabled' ||
              name === 'hidden' ||
              name === 'tabindex'),
        )
        .map(({ name, value }) => `${name}=${value}`)
        .sort()
      return attrs.join(' ')
    })
    .sort()
}

describe('specialized-tools state parity across styling paths (#266)', () => {
  const disposers: (() => void)[] = []

  afterEach(() => {
    while (disposers.length > 0) disposers.pop()!()
    document.body.replaceChildren()
  })

  it('covers the products both paths render', () => {
    expect(both.length).toBeGreaterThan(15)
  })

  it('publishes identical machine state on both paths, case by case', () => {
    const baseline = document.createElement('div')
    const registry = document.createElement('div')
    document.body.append(baseline, registry)
    const b = mountBaselineSpecializedToolsScenarios(
      baseline,
      contract,
      catalog,
      applicableSpecializedToolsScenarios(joined, 'baseline'),
    )
    const r = mountRegistrySpecializedToolsScenarios(registry, contract, catalog)
    disposers.push(
      () => b.dispose(),
      () => r.dispose(),
    )
    const mismatches: string[] = []
    let compared = 0
    for (const scenario of both) {
      for (const scenarioCase of scenario.cases) {
        const selector = `[data-scenario-id="${scenario.scenarioId}"][data-scenario-case="${scenarioCase.id}"]`
        const left = baseline.querySelector(selector)
        const right = registry.querySelector(selector)
        if (left === null || right === null) {
          mismatches.push(`${selector}: missing on one path`)
          continue
        }
        compared += 1
        const l = publishedState(left)
        const rr = publishedState(right)
        if (JSON.stringify(l) !== JSON.stringify(rr)) {
          const onlyLeft = l.filter((entry) => !rr.includes(entry))
          const onlyRight = rr.filter((entry) => !l.includes(entry))
          mismatches.push(
            `${scenario.productId}/${scenarioCase.id}\n  baseline only: ${onlyLeft.join(' | ')}\n  registry only: ${onlyRight.join(' | ')}`,
          )
        }
      }
    }
    expect(compared).toBeGreaterThan(50)
    expect(mismatches, mismatches.join('\n')).toEqual([])
  })
})
