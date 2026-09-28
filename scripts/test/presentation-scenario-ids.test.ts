import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  PRESENTATION_SCENARIO_IDS_PATH,
  presentationScenarioIdsByFamily,
  renderPresentationScenarioIds,
} from '../lib/presentation-scenario-ids.mjs'

/**
 * The literal scenario ids the typed presentation-scenario path is exact against are GENERATED
 * from `registry/registry.json#productContract` (the one inventory). A stale module would type
 * the family definitions against yesterday's contract; `compileScenarioFamily` would then throw at
 * runtime (it cross-checks the ids), but that is a late, test-time failure — this one names the
 * fix. `pnpm check:generated` diffs the same file after a full regenerate.
 */
const ROOT = resolve(import.meta.dirname, '../..')

function productContract(): unknown {
  const registry: unknown = JSON.parse(
    readFileSync(resolve(ROOT, 'registry/registry.json'), 'utf8'),
  )
  if (typeof registry !== 'object' || registry === null || !('productContract' in registry)) {
    throw new Error('registry/registry.json carries no productContract')
  }
  return registry.productContract
}

describe('generated presentation scenario ids', () => {
  it('is exactly what registry/registry.json renders to (run `pnpm build:registry`)', async () => {
    const committed = readFileSync(resolve(ROOT, PRESENTATION_SCENARIO_IDS_PATH), 'utf8')
    expect(committed).toBe(await renderPresentationScenarioIds(productContract(), ROOT))
  })

  it('groups every contract entry under its family, in canonical contract order', () => {
    const byFamily = presentationScenarioIdsByFamily({
      entries: [
        { presentation: { family: 'b' }, scenarioId: 'component:z' },
        { presentation: { family: 'a' }, scenarioId: 'component:y' },
        { presentation: { family: 'b' }, scenarioId: 'component:x' },
      ],
    })
    expect([...byFamily]).toEqual([
      ['b', ['component:z', 'component:x']],
      ['a', ['component:y']],
    ])
  })

  it('refuses a contract it cannot render faithfully', () => {
    expect(() => presentationScenarioIdsByFamily(null)).toThrow(/must be an object/)
    expect(() => presentationScenarioIdsByFamily({ entries: {} })).toThrow(/must be an array/)
    expect(() => presentationScenarioIdsByFamily({ entries: [{ scenarioId: 'x' }] })).toThrow(
      /entries\[0\]/,
    )
    const duplicate = { presentation: { family: 'a' }, scenarioId: 'component:x' }
    expect(() => presentationScenarioIdsByFamily({ entries: [duplicate, duplicate] })).toThrow(
      /duplicate scenarioId/,
    )
  })
})
