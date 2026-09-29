/**
 * Boot glue for ONE path document: read the gallery query, resolve it
 * through the scenario protocol, hand the resolved case to that path's own
 * adapter, and report the outcome. It owns no styling and no renderer — each
 * path document passes its adapters in, so the two renderers never meet.
 *
 * A document is addressable on its own (`?entry=…&case=…&theme=…`, the
 * `@llui/cli/gallery` vocabulary); with no `entry` it lists what this path
 * can draw, so a standalone path build is still directly usable.
 */
import {
  GALLERY_DOCUMENT_MESSAGE_TYPE,
  GALLERY_DOCUMENT_READY_ATTRIBUTE,
  GALLERY_PATH_LABELS,
  formatGalleryQuery,
  parseGalleryQuery,
  resolveGalleryEntry,
  type GalleryLocation,
} from '@llui/cli/gallery'
import {
  PresentationScenarioError,
  type PresentationScenarioAdapterBinding,
  type PresentationScenarioAdapterContext,
  type PresentationScenarioEnvironment,
  type PresentationScenarioPath,
} from '@llui/cli/presentation-scenarios'
import { GALLERY_CATALOGS, catalogFor, isVisuallyAvailable, scenarioFor } from './catalogs'
import { GALLERY_CONTRACT } from './contract'
import type { PresentationFamily } from '@llui/cli'
import type {
  GalleryDocumentErrorCode,
  GalleryDocumentMessage,
  GalleryDocumentStatus,
} from './document-protocol'

/** What the gallery tells an adapter beyond the protocol's own context. */
export interface GalleryAdapterExtra {
  /** Copied artifacts this render is narrowed to (registry path only). */
  readonly copiedArtifactNames: readonly string[] | undefined
}

export type GalleryRenderContext = PresentationScenarioAdapterContext & GalleryAdapterExtra

/**
 * One family's renderer for this path: its TYPED adapter map bound to its
 * TYPED catalog (`bindScenarioAdapters`), exposed through the protocol's
 * family-agnostic binding. The binding resolves the selection itself and
 * hands each adapter the input it was type-checked against, so no adapter's
 * input is ever erased by a cast at this boundary.
 */
export type GalleryAdapterBinding = PresentationScenarioAdapterBinding<
  HTMLElement,
  { dispose(): void },
  GalleryAdapterExtra
>

export interface PathDocumentOptions {
  readonly path: PresentationScenarioPath
  /**
   * One lazy loader per presentation family, so a document downloads only the
   * renderer for the family of the scenario it was asked for.
   */
  readonly adapters: Readonly<Record<PresentationFamily, () => Promise<GalleryAdapterBinding>>>
  readonly root: HTMLElement
}

class DocumentFailure extends Error {
  constructor(
    readonly code: GalleryDocumentErrorCode,
    message: string,
  ) {
    super(message)
  }
}

function applyEnvironment(environment: PresentationScenarioEnvironment): void {
  const html = document.documentElement
  html.setAttribute('dir', environment.direction)
  html.dataset.theme = environment.theme
  html.dataset.motion = environment.motion
  html.dataset.viewport = environment.viewport
  html.dataset.forcedColors = environment.forcedColors
  html.style.colorScheme = environment.theme
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value)
  node.append(...children)
  return node
}

export interface GalleryDocumentHandle {
  /** Resolves with the first settled status (`ready` or `error`). */
  readonly settled: Promise<GalleryDocumentStatus>
  /** Unmount the scenario and stop listening (tests; a page just navigates). */
  dispose(): void
}

export function bootGalleryDocument(options: PathDocumentOptions): GalleryDocumentHandle {
  const { path, adapters, root } = options
  const html = document.documentElement
  const pathLabel = GALLERY_PATH_LABELS[path]
  html.dataset.galleryPath = path
  const parsed = parseGalleryQuery(window.location.search)
  const location = parsed.location
  let handle: { dispose(): void } | undefined
  let disposed = false
  let settle: (status: GalleryDocumentStatus) => void = () => {}
  const settled = new Promise<GalleryDocumentStatus>((resolve) => {
    settle = resolve
  })

  const report = (
    status: GalleryDocumentStatus,
    detail: { code?: GalleryDocumentErrorCode; message?: string } = {},
  ): void => {
    html.setAttribute(GALLERY_DOCUMENT_READY_ATTRIBUTE, status)
    if (status !== 'loading') settle(status)
    if (detail.code === undefined) delete html.dataset.galleryError
    else html.dataset.galleryError = detail.code
    if (window.parent === window) return
    const message: GalleryDocumentMessage = {
      type: GALLERY_DOCUMENT_MESSAGE_TYPE,
      path,
      href: window.location.href,
      status,
      ...(location.entry === undefined ? {} : { entry: location.entry }),
      ...(location.caseId === undefined ? {} : { caseId: location.caseId }),
      ...detail,
    }
    window.parent.postMessage(message, window.location.origin)
  }

  const fail = (code: GalleryDocumentErrorCode, message: string): void => {
    handle?.dispose()
    handle = undefined
    document.title = `Cannot render · ${pathLabel}`
    root.replaceChildren(
      element('section', { role: 'alert', 'data-gallery-error': code }, [
        element('h1', {}, [`${pathLabel} could not render this scenario`]),
        element('p', {}, [message]),
        element('p', {}, [element('a', { href: './' }, ['List everything this path renders'])]),
      ]),
    )
    report('error', { code, message })
  }

  report('loading')
  // A failure AFTER mount (a handler throwing on interaction) is still a
  // renderer failure; the content stays, the status says so.
  const onError = (event: ErrorEvent): void => {
    report('error', { code: 'renderer-failed', message: String(event.message) })
  }
  window.addEventListener('error', onError)
  const documentHandle: GalleryDocumentHandle = {
    settled,
    dispose: () => {
      disposed = true
      window.removeEventListener('error', onError)
      handle?.dispose()
      handle = undefined
    },
  }

  if (location.entry === undefined) {
    renderIndex(root, path)
    document.title = `${pathLabel} · Component Gallery`
    report('ready')
    return documentHandle
  }

  mountScenario(root, path, adapters, location).then(
    (mounted) => {
      if (disposed) {
        mounted.handle.dispose()
        return
      }
      handle = mounted.handle
      document.title = mounted.title
      // Let the adapter's first commit and any microtask-scheduled work
      // settle before declaring the scenario ready. Not
      // `requestAnimationFrame`: it never fires in a hidden tab, which is
      // where headless drivers run.
      setTimeout(() => {
        if (html.getAttribute(GALLERY_DOCUMENT_READY_ATTRIBUTE) === 'loading') report('ready')
      }, 0)
    },
    (error: unknown) => {
      if (error instanceof DocumentFailure) fail(error.code, error.message)
      else if (error instanceof PresentationScenarioError) fail('invalid-selection', error.message)
      else fail('renderer-failed', error instanceof Error ? error.message : String(error))
    },
  )
  return documentHandle
}

