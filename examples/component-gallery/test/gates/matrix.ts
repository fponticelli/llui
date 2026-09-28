/**
 * The gate MATRIX (#268): every rendered case of every canonical entry on
 * every path that draws it, derived from the ONE source of truth — the
 * product contract plus the family scenario catalogs compiled against it.
 * Nothing here lists an entry, a case or an environment by hand, so adding,
 * removing or reclassifying a contract entry changes what every gate runs
 * (and the exact-set coverage tests fail until the renderers follow).
 *
 * Titles are the failure's address: `<entry> › <path> › <case> › <env>`, so
 * a red gate names the canonical component, the styling path, the scenario
 * and the environment instead of an undifferentiated gallery failure.
 */
import { galleryDocumentHref, GALLERY_PATH_SEGMENTS } from '@llui/cli/gallery'
import {
  DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
  PRESENTATION_SCENARIO_PATHS,
  type PresentationScenarioEnvironment,
  type PresentationScenarioEnvironmentAxis,
  type PresentationScenarioPath,
} from '@llui/cli/presentation-scenarios'
import type { PresentationCoverage, PresentationFamily } from '@llui/cli'
import { isVisuallyAvailable, scenarioFor } from '../../src/shared/catalogs'
import { GALLERY_CONTRACT } from '../../src/shared/contract'

export interface GalleryCase {
  readonly entry: string
  readonly displayName: string
  readonly family: PresentationFamily
  readonly path: PresentationScenarioPath
  readonly scenarioId: string
  readonly caseId: string
  readonly caseLabel: string
  /** Environment axes this case DECLARES (the only ones a document accepts). */
  readonly axes: readonly PresentationScenarioEnvironmentAxis[]
  /** Only the axes that differ from the canonical default. */
  readonly overrides: Partial<PresentationScenarioEnvironment>
  readonly environment: PresentationScenarioEnvironment
}

type Axis = PresentationScenarioEnvironmentAxis

/** The non-default value each visually varied axis is flipped to. */
export const AXIS_VARIANT = {
  theme: 'dark',
  direction: 'rtl',
  motion: 'reduced',
  viewport: 'narrow',
  forcedColors: 'active',
} as const satisfies PresentationScenarioEnvironment

export function environmentLabel(environment: PresentationScenarioEnvironment): string {
  return [
    environment.theme,
    environment.direction,
    `motion-${environment.motion}`,
    environment.viewport,
    ...(environment.forcedColors === 'active' ? ['forced-colors'] : []),
  ].join(' ')
}

export function caseTitle(galleryCase: GalleryCase): string {
  return [
    galleryCase.entry,
    GALLERY_PATH_SEGMENTS[galleryCase.path],
    galleryCase.caseId,
    environmentLabel(galleryCase.environment),
  ].join(' › ')
}

/** A stable file-system key for a case (visual baselines, failure artifacts). */
export function caseKey(galleryCase: GalleryCase): string {
  const overrides = Object.entries(galleryCase.overrides)
    .map(([axis, value]) => `${axis}-${String(value)}`)
    .sort()
  return [
    GALLERY_PATH_SEGMENTS[galleryCase.path],
    galleryCase.entry,
    galleryCase.caseId,
    overrides.length === 0 ? 'default' : overrides.join('+'),
  ].join('/')
}

/** The document URL, relative to the served gallery root. */
export function documentHref(galleryCase: GalleryCase): string {
  return galleryDocumentHref(
    {
      path: galleryCase.path,
      entry: galleryCase.entry,
      caseId: galleryCase.caseId,
      ...(Object.keys(galleryCase.overrides).length === 0
        ? {}
        : { environment: galleryCase.overrides }),
    },
    { base: '' },
  )
}

/** The same case with some declared axes flipped. Throws on an undeclared axis. */
export function withOverrides(
  galleryCase: GalleryCase,
  overrides: Partial<PresentationScenarioEnvironment>,
): GalleryCase {
  for (const axis of Object.keys(overrides) as Axis[]) {
    if (!galleryCase.axes.includes(axis)) {
      throw new Error(`${caseTitle(galleryCase)} does not declare the ${axis} axis`)
    }
  }
  const merged = { ...galleryCase.overrides, ...overrides }
  return {
    ...galleryCase,
    overrides: merged,
    environment: { ...DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT, ...merged },
  }
}

/**
 * Every case of every visually available (entry, path), in the canonical
 * default environment — the rendered-coverage set.
 */
