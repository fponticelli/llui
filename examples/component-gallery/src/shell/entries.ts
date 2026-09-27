/**
 * The gallery's information architecture, DERIVED — never listed.
 *
 * One `GalleryEntry` per canonical ProductContract entry, carrying exactly
 * what the shell shows about it: names people search for (display name,
 * canonical name, aliases, copied-artifact names, machine import), its
 * category, the per-path coverage and how to install/import each path, and
 * the compiled scenario cases. `test/entries.test.ts` asserts the entry set
 * equals the contract's and every case equals its family catalog's, both as
 * exact sets.
 */
import type {
  PresentationCoverage,
  ProductCategory,
  ProductEntry,
  PresentationFamily,
} from '@llui/cli'
import { GALLERY_PATH_LABELS } from '@llui/cli/gallery'
import type {
  PresentationScenarioEnvironmentAxis,
  PresentationScenarioPath,
} from '@llui/cli/presentation-scenarios'
import { items as registryItems } from '../../../../registry/registry.json'
import { isVisuallyAvailable, scenarioFor } from '../shared/catalogs'
import { GALLERY_CONTRACT } from '../shared/contract'

export const PATHS: readonly PresentationScenarioPath[] = ['baseline', 'registryTailwind']

export const CATEGORY_LABELS: Readonly<Record<ProductCategory, string>> = {
  controls: 'Controls',
  forms: 'Forms',
  navigation: 'Navigation',
  overlays: 'Overlays',
  feedback: 'Feedback',
  'data-display': 'Data display',
  layout: 'Layout',
  media: 'Media',
  patterns: 'Patterns',
  utilities: 'Utilities',
}

export const FAMILY_LABELS: Readonly<Record<PresentationFamily, string>> = {
  'forms-controls': 'Forms & controls',
  'navigation-data': 'Navigation & data display',
  'menus-overlays': 'Menus & overlays',
  'specialized-tools': 'Specialized tools',
}

export const COVERAGE_LABELS: Readonly<Record<PresentationCoverage['mode'], string>> = {
  styled: 'Styled',
  partial: 'Partially styled',
  composed: 'Composed',
  styleless: 'Styleless',
  'not-applicable': 'Not applicable',
}

export interface GalleryCase {
  readonly id: string
  readonly label: string
  readonly environmentAxes: readonly PresentationScenarioEnvironmentAxis[]
  readonly copiedArtifactNames?: readonly string[]
}

export interface GalleryPathSummary {
  readonly mode: PresentationCoverage['mode']
  readonly rendered: boolean
  readonly rationale?: string
  readonly composedOf?: readonly string[]
  /** One line per thing a consumer of this path adds to their app. */
  readonly install: readonly string[]
}

export interface GalleryCopiedArtifact {
  readonly name: string
  readonly displayName: string
  readonly description?: string
  readonly registryDependencies: readonly string[]
}

export interface GalleryEntry {
  readonly name: string
  readonly displayName: string
  readonly category: ProductCategory
  readonly family: PresentationFamily
  readonly artifactKind: ProductEntry['artifactKind']
  readonly machineImport?: string
  readonly aliases: readonly string[]
  readonly copiedArtifacts: readonly GalleryCopiedArtifact[]
  readonly paths: Readonly<Record<PresentationScenarioPath, GalleryPathSummary>>
  readonly defaultCaseId: string
  readonly cases: readonly GalleryCase[]
  /** Lowercased names people might type, in priority order. */
  readonly terms: readonly string[]
}

type RegistryItem = { name: string; description?: string; registryDependencies?: string[] }
const itemByName = new Map<string, RegistryItem>(
  (registryItems as readonly RegistryItem[]).map((item) => [item.name, item]),
)

function importName(machineImport: string): string {
  const last = machineImport.split('/').pop() ?? machineImport
  return last.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase())
}

function installLines(entry: ProductEntry, path: PresentationScenarioPath): string[] {
  const machine = entry.machine.kind === 'public' ? entry.machine.importPath : undefined
  if (path === 'baseline') {
    if (entry.presentation.baseline.mode === 'not-applicable') return []
    return [
      'pnpm add @llui/components @llui/dom',
      ...(isVisuallyAvailable(entry.presentation.baseline.mode)
        ? ["import '@llui/components/styles/theme.css'"]
        : []),
      ...(machine === undefined ? [] : [`import * as ${importName(machine)} from '${machine}'`]),
    ]
  }
  if (entry.copiedArtifacts.length === 0) {
    return machine === undefined ? [] : [`import * as ${importName(machine)} from '${machine}'`]
  }
  return [
    ...entry.copiedArtifacts.map(({ name }) => `pnpm exec llui add ${name}`),
    "@import '@llui/components/styles/tokens.css'  /* in your Tailwind v4 entry */",
    ...(machine === undefined ? [] : [`import * as ${importName(machine)} from '${machine}'`]),
  ]
}

function pathSummary(entry: ProductEntry, path: PresentationScenarioPath): GalleryPathSummary {
  const coverage = entry.presentation[path]
  return {
    mode: coverage.mode,
    rendered: isVisuallyAvailable(coverage.mode),
    ...('rationale' in coverage ? { rationale: coverage.rationale } : {}),
    ...(coverage.mode === 'composed' ? { composedOf: [...coverage.products] } : {}),
    install: installLines(entry, path),
  }
}

