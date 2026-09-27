/**
 * From a URL-shaped `GalleryLocation` to exactly what the shell shows.
 *
 * `resolveRoute` is total: any location — a stale bookmark, a hand-edited
 * query, an alias — resolves to a valid view plus the `canonical` location
 * the address bar should say and human-readable `notices` for whatever it
 * had to correct. A path, case, axis or artifact the contract or catalog
 * does not declare for the entry is dropped (never silently kept), so a
 * gallery URL always names a state the gallery can actually draw.
 */
import {
  DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
  PRESENTATION_SCENARIO_ENVIRONMENT_VALUES,
  type PresentationScenarioEnvironment,
  type PresentationScenarioEnvironmentAxis,
  type PresentationScenarioPath,
} from '@llui/cli/presentation-scenarios'
import {
  GALLERY_PATH_LABELS,
  GALLERY_QUERY_KEYS,
  galleryDocumentHref,
  parseGalleryQuery,
  resolveGalleryEntry,
  type GalleryLocation,
  type GalleryView,
} from '@llui/cli/gallery'
import { GALLERY_CONTRACT } from '../shared/contract'
import { findGalleryEntry, suggestEntries, type GalleryCase, type GalleryEntry } from './entries'

export const AXES = Object.keys(
  PRESENTATION_SCENARIO_ENVIRONMENT_VALUES,
) as PresentationScenarioEnvironmentAxis[]

export const AXIS_LABELS: Readonly<Record<PresentationScenarioEnvironmentAxis, string>> = {
  theme: 'Theme',
  direction: 'Direction',
  motion: 'Motion',
  viewport: 'Viewport',
  forcedColors: 'Forced colors',
}

export const AXIS_VALUE_LABELS: Readonly<Record<string, string>> = {
  light: 'Light',
  dark: 'Dark',
  ltr: 'LTR',
  rtl: 'RTL',
  full: 'Full',
  reduced: 'Reduced',
  wide: 'Wide',
  narrow: 'Narrow',
  none: 'Off',
  active: 'On',
}

/** One framed path document (or the explanation shown instead of it). */
export interface RouteFrame {
  readonly path: PresentationScenarioPath
  /** Relative URL of the path document; absent when the path draws nothing. */
  readonly href?: string
}

export type ResolvedRoute =
  | { readonly kind: 'index' }
  | {
      readonly kind: 'not-found'
      readonly requested: string
      readonly suggestions: readonly string[]
    }
  | {
      readonly kind: 'entry'
      readonly entry: string
      readonly path: PresentationScenarioPath
      readonly view: GalleryView
      readonly caseId: string
      readonly environment: PresentationScenarioEnvironment
      /** Axes the current case lets you vary. */
      readonly axes: readonly PresentationScenarioEnvironmentAxis[]
      readonly copiedArtifact?: string
      /** Copied artifacts the current case can target on the registry path. */
      readonly artifacts: readonly string[]
      readonly frames: readonly RouteFrame[]
    }

export interface RouteResolution {
  readonly route: ResolvedRoute
  /** What the address bar should say for this state. */
  readonly canonical: GalleryLocation
  readonly notices: readonly string[]
}

/** Copy one axis between environments, keeping its literal type. */
export function copyAxis<Axis extends PresentationScenarioEnvironmentAxis>(
  from: Partial<PresentationScenarioEnvironment>,
  to: Partial<PresentationScenarioEnvironment>,
  axis: Axis,
): void {
  const value = from[axis]
  if (value !== undefined) to[axis] = value
}

/** The path shown when a URL names none: baseline first, if it draws the entry. */
export function defaultPath(entry: GalleryEntry): PresentationScenarioPath {
  if (entry.paths.baseline.rendered) return 'baseline'
  if (entry.paths.registryTailwind.rendered) return 'registryTailwind'
  return 'baseline'
}

function eligibleArtifacts(entry: GalleryEntry, scenarioCase: GalleryCase): string[] {
  const names = entry.copiedArtifacts.map(({ name }) => name)
  return scenarioCase.copiedArtifactNames === undefined
    ? names
    : names.filter((name) => scenarioCase.copiedArtifactNames!.includes(name))
}

function axisValue(axis: PresentationScenarioEnvironmentAxis, value: string): string {
  return AXIS_VALUE_LABELS[value] ?? `${AXIS_LABELS[axis]} ${value}`
}

/** A document base the shell frames against: its own directory. */
const DOCUMENT_BASE = './'

