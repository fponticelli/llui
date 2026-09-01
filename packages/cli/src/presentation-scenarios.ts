import type { PresentationFamily, ProductContract } from './product-contract.js'

const CASE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Stable values accepted by each composable presentation environment axis. */
export const PRESENTATION_SCENARIO_ENVIRONMENT_VALUES = {
  theme: ['light', 'dark'],
  direction: ['ltr', 'rtl'],
  motion: ['full', 'reduced'],
  viewport: ['wide', 'narrow'],
  forcedColors: ['none', 'active'],
} as const

const ENVIRONMENT_AXES = new Set<string>(Object.keys(PRESENTATION_SCENARIO_ENVIRONMENT_VALUES))

interface JsonInputIssue {
  readonly path: string
  readonly reason: string
}

function childJsonPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`
}

function jsonInputIssue(
  value: unknown,
  path = '$',
  ancestors: Set<object> = new Set(),
): JsonInputIssue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return undefined
  if (typeof value === 'number') {
    return Number.isFinite(value) && !Object.is(value, -0)
      ? undefined
      : { path, reason: 'numbers must be finite and preserve their JSON value' }
  }
  if (typeof value === 'function') {
    return { path, reason: 'function values are not JSON-safe' }
  }
  if (typeof value !== 'object') {
    return { path, reason: `${typeof value} values are not JSON-safe` }
  }
  if (ancestors.has(value)) {
    return { path, reason: 'cyclic references are not JSON-safe' }
  }

  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.some((key) => typeof key === 'symbol')) {
      return { path, reason: 'symbol-keyed properties are not JSON-safe' }
    }
    const stringKeys = ownKeys.filter((key): key is string => typeof key === 'string')
    for (const key of stringKeys) {
      if (key === 'length') continue
      if (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= 4_294_967_295) {
        return {
          path: childJsonPath(path, key),
          reason: 'non-index array properties are not JSON-safe',
        }
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!
      if (!('value' in descriptor)) {
        return {
          path: `${path}[${key}]`,
          reason: 'accessor properties are not JSON-safe',
        }
      }
      if (!descriptor.enumerable) {
        return {
          path: `${path}[${key}]`,
          reason: 'non-enumerable properties are not JSON-safe',
        }
      }
    }

    ancestors.add(value)
    for (const [index, item] of value.entries()) {
      const issue = jsonInputIssue(item, `${path}[${index}]`, ancestors)
      if (issue !== undefined) {
        ancestors.delete(value)
        return issue
      }
    }
    ancestors.delete(value)
    return undefined
  }

  const prototype = Object.getPrototypeOf(value) as object | null
  if (prototype !== Object.prototype && prototype !== null) {
    return { path, reason: 'only plain objects are JSON-safe' }
  }

  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.some((key) => typeof key === 'symbol')) {
    return { path, reason: 'symbol-keyed properties are not JSON-safe' }
  }
  const stringKeys = ownKeys.filter((key): key is string => typeof key === 'string')

  ancestors.add(value)
  for (const key of stringKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (!('value' in descriptor)) {
      ancestors.delete(value)
      return {
        path: childJsonPath(path, key),
        reason: 'accessor properties are not JSON-safe',
      }
    }
    if (!descriptor.enumerable) {
      ancestors.delete(value)
      return {
        path: childJsonPath(path, key),
        reason: 'non-enumerable properties are not JSON-safe',
      }
    }
    const issue = jsonInputIssue(descriptor.value, childJsonPath(path, key), ancestors)
    if (issue !== undefined) {
      ancestors.delete(value)
      return issue
    }
  }
  ancestors.delete(value)
  return undefined
}

function cloneJsonInput(value: PresentationScenarioJson): PresentationScenarioJson {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) {
    throw new Error('Validated presentation scenario input could not be serialized.')
  }
  return JSON.parse(encoded) as PresentationScenarioJson
}

/** Renderer-neutral data accepted as a scenario input. */
export type PresentationScenarioJson =
  | null
  | boolean
  | number
  | string
  | readonly PresentationScenarioJson[]
  | { readonly [key: string]: PresentationScenarioJson }

/** One environment dimension a case explicitly supports varying. */
export type PresentationScenarioEnvironmentAxis =
  keyof typeof PRESENTATION_SCENARIO_ENVIRONMENT_VALUES

/** Fully resolved environment supplied independently to either renderer path. */
export type PresentationScenarioEnvironment = {
  readonly [Axis in PresentationScenarioEnvironmentAxis]: (typeof PRESENTATION_SCENARIO_ENVIRONMENT_VALUES)[Axis][number]
}

/** Canonical environment used when a selection omits supported overrides. */
export const DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT = {
  theme: 'light',
  direction: 'ltr',
  motion: 'full',
  viewport: 'wide',
  forcedColors: 'none',
} as const satisfies PresentationScenarioEnvironment

/** Renderer paths joined by the protocol while remaining implementation-isolated. */
export const PRESENTATION_SCENARIO_PATHS = ['baseline', 'registryTailwind'] as const

const PRESENTATION_SCENARIO_PATH_SET = new Set<string>(PRESENTATION_SCENARIO_PATHS)

/** A renderer path whose availability is owned by ProductContract. */
export type PresentationScenarioPath = (typeof PRESENTATION_SCENARIO_PATHS)[number]

/** One stable, product-local state owned by a presentation family. */
export interface PresentationScenarioCase<
  Input extends PresentationScenarioJson = PresentationScenarioJson,
> {
  readonly id: string
  readonly label: string
  readonly input: Input
  readonly environmentAxes: readonly PresentationScenarioEnvironmentAxis[]
  /** Registry copied artifacts this case supports; omitted means every owned artifact. */
  readonly copiedArtifactNames?: readonly string[]
}

/** All semantic cases declared for one ProductContract scenario identity. */
export interface PresentationScenarioDefinition<
  Case extends PresentationScenarioCase = PresentationScenarioCase,
> {
  readonly defaultCaseId: string
  readonly cases: readonly Case[]
}

/** Family-owned definitions keyed by ProductContract `scenarioId`. */
export type PresentationScenarioDefinitions = Readonly<
  Record<string, PresentationScenarioDefinition>
>

/** Canonical renderer input copied from a validated family case. */
export interface CompiledPresentationScenarioCase<
  Case extends PresentationScenarioCase = PresentationScenarioCase,
> {
  readonly id: Case['id']
  readonly label: Case['label']
  readonly input: Case['input']
  readonly environmentAxes: Case['environmentAxes']
  readonly copiedArtifactNames?: Case['copiedArtifactNames']
}

/** One compiled product join without duplicated ProductContract metadata. */
export interface CompiledPresentationScenario<
  Case extends PresentationScenarioCase = PresentationScenarioCase,
> {
  readonly productId: string
  readonly scenarioId: string
  readonly defaultCaseId: string
  readonly cases: readonly CompiledPresentationScenarioCase<Case>[]
}

/** Deterministic, JSON-safe catalog for one presentation family. */
export interface CompiledPresentationScenarioFamily<
  Case extends PresentationScenarioCase = PresentationScenarioCase,
> {
  readonly version: 1
  readonly family: PresentationFamily
  readonly scenarios: readonly CompiledPresentationScenario<Case>[]
}

/** Route-like request for one scenario case, renderer path, and environment. */
export interface PresentationScenarioSelection {
  readonly productId: string
  readonly caseId?: string
  readonly path: PresentationScenarioPath
  readonly environment?: Partial<PresentationScenarioEnvironment>
  readonly copiedArtifact?: string
}

/** Validated renderer input returned for a presentation selection. */
export interface ResolvedPresentationScenarioSelection<
  Case extends PresentationScenarioCase = PresentationScenarioCase,
> {
  readonly productId: string
  readonly scenarioId: string
  readonly case: CompiledPresentationScenarioCase<Case>
  readonly path: PresentationScenarioPath
  readonly environment: PresentationScenarioEnvironment
  readonly copiedArtifact?: {
    readonly name: string
    readonly scenarioId: string
  }
}

/** Stable failure categories exposed to gallery routing and build tooling. */
export type PresentationScenarioErrorCode =
  | 'invalid-definitions'
  | 'unknown-product'
  | 'unknown-case'
  | 'invalid-environment'
  | 'invalid-copied-artifact'
  | 'invalid-catalog'
  | 'invalid-path'

/** A stable, machine-readable protocol or selection failure. */
export class PresentationScenarioError extends Error {
  override readonly name = 'PresentationScenarioError'

  constructor(
    readonly code: PresentationScenarioErrorCode,
    readonly issues: readonly string[],
  ) {
    super(issues.join('\n'))
  }
}

function scenarioDefinitionIssues(
  entry: ProductContract['entries'][number],
  definition: PresentationScenarioDefinition,
): string[] {
  const issues: string[] = []
  if (definition.cases.length === 0) {
    issues.push(`Scenario "${entry.scenarioId}" must define at least one case.`)
  }
  if (!CASE_ID.test(definition.defaultCaseId)) {
    issues.push(
      `Invalid default case id "${definition.defaultCaseId}" in scenario "${entry.scenarioId}".`,
    )
  }

  const caseIds = new Set<string>()
  const copiedArtifactNames = new Set(entry.copiedArtifacts.map(({ name }) => name))
  for (const scenarioCase of definition.cases) {
    if (!CASE_ID.test(scenarioCase.id)) {
      issues.push(`Invalid case id "${scenarioCase.id}" in scenario "${entry.scenarioId}".`)
    }
    if (caseIds.has(scenarioCase.id)) {
      issues.push(`Duplicate case id "${scenarioCase.id}" in scenario "${entry.scenarioId}".`)
    }
    caseIds.add(scenarioCase.id)

    if (scenarioCase.label.trim() === '') {
      issues.push(`Case "${scenarioCase.id}" in scenario "${entry.scenarioId}" has an empty label.`)
    }

    const environmentAxes = new Set<string>()
    for (const axis of scenarioCase.environmentAxes) {
      if (!ENVIRONMENT_AXES.has(axis)) {
        issues.push(
          `Case "${scenarioCase.id}" in scenario "${entry.scenarioId}" has unknown environment axis "${axis}".`,
        )
      }
      if (environmentAxes.has(axis)) {
        issues.push(
          `Case "${scenarioCase.id}" in scenario "${entry.scenarioId}" has duplicate environment axis "${axis}".`,
        )
      }
      environmentAxes.add(axis)
    }

    const inputIssue = jsonInputIssue(scenarioCase.input)
    if (inputIssue !== undefined) {
      issues.push(
        `Invalid JSON input for case "${scenarioCase.id}" in scenario "${entry.scenarioId}" at ${inputIssue.path}: ${inputIssue.reason}.`,
      )
    }

    const seenCopiedArtifacts = new Set<string>()
    for (const target of scenarioCase.copiedArtifactNames ?? []) {
      if (!copiedArtifactNames.has(target)) {
        issues.push(
          `Case "${scenarioCase.id}" in scenario "${entry.scenarioId}" targets unknown copied artifact "${target}".`,
        )
      }
      if (seenCopiedArtifacts.has(target)) {
        issues.push(
          `Case "${scenarioCase.id}" in scenario "${entry.scenarioId}" has duplicate copied-artifact target "${target}".`,
        )
      }
      seenCopiedArtifacts.add(target)
    }
  }
  if (!caseIds.has(definition.defaultCaseId)) {
    issues.push(
      `Default case "${definition.defaultCaseId}" does not exist in scenario "${entry.scenarioId}".`,
    )
  }
  return issues
}

function catalogIntegrityIssues(
  contract: ProductContract,
  catalog: CompiledPresentationScenarioFamily,
): string[] {
  const issues: string[] = []
  if (catalog.version !== 1) {
    issues.push(`Catalog version "${String(catalog.version)}" is unsupported; expected 1.`)
  }

  const entries = contract.entries.filter((entry) => entry.presentation.family === catalog.family)
  if (entries.length === 0) {
    issues.push(`Catalog family "${String(catalog.family)}" has no ProductContract entries.`)
    return issues.sort()
  }

  const entriesByScenario = new Map(entries.map((entry) => [entry.scenarioId, entry]))
  const seenProducts = new Set<string>()
  const seenScenarios = new Set<string>()
  for (const scenario of catalog.scenarios) {
    if (seenProducts.has(scenario.productId)) {
      issues.push(`Catalog contains duplicate product "${scenario.productId}".`)
    }
    seenProducts.add(scenario.productId)
    if (seenScenarios.has(scenario.scenarioId)) {
      issues.push(`Catalog contains duplicate scenario "${scenario.scenarioId}".`)
    }
    seenScenarios.add(scenario.scenarioId)

    const entry = entriesByScenario.get(scenario.scenarioId)
    if (entry === undefined) {
      issues.push(
        `Catalog contains stale scenario "${scenario.scenarioId}" for product "${scenario.productId}".`,
      )
      continue
    }
    if (entry.name !== scenario.productId) {
      issues.push(
        `Catalog scenario "${scenario.scenarioId}" is attached to product "${scenario.productId}", expected "${entry.name}".`,
      )
      continue
    }
    issues.push(...scenarioDefinitionIssues(entry, scenario))
  }

  for (const entry of entries) {
    if (!seenScenarios.has(entry.scenarioId)) {
      issues.push(`Catalog is missing scenario "${entry.scenarioId}" for product "${entry.name}".`)
    }
  }

  const hasExactIdentities =
    catalog.scenarios.length === entries.length &&
    entries.every(
      (entry) =>
        catalog.scenarios.filter(
          (scenario) =>
            scenario.scenarioId === entry.scenarioId && scenario.productId === entry.name,
        ).length === 1,
    )
  if (hasExactIdentities) {
    for (const [index, entry] of entries.entries()) {
      const scenario = catalog.scenarios[index]!
      if (scenario.productId !== entry.name || scenario.scenarioId !== entry.scenarioId) {
        issues.push(
          `Catalog scenario "${scenario.scenarioId}" for product "${scenario.productId}" is out of canonical order at index ${index}.`,
        )
      }
    }
  }

  return issues.sort()
}

/** Join family-owned semantic cases to ProductContract's canonical inventory. */
export function compileScenarioFamily<const Definitions extends PresentationScenarioDefinitions>(
  contract: ProductContract,
  family: PresentationFamily,
  definitions: Definitions,
): CompiledPresentationScenarioFamily<Definitions[keyof Definitions]['cases'][number]>
export function compileScenarioFamily(
  contract: ProductContract,
  family: PresentationFamily,
  definitions: PresentationScenarioDefinitions,
): CompiledPresentationScenarioFamily {
  const entries = contract.entries.filter((entry) => entry.presentation.family === family)
  const expectedScenarioIds = new Set(entries.map((entry) => entry.scenarioId))
  const issues = [
    ...entries
      .filter((entry) => definitions[entry.scenarioId] === undefined)
      .map(
        (entry) =>
          `Missing definition for scenario "${entry.scenarioId}" (product "${entry.name}").`,
      ),
    ...Object.keys(definitions)
      .filter((scenarioId) => !expectedScenarioIds.has(scenarioId))
      .map((scenarioId) => `Stale definition for scenario "${scenarioId}".`),
  ]

  for (const entry of entries) {
    const definition = definitions[entry.scenarioId]
    if (definition === undefined) continue
    issues.push(...scenarioDefinitionIssues(entry, definition))
  }

  issues.sort()

  if (issues.length > 0) throw new PresentationScenarioError('invalid-definitions', issues)

  return {
    version: 1,
    family,
    scenarios: entries.map((entry) => {
      const definition = definitions[entry.scenarioId]!
      return {
        productId: entry.name,
        scenarioId: entry.scenarioId,
        defaultCaseId: definition.defaultCaseId,
        cases: definition.cases.map((scenarioCase) => ({
          id: scenarioCase.id,
          label: scenarioCase.label,
          input: cloneJsonInput(scenarioCase.input),
          environmentAxes: [...scenarioCase.environmentAxes],
          ...(scenarioCase.copiedArtifactNames === undefined
            ? {}
            : { copiedArtifactNames: [...scenarioCase.copiedArtifactNames] }),
        })),
      }
    }),
  }
}

/** Resolve one deterministic renderer input from a compiled family catalog. */
export function resolveScenarioSelection<Case extends PresentationScenarioCase>(
  contract: ProductContract,
  catalog: CompiledPresentationScenarioFamily<Case>,
  selection: PresentationScenarioSelection,
): ResolvedPresentationScenarioSelection<Case>
export function resolveScenarioSelection(
  contract: ProductContract,
  catalog: CompiledPresentationScenarioFamily,
  selection: PresentationScenarioSelection,
): ResolvedPresentationScenarioSelection {
  const catalogIssues = catalogIntegrityIssues(contract, catalog)
  if (catalogIssues.length > 0) {
    throw new PresentationScenarioError('invalid-catalog', catalogIssues)
  }

  const scenario = catalog.scenarios.find(({ productId }) => productId === selection.productId)
  if (scenario === undefined) {
    throw new PresentationScenarioError('unknown-product', [
      `Unknown product "${selection.productId}" in compiled family "${catalog.family}".`,
    ])
  }
  const entry = contract.entries.find(({ name }) => name === selection.productId)
  if (
    entry === undefined ||
    entry.scenarioId !== scenario.scenarioId ||
    entry.presentation.family !== catalog.family
  ) {
    throw new PresentationScenarioError('invalid-catalog', [
      `Catalog contains stale scenario "${scenario.scenarioId}" for product "${selection.productId}".`,
    ])
  }
  if (!PRESENTATION_SCENARIO_PATH_SET.has(selection.path)) {
    throw new PresentationScenarioError('invalid-path', [
      `Unknown presentation path "${String(selection.path)}".`,
    ])
  }
  if (entry.presentation[selection.path].mode === 'not-applicable') {
    throw new PresentationScenarioError('invalid-path', [
      `Presentation path "${selection.path}" is not applicable to product "${selection.productId}".`,
    ])
  }
  const caseId = selection.caseId ?? scenario.defaultCaseId
  const scenarioCase = scenario.cases.find(({ id }) => id === caseId)
  if (scenarioCase === undefined) {
    throw new PresentationScenarioError('unknown-case', [
      `Unknown case "${caseId}" for product "${selection.productId}".`,
    ])
  }

  const environment = selection.environment ?? {}
  const environmentIssues: string[] = []
  for (const [axis, value] of Object.entries(environment)) {
    if (!ENVIRONMENT_AXES.has(axis)) {
      environmentIssues.push(`Environment axis "${axis}" is unknown.`)
      continue
    }

    const knownAxis = axis as PresentationScenarioEnvironmentAxis
    const allowedValues = PRESENTATION_SCENARIO_ENVIRONMENT_VALUES[knownAxis] as readonly unknown[]
    if (!allowedValues.includes(value)) {
      environmentIssues.push(`Environment axis "${axis}" has unknown value "${String(value)}".`)
      continue
    }
    if (!scenarioCase.environmentAxes.includes(knownAxis)) {
      environmentIssues.push(
        `Case "${caseId}" for product "${selection.productId}" does not support environment axis "${axis}".`,
      )
    }
  }
  if (environmentIssues.length > 0) {
    throw new PresentationScenarioError('invalid-environment', environmentIssues.sort())
  }
  if (selection.copiedArtifact !== undefined && selection.path !== 'registryTailwind') {
    throw new PresentationScenarioError('invalid-copied-artifact', [
      `Copied-artifact target "${selection.copiedArtifact}" is invalid on the baseline path.`,
    ])
  }
  if (
    selection.copiedArtifact !== undefined &&
    !entry.copiedArtifacts.some(({ name }) => name === selection.copiedArtifact)
  ) {
    throw new PresentationScenarioError('invalid-copied-artifact', [
      `Product "${selection.productId}" does not own copied artifact "${selection.copiedArtifact}".`,
    ])
  }
  if (
    selection.copiedArtifact !== undefined &&
    scenarioCase.copiedArtifactNames !== undefined &&
    !scenarioCase.copiedArtifactNames.includes(selection.copiedArtifact)
  ) {
    throw new PresentationScenarioError('invalid-copied-artifact', [
      `Case "${caseId}" for product "${selection.productId}" does not support copied artifact "${selection.copiedArtifact}".`,
    ])
  }
  const eligibleArtifacts =
    scenarioCase.copiedArtifactNames === undefined
      ? entry.copiedArtifacts
      : entry.copiedArtifacts.filter(({ name }) => scenarioCase.copiedArtifactNames!.includes(name))
  const selectedArtifactName =
    selection.path === 'registryTailwind'
      ? (selection.copiedArtifact ??
        eligibleArtifacts.find(({ name }) => name === entry.name)?.name ??
        (eligibleArtifacts.length === 1 ? eligibleArtifacts[0]!.name : undefined))
      : undefined
  if (
    selection.path === 'registryTailwind' &&
    selectedArtifactName === undefined &&
    scenarioCase.copiedArtifactNames !== undefined &&
    eligibleArtifacts.length === 0
  ) {
    throw new PresentationScenarioError('invalid-copied-artifact', [
      `Case "${caseId}" for product "${selection.productId}" has no eligible copied artifact for the registryTailwind path.`,
    ])
  }
  if (
    selection.path === 'registryTailwind' &&
    selectedArtifactName === undefined &&
    eligibleArtifacts.length > 1
  ) {
    const targets = eligibleArtifacts
      .map(({ name }) => `"${name}"`)
      .sort()
      .join(', ')
    throw new PresentationScenarioError('invalid-copied-artifact', [
      `Case "${caseId}" for product "${selection.productId}" has multiple eligible copied artifacts; select one explicitly: ${targets}.`,
    ])
  }
  const copiedArtifact = entry.copiedArtifacts.find(({ name }) => name === selectedArtifactName)

  return {
    productId: scenario.productId,
    scenarioId: scenario.scenarioId,
    case: scenarioCase,
    path: selection.path,
    environment: {
      ...DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
      ...environment,
    },
    ...(copiedArtifact === undefined
      ? {}
      : {
          copiedArtifact: {
            name: copiedArtifact.name,
            scenarioId: copiedArtifact.scenarioId ?? entry.scenarioId,
          },
        }),
  }
}