function toGalleryEntry(entry: ProductEntry): GalleryEntry {
  const scenario = scenarioFor(entry.name)
  if (scenario === undefined) {
    throw new Error(`No presentation family declares scenarios for ${entry.name}`)
  }
  const aliases = GALLERY_CONTRACT.aliases
    .filter(({ canonicalName }) => canonicalName === entry.name)
    .map(({ name }) => name)
  const copiedArtifacts = entry.copiedArtifacts.map((artifact) => {
    const item = itemByName.get(artifact.name)
    return {
      name: artifact.name,
      displayName: artifact.displayName ?? entry.displayName,
      ...(item?.description === undefined ? {} : { description: item.description }),
      registryDependencies: item?.registryDependencies ?? [],
    }
  })
  const machineImport = entry.machine.kind === 'public' ? entry.machine.importPath : undefined
  return {
    name: entry.name,
    displayName: entry.displayName,
    category: entry.category,
    family: entry.presentation.family,
    artifactKind: entry.artifactKind,
    ...(machineImport === undefined ? {} : { machineImport }),
    aliases,
    copiedArtifacts,
    paths: {
      baseline: pathSummary(entry, 'baseline'),
      registryTailwind: pathSummary(entry, 'registryTailwind'),
    },
    defaultCaseId: scenario.defaultCaseId,
    cases: scenario.cases.map((scenarioCase) => ({
      id: scenarioCase.id,
      label: scenarioCase.label,
      environmentAxes: [...scenarioCase.environmentAxes],
      ...(scenarioCase.copiedArtifactNames === undefined
        ? {}
        : { copiedArtifactNames: [...scenarioCase.copiedArtifactNames] }),
    })),
    terms: [
      ...new Set(
        [
          entry.name,
          entry.displayName,
          ...aliases,
          ...copiedArtifacts.map(({ name }) => name),
          ...copiedArtifacts.map(({ displayName }) => displayName),
          ...(machineImport === undefined ? [] : [machineImport]),
        ].map((term) => term.toLowerCase()),
      ),
    ],
  }
}

/** Every canonical entry, ordered by display name. */
export const GALLERY_ENTRIES: readonly GalleryEntry[] = GALLERY_CONTRACT.entries
  .map(toGalleryEntry)
  .sort((left, right) => left.displayName.localeCompare(right.displayName, 'en'))

const entryByName = new Map(GALLERY_ENTRIES.map((entry) => [entry.name, entry]))

export function findGalleryEntry(name: string): GalleryEntry | undefined {
  return entryByName.get(name)
}

/** Categories in contract-declared order, each with its entry count. */
export const GALLERY_CATEGORIES: readonly { id: ProductCategory; label: string; count: number }[] =
  (Object.keys(CATEGORY_LABELS) as ProductCategory[])
    .map((id) => ({
      id,
      label: CATEGORY_LABELS[id],
      count: GALLERY_ENTRIES.filter((entry) => entry.category === id).length,
    }))
    .filter(({ count }) => count > 0)

export function pathLabel(path: PresentationScenarioPath): string {
  return GALLERY_PATH_LABELS[path]
}

/**
 * Rank entries against a free-text query. Every whitespace-separated token
 * must match some term; a whole-term match outranks a term prefix, which
 * outranks a word prefix, which outranks a substring. Ties keep display-name
 * order.
 */
export function searchEntries(
  query: string,
  category: ProductCategory | undefined,
  entries: readonly GalleryEntry[] = GALLERY_ENTRIES,
): GalleryEntry[] {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token !== '')
  const scored: { entry: GalleryEntry; score: number; order: number }[] = []
  entries.forEach((entry, order) => {
    if (category !== undefined && entry.category !== category) return
    let score = 0
    for (const token of tokens) {
      let best = 0
      for (const term of entry.terms) {
        if (term === token) best = Math.max(best, 4)
        else if (term.startsWith(token)) best = Math.max(best, 3)
        else if (term.split(/[\s/-]/).some((word) => word.startsWith(token)))
          best = Math.max(best, 2)
        else if (term.includes(token)) best = Math.max(best, 1)
      }
      if (best === 0) return
      score += best
    }
    scored.push({ entry, score, order })
  })
  return scored
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .map(({ entry }) => entry)
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1)
      current.push(Math.min(previous[column]! + 1, current[column - 1]! + 1, substitution))
    }
    previous = current
  }
  return previous[right.length]!
}

/**
 * Entries worth suggesting for a name that matched nothing: close misspellings
 * of any searchable name first, then entries sharing any word with it.
 */
export function suggestEntries(requested: string, limit = 5): GalleryEntry[] {
  const needle = requested.toLowerCase()
  const tolerance = Math.max(2, Math.floor(needle.length / 3))
  const close = GALLERY_ENTRIES.map((entry) => ({
    entry,
    distance: Math.min(...entry.terms.map((term) => editDistance(needle, term))),
  }))
    .filter(({ distance }) => distance <= tolerance)
    .sort((left, right) => left.distance - right.distance)
    .map(({ entry }) => entry)
  const words = needle.split(/[\s/-]+/).filter((word) => word.length > 1)
  const related = GALLERY_ENTRIES.filter((entry) =>
    words.some((word) => entry.terms.some((term) => term.includes(word))),
  )
  return [...new Set([...close, ...related])].slice(0, limit)
}
