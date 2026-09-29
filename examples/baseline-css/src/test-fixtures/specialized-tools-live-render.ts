// TEST-ONLY fixture (packages/components/test/styles/specialized-tools-live-render.browser.test.ts).
// Mounts the REAL specialized-tools baseline renderer (#266) in the one example
// app that has NO Tailwind at all, so what Chromium measures is the plain-CSS
// baseline path and nothing else: `theme.css`, no preflight, no utilities.
import '@llui/components/styles/theme.css'
import { mountBaselineSpecializedToolsScenarios } from '../../../../packages/components/test/styles/specialized-tools-baseline-renderer'
import {
  applicableSpecializedToolsScenarios,
  compileSpecializedToolsCatalog,
  joinSpecializedToolsScenarios,
} from '../../../../packages/components/test/styles/specialized-tools-scenarios'

type Contract = Parameters<typeof compileSpecializedToolsCatalog>[0]
type Environment = NonNullable<
  Parameters<typeof mountBaselineSpecializedToolsScenarios>[4]
>['environment']

declare global {
  interface Window {
    __mountSpecializedToolsBaseline?: (contract: Contract, environment?: Environment) => void
  }
}

window.__mountSpecializedToolsBaseline = (contract, environment) => {
  const catalog = compileSpecializedToolsCatalog(contract)
  const container = document.getElementById('app')
  if (container === null) throw new Error('Missing #app container')
  mountBaselineSpecializedToolsScenarios(
    container,
    contract,
    catalog,
    applicableSpecializedToolsScenarios(
      joinSpecializedToolsScenarios(catalog, contract),
      'baseline',
    ),
    environment === undefined ? {} : { environment },
  )
}
