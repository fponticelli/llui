/**
 * The shell's TEA core: state, messages, effects and a pure `update`.
 *
 * The URL is the source of truth for everything shareable; `update` turns
 * every navigation into a new `location`, re-resolves it (`resolveRoute`),
 * and asks for the address bar to follow (`history` effect). State that is
 * NOT shareable — frame loading status, the shell's own colour scheme, the
 * mobile nav — never enters the URL.
 */
import {
  formatGalleryQuery,
  parseGalleryQuery,
  type GalleryLocation,
  type GalleryView,
} from '@llui/cli/gallery'
import type { ProductCategory } from '@llui/cli'
import type {
  PresentationScenarioEnvironment,
  PresentationScenarioEnvironmentAxis,
  PresentationScenarioPath,
} from '@llui/cli/presentation-scenarios'
import type { GalleryDocumentErrorCode } from '../shared/document-protocol'
import { findGalleryEntry, searchEntries } from './entries'
import { copyAxis, resolveRoute, type ResolvedRoute } from './route'

export type FrameStatus =
  | { readonly status: 'loading' }
  | { readonly status: 'ready' }
  | {
      readonly status: 'error'
      readonly code: GalleryDocumentErrorCode | 'timeout'
      readonly message: string
    }

export type ShellTheme = 'system' | 'light' | 'dark'

export interface State {
  readonly location: GalleryLocation
  readonly route: ResolvedRoute
  readonly notices: readonly string[]
  /** Canonical names matching the current search + category, ranked. */
  readonly results: readonly string[]
  /** Status per framed document, keyed by the frame's key. */
  readonly frames: Readonly<Record<string, FrameStatus>>
  /** Bumped by "Retry" so a frame's key — and element — changes. */
  readonly reload: number
  /**
   * Environment choices remembered across cases that do not declare an axis,
   * so switching to such a case and back restores them. Never in the URL.
   */
  readonly remembered: Partial<PresentationScenarioEnvironment>
  readonly shellTheme: ShellTheme
  readonly navOpen: boolean
  readonly copied: boolean
}

export type Msg =
  /** @intent("Navigate to a gallery location, adding a history entry") */
  | { type: 'navigate'; location: GalleryLocation }
  /** @intent("The browser moved through history to this query string") */
  | { type: 'popState'; search: string }
  | { type: 'setQuery'; query: string }
  | { type: 'setCategory'; category: ProductCategory | null }
  | { type: 'setPath'; path: PresentationScenarioPath }
  | { type: 'setView'; view: GalleryView }
  | { type: 'setCase'; caseId: string }
  | { type: 'setAxis'; patch: Partial<PresentationScenarioEnvironment> }
  | { type: 'setArtifact'; artifact: string }
  | {
      type: 'frameStatus'
      key: string
      status: 'loading' | 'ready' | 'error'
      code?: GalleryDocumentErrorCode
      message?: string
    }
  | { type: 'frameTimeout'; key: string }
  | { type: 'retry' }
  | { type: 'setShellTheme'; theme: ShellTheme }
  | { type: 'toggleNav' }
  | { type: 'closeNav' }
  | { type: 'copyLink' }
  | { type: 'linkCopied' }

export type Effect =
  | { type: 'history'; mode: 'push' | 'replace'; search: string }
  | { type: 'title'; title: string }
  | { type: 'watchFrame'; key: string }
  | { type: 'copy'; search: string }
  | { type: 'focusMain' }

/** The document title for a state: what a tab, bookmark or screen reader announces. */
export function routeTitle(state: State): string {
  const route = state.route
  if (route.kind === 'index') return 'Component Gallery · LLui'
  if (route.kind === 'not-found') return `Not found · Component Gallery · LLui`
  const entry = findGalleryEntry(route.entry)
  const scenario = entry?.cases.find(({ id }) => id === route.caseId)?.label ?? route.caseId
  return `${entry?.displayName ?? route.entry} — ${scenario} · Component Gallery · LLui`
}

/** How long a document may stay silent before the shell reports it. */
export const FRAME_TIMEOUT_MS = 15_000

/** A frame's identity: its document URL plus the retry generation. */
export function frameKey(href: string, reload: number): string {
  return `${href}#${reload}`
}

function frameKeys(route: ResolvedRoute, reload: number): string[] {
  if (route.kind !== 'entry') return []
  return route.frames.flatMap(({ href }) => (href === undefined ? [] : [frameKey(href, reload)]))
}

function withLocation(
  state: State,
  location: GalleryLocation,
  issues: readonly string[] = [],
): State {
  const { route, canonical, notices } = resolveRoute(location, issues)
  const keys = frameKeys(route, state.reload)
  const frames: Record<string, FrameStatus> = {}
  for (const key of keys) frames[key] = state.frames[key] ?? { status: 'loading' }
  return {
    ...state,
    location: canonical,
    route,
    notices,
    results: searchEntries(canonical.query ?? '', canonical.category).map(({ name }) => name),
    frames,
  }
}

function newFrameEffects(before: State, after: State): Effect[] {
  return Object.keys(after.frames)
    .filter((key) => before.frames[key] === undefined)
    .map((key) => ({ type: 'watchFrame', key }))
}

export function initialState(search: string): State {
  const parsed = parseGalleryQuery(search)
  const empty: State = {
    location: {},
    route: { kind: 'index' },
    notices: [],
    results: [],
    frames: {},
    reload: 0,
    remembered: {},
    shellTheme: 'system',
    navOpen: false,
    copied: false,
  }
  return withLocation(empty, parsed.location, parsed.issues)
}