export function renderedCases(): readonly GalleryCase[] {
  const cases: GalleryCase[] = []
  for (const entry of GALLERY_CONTRACT.entries) {
    const scenario = scenarioFor(entry.name)
    if (scenario === undefined) {
      throw new Error(`${entry.name} has no scenario in any family catalog`)
    }
    for (const path of PRESENTATION_SCENARIO_PATHS) {
      if (!isVisuallyAvailable(entry.presentation[path].mode)) continue
      for (const scenarioCase of scenario.cases) {
        cases.push({
          entry: entry.name,
          displayName: entry.displayName,
          family: entry.presentation.family,
          path,
          scenarioId: scenario.scenarioId,
          caseId: scenarioCase.id,
          caseLabel: scenarioCase.label,
          axes: scenarioCase.environmentAxes,
          overrides: {},
          environment: DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
        })
      }
    }
  }
  return cases
}

/**
 * The accessibility matrix: every rendered case, plus its dark rendering
 * where the case declares the theme axis (contrast differs per theme, and a
 * token regression has twice shipped in ONE theme only — styling.md).
 */
export function auditCases(): readonly GalleryCase[] {
  return renderedCases().flatMap((galleryCase) =>
    galleryCase.axes.includes('theme')
      ? [galleryCase, withOverrides(galleryCase, { theme: AXIS_VARIANT.theme })]
      : [galleryCase],
  )
}

/** Axes the visual matrix varies, in addition to every case at the default. */
export const VISUAL_AXES = [
  'theme',
  'direction',
  'motion',
  'viewport',
] as const satisfies readonly Axis[]

/**
 * The visual matrix: the full semantic STATE matrix (every case) at the
 * default environment, plus — per (entry, path) — one representative case
 * flipped along each environment axis it declares (the scenario's default
 * case when it declares the axis, else the first case that does). Flipping
 * every case along every axis would multiply the baseline set ~2.3x for
 * renderings that differ from their representative only in the state the
 * default matrix already pins.
 */
export function visualCases(): readonly GalleryCase[] {
  const out: GalleryCase[] = []
  const byOwner = new Map<string, GalleryCase[]>()
  for (const galleryCase of renderedCases()) {
    out.push(galleryCase)
    const owner = `${galleryCase.entry}\0${galleryCase.path}`
    byOwner.set(owner, [...(byOwner.get(owner) ?? []), galleryCase])
  }
  for (const cases of byOwner.values()) {
    const first = cases[0]!
    const defaultCaseId = scenarioFor(first.entry)!.defaultCaseId
    for (const axis of VISUAL_AXES) {
      const declaring = cases.filter(({ axes }) => axes.includes(axis))
      const representative =
        declaring.find(({ caseId }) => caseId === defaultCaseId) ?? declaring[0]
      if (representative === undefined) continue
      out.push(withOverrides(representative, { [axis]: AXIS_VARIANT[axis] }))
    }
  }
  return out
}

export interface NotRenderedPath {
  readonly entry: string
  readonly displayName: string
  readonly path: PresentationScenarioPath
  readonly coverage: Exclude<PresentationCoverage, { mode: 'styled' | 'partial' | 'composed' }>
}

/** Every (entry, path) the contract says draws nothing, with its stated reason. */
export function notRenderedPaths(): readonly NotRenderedPath[] {
  const out: NotRenderedPath[] = []
  for (const entry of GALLERY_CONTRACT.entries) {
    for (const path of PRESENTATION_SCENARIO_PATHS) {
      const coverage = entry.presentation[path]
      if (coverage.mode === 'styleless' || coverage.mode === 'not-applicable') {
        out.push({ entry: entry.name, displayName: entry.displayName, path, coverage })
      }
    }
  }
  return out
}

/** A case the per-case gate opens, and which of its checks apply. */
export interface GateCase extends GalleryCase {
  /** In `auditCases()`: axe runs on it. */
  readonly audit: boolean
  /** In `visualCases()`: it has a baseline. */
  readonly visual: boolean
}

/**
 * The UNION of the audit and visual matrices, one entry per distinct
 * (entry, path, case, environment) — so a case both matrices name is opened
 * ONCE and gets both checks (every case renders, is markup-probed and is
 * fault-checked regardless). Opening the two matrices separately cost ~2000
 * navigations; the union is ~1200.
 */
export function gateCases(): readonly GateCase[] {
  const audit = new Set(auditCases().map(caseKey))
  const visual = new Set(visualCases().map(caseKey))
  const seen = new Set<string>()
  const out: GateCase[] = []
  for (const galleryCase of [...auditCases(), ...visualCases()]) {
    const key = caseKey(galleryCase)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...galleryCase, audit: audit.has(key), visual: visual.has(key) })
  }
  return out
}
