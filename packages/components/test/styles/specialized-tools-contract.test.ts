// @vitest-environment node

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeScenarioFamily } from '@llui/cli/presentation-scenarios'
import { loadProductContract } from './navigation-data-contract-source'
import {
  applicableSpecializedToolsScenarios,
  compileSpecializedToolsCatalog,
  DIRECTIONAL_PRODUCT_IDS,
  EARLIER_FAMILIES,
  FORCED_COLOR_CUES,
  INPUT_MODALITY_PARITY,
  joinSpecializedToolsScenarios,
  MOTION_PRODUCT_IDS,
  REQUIRED_STATE_CASES,
  scenarioEnvironmentProductIds,
  SPECIALIZED_TOOLS_CLASSIFICATION,
  SPECIALIZED_TOOLS_DEFINITIONS,
  SPECIALIZED_TOOLS_PRODUCT_IDS,
} from './specialized-tools-scenarios'

const ROOT = resolve(import.meta.dirname, '../../../..')
const STYLES = resolve(ROOT, 'packages/components/src/styles')
const FAMILY_CSS = 'specialized-tools.css'

const contract = loadProductContract()
const family = contract.entries.filter(
  ({ presentation }) => presentation.family === 'specialized-tools',
)
// Compiled LAZILY, inside the tests that need it. The protocol compiler throws
// on a missing or stale definition, and at module scope that throw fails the
// file with zero tests run — hiding the residue and classification assertions
// below, which name the product and the family and are the diagnosis a
// contributor needs when an entry moves between families.
let compiled: ReturnType<typeof compileSpecializedToolsCatalog> | undefined
const compiledCatalog = () => (compiled ??= compileSpecializedToolsCatalog(contract))
const joinedScenarios = () => joinSpecializedToolsScenarios(compiledCatalog(), contract)
const entryOf = (name: string) => {
  const entry = contract.entries.find((candidate) => candidate.name === name)
  if (entry === undefined) throw new Error(`No ProductContract entry named ${name}`)
  return entry
}

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')
const scopesIn = (css: string): Set<string> =>
  new Set([...stripComments(css).matchAll(/\[data-scope='([^']+)'\]/g)].map((m) => m[1]!))
const cssFiles = readdirSync(STYLES).filter((file) => file.endsWith('.css'))
const readStyle = (file: string): string => readFileSync(resolve(STYLES, file), 'utf8')

describe('specialized-tools presentation contract (#266)', () => {
  it('owns EXACTLY the canonical entries the three earlier family tickets do not', () => {
    const earlier = new Set<string>(EARLIER_FAMILIES)
    const uncovered = contract.entries
      .filter(({ presentation }) => !earlier.has(presentation.family))
      .map(({ name }) => name)
      .sort()
    // Exact, both directions: nothing falls between the four families, and
    // nothing outside the residue is claimed.
    expect(uncovered).toEqual([...SPECIALIZED_TOOLS_PRODUCT_IDS].sort())
    expect(family.map(({ name }) => name).sort()).toEqual(uncovered)
    // The four families partition the whole contract.
    const byFamily = new Map<string, number>()
    for (const entry of contract.entries) {
      byFamily.set(entry.presentation.family, (byFamily.get(entry.presentation.family) ?? 0) + 1)
    }
    expect([...byFamily.keys()].sort()).toEqual([...EARLIER_FAMILIES, 'specialized-tools'].sort())
  })

  it('classifies every family entry on both paths, and the contract says the same', () => {
    expect(Object.keys(SPECIALIZED_TOOLS_CLASSIFICATION).sort()).toEqual(
      [...SPECIALIZED_TOOLS_PRODUCT_IDS].sort(),
    )
    for (const [name, classification] of Object.entries(SPECIALIZED_TOOLS_CLASSIFICATION)) {
      const entry = entryOf(name)
      for (const path of ['baseline', 'registryTailwind'] as const) {
        expect(entry.presentation[path].mode, `${name}.${path}`).toBe(classification[path].mode)
        expect(classification[path].owns.trim(), `${name}.${path} ownership`).not.toBe('')
      }
    }
  })

  it('reports zero unexplained entries: every non-styled path carries a contract rationale', () => {
    for (const entry of family) {
      for (const path of ['baseline', 'registryTailwind'] as const) {
        const coverage = entry.presentation[path]
        if (coverage.mode === 'styled') continue
        expect(coverage.rationale.trim(), `${entry.name}.${path}`).not.toBe('')
        // The generic "owns no visual treatment" boilerplate the contract
        // shipped before this ticket is not an explanation of anything.
        expect(coverage.rationale, `${entry.name}.${path}`).not.toMatch(
          /^The baseline path owns no visual treatment for this product/,
        )
      }
    }
  })

  it('names the direct-versus-consumer boundary for every partial path', () => {
    const partial = family.flatMap((entry) =>
      (['baseline', 'registryTailwind'] as const).flatMap((path) => {
        const coverage = entry.presentation[path]
        return coverage.mode === 'partial' ? [{ entry, path, rationale: coverage.rationale }] : []
      }),
    )
    expect(partial.map(({ entry, path }) => `${entry.name}.${path}`).sort()).toEqual([
      'icons.registryTailwind',
      'signature-pad.baseline',
      'signature-pad.registryTailwind',
      'tour.baseline',
      'tour.registryTailwind',
      'wizard.baseline',
    ])
    for (const { entry, path, rationale } of partial) {
      expect(rationale, `${entry.name}.${path}`).toMatch(/directly owns/i)
      expect(rationale, `${entry.name}.${path}`).toMatch(/consumer|caller/i)
    }
  })

  it('keeps styleless strictly behaviour-only: a public machine, no selector, no copied artifact', () => {
    const styleless = family.filter(
      ({ presentation }) =>
        presentation.baseline.mode === 'styleless' ||
        presentation.registryTailwind.mode === 'styleless',
    )
    expect(styleless.map(({ name }) => name).sort()).toEqual(['in-view', 'presence'])
    const allScopes = new Set(cssFiles.flatMap((file) => [...scopesIn(readStyle(file))]))
    for (const entry of styleless) {
      expect(entry.machine.kind, entry.name).toBe('public')
      expect(entry.presentation.baseline.mode, entry.name).toBe('styleless')
      expect(entry.presentation.registryTailwind.mode, entry.name).toBe('styleless')
      expect(entry.copiedArtifacts, entry.name).toEqual([])
      expect(allScopes.has(entry.name), `${entry.name} has a baseline selector`).toBe(false)
      expect(existsSync(resolve(ROOT, `registry/llui/ui/${entry.name}.ts`)), entry.name).toBe(false)
      // The rationale must name its composition example, and the example
      // must exist as a tested module.
      if (entry.presentation.baseline.mode === 'styleless') {
        expect(entry.presentation.baseline.rationale, entry.name).toMatch(/behaviou?r-only/i)
        expect(entry.presentation.baseline.rationale, entry.name).toMatch(/composition example/i)
      }
    }
    const compositions = readFileSync(
      resolve(import.meta.dirname, 'specialized-tools-compositions.ts'),
      'utf8',
    )
    expect(compositions).toMatch(/export function lazyQrCodeInView\b/)
    expect(compositions).toMatch(/export function presenceClipboardConfirmation\b/)
    expect(existsSync(resolve(import.meta.dirname, 'specialized-tools-compositions.test.ts'))).toBe(
      true,
    )
  })

  it('ships ONE baseline family module whose scopes are exactly the styled/partial baseline set', () => {
    const expected = family
      .filter(({ presentation }) => ['styled', 'partial'].includes(presentation.baseline.mode))
      .map(({ name }) => name)
      .sort()
    const baseline = readStyle(FAMILY_CSS)
    // `wizard` is the one exception, and it is structural: every part it
    // publishes is `data-scope="steps"`, whose rules the navigation-data family
    // owns (#264), and its actions take the foundation `.btn` classes. It owns
    // no scope to put here — which is exactly what its `partial` rationale says.
    expect(expected).toContain('wizard')
    expect([...scopesIn(baseline)].sort()).toEqual(expected.filter((name) => name !== 'wizard'))
    expect(scopesIn(baseline).has('steps')).toBe(false)
    // No OTHER baseline module styles a family scope.
    for (const file of cssFiles.filter((candidate) => candidate !== FAMILY_CSS)) {
      const leaked = [...scopesIn(readStyle(file))].filter((scope) =>
        (SPECIALIZED_TOOLS_PRODUCT_IDS as readonly string[]).includes(scope),
      )
      expect(leaked, `${file} styles specialized-tools scopes`).toEqual([])
    }
    // The complete theme imports it.
    expect(stripComments(readStyle('theme.css'))).toContain(`@import './${FAMILY_CSS}';`)
  })

  it('backs every visually available registry path with copied source that exists', () => {
    for (const entry of family) {
      const mode = entry.presentation.registryTailwind.mode
      if (mode === 'styled' || mode === 'partial') {
        expect(entry.copiedArtifacts.length, entry.name).toBeGreaterThan(0)
        for (const artifact of entry.copiedArtifacts) {
          expect(
            existsSync(resolve(ROOT, `registry/llui/ui/${artifact.name}.ts`)),
            `${entry.name}: registry/llui/ui/${artifact.name}.ts`,
          ).toBe(true)
        }
      }
    }
  })

  it('compiles the family catalog with the exact inventory (zero missing, zero stale)', () => {
    expect(Object.keys(SPECIALIZED_TOOLS_DEFINITIONS).sort()).toEqual(
      family.map(({ scenarioId }) => scenarioId).sort(),
    )
    expect(
      compiledCatalog()
        .scenarios.map(({ productId }) => productId)
        .sort(),
    ).toEqual(family.map(({ name }) => name).sort())
    const { 'component:qr-code': _omitted, ...missing } = SPECIALIZED_TOOLS_DEFINITIONS
    expect(() => decodeScenarioFamily(contract, 'specialized-tools', missing)).toThrow(
      /missing definition for product/i,
    )
  })

  it('derives renderer applicability from the contract modes only', () => {
    for (const path of ['baseline', 'registryTailwind'] as const) {
      const expected = family
        .filter(({ presentation }) =>
          ['styled', 'partial', 'composed'].includes(presentation[path].mode),
        )
        .map(({ name }) => name)
        .sort()
      expect(
        applicableSpecializedToolsScenarios(joinedScenarios(), path)
          .map(({ productId }) => productId)
          .sort(),
        path,
      ).toEqual(expected)
    }
  })

  it('declares the complex state matrix of every product as named cases', () => {
    for (const [productId, required] of Object.entries(REQUIRED_STATE_CASES)) {
      const scenario = joinedScenarios().find((candidate) => candidate.productId === productId)
      expect(scenario, productId).toBeDefined()
      const caseIds = scenario!.cases.map(({ id }) => id)
      for (const id of required) expect(caseIds, `${productId} case ${id}`).toContain(id)
    }
  })

  it('keeps every case stable, unique and labelled, with a real default', () => {
    for (const scenario of compiledCatalog().scenarios) {
      const ids = scenario.cases.map(({ id }) => id)
      expect(new Set(ids).size, scenario.productId).toBe(ids.length)
      expect(ids, scenario.productId).toContain(scenario.defaultCaseId)
      for (const scenarioCase of scenario.cases) {
        expect(scenarioCase.label.trim()).not.toBe('')
      }
    }
  })

  it('is deterministic: no clock, randomness, network or generated identity in any input', () => {
    const serialized = JSON.stringify(SPECIALIZED_TOOLS_DEFINITIONS)
    expect(serialized).not.toMatch(/https?:|\/\/|Date\.now|Math\.random|uuid|crypto/i)
    // Scenario data must be JSON: a round trip is an identity.
    expect(JSON.parse(serialized)).toEqual(SPECIALIZED_TOOLS_DEFINITIONS)
    // Every date-valued field is a pinned, real ISO calendar date. (`input`
    // is deliberately excluded: it is the raw text a user TYPED, and the
    // date-input `invalid` case types an impossible date on purpose.)
    const DATE_FIELDS = new Set(['value', 'start', 'end', 'min', 'max', 'today', 'unavailable'])
    const dates: string[] = []
    JSON.parse(serialized, (key: string, value: unknown) => {
      const collect = (candidate: unknown): void => {
        if (typeof candidate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
          dates.push(candidate)
        }
      }
      if (DATE_FIELDS.has(key)) {
        if (Array.isArray(value)) (value as unknown[]).forEach(collect)
        else collect(value)
      }
      return value
    })
    expect(dates.length).toBeGreaterThan(10)
    for (const date of dates) {
      const [y, m, d] = date.split('-').map(Number) as [number, number, number]
      const parsed = new Date(Date.UTC(y, m - 1, d))
      expect(parsed.toISOString().slice(0, 10), date).toBe(date)
    }
    // The module that owns the data reads no clock and draws no random value.
    const source = readFileSync(
      resolve(import.meta.dirname, 'specialized-tools-scenarios.ts'),
      'utf8',
    )
    expect(stripComments(source)).not.toMatch(
      /Date\.now\(|new Date\(|Math\.random\(|performance\.now\(/,
    )
  })

  it('declares an RTL-capable case for every directional product', () => {
    const withDirection = new Set(scenarioEnvironmentProductIds(joinedScenarios(), 'direction'))
    for (const productId of DIRECTIONAL_PRODUCT_IDS) {
      expect(withDirection.has(productId), productId).toBe(true)
    }
  })

  it('declares a reduced-motion-capable case for every product with motion', () => {
    const withMotion = new Set(scenarioEnvironmentProductIds(joinedScenarios(), 'motion'))
    for (const productId of MOTION_PRODUCT_IDS) {
      expect(withMotion.has(productId), productId).toBe(true)
    }
  })

  it('pairs every forced-colors-capable product with a concrete non-colour cue', () => {
    const forced = scenarioEnvironmentProductIds(joinedScenarios(), 'forcedColors')
    // Exact, both directions: no forced-colors case without a named cue, and
    // no cue for a product that never renders under forced colors.
    expect([...new Set(forced)].sort()).toEqual(Object.keys(FORCED_COLOR_CUES).sort())
    for (const productId of forced) {
      const cue = FORCED_COLOR_CUES[productId as keyof typeof FORCED_COLOR_CUES]
      expect(cue, productId).toBeTruthy()
    }
  })

  it('states input-modality parity for every product the ticket gave a new modality', () => {
    for (const productId of [
      'date-picker',
      'image-cropper',
      'floating-panel',
      'sortable',
      'splitter',
      'signature-pad',
      'file-upload',
      'clipboard',
    ] as const) {
      const parity = INPUT_MODALITY_PARITY[productId]
      expect(parity, productId).toBeDefined()
      expect(parity!.keyboard.trim()).not.toBe('')
      expect(parity!.pointerTouch.trim()).not.toBe('')
      expect(parity!.assistiveTech.trim()).not.toBe('')
    }
  })
})
