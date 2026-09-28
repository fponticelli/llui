import { afterEach, describe, expect, it, vi } from 'vitest'
import { GALLERY_DOCUMENT_MESSAGE_TYPE } from '@llui/cli/gallery'
import {
  bindScenarioAdapters,
  type PresentationScenarioJsonSnapshot,
} from '@llui/cli/presentation-scenarios'
import type { PresentationFamily } from '@llui/cli'
import { GALLERY_CATALOGS } from '../src/shared/catalogs'
import {
  bootGalleryDocument,
  type GalleryAdapterBinding,
  type GalleryDocumentHandle,
  type GalleryRenderContext,
  type PathDocumentOptions,
} from '../src/shared/document'
import { isGalleryDocumentMessage } from '../src/shared/document-protocol'

let handle: GalleryDocumentHandle | undefined
afterEach(() => {
  handle?.dispose()
  handle = undefined
  document.body.replaceChildren()
  for (const name of [...document.documentElement.getAttributeNames()]) {
    if (name !== 'lang') document.documentElement.removeAttribute(name)
  }
  vi.restoreAllMocks()
})

const drawn: { scenarioId: string; caseId: string; environment: unknown; artifacts: unknown }[] = []
type RecordingAdapter = (
  host: HTMLElement,
  input: PresentationScenarioJsonSnapshot,
  ctx: GalleryRenderContext,
) => { dispose(): void }
type RecordingMap = Readonly<Record<string, RecordingAdapter>>

const recording: RecordingAdapter = (host, _input, ctx) => {
  drawn.push({
    scenarioId: ctx.scenarioId,
    caseId: ctx.caseId,
    environment: ctx.environment,
    artifacts: ctx.copiedArtifactNames,
  })
  host.append(Object.assign(document.createElement('p'), { textContent: 'drawn' }))
  return { dispose: () => host.replaceChildren() }
}

/** Bind each family's share of `map` (the keys its catalog owns) to that family's catalog. */
function loaders(map: RecordingMap): PathDocumentOptions['adapters'] {
  const load = (family: PresentationFamily) => () => {
    const catalog = GALLERY_CATALOGS.find((candidate) => candidate.family === family)!
    const owned = new Set(catalog.scenarios.map(({ scenarioId }) => scenarioId))
    const binding: GalleryAdapterBinding = bindScenarioAdapters(
      catalog,
      Object.fromEntries(Object.entries(map).filter(([scenarioId]) => owned.has(scenarioId))),
    )
    return Promise.resolve(binding)
  }
  return {
    'forms-controls': load('forms-controls'),
    'navigation-data': load('navigation-data'),
    'menus-overlays': load('menus-overlays'),
    'specialized-tools': load('specialized-tools'),
  }
}

async function boot(
  search: string,
  map: RecordingMap,
  path: PathDocumentOptions['path'] = 'baseline',
): Promise<{ root: HTMLElement; status: string }> {
  window.history.replaceState(null, '', `/${search}`)
  const root = document.createElement('main')
  document.body.append(root)
  drawn.length = 0
  handle = bootGalleryDocument({ path, root, adapters: loaders(map) })
  const status = await handle.settled
  return { root, status }
}

const html = () => document.documentElement

describe('a gallery path document (#267)', () => {
  it('renders one resolved case through its adapter and reports ready', async () => {
    const { root, status } = await boot('?entry=accordion&case=closed&dir=rtl', {
      'component:accordion': recording,
    })
    expect(status).toBe('ready')
    expect(html().getAttribute('data-gallery-status')).toBe('ready')
    expect(drawn).toEqual([
      {
        scenarioId: 'component:accordion',
        caseId: 'closed',
        environment: {
          theme: 'light',
          direction: 'rtl',
          motion: 'full',
          viewport: 'wide',
          forcedColors: 'none',
        },
        artifacts: undefined,
      },
    ])
    const host = root.querySelector('#gallery-scenario')
    expect(host?.getAttribute('data-scenario-product')).toBe('accordion')
    expect(host?.getAttribute('data-scenario-case')).toBe('closed')
    expect(html().getAttribute('dir')).toBe('rtl')
    expect(document.title).toBe('Accordion — Closed item · Baseline theme')
  })

  it('resolves an alias and narrows the render to its copied artifact', async () => {
    await boot('?entry=sheet', { 'component:drawer': recording }, 'registryTailwind')
    expect(drawn[0]).toMatchObject({ scenarioId: 'component:drawer', artifacts: ['sheet'] })
  })

  it('lists what the path renders when no entry is named', async () => {
    const { root, status } = await boot('', {})
    expect(status).toBe('ready')
    const index = root.querySelector('[data-gallery-index="baseline"]')
    expect(index?.textContent).toContain('Accordion')
    // `button` is registry-only.
    expect(index?.textContent).not.toMatch(/\bButton\b —/)
  })

  it.each([
    ['?entry=nope', 'unknown-entry'],
    ['?entry=button', 'not-rendered'],
    ['?entry=accordion&case=exploded', 'invalid-selection'],
    ['?entry=accordion&case=closed&theme=dark', 'invalid-selection'],
    ['?entry=accordion', 'missing-renderer'],
  ])('reports %s as %s with an alert', async (search, code) => {
    const { root, status } = await boot(search, {})
    expect(status).toBe('error')
    expect(html().dataset.galleryError).toBe(code)
    expect(root.querySelector(`[role="alert"][data-gallery-error="${code}"]`)).not.toBeNull()
  })

  it('reports a renderer that throws while mounting', async () => {
    const { root, status } = await boot('?entry=accordion', {
      'component:accordion': () => {
        throw new Error('boom')
      },
    })
    expect(status).toBe('error')
    expect(html().dataset.galleryError).toBe('renderer-failed')
    expect(root.textContent).toContain('boom')
  })

  it('posts every status change to a framing parent on its own origin', async () => {
    const parent = { postMessage: vi.fn() }
    vi.spyOn(window, 'parent', 'get').mockReturnValue(parent as unknown as Window)
    await boot('?entry=accordion&case=open', { 'component:accordion': recording })
    const messages = parent.postMessage.mock.calls.map(([message, origin]) => {
      expect(origin).toBe(window.location.origin)
      expect(isGalleryDocumentMessage(message)).toBe(true)
      return message as { type: string; status: string; entry: string; caseId: string }
    })
    expect(messages.map(({ status }) => status)).toEqual(['loading', 'ready'])
    expect(messages[1]).toMatchObject({
      type: GALLERY_DOCUMENT_MESSAGE_TYPE,
      entry: 'accordion',
      caseId: 'open',
      path: 'baseline',
    })
  })

  it('rejects foreign messages', () => {
    expect(isGalleryDocumentMessage({ type: 'other' })).toBe(false)
    expect(
      isGalleryDocumentMessage({
        type: GALLERY_DOCUMENT_MESSAGE_TYPE,
        path: 'tailwind',
        href: 'x',
        status: 'ready',
      }),
    ).toBe(false)
  })
})
