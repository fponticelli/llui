// TEST-ONLY fixture (packages/components/test/styles/specialized-tools-live-render.browser.test.ts).
// Mounts the REAL specialized-tools registry renderer (#266) — the copied skins,
// compiled by this app's real Tailwind v4 pipeline against `tokens.css`.
import { mountRegistrySpecializedToolsScenarios } from '../../../../registry/test/specialized-tools-scenario-renderer'
import {
  applicableSpecializedToolsScenarios,
  compileSpecializedToolsCatalog,
  joinSpecializedToolsScenarios,
} from '../../../../packages/components/test/styles/specialized-tools-scenarios'

type Contract = Parameters<typeof compileSpecializedToolsCatalog>[0]
type Environment = NonNullable<
  Parameters<typeof mountRegistrySpecializedToolsScenarios>[4]
>['environment']

declare global {
  interface Window {
    __mountSpecializedToolsRegistry?: (contract: Contract, environment?: Environment) => void
  }
}

window.__mountSpecializedToolsRegistry = (contract, environment) => {
  const catalog = compileSpecializedToolsCatalog(contract)
  const container = document.getElementById('app')
  if (container === null) throw new Error('Missing #app container')
  mountRegistrySpecializedToolsScenarios(
    container,
    contract,
    catalog,
    applicableSpecializedToolsScenarios(
      joinSpecializedToolsScenarios(catalog, contract),
      'registryTailwind',
    ),
    environment === undefined ? {} : { environment },
  )
}
