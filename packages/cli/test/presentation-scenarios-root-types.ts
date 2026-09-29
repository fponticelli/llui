// Every protocol symbol is direct-subpath-only. Each directive is a mutation gate: exporting that
// symbol from the root by a named export, alias, or export-star makes the directive unused.

// @ts-expect-error direct-subpath-only value
import { PRESENTATION_SCENARIO_ENVIRONMENT_VALUES as rootEnvironmentValues } from '../src/index.js'
// @ts-expect-error direct-subpath-only value
import { DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT as rootDefaultEnvironment } from '../src/index.js'
// @ts-expect-error direct-subpath-only value
import { PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS as rootDiagnosticLimits } from '../src/index.js'
// @ts-expect-error direct-subpath-only value
import { PRESENTATION_SCENARIO_COMPLEXITY_LIMITS as rootComplexityLimits } from '../src/index.js'
// @ts-expect-error direct-subpath-only value
import { PRESENTATION_SCENARIO_PATHS as rootPaths } from '../src/index.js'
// @ts-expect-error direct-subpath-only value
import { PresentationScenarioError as RootScenarioError } from '../src/index.js'
// @ts-expect-error direct-subpath-only value
import { compileScenarioFamily as rootCompile } from '../src/index.js'
// @ts-expect-error direct-subpath-only value
import { decodeScenarioFamily as rootDecodeFamily } from '../src/index.js'
// @ts-expect-error direct-subpath-only value
import { resolveScenarioSelection as rootResolve } from '../src/index.js'
// @ts-expect-error direct-subpath-only value
import { decodeScenarioSelection as rootDecodeSelection } from '../src/index.js'
// @ts-expect-error direct-subpath-only value
import { dispatchScenarioSelection as rootDispatch } from '../src/index.js'
// @ts-expect-error direct-subpath-only value
import { bindScenarioAdapters as rootBind } from '../src/index.js'

// @ts-expect-error direct-subpath-only type
import type { PresentationScenarioJson as RootJson } from '../src/index.js'
// @ts-expect-error direct-subpath-only type
import type { PresentationScenarioJsonSnapshot as RootJsonSnapshot } from '../src/index.js'
// @ts-expect-error direct-subpath-only type
import type { PresentationScenarioEnvironmentAxis as RootAxis } from '../src/index.js'
// @ts-expect-error direct-subpath-only type
import type { PresentationScenarioEnvironment as RootEnvironment } from '../src/index.js'
// @ts-expect-error direct-subpath-only type
import type { PresentationScenarioPath as RootPath } from '../src/index.js'
// @ts-expect-error direct-subpath-only type
import type { PresentationScenarioCase as RootCase } from '../src/index.js'
// @ts-expect-error direct-subpath-only type
import type { PresentationScenarioDefinition as RootDefinition } from '../src/index.js'
// @ts-expect-error direct-subpath-only type
import type { PresentationScenarioDefinitions as RootDefinitions } from '../src/index.js'
// @ts-expect-error direct-subpath-only type
import type { CompiledPresentationScenarioCase as RootCompiledCase } from '../src/index.js'
// @ts-expect-error direct-subpath-only type
import type { CompiledPresentationScenario as RootCompiledScenario } from '../src/index.js'
// @ts-expect-error direct-subpath-only type
import type { CompiledPresentationScenarioFamily as RootCompiledFamily } from '../src/index.js'
// @ts-expect-error direct-subpath-only type
import type { PresentationScenarioSelection as RootSelection } from '../src/index.js'
// @ts-expect-error direct-subpath-only type
import type { ResolvedPresentationScenarioSelection as RootResolved } from '../src/index.js'
// @ts-expect-error direct-subpath-only type
import type { PresentationScenarioErrorCode as RootErrorCode } from '../src/index.js'
// @ts-expect-error direct-subpath-only type
import type { PresentationScenarioFamilyIds as RootFamilyIds } from '../src/index.js'
// @ts-expect-error direct-subpath-only type
import type { PresentationScenarioCaseInput as RootCaseInput } from '../src/index.js'
// @ts-expect-error direct-subpath-only type
import type { PresentationScenarioAdapterContext as RootAdapterContext } from '../src/index.js'
// @ts-expect-error direct-subpath-only type
import type { PresentationScenarioAdapterExtra as RootAdapterExtra } from '../src/index.js'
// @ts-expect-error direct-subpath-only type
import type { NoPresentationScenarioAdapterExtra as RootNoExtra } from '../src/index.js'
// @ts-expect-error direct-subpath-only type
import type { PresentationScenarioAdapter as RootAdapter } from '../src/index.js'
// @ts-expect-error direct-subpath-only type
import type { PresentationScenarioAdapters as RootAdapters } from '../src/index.js'
// @ts-expect-error direct-subpath-only type
import type { PreparedPresentationScenario as RootPrepared } from '../src/index.js'
// @ts-expect-error direct-subpath-only type
import type { PresentationScenarioAdapterBinding as RootBinding } from '../src/index.js'

void [
  rootEnvironmentValues,
  rootDefaultEnvironment,
  rootDiagnosticLimits,
  rootComplexityLimits,
  rootPaths,
  RootScenarioError,
  rootCompile,
  rootDecodeFamily,
  rootResolve,
  rootDecodeSelection,
  rootDispatch,
  rootBind,
]
type RootTypes =
  | RootJson
  | RootJsonSnapshot
  | RootAxis
  | RootEnvironment
  | RootPath
  | RootCase
  | RootDefinition
  | RootDefinitions
  | RootCompiledCase
  | RootCompiledScenario
  | RootCompiledFamily
  | RootSelection
  | RootResolved
  | RootErrorCode
  | RootFamilyIds
  | RootCaseInput<never, never>
  | RootAdapterContext
  | RootAdapterExtra<never>
  | RootNoExtra
  | RootAdapter<never, never, never, never>
  | RootAdapters<never, never, never>
  | RootPrepared<never, never>
  | RootBinding<never, never>
declare const rootTypes: RootTypes
void rootTypes