export function resolveRoute(
  location: GalleryLocation,
  issues: readonly string[] = [],
): RouteResolution {
  const notices = issues.map((issue) => `Ignored an invalid link parameter — ${issue}.`)
  const browse: GalleryLocation = {
    ...(location.query === undefined ? {} : { query: location.query }),
    ...(location.category === undefined ? {} : { category: location.category }),
  }
  if (location.entry === undefined) {
    return { route: { kind: 'index' }, canonical: browse, notices }
  }

  const resolved = resolveGalleryEntry(GALLERY_CONTRACT, location.entry)
  const entry = resolved === undefined ? undefined : findGalleryEntry(resolved.canonical.name)
  if (resolved === undefined || entry === undefined) {
    return {
      route: {
        kind: 'not-found',
        requested: location.entry,
        suggestions: suggestEntries(location.entry).map(({ name }) => name),
      },
      canonical: { ...browse, entry: location.entry },
      notices,
    }
  }

  // An alias / copied-artifact name selects that artifact on the registry path.
  const aliasArtifact =
    resolved.copiedArtifact !== undefined && resolved.copiedArtifact !== entry.name
      ? resolved.copiedArtifact
      : undefined
  const requestedArtifact = location.copiedArtifact ?? aliasArtifact
  const explicitPath =
    location.path ?? (aliasArtifact === undefined ? undefined : 'registryTailwind')
  const path = explicitPath ?? defaultPath(entry)
  const view: GalleryView = location.view ?? 'single'

  let scenarioCase = entry.cases.find(({ id }) => id === (location.caseId ?? entry.defaultCaseId))
  if (scenarioCase === undefined) {
    notices.push(
      `“${entry.displayName}” has no “${location.caseId}” scenario; showing the default scenario instead.`,
    )
    scenarioCase = entry.cases.find(({ id }) => id === entry.defaultCaseId)!
  }

  const environment: Partial<PresentationScenarioEnvironment> = {}
  for (const axis of AXES) {
    const value = location.environment?.[axis]
    if (value === undefined || value === DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT[axis]) continue
    if (scenarioCase.environmentAxes.includes(axis))
      copyAxis(location.environment!, environment, axis)
    else {
      notices.push(
        `The “${scenarioCase.label}” scenario does not vary ${AXIS_LABELS[axis].toLowerCase()}; ${axisValue(axis, value)} was ignored.`,
      )
    }
  }
  const effectiveEnvironment: PresentationScenarioEnvironment = {
    ...DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
    ...environment,
  }

  const artifacts = eligibleArtifacts(entry, scenarioCase)
  let copiedArtifact: string | undefined
  if (requestedArtifact !== undefined) {
    if (artifacts.includes(requestedArtifact)) copiedArtifact = requestedArtifact
    else {
      notices.push(
        `“${requestedArtifact}” is not a registry artifact of the “${scenarioCase.label}” ${entry.displayName} scenario; it was ignored.`,
      )
    }
  }

  const paths: readonly PresentationScenarioPath[] =
    view === 'compare' ? ['baseline', 'registryTailwind'] : [path]
  const frames = paths.map((framePath): RouteFrame => {
    if (!entry.paths[framePath].rendered) return { path: framePath }
    const artifact = framePath === 'registryTailwind' ? copiedArtifact : undefined
    return {
      path: framePath,
      href: galleryDocumentHref(
        {
          path: framePath,
          entry: entry.name,
          caseId: scenarioCase.id,
          environment,
          ...(artifact === undefined ? {} : { copiedArtifact: artifact }),
        },
        { base: DOCUMENT_BASE },
      ),
    }
  })

  const canonical: GalleryLocation = {
    ...browse,
    entry: entry.name,
    ...(explicitPath === undefined ? {} : { path: explicitPath }),
    ...(view === 'compare' ? { view } : {}),
    ...(location.caseId === undefined || scenarioCase.id !== location.caseId
      ? {}
      : { caseId: scenarioCase.id }),
    ...(Object.keys(environment).length === 0 ? {} : { environment }),
    ...(copiedArtifact === undefined ? {} : { copiedArtifact }),
  }
  return {
    route: {
      kind: 'entry',
      entry: entry.name,
      path,
      view,
      caseId: scenarioCase.id,
      environment: effectiveEnvironment,
      axes: [...scenarioCase.environmentAxes],
      ...(copiedArtifact === undefined ? {} : { copiedArtifact }),
      artifacts,
      frames,
    },
    canonical,
    notices,
  }
}

export function describePath(path: PresentationScenarioPath): string {
  return GALLERY_PATH_LABELS[path]
}

/**
 * A one-axis environment patch from a control's string value, validated by
 * the same parser a link goes through (so an invalid value yields `{}`).
 */
export function axisPatch(
  axis: PresentationScenarioEnvironmentAxis,
  value: string,
): Partial<PresentationScenarioEnvironment> {
  return (
    parseGalleryQuery(`${GALLERY_QUERY_KEYS[axis]}=${encodeURIComponent(value)}`).location
      .environment ?? {}
  )
}
