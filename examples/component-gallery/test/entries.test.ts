import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ProductContractSchema } from '@llui/cli'
import { ProductContractError } from '@llui/cli/product-contract'
import { GALLERY_CATALOGS } from '../src/shared/catalogs'
import {
  GALLERY_CONTRACT,
  GALLERY_CONTRACT_SOURCE,
  loadGalleryContract,
} from '../src/shared/contract'
import {
  GALLERY_CATEGORIES,
  GALLERY_ENTRIES,
  findGalleryEntry,
  searchEntries,
} from '../src/shell/entries'

const REPO = resolve(import.meta.dirname, '../../..')

describe('the gallery inventory is the contract (#267)', () => {
  it('reads the one canonical contract, which the authoritative schema accepts', () => {
    const manifest = JSON.parse(readFileSync(resolve(REPO, 'registry/registry.json'), 'utf8')) as {
      productContract: unknown
    }
    expect(ProductContractSchema.parse(manifest.productContract)).toEqual(GALLERY_CONTRACT)
  })

  it('refuses a malformed contract loudly, naming the source and the violating path', () => {
    const [first, ...rest] = GALLERY_CONTRACT.entries
    const malformed: unknown = {
      ...GALLERY_CONTRACT,
      entries: [{ ...first, scenarioId: 42 }, ...rest],
    }
    let thrown: unknown
    try {
      loadGalleryContract(malformed)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ProductContractError)
    if (!(thrown instanceof ProductContractError)) return
    expect(thrown.source).toBe(GALLERY_CONTRACT_SOURCE)
    expect(thrown.message).toContain(
      `Invalid ProductContract in registry/registry.json#productContract (1 issue):\n  - $.entries[0].scenarioId: `,
    )
    // …and the same loader accepts the real one unchanged.
    expect(loadGalleryContract(GALLERY_CONTRACT)).toEqual(GALLERY_CONTRACT)
  })

  it('has exactly one entry per canonical product — no more, no fewer', () => {
    expect(GALLERY_ENTRIES.map(({ name }) => name).sort()).toEqual(
      GALLERY_CONTRACT.entries.map(({ name }) => name).sort(),
    )
  })

  it('takes every case of every entry from its compiled family catalog, exactly', () => {
    const catalogCases = new Map(
      GALLERY_CATALOGS.flatMap(({ scenarios }) => scenarios).map((scenario) => [
        scenario.productId,
        { defaultCaseId: scenario.defaultCaseId, ids: scenario.cases.map(({ id }) => id) },
      ]),
    )
    expect([...catalogCases.keys()].sort()).toEqual(GALLERY_ENTRIES.map(({ name }) => name).sort())
    for (const entry of GALLERY_ENTRIES) {
      expect(
        { defaultCaseId: entry.defaultCaseId, ids: entry.cases.map(({ id }) => id) },
        entry.name,
      ).toEqual(catalogCases.get(entry.name))
    }
  })

  it('derives categories, aliases and copied artifacts from the contract', () => {
    expect(GALLERY_CATEGORIES.reduce((sum, { count }) => sum + count, 0)).toBe(
      GALLERY_CONTRACT.entries.length,
    )
    for (const alias of GALLERY_CONTRACT.aliases) {
      expect(findGalleryEntry(alias.canonicalName)?.aliases, alias.name).toContain(alias.name)
    }
    const drawer = findGalleryEntry('drawer')
    expect(drawer?.copiedArtifacts.map(({ name }) => name)).toEqual(['drawer', 'sheet'])
    expect(drawer?.copiedArtifacts[0]?.description).toMatch(/edge panel/)
  })

  it('explains what each path installs, honestly per coverage', () => {
    const button = findGalleryEntry('button')!
    expect(button.paths.baseline).toMatchObject({ mode: 'not-applicable', rendered: false })
    expect(button.paths.baseline.install).toEqual([])
    expect(button.paths.registryTailwind.install).toContain('pnpm exec llui add button')

    const accordion = findGalleryEntry('accordion')!
    expect(accordion.paths.baseline.install).toEqual([
      'pnpm add @llui/components @llui/dom',
      "import '@llui/components/styles/theme.css'",
      "import * as accordion from '@llui/components/accordion'",
    ])

    const searchField = findGalleryEntry('search-field')!
    expect(searchField.paths.baseline.rendered).toBe(false)
    expect(searchField.paths.baseline.install).not.toContain(
      "import '@llui/components/styles/theme.css'",
    )
  })
})

describe('searchEntries', () => {
  it('finds every canonical entry by its name and ranks it first', () => {
    for (const entry of GALLERY_ENTRIES) {
      expect(searchEntries(entry.name, undefined)[0]?.name, entry.name).toBe(entry.name)
    }
  })

  it('finds every alias and copied-artifact name', () => {
    for (const alias of GALLERY_CONTRACT.aliases) {
      expect(
        searchEntries(alias.name, undefined).map(({ name }) => name),
        alias.name,
      ).toContain(alias.canonicalName)
    }
    expect(searchEntries('sheet', undefined)[0]?.name).toBe('drawer')
  })

  it('requires every token and matches word prefixes', () => {
    expect(searchEntries('date pick', undefined)[0]?.name).toBe('date-picker')
    expect(searchEntries('dropdown', undefined)[0]?.name).toBe('menu')
    expect(searchEntries('zzz-nothing', undefined)).toEqual([])
  })

  it('filters by category', () => {
    const overlays = searchEntries('', 'overlays')
    expect(overlays.length).toBeGreaterThan(0)
    expect(overlays.every(({ category }) => category === 'overlays')).toBe(true)
  })
})
