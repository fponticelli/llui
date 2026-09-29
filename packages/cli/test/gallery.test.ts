import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ProductContractSchema } from '../src/product-contract.js'
import {
  GALLERY_DOCUMENT_READY_ATTRIBUTE,
  GALLERY_PATH_LABELS,
  GALLERY_PATH_SEGMENTS,
  GALLERY_QUERY_KEYS,
  GalleryLinkError,
  PUBLIC_GALLERY_BASE,
  formatGalleryQuery,
  galleryDocumentHref,
  galleryHref,
  galleryPathFromSegment,
  parseGalleryQuery,
  resolveGalleryEntry,
  type GalleryLocation,
} from '../src/gallery.js'
import type { CompiledPresentationScenarioFamily } from '../src/presentation-scenarios.js'

const REPO = resolve(import.meta.dirname, '../../..')
const contract = ProductContractSchema.parse(
  (
    JSON.parse(readFileSync(resolve(REPO, 'registry/registry.json'), 'utf8')) as {
      productContract: unknown
    }
  ).productContract,
)

describe('gallery path vocabulary', () => {
  it('names the two paths with their user-facing labels and URL segments', () => {
    expect(GALLERY_PATH_LABELS).toEqual({
      baseline: 'Baseline theme',
      registryTailwind: 'Registry skins',
    })
    expect(GALLERY_PATH_SEGMENTS).toEqual({ baseline: 'baseline', registryTailwind: 'registry' })
    expect(galleryPathFromSegment('registry')).toBe('registryTailwind')
    expect(galleryPathFromSegment('baseline')).toBe('baseline')
    expect(galleryPathFromSegment('registryTailwind')).toBeUndefined()
    expect(galleryPathFromSegment('')).toBeUndefined()
  })

  it('publishes the document-ready attribute headless drivers wait on', () => {
    expect(GALLERY_DOCUMENT_READY_ATTRIBUTE).toBe('data-gallery-status')
  })

  it('publishes the site-relative public base', () => {
    expect(PUBLIC_GALLERY_BASE).toBe('/apps/component-gallery/')
  })
})

describe('formatGalleryQuery / parseGalleryQuery', () => {
  it('formats the empty location as no query at all', () => {
    expect(formatGalleryQuery({})).toBe('')
  })

  it('writes keys in one canonical order regardless of object order', () => {
    const location: GalleryLocation = {
      environment: { viewport: 'narrow', theme: 'dark', direction: 'rtl' },
      caseId: 'disabled',
      entry: 'checkbox',
      path: 'registryTailwind',
      view: 'compare',
    }
    expect(formatGalleryQuery(location)).toBe(
      '?entry=checkbox&path=registry&view=compare&case=disabled&theme=dark&dir=rtl&viewport=narrow',
    )
  })

  it('omits canonical default environment values so one state has one URL', () => {
    expect(
      formatGalleryQuery({
        entry: 'tabs',
        environment: {
          theme: 'light',
          direction: 'ltr',
          motion: 'full',
          viewport: 'wide',
          forcedColors: 'none',
        },
        view: 'single',
      }),
    ).toBe('?entry=tabs')
  })

  it('encodes free text and round-trips every field', () => {
    const location: GalleryLocation = {
      entry: 'date-picker',
      path: 'registryTailwind',
      view: 'compare',
      caseId: 'two-months',
      copiedArtifact: 'calendar',
      environment: {
        theme: 'dark',
        direction: 'rtl',
        motion: 'reduced',
        viewport: 'narrow',
        forcedColors: 'active',
      },
      query: 'date & time?',
      category: 'forms',
    }
    const query = formatGalleryQuery(location)
    expect(query).toContain('q=date%20%26%20time%3F')
    expect(parseGalleryQuery(query)).toEqual({ location, issues: [] })
  })

  it('accepts a query with or without its leading question mark', () => {
    expect(parseGalleryQuery('entry=menu').location).toEqual({ entry: 'menu' })
    expect(parseGalleryQuery('?entry=menu').location).toEqual({ entry: 'menu' })
  })

  it('drops and reports invalid values instead of throwing', () => {
    const parsed = parseGalleryQuery(
      '?entry=Menu!&path=registryTailwind&view=grid&theme=sepia&dir=up&category=widgets&case=Bad Case&artifact=%20',
    )
    expect(parsed.location).toEqual({})
    expect(parsed.issues).toEqual([
      'artifact: invalid value " "',
      'case: invalid value "Bad Case"',
      'category: invalid value "widgets"',
      'dir: invalid value "up"',
      'entry: invalid value "Menu!"',
      'path: invalid value "registryTailwind"',
      'theme: invalid value "sepia"',
      'view: invalid value "grid"',
    ])
  })

  it('reports a repeated key and keeps its first value', () => {
    const parsed = parseGalleryQuery('?entry=menu&entry=tabs')
    expect(parsed.location).toEqual({ entry: 'menu' })
    expect(parsed.issues).toEqual(['entry: repeated; the first value was used'])
  })

  it('ignores unknown keys silently so foreign query parameters survive', () => {
    expect(parseGalleryQuery('?utm_source=x&entry=menu')).toEqual({
      location: { entry: 'menu' },
      issues: [],
    })
  })

  it('keeps the query key vocabulary stable (it is a public URL contract)', () => {
    expect(GALLERY_QUERY_KEYS).toEqual({
      entry: 'entry',
      path: 'path',
      view: 'view',
      caseId: 'case',
      copiedArtifact: 'artifact',
      query: 'q',
      category: 'category',
      theme: 'theme',
      direction: 'dir',
      motion: 'motion',
      viewport: 'viewport',
      forcedColors: 'forced',
    })
  })
})

