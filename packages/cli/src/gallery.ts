// Browser-pure, like `presentation-scenarios.ts`: the only runtime imports are that module and
// `product-contract-types.ts`, both of which are themselves dependency-free (no Node, DOM, zod
// or LLui runtime). The package-boundary test asserts it, so this subpath can be imported by the
// gallery shell, its two path documents, docs generation (#269) and headless drivers (#268)
// alike.
import {
  DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
  PRESENTATION_SCENARIO_ENVIRONMENT_VALUES,
} from './presentation-scenarios.js'
import type {
  CompiledPresentationScenarioFamily,
  PresentationScenarioEnvironment,
  PresentationScenarioEnvironmentAxis,
  PresentationScenarioPath,
} from './presentation-scenarios.js'
import type {
  ProductAlias,
  ProductCategory,
  ProductContract,
  ProductEntry,
} from './product-contract-types.js'

/**
 * The Component Gallery's public URL contract (#267).
 *
 * The gallery is one shell document plus two ISOLATED path documents, one per renderer path:
 *
 *   <base>             the shell: search, categories, controls, framing
 *   <base>baseline/    the Baseline theme document (plain CSS, no Tailwind)
 *   <base>registry/    the Registry skins document (Tailwind v4 + copied source)
 *
 * All three read the SAME query vocabulary (`GALLERY_QUERY_KEYS`), so a path document is
 * addressable per entry, case and environment on its own — which is what lets a headless driver
 * load exactly one scenario without the shell. Every value is validated on the way in and on the
 * way out: an invalid link is refused when it is BUILT (`galleryHref` throws) and reported, not
 * thrown, when it is READ (`parseGalleryQuery` returns issues), because a stale bookmark must
 * still open the gallery.
 */

/** User-facing names of the two renderer paths. Use these words in copy, never "demo". */
export const GALLERY_PATH_LABELS = Object.freeze({
  baseline: 'Baseline theme',
  registryTailwind: 'Registry skins',
} as const satisfies Record<PresentationScenarioPath, string>)

/** URL segment (and `path=` value) for each renderer path. */
export const GALLERY_PATH_SEGMENTS = Object.freeze({
  baseline: 'baseline',
  registryTailwind: 'registry',
} as const satisfies Record<PresentationScenarioPath, string>)

export type GalleryPathSegment = (typeof GALLERY_PATH_SEGMENTS)[PresentationScenarioPath]

/** Where llui.dev serves the gallery, relative to the site root. */
export const PUBLIC_GALLERY_BASE = '/apps/component-gallery/'

/**
 * Attribute a path document sets on its `<html>` element once a scenario has settled:
 * `loading` while mounting, then `ready` or `error`. A headless driver waits on
 * `[data-gallery-status="ready"]` rather than on any renderer-specific selector.
 */
export const GALLERY_DOCUMENT_READY_ATTRIBUTE = 'data-gallery-status'

/** `postMessage` type a path document sends to its parent frame on every status change. */
export const GALLERY_DOCUMENT_MESSAGE_TYPE = 'llui-gallery:document-status'

/** The query-string key for each location field. A public URL contract: never rename one. */
export const GALLERY_QUERY_KEYS = Object.freeze({
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
} as const)

export type GalleryView = 'single' | 'compare'

/** Everything the gallery encodes in its URL. Every field is optional. */
export interface GalleryLocation {
  /** Canonical product name. Absent means the gallery index. */
  readonly entry?: string
  readonly path?: PresentationScenarioPath
  /** `single` is the default and is never written. */
  readonly view?: GalleryView
  readonly caseId?: string
  readonly copiedArtifact?: string
  readonly environment?: Partial<PresentationScenarioEnvironment>
  /** Index search text. */
  readonly query?: string
  /** Index category filter. */
  readonly category?: ProductCategory
}

/** The subset of a location a path document reads. */
export interface GalleryDocumentSelection {
  readonly path: PresentationScenarioPath
  readonly entry: string
  readonly caseId?: string
  readonly copiedArtifact?: string
  readonly environment?: Partial<PresentationScenarioEnvironment>
}

export type GalleryLinkErrorCode =
  | 'unknown-entry'
  | 'path-not-applicable'
  | 'invalid-value'
  | 'unknown-case'
  | 'unsupported-axis'

