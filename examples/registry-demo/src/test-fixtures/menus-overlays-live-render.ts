// TEST-ONLY fixture (packages/components/test/styles/menus-overlays-live-render.browser.test.ts).
// Mounts ONE resolved menus-overlays scenario case at a time through the REAL
// registry renderer (`menus-overlays-scenario-renderer.ts`'s exported
// `REGISTRY_ADAPTERS` + `resolveScenarioSelection`) — never hand-written HTML
// — so collision/virtual-anchor/stacked-overlay/RTL/motion claims can be
// measured against actual rendered output in real Chromium, painted with the
// real registry Tailwind skins (#265 finding #1/#2, part 3). Mirrors
// `menus-overlays-live-render.ts` (components-demo) exactly.
import {
  compileMenusOverlaysCatalog,
  joinMenusOverlaysScenarios,
  resolveScenarioSelection,
  type MenusOverlaysDefinitions,
  type PresentationScenarioEnvironment,
} from '../../../../packages/components/test/styles/menus-overlays-scenarios'
import {
  REGISTRY_ADAPTERS,
  type Disposable,
} from '../../../../registry/test/menus-overlays-scenario-renderer'

type Contract = Parameters<typeof compileMenusOverlaysCatalog>[0]

export interface MountCaseRequest {
  readonly scenarioId: string
  readonly caseId: string
  readonly environment?: Partial<PresentationScenarioEnvironment>
  readonly hostId: string
}

declare global {
  interface Window {
    __mountMenusOverlaysRegistryCase?: (contract: Contract, request: MountCaseRequest) => void
    __disposeMenusOverlaysRegistryCase?: (hostId: string) => void
  }
}

const handles = new Map<string, Disposable>()

window.__mountMenusOverlaysRegistryCase = (contract, request) => {
  const catalog = compileMenusOverlaysCatalog(contract)
  const joined = joinMenusOverlaysScenarios(catalog, contract)
  const scenario = joined.find((entry) => entry.scenarioId === request.scenarioId)
  if (scenario === undefined) {
    throw new Error(`Unknown menus-overlays scenarioId ${request.scenarioId}`)
  }
  const resolved = resolveScenarioSelection<MenusOverlaysDefinitions>(contract, catalog, {
    productId: scenario.productId,
    caseId: request.caseId,
    path: 'registryTailwind',
    ...(request.environment !== undefined ? { environment: request.environment } : {}),
  })
  const adapter = REGISTRY_ADAPTERS[request.scenarioId as keyof typeof REGISTRY_ADAPTERS]
  if (adapter === undefined) {
    throw new Error(`No registry adapter registered for ${request.scenarioId}`)
  }
  const host = document.createElement('section')
  host.id = request.hostId
  document.body.append(host)
  const disposable = (adapter as (host: HTMLElement, input: unknown, ctx: unknown) => Disposable)(
    host,
    resolved.case.input,
    { scenarioId: request.scenarioId, caseId: resolved.case.id, environment: resolved.environment },
  )
  handles.set(request.hostId, disposable)
}

window.__disposeMenusOverlaysRegistryCase = (hostId) => {
  handles.get(hostId)?.dispose()
  handles.delete(hostId)
  document.getElementById(hostId)?.remove()
}