async function mountScenario(
  root: HTMLElement,
  path: PresentationScenarioPath,
  loaders: PathDocumentOptions['adapters'],
  location: GalleryLocation,
): Promise<{ handle: { dispose(): void }; title: string }> {
  const requested = location.entry!
  const resolvedEntry = resolveGalleryEntry(GALLERY_CONTRACT, requested)
  if (resolvedEntry === undefined) {
    throw new DocumentFailure('unknown-entry', `No gallery entry is named "${requested}".`)
  }
  const entry = resolvedEntry.canonical
  const coverage = entry.presentation[path]
  if (!isVisuallyAvailable(coverage.mode)) {
    throw new DocumentFailure(
      'not-rendered',
      `${entry.displayName} has no ${GALLERY_PATH_LABELS[path]} rendering (${coverage.mode})${
        'rationale' in coverage ? `: ${coverage.rationale}` : '.'
      }`,
    )
  }
  const catalog = catalogFor(entry.name)
  const scenario = scenarioFor(entry.name)
  if (catalog === undefined || scenario === undefined) {
    throw new DocumentFailure('missing-renderer', `No scenario catalog declares ${entry.name}.`)
  }
  const copiedArtifact =
    path === 'registryTailwind'
      ? (location.copiedArtifact ??
        (resolvedEntry.copiedArtifact !== entry.name ? resolvedEntry.copiedArtifact : undefined))
      : undefined
  const binding = await loaders[entry.presentation.family]()
  // The binding resolves against its own TYPED catalog (the protocol still
  // validates the selection at runtime), then requires an adapter for the
  // scenario — in that order, so a bad selection is reported as such even
  // when the path also has no renderer for it.
  let prepared
  try {
    prepared = binding.prepare(GALLERY_CONTRACT, {
      productId: entry.name,
      path,
      ...(location.caseId === undefined ? {} : { caseId: location.caseId }),
      ...(location.environment === undefined ? {} : { environment: location.environment }),
      ...(copiedArtifact === undefined ? {} : { copiedArtifact }),
    })
  } catch (error) {
    if (error instanceof PresentationScenarioError && error.code === 'missing-adapter') {
      throw new DocumentFailure(
        'missing-renderer',
        `The ${GALLERY_PATH_LABELS[path]} document has no renderer for ${scenario.scenarioId}.`,
      )
    }
    throw error
  }
  const resolved = prepared.selection
  applyEnvironment(resolved.environment)
  const host = element('section', {
    id: 'gallery-scenario',
    'data-scenario-renderer': path,
    'data-scenario-product': entry.name,
    'data-scenario-id': resolved.scenarioId,
    'data-scenario-case': resolved.case.id,
    'aria-label': `${entry.displayName}: ${resolved.case.label}`,
  })
  root.replaceChildren(host)
  const handle = prepared.render(host, {
    copiedArtifactNames:
      copiedArtifact !== undefined ? [copiedArtifact] : resolved.case.copiedArtifactNames,
  })
  return {
    handle,
    title: `${entry.displayName} — ${resolved.case.label} · ${GALLERY_PATH_LABELS[path]}`,
  }
}

/** What this path draws, as plain links — the standalone document's landing page. */
function renderIndex(root: HTMLElement, path: PresentationScenarioPath): void {
  const list = element('ul', { 'data-gallery-index': path })
  for (const catalog of GALLERY_CATALOGS) {
    for (const scenario of catalog.scenarios) {
      const entry = GALLERY_CONTRACT.entries.find(({ name }) => name === scenario.productId)
      if (entry === undefined || !isVisuallyAvailable(entry.presentation[path].mode)) continue
      const cases = element(
        'span',
        {},
        scenario.cases.flatMap((scenarioCase, index) => [
          ...(index === 0 ? [] : [' · ']),
          element(
            'a',
            { href: formatGalleryQuery({ entry: entry.name, caseId: scenarioCase.id }) },
            [scenarioCase.label],
          ),
        ]),
      )
      list.append(element('li', {}, [element('strong', {}, [entry.displayName]), ' — ', cases]))
    }
  }
  root.replaceChildren(
    element('h1', {}, [`${GALLERY_PATH_LABELS[path]} — every rendered scenario`]),
    list,
  )
}