describe('resolveGalleryEntry', () => {
  it('resolves a canonical name', () => {
    const resolved = resolveGalleryEntry(contract, 'accordion')
    expect(resolved?.canonical.name).toBe('accordion')
    expect(resolved?.alias).toBeUndefined()
    expect(resolved?.copiedArtifact).toBeUndefined()
  })

  it('resolves every alias to its canonical entry and names the copied artifact', () => {
    expect(contract.aliases.length).toBeGreaterThan(0)
    for (const alias of contract.aliases) {
      const resolved = resolveGalleryEntry(contract, alias.name)
      expect(resolved?.canonical.name, alias.name).toBe(alias.canonicalName)
      expect(resolved?.alias?.name, alias.name).toBe(alias.name)
      expect(resolved?.copiedArtifact, alias.name).toBe(alias.name)
    }
  })

  it('resolves a copied-artifact name that is neither canonical nor an alias', () => {
    const resolved = resolveGalleryEntry(contract, 'sheet')
    expect(resolved?.canonical.name).toBe('drawer')
    expect(resolved?.alias).toBeUndefined()
    expect(resolved?.copiedArtifact).toBe('sheet')
  })

  it('returns undefined for an unknown name', () => {
    expect(resolveGalleryEntry(contract, 'no-such-thing')).toBeUndefined()
  })
})

