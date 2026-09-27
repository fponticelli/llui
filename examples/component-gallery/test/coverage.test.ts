/**
 * Rendered coverage, as EXACT sets (#267): for each path, the entries the
 * gallery frames are exactly the contract's visually available entries, each
 * has an adapter in that path document's own renderer map, and every one of
 * their cases renders to `ready` through the real document glue and the
 * real adapters. Nothing here lists an entry or a case by hand.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PresentationScenarioPath } from '@llui/cli/presentation-scenarios'
import { BASELINE_ADAPTER_LOADERS } from '../src/baseline/adapters'
import { REGISTRY_ADAPTER_LOADERS } from '../src/registry/adapters'
import { GALLERY_CATALOGS } from '../src/shared/catalogs'
import { GALLERY_CONTRACT } from '../src/shared/contract'
import {
  bootGalleryDocument,
  type GalleryAdapterMap,
  type PathDocumentOptions,
} from '../src/shared/document'
import { GALLERY_ENTRIES } from '../src/shell/entries'
import { resolveRoute } from '../src/shell/route'
import { installFrozenIconify } from '../../../registry/test/specialized-tools-frozen-icons'

const LOADERS: Record<PresentationScenarioPath, PathDocumentOptions['adapters']> = {
  baseline: BASELINE_ADAPTER_LOADERS,
  registryTailwind: REGISTRY_ADAPTER_LOADERS,
}

const visual = (mode: string) => mode === 'styled' || mode === 'partial' || mode === 'composed'

let restoreIcons: () => void = () => {}
beforeAll(() => {
  restoreIcons = installFrozenIconify()
})
afterAll(() => restoreIcons())

describe.each(['baseline', 'registryTailwind'] as const)('%s rendered coverage', (path) => {
  const expected = GALLERY_CONTRACT.entries
    .filter(({ presentation }) => visual(presentation[path].mode))
    .map(({ name }) => name)
    .sort()

  it('frames exactly the visually available entries', () => {
    const framed = GALLERY_ENTRIES.filter((entry) => {
      const { route } = resolveRoute({ entry: entry.name, path })
      return route.kind === 'entry' && route.frames.some((frame) => frame.href !== undefined)
    }).map(({ name }) => name)
    expect(framed.sort()).toEqual(expected)
    expect(expected.length).toBeGreaterThan(40)
  })

  it('binds an adapter to each of them, and to nothing outside the contract', async () => {
    const maps: GalleryAdapterMap[] = await Promise.all(
      Object.values(LOADERS[path]).map((load) => load()),
    )
    const bound = new Set(maps.flatMap((map) => Object.keys(map)))
    const scenarioIds = new Map(
      GALLERY_CONTRACT.entries.map((entry) => [entry.name, entry.scenarioId]),
    )
    for (const name of expected) {
      expect(bound.has(scenarioIds.get(name)!), `${name} on ${path}`).toBe(true)
    }
    const known = new Set(scenarioIds.values())
    expect([...bound].filter((id) => !known.has(id))).toEqual([])
  })

  it('renders every case of every framed entry to ready through the document', async () => {
    const failures: string[] = []
    let rendered = 0
    for (const name of expected) {
      const scenario = GALLERY_CATALOGS.flatMap(({ scenarios }) => scenarios).find(
        ({ productId }) => productId === name,
      )!
      for (const scenarioCase of scenario.cases) {
        window.history.replaceState(null, '', `/?entry=${name}&case=${scenarioCase.id}`)
        const root = document.createElement('main')
        document.body.append(root)
        const handle = bootGalleryDocument({ path, root, adapters: LOADERS[path] })
        const status = await handle.settled
        if (status !== 'ready') {
          failures.push(
            `${name}/${scenarioCase.id}: ${document.documentElement.dataset.galleryError} ${root.textContent}`,
          )
        }
        rendered += 1
        handle.dispose()
        document.body.replaceChildren()
      }
    }
    expect(failures).toEqual([])
    expect(rendered).toBe(
      GALLERY_CATALOGS.flatMap(({ scenarios }) => scenarios)
        .filter(({ productId }) => expected.includes(productId))
        .reduce((sum, { cases }) => sum + cases.length, 0),
    )
  })
})