/** Thrown when a gallery link is BUILT from invalid input. */
export class GalleryLinkError extends Error {
  override readonly name = 'GalleryLinkError'
  readonly code: GalleryLinkErrorCode

  constructor(code: GalleryLinkErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_IDENTIFIER_LENGTH = 256
const MAX_QUERY_LENGTH = 200
const CATEGORIES: ReadonlySet<string> = new Set<ProductCategory>([
  'controls',
  'forms',
  'navigation',
  'overlays',
  'feedback',
  'data-display',
  'layout',
  'media',
  'patterns',
  'utilities',
])
const ENVIRONMENT_AXES = Object.keys(
  PRESENTATION_SCENARIO_ENVIRONMENT_VALUES,
) as PresentationScenarioEnvironmentAxis[]

/** Canonical write order. Parsing is order-independent; formatting is not. */
const ORDER = [
  'entry',
  'path',
  'view',
  'caseId',
  'copiedArtifact',
  'query',
  'category',
  'theme',
  'direction',
  'motion',
  'viewport',
  'forcedColors',
] as const satisfies readonly (keyof typeof GALLERY_QUERY_KEYS)[]

function isIdentifier(value: string): boolean {
  return value.length <= MAX_IDENTIFIER_LENGTH && IDENTIFIER.test(value)
}

function isAxisValue(axis: PresentationScenarioEnvironmentAxis, value: string): boolean {
  return (PRESENTATION_SCENARIO_ENVIRONMENT_VALUES[axis] as readonly string[]).includes(value)
}

/** Map a URL segment back to its protocol path, or `undefined` for anything else. */
export function galleryPathFromSegment(segment: string): PresentationScenarioPath | undefined {
  if (segment === GALLERY_PATH_SEGMENTS.baseline) return 'baseline'
  if (segment === GALLERY_PATH_SEGMENTS.registryTailwind) return 'registryTailwind'
  return undefined
}

function fieldValue(location: GalleryLocation, field: (typeof ORDER)[number]): string | undefined {
  switch (field) {
    case 'path':
      return location.path === undefined ? undefined : GALLERY_PATH_SEGMENTS[location.path]
    case 'view':
      return location.view === 'compare' ? 'compare' : undefined
    case 'query': {
      const trimmed = location.query?.trim()
      return trimmed === undefined || trimmed === '' ? undefined : trimmed
    }
    case 'entry':
    case 'caseId':
    case 'copiedArtifact':
    case 'category':
      return location[field]
    default: {
      const value = location.environment?.[field]
      return value === undefined || value === DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT[field]
        ? undefined
        : value
    }
  }
}

/**
 * Serialize a location as `?key=value&…` in canonical key order, omitting absent fields, the
 * default view and default environment values — so one gallery state has exactly one URL.
 * Returns `''` for an empty location. Values are NOT validated here; use `galleryHref` to build
 * a link from untrusted input.
 */
export function formatGalleryQuery(location: GalleryLocation): string {
  const pairs: string[] = []
  for (const field of ORDER) {
    const value = fieldValue(location, field)
    if (value === undefined) continue
    pairs.push(`${GALLERY_QUERY_KEYS[field]}=${encodeURIComponent(value)}`)
  }
  return pairs.length === 0 ? '' : `?${pairs.join('&')}`
}

type MutableLocation = {
  -readonly [Key in keyof GalleryLocation]: GalleryLocation[Key]
}

const KEY_TO_FIELD: ReadonlyMap<string, (typeof ORDER)[number]> = new Map(
  ORDER.map((field) => [GALLERY_QUERY_KEYS[field], field]),
)

/**
 * Read a location from a query string (with or without its leading `?`). Never throws: an
 * invalid value is dropped and reported in `issues` (sorted), a repeated key keeps its first
 * value, and unknown keys are ignored so foreign parameters survive a round trip.
 */
export function parseGalleryQuery(search: string): {
  location: GalleryLocation
  issues: string[]
} {
  const location: MutableLocation = {}
  const environment: Partial<Record<PresentationScenarioEnvironmentAxis, string>> = {}
  const issues: string[] = []
  const seen = new Set<string>()
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)

  for (const [key, raw] of params) {
    const field = KEY_TO_FIELD.get(key)
    if (field === undefined) continue
    if (seen.has(key)) {
      issues.push(`${key}: repeated; the first value was used`)
      continue
    }
    seen.add(key)
    const invalid = (): void => {
      issues.push(`${key}: invalid value ${JSON.stringify(raw)}`)
    }
    switch (field) {
      case 'entry':
      case 'caseId':
      case 'copiedArtifact':
        if (isIdentifier(raw)) location[field] = raw
        else invalid()
        break
      case 'path': {
        const path = galleryPathFromSegment(raw)
        if (path === undefined) invalid()
        else location.path = path
        break
      }
      case 'view':
        if (raw === 'compare' || raw === 'single') {
          if (raw === 'compare') location.view = 'compare'
        } else invalid()
        break
      case 'query': {
        const trimmed = raw.trim()
        if (trimmed.length > MAX_QUERY_LENGTH) invalid()
        else if (trimmed !== '') location.query = trimmed
        break
      }
      case 'category':
        if (CATEGORIES.has(raw)) location.category = raw as ProductCategory
        else invalid()
        break
      default:
        if (isAxisValue(field, raw)) environment[field] = raw
        else invalid()
    }
  }

  const axes = ENVIRONMENT_AXES.filter((axis) => environment[axis] !== undefined)
  if (axes.length > 0) {
    // Each value was checked against its own axis above; this restates that as the type.
    location.environment = environment as Partial<PresentationScenarioEnvironment>
  }
  return { location, issues: issues.sort() }
}

export interface ResolvedGalleryEntry {
  readonly canonical: ProductEntry
  /** Present when the requested name is a contract alias. */
  readonly alias?: ProductAlias
  /** The copied (registry) artifact the requested name denotes, when it denotes one other than
   *  the canonical product itself. */
  readonly copiedArtifact?: string
}

/**
 * Resolve any name a user might type — a canonical product, an alias, or a copied-artifact
 * (`llui add`) name — to its canonical gallery entry.
 */
export function resolveGalleryEntry(
  contract: ProductContract,
  name: string,
): ResolvedGalleryEntry | undefined {
  const canonical = contract.entries.find((entry) => entry.name === name)
  if (canonical !== undefined) return { canonical }
  const alias = contract.aliases.find((candidate) => candidate.name === name)
  const owner = contract.entries.find(({ copiedArtifacts }) =>
    copiedArtifacts.some((artifact) => artifact.name === name),
  )
  if (owner === undefined) return undefined
  return alias === undefined
    ? { canonical: owner, copiedArtifact: name }
    : { canonical: owner, alias, copiedArtifact: name }
}

export interface GalleryHrefOptions {
  /** Prefix the query is appended to. Defaults to `PUBLIC_GALLERY_BASE`. */
  readonly base?: string
  readonly path?: PresentationScenarioPath
  readonly view?: GalleryView
  readonly caseId?: string
  readonly environment?: Partial<PresentationScenarioEnvironment>
  /**
   * Compiled family catalogs. When supplied, `caseId` must name a declared case and every
   * non-default environment axis must be declared by the case the link resolves to.
   */
  readonly catalogs?: readonly CompiledPresentationScenarioFamily[]
}

function assertEnvironment(
  environment: Partial<PresentationScenarioEnvironment> | undefined,
): void {
  if (environment === undefined) return
  for (const [axis, value] of Object.entries(environment)) {
    if (!(ENVIRONMENT_AXES as string[]).includes(axis)) {
      throw new GalleryLinkError(
        'invalid-value',
        `unknown environment axis ${JSON.stringify(axis)}`,
      )
    }
    if (value !== undefined && !isAxisValue(axis as PresentationScenarioEnvironmentAxis, value)) {
      throw new GalleryLinkError('invalid-value', `invalid ${axis} value ${JSON.stringify(value)}`)
    }
  }
}

function assertIdentifier(label: string, value: string | undefined): void {
  if (value !== undefined && !isIdentifier(value)) {
    throw new GalleryLinkError('invalid-value', `invalid ${label} ${JSON.stringify(value)}`)
  }
}

function assertCatalogCase(
  entry: ProductEntry,
  catalogs: readonly CompiledPresentationScenarioFamily[],
  caseId: string | undefined,
  environment: Partial<PresentationScenarioEnvironment> | undefined,
): void {
  const scenario = catalogs
    .flatMap(({ scenarios }) => scenarios)
    .find(({ productId }) => productId === entry.name)
  if (scenario === undefined) {
    throw new GalleryLinkError(
      'unknown-case',
      `no catalog supplied declares scenarios for ${JSON.stringify(entry.name)}`,
    )
  }
  const effectiveCaseId = caseId ?? scenario.defaultCaseId
  const scenarioCase = scenario.cases.find(({ id }) => id === effectiveCaseId)
  if (scenarioCase === undefined) {
    throw new GalleryLinkError(
      'unknown-case',
      `unknown case ${JSON.stringify(effectiveCaseId)} for ${JSON.stringify(entry.name)}`,
    )
  }
  for (const axis of ENVIRONMENT_AXES) {
    const value = environment?.[axis]
    if (value === undefined || value === DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT[axis]) continue
    if (!scenarioCase.environmentAxes.includes(axis)) {
      throw new GalleryLinkError(
        'unsupported-axis',
        `case ${JSON.stringify(effectiveCaseId)} of ${JSON.stringify(entry.name)} does not declare the ${JSON.stringify(axis)} axis`,
      )
    }
  }
}

/**
 * The stable gallery URL for a product, alias or copied-artifact name. An alias or copied
 * artifact other than the product itself is canonicalized to its product and pinned to the
 * registry path with that artifact selected, because that is the only path it exists on.
 *
 * Throws `GalleryLinkError` for an unknown name, a path the contract marks `not-applicable`,
 * or a malformed value — and, when `catalogs` are supplied, for an undeclared case or axis.
 */
export function galleryHref(
  contract: ProductContract,
  name: string,
  options: GalleryHrefOptions = {},
): string {
  const resolved = resolveGalleryEntry(contract, name)
  if (resolved === undefined) {
    throw new GalleryLinkError('unknown-entry', `unknown gallery entry ${JSON.stringify(name)}`)
  }
  const { canonical, copiedArtifact } = resolved
  const artifact =
    copiedArtifact !== undefined && copiedArtifact !== canonical.name ? copiedArtifact : undefined
  const path = options.path ?? (artifact === undefined ? undefined : 'registryTailwind')
  if (artifact !== undefined && path === 'baseline') {
    throw new GalleryLinkError(
      'path-not-applicable',
      `${JSON.stringify(name)} is a registry artifact; it has no baseline presentation`,
    )
  }
  if (path !== undefined && canonical.presentation[path].mode === 'not-applicable') {
    throw new GalleryLinkError(
      'path-not-applicable',
      `the ${GALLERY_PATH_LABELS[path]} path is not applicable to ${JSON.stringify(canonical.name)}`,
    )
  }
  assertIdentifier('case', options.caseId)
  assertEnvironment(options.environment)
  if (options.catalogs !== undefined) {
    assertCatalogCase(canonical, options.catalogs, options.caseId, options.environment)
  }
  const location: MutableLocation = { entry: canonical.name }
  if (path !== undefined) location.path = path
  if (options.view !== undefined) location.view = options.view
  if (options.caseId !== undefined) location.caseId = options.caseId
  if (artifact !== undefined) location.copiedArtifact = artifact
  if (options.environment !== undefined) location.environment = options.environment
  return `${options.base ?? PUBLIC_GALLERY_BASE}${formatGalleryQuery(location)}`
}

/**
 * URL of ONE path document rendering one entry/case/environment, with no shell around it —
 * for framing by the shell and for headless drivers. Only document keys are written.
 */
export function galleryDocumentHref(
  selection: GalleryDocumentSelection,
  options: { readonly base?: string } = {},
): string {
  assertIdentifier('entry', selection.entry)
  assertIdentifier('case', selection.caseId)
  assertIdentifier('copied artifact', selection.copiedArtifact)
  assertEnvironment(selection.environment)
  const location: MutableLocation = { entry: selection.entry }
  if (selection.caseId !== undefined) location.caseId = selection.caseId
  if (selection.copiedArtifact !== undefined) location.copiedArtifact = selection.copiedArtifact
  if (selection.environment !== undefined) location.environment = selection.environment
  return `${options.base ?? PUBLIC_GALLERY_BASE}${GALLERY_PATH_SEGMENTS[selection.path]}/${formatGalleryQuery(location)}`
}
