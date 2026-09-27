// TEST-ONLY fixture (packages/components/test/styles/navigation-data-live-render.browser.test.ts).
// Mounts the REAL navigation-data scenario renderer — not hand-written HTML —
// so density/closing-phase geometry claims can be measured against actual
// rendered output in real Chromium (#264 item C).
import { mountRegistryNavigationDataScenarios } from '../../../../registry/test/navigation-data-scenario-renderer'
import { compileNavigationDataCatalog } from '../../../../packages/components/test/styles/navigation-data-scenarios'

// `ProductContract` is derived from an already-resolved value import rather
// than named directly from `@llui/cli` — this app has no dependency on that
// package, only `@llui/components`/`@llui/registry` do (devDependencies, for
// their tests).
type Contract = Parameters<typeof compileNavigationDataCatalog>[0]

declare global {
  interface Window {
    __mountNavigationDataRegistry?: (contract: Contract) => void
  }
}

window.__mountNavigationDataRegistry = (contract) => {
  const catalog = compileNavigationDataCatalog(contract)
  const container = document.getElementById('app')
  if (container === null) throw new Error('Missing #app container')
  mountRegistryNavigationDataScenarios(container, contract, catalog)
}
