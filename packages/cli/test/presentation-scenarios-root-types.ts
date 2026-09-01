// Every protocol symbol is direct-subpath-only. Each directive is a mutation gate: exporting that
// symbol from the root by a named export, alias, or export-star makes the directive unused.

// @ts-expect-error direct-subpath-only value
import { PRESENTATION_SCENARIO_ENVIRONMENT_VALUES as rootEnvironmentValues } from '../src/index.js'
// @ts-expect-error direct-subpath-only value
import { DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT as rootDefaultEnvironment } from '../src/index.js'
// @ts-expect-error direct-subpath-only value
import { PRESENTATION_SCENARIO_PATHS as rootPaths } from '../src/index.js'
// @ts-expect-error direct-subpath-only value
import { PresentationScenarioError as RootScenarioError } from '../src/index.js'
// @ts-expect-error direct-subpath-only value
import { compileScenarioFamily as rootCompile } from '../src/index.js'
// @ts-expect-error direct-subpath-only value
import { resolveScenarioSelection as rootResolve } from '../src/index.js'

// @ts-expect-error direct-subpath-only type
import type { PresentationScenarioJson as RootJson } from '../src/index.js'
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

void [
  rootEnvironmentValues,
  rootDefaultEnvironment,
  rootPaths,
  RootScenarioError,
  rootCompile,
  rootResolve,
]
type RootTypes =
  | RootJson
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
declare const rootTypes: RootTypes
void rootTypes
