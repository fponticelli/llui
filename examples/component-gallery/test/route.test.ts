import { describe, expect, it } from 'vitest'
import { formatGalleryQuery, parseGalleryQuery } from '@llui/cli/gallery'
import { GALLERY_CONTRACT } from '../src/shared/contract'
import { GALLERY_ENTRIES, findGalleryEntry } from '../src/shell/entries'
import { resolveRoute, type ResolvedRoute } from '../src/shell/route'

const route = (search: string) => {
  const parsed = parseGalleryQuery(search)
  return resolveRoute(parsed.location, parsed.issues)
}

function entryRoute(resolved: ResolvedRoute): Extract<ResolvedRoute, { kind: 'entry' }> {
  if (resolved.kind !== 'entry') throw new Error(`expected an entry route, got ${resolved.kind}`)
  return resolved
}

describe('resolveRoute', () => {
  it('resolves the bare gallery to the index and keeps browse parameters', () => {
    const resolved = route('?q=menu&category=overlays')
    expect(resolved.route).toEqual({ kind: 'index' })
    expect(resolved.canonical).toEqual({ query: 'menu', category: 'overlays' })
  })

  it('resolves every canonical entry stable URL to that entry and its default case', () => {
    for (const entry of GALLERY_ENTRIES) {
      const resolved = route(`?entry=${entry.name}`)
      const view = entryRoute(resolved.route)
      expect(view.entry).toBe(entry.name)
      expect(view.caseId).toBe(entry.defaultCaseId)
      expect(resolved.notices, entry.name).toEqual([])
      expect(formatGalleryQuery(resolved.canonical)).toBe(`?entry=${entry.name}`)
    }
  })

  it('canonicalizes an alias to its entry, registry path and artifact', () => {
    for (const alias of GALLERY_CONTRACT.aliases) {
      const resolved = route(`?entry=${alias.name}`)
      expect(entryRoute(resolved.route).entry).toBe(alias.canonicalName)
      expect(resolved.canonical).toMatchObject({
        entry: alias.canonicalName,
        path: 'registryTailwind',
        copiedArtifact: alias.name,
      })
    }
  })

  it('defaults to the baseline path, or the registry path when baseline draws nothing', () => {
    expect(entryRoute(route('?entry=accordion').route).path).toBe('baseline')
    expect(entryRoute(route('?entry=button').route).path).toBe('registryTailwind')
  })

  it('frames a path document only where the contract says the path draws the entry', () => {
    for (const entry of GALLERY_ENTRIES) {
      const view = entryRoute(route(`?entry=${entry.name}&view=compare`).route)
      expect(view.frames.map(({ path }) => path)).toEqual(['baseline', 'registryTailwind'])
      for (const frame of view.frames) {
        expect(frame.href !== undefined, `${entry.name} ${frame.path}`).toBe(
          entry.paths[frame.path].rendered,
        )
      }
    }
  })

  it('addresses the path document with the same case and environment', () => {
    const view = entryRoute(route('?entry=accordion&path=registry&case=closed&dir=rtl').route)
    expect(view.frames).toEqual([
      { path: 'registryTailwind', href: './registry/?entry=accordion&case=closed&dir=rtl' },
    ])
  })

  it('falls back to the default case, with a notice, for an unknown case', () => {
    const resolved = route('?entry=accordion&case=exploded')
    expect(entryRoute(resolved.route).caseId).toBe('closed')
    expect(resolved.notices).toEqual([
      '“Accordion” has no “exploded” scenario; showing the default scenario instead.',
    ])
    expect(formatGalleryQuery(resolved.canonical)).toBe('?entry=accordion')
  })

  it('drops an axis the case does not declare, with a notice', () => {
    // accordion/closed declares direction only.
    const resolved = route('?entry=accordion&dir=rtl&theme=dark')
    const view = entryRoute(resolved.route)
    expect(view.axes).toEqual(['direction'])
    expect(view.environment).toMatchObject({ direction: 'rtl', theme: 'light' })
    expect(resolved.notices).toEqual([
      'The “Closed item” scenario does not vary theme; Dark was ignored.',
    ])
    expect(formatGalleryQuery(resolved.canonical)).toBe('?entry=accordion&dir=rtl')
  })

  it('keeps a copied artifact only when the case can target it', () => {
    const datePicker = findGalleryEntry('date-picker')!
    const twoMonths = datePicker.cases.find(({ id }) => id === 'two-months')!
    expect(twoMonths.copiedArtifactNames).toEqual(['calendar'])
    const ok = route('?entry=date-picker&path=registry&case=two-months&artifact=calendar')
    expect(entryRoute(ok.route).copiedArtifact).toBe('calendar')
    const bad = route('?entry=date-picker&path=registry&case=two-months&artifact=date-picker')
    expect(entryRoute(bad.route).copiedArtifact).toBeUndefined()
    expect(bad.notices).toHaveLength(1)
  })

  it('reports an unknown entry with ranked suggestions', () => {
    const resolved = route('?entry=date-pickr')
    expect(resolved.route).toMatchObject({ kind: 'not-found', requested: 'date-pickr' })
    const suggestions = resolved.route.kind === 'not-found' ? resolved.route.suggestions : []
    expect(suggestions).toContain('date-picker')
  })

  it('turns invalid link parameters into notices instead of failing', () => {
    const resolved = route('?entry=tabs&theme=sepia')
    expect(entryRoute(resolved.route).entry).toBe('tabs')
    expect(resolved.notices).toEqual([
      'Ignored an invalid link parameter — theme: invalid value "sepia".',
    ])
  })
})