/** `init`'s effects: correct the address bar, and watch the first frames. */
export function initialEffects(state: State, search: string): Effect[] {
  const canonical = formatGalleryQuery(state.location)
  return [
    ...(canonical === normalizeSearch(search)
      ? []
      : [{ type: 'history', mode: 'replace', search: canonical } as const]),
    { type: 'title', title: routeTitle(state) },
    ...Object.keys(state.frames).map((key): Effect => ({ type: 'watchFrame', key })),
  ]
}

function pickAxes(
  environment: Partial<PresentationScenarioEnvironment>,
  axes: readonly PresentationScenarioEnvironmentAxis[],
): Partial<PresentationScenarioEnvironment> {
  const picked: Partial<PresentationScenarioEnvironment> = {}
  for (const axis of axes) copyAxis(environment, picked, axis)
  return picked
}

function normalizeSearch(search: string): string {
  return search === '?' ? '' : search
}

function navigate(
  state: State,
  location: GalleryLocation,
  mode: 'push' | 'replace',
  extra: Effect[] = [],
): [State, Effect[]] {
  const next = withLocation({ ...state, copied: false }, location)
  const search = formatGalleryQuery(next.location)
  const changed = search !== formatGalleryQuery(state.location)
  return [
    next,
    [
      ...(changed ? [{ type: 'history', mode, search } as const] : []),
      ...(changed ? [{ type: 'title', title: routeTitle(next) } as const] : []),
      ...newFrameEffects(state, next),
      ...extra,
    ],
  ]
}

/** The entry-scoped part of a location with one field replaced. */
function entryLocation(state: State, patch: Partial<GalleryLocation>): GalleryLocation {
  return { ...state.location, ...patch }
}

export function update(state: State, msg: Msg): [State, Effect[]] {
  switch (msg.type) {
    case 'navigate': {
      const entryChanged = msg.location.entry !== state.location.entry
      return navigate({ ...state, navOpen: false }, msg.location, 'push', [
        ...(entryChanged ? [{ type: 'focusMain' } as const] : []),
      ])
    }
    case 'popState': {
      const parsed = parseGalleryQuery(msg.search)
      const next = withLocation(state, parsed.location, parsed.issues)
      return [next, [{ type: 'title', title: routeTitle(next) }, ...newFrameEffects(state, next)]]
    }
    case 'setQuery': {
      const query = msg.query.trim() === '' ? undefined : msg.query
      const { query: _query, ...rest } = state.location
      // Typing replaces the current entry instead of stacking one per key.
      return navigate(state, query === undefined ? rest : { ...rest, query }, 'replace')
    }
    case 'setCategory': {
      const { category: _category, ...rest } = state.location
      return navigate(
        state,
        msg.category === null || msg.category === state.location.category
          ? rest
          : { ...rest, category: msg.category },
        'push',
      )
    }
    case 'setPath':
      return navigate(state, entryLocation(state, { path: msg.path, view: 'single' }), 'push')
    case 'setView':
      return navigate(state, entryLocation(state, { view: msg.view }), 'push')
    case 'setCase': {
      if (state.route.kind !== 'entry') return [state, []]
      const nextCase = findGalleryEntry(state.route.entry)?.cases.find(
        ({ id }) => id === msg.caseId,
      )
      if (nextCase === undefined) return [state, []]
      // Carry every remembered axis the NEW case declares; the rest waits in
      // `remembered` for a case that does, instead of being reported dropped.
      const carried = { ...state.remembered, ...state.location.environment }
      const environment = pickAxes(carried, nextCase.environmentAxes)
      return navigate(state, entryLocation(state, { caseId: msg.caseId, environment }), 'push')
    }
    case 'setAxis': {
      const environment = { ...state.location.environment, ...msg.patch }
      const remembered = { ...state.remembered, ...msg.patch }
      return navigate({ ...state, remembered }, entryLocation(state, { environment }), 'push')
    }
    case 'setArtifact':
      return navigate(state, entryLocation(state, { copiedArtifact: msg.artifact }), 'push')
    case 'frameStatus': {
      if (state.frames[msg.key] === undefined) return [state, []]
      const status: FrameStatus =
        msg.status === 'error'
          ? {
              status: 'error',
              code: msg.code ?? 'renderer-failed',
              message: msg.message ?? 'The document reported an error.',
            }
          : { status: msg.status }
      return [{ ...state, frames: { ...state.frames, [msg.key]: status } }, []]
    }
    case 'frameTimeout': {
      const current = state.frames[msg.key]
      if (current === undefined || current.status !== 'loading') return [state, []]
      return [
        {
          ...state,
          frames: {
            ...state.frames,
            [msg.key]: {
              status: 'error',
              code: 'timeout',
              message: `The document did not report back within ${FRAME_TIMEOUT_MS / 1000} seconds.`,
            },
          },
        },
        [],
      ]
    }
    case 'retry': {
      const bumped = { ...state, reload: state.reload + 1, frames: {} }
      const next = withLocation(bumped, state.location)
      return [next, newFrameEffects(bumped, next)]
    }
    case 'setShellTheme':
      return [{ ...state, shellTheme: msg.theme }, []]
    case 'toggleNav':
      return [{ ...state, navOpen: !state.navOpen }, []]
    case 'closeNav':
      return [{ ...state, navOpen: false }, []]
    case 'copyLink':
      return [state, [{ type: 'copy', search: formatGalleryQuery(state.location) }]]
    case 'linkCopied':
      return [{ ...state, copied: true }, []]
  }
}
