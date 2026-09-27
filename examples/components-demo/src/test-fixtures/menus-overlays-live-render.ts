// TEST-ONLY fixture (packages/components/test/styles/menus-overlays-live-render.browser.test.ts).
// Mounts ONE resolved menus-overlays scenario case at a time through the REAL
// baseline renderer (`menus-overlays-baseline-renderer.ts`'s exported
// `BASELINE_ADAPTERS` + `resolveScenarioSelection`) — never hand-written HTML
// — so collision/virtual-anchor/stacked-overlay/RTL/motion claims can be
// measured against actual rendered output in real Chromium (#265 finding
// #1/#2, part 3). Mirrors `navigation-data-live-render.ts`'s pattern (#264
// item C) but exposes a per-case mount rather than an "everything at once"
// mount, because several of this suite's assertions need the SAME product
// mounted twice on one page (stacked/nested overlays) or need a live
// `dispose()` handle to drive presence transitions after mount.
import {
  compileMenusOverlaysCatalog,
  joinMenusOverlaysScenarios,
  resolveScenarioSelection,
  type MenusOverlaysDefinitions,
  type PresentationScenarioEnvironment,
} from '../../../../packages/components/test/styles/menus-overlays-scenarios'
import {
  BASELINE_ADAPTERS,
  type Disposable,
} from '../../../../packages/components/test/styles/menus-overlays-baseline-renderer'

// `ProductContract` is derived from an already-resolved value import rather
// than named directly from `@llui/cli` — this app has no dependency on that
// package, only `@llui/components` does (a devDependency, for its tests).
type Contract = Parameters<typeof compileMenusOverlaysCatalog>[0]

export interface MountCaseRequest {
  readonly scenarioId: string
  readonly caseId: string
  readonly environment?: Partial<PresentationScenarioEnvironment>
  readonly hostId: string
}

declare global {
  interface Window {
    __mountMenusOverlaysBaselineCase?: (contract: Contract, request: MountCaseRequest) => void
    __disposeMenusOverlaysBaselineCase?: (hostId: string) => void
  }
}

const handles = new Map<string, Disposable>()

window.__mountMenusOverlaysBaselineCase = (contract, request) => {
  const catalog = compileMenusOverlaysCatalog(contract)
  const joined = joinMenusOverlaysScenarios(catalog, contract)
  const scenario = joined.find((entry) => entry.scenarioId === request.scenarioId)
  if (scenario === undefined) {
    throw new Error(`Unknown menus-overlays scenarioId ${request.scenarioId}`)
  }
  const resolved = resolveScenarioSelection<MenusOverlaysDefinitions>(contract, catalog, {
    productId: scenario.productId,
    caseId: request.caseId,
    path: 'baseline',
    ...(request.environment !== undefined ? { environment: request.environment } : {}),
  })
  const adapter = BASELINE_ADAPTERS[request.scenarioId as keyof typeof BASELINE_ADAPTERS]
  if (adapter === undefined) {
    throw new Error(`No baseline adapter registered for ${request.scenarioId}`)
  }
  const host = document.createElement('section')
  host.id = request.hostId
  // The host is the case's THEMED CONTAINER, so it paints like one: a
  // subtree theme (`data-theme` on the host, written by the renderer) only
  // re-scopes the tokens; the container itself must paint the surface and
  // text colour, or its unpainted descendants show the page's theme through
  // it. Measured against a page-level theme in
  // `menus-overlays-product-effects.browser.test.ts`.
  host.style.background = 'var(--background)'
  host.style.color = 'var(--foreground)'
  document.body.append(host)
  const disposable = (adapter as (host: HTMLElement, input: unknown, ctx: unknown) => Disposable)(
    host,
    resolved.case.input,
    { scenarioId: request.scenarioId, caseId: resolved.case.id, environment: resolved.environment },
  )
  handles.set(request.hostId, disposable)
}

window.__disposeMenusOverlaysBaselineCase = (hostId) => {
  handles.get(hostId)?.dispose()
  handles.delete(hostId)
  document.getElementById(hostId)?.remove()
}