describe('galleryHref', () => {
  it('gives every canonical entry a stable, base-relative URL', () => {
    for (const entry of contract.entries) {
      expect(galleryHref(contract, entry.name)).toBe(`${PUBLIC_GALLERY_BASE}?entry=${entry.name}`)
    }
  })

  it('canonicalizes an alias and targets its copied artifact on the registry path', () => {
    expect(galleryHref(contract, 'dropdown-menu')).toBe(
      `${PUBLIC_GALLERY_BASE}?entry=menu&path=registry&artifact=dropdown-menu`,
    )
    expect(galleryHref(contract, 'sheet', { base: 'https://llui.dev/g/' })).toBe(
      'https://llui.dev/g/?entry=drawer&path=registry&artifact=sheet',
    )
  })

  it('carries path, case, view and environment', () => {
    expect(
      galleryHref(contract, 'checkbox', {
        base: './',
        path: 'baseline',
        caseId: 'disabled',
        view: 'compare',
        environment: { direction: 'rtl' },
      }),
    ).toBe('./?entry=checkbox&path=baseline&view=compare&case=disabled&dir=rtl')
  })

  it('refuses an unknown entry', () => {
    expect(() => galleryHref(contract, 'nope')).toThrow(GalleryLinkError)
    try {
      galleryHref(contract, 'nope')
    } catch (error) {
      expect((error as GalleryLinkError).code).toBe('unknown-entry')
    }
  })

  it('refuses a path the contract marks not applicable', () => {
    // `button` is registry-only: its baseline presentation is not-applicable.
    expect(() => galleryHref(contract, 'button', { path: 'baseline' })).toThrow(/not applicable/)
  })

  it('refuses an invalid identifier or environment value', () => {
    expect(() => galleryHref(contract, 'button', { caseId: 'Not A Case' })).toThrow(
      GalleryLinkError,
    )
    expect(() =>
      galleryHref(contract, 'button', {
        environment: { theme: 'sepia' as 'dark' },
      }),
    ).toThrow(GalleryLinkError)
  })

  it('validates case and axes against a catalog when one is supplied', () => {
    const entry = contract.entries.find(({ name }) => name === 'accordion')!
    const catalog: CompiledPresentationScenarioFamily = {
      version: 1,
      family: 'navigation-data',
      scenarios: [
        {
          productId: 'accordion',
          scenarioId: entry.scenarioId,
          defaultCaseId: 'closed',
          cases: [
            { id: 'closed', label: 'Closed', input: null, environmentAxes: ['direction'] },
            { id: 'open', label: 'Open', input: null, environmentAxes: [] },
          ],
        },
      ],
    }
    expect(galleryHref(contract, 'accordion', { catalogs: [catalog], caseId: 'open' })).toBe(
      `${PUBLIC_GALLERY_BASE}?entry=accordion&case=open`,
    )
    expect(() =>
      galleryHref(contract, 'accordion', { catalogs: [catalog], caseId: 'missing' }),
    ).toThrow(/unknown case "missing"/)
    expect(() =>
      galleryHref(contract, 'accordion', {
        catalogs: [catalog],
        caseId: 'open',
        environment: { direction: 'rtl' },
      }),
    ).toThrow(/does not declare the "direction" axis/)
    // The DEFAULT case is what an omitted caseId resolves to, so axes are
    // checked against it.
    expect(
      galleryHref(contract, 'accordion', {
        catalogs: [catalog],
        environment: { direction: 'rtl' },
      }),
    ).toBe(`${PUBLIC_GALLERY_BASE}?entry=accordion&dir=rtl`)
  })
})

describe('galleryDocumentHref', () => {
  it('addresses one path document per entry, case and environment', () => {
    expect(
      galleryDocumentHref({
        path: 'registryTailwind',
        entry: 'drawer',
        caseId: 'left',
        copiedArtifact: 'sheet',
        environment: { direction: 'rtl', theme: 'dark' },
      }),
    ).toBe(
      `${PUBLIC_GALLERY_BASE}registry/?entry=drawer&case=left&artifact=sheet&theme=dark&dir=rtl`,
    )
    expect(galleryDocumentHref({ path: 'baseline', entry: 'tabs' }, { base: './' })).toBe(
      './baseline/?entry=tabs',
    )
  })

  it('never writes shell-only keys into a document URL', () => {
    const href = galleryDocumentHref({ path: 'baseline', entry: 'tabs' })
    expect(href).not.toMatch(/[?&](?:path|view|q|category)=/)
  })

  it('refuses a malformed entry or case', () => {
    expect(() => galleryDocumentHref({ path: 'baseline', entry: 'Tabs' })).toThrow(GalleryLinkError)
  })
})
