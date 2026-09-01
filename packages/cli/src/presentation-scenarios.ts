import type { PresentationFamily, ProductContract } from './product-contract-types.js'

const CASE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const OBJECT_SOURCE = Function.prototype.toString.call(Object)
const ARRAY_SOURCE = Function.prototype.toString.call(Array)
const ARRAY_ENTRIES_SOURCE = Function.prototype.toString.call(Array.prototype.entries)
const ARRAY_ITERATOR_SOURCE = Function.prototype.toString.call(Array.prototype[Symbol.iterator])
const MAX_DEPTH = 64
const MAX_NODES = 5_000
const MAX_STRING_LENGTH = 100_000
const MAX_TOTAL_STRING_UNITS = 1_000_000
const MAX_ARRAY_LENGTH = 1_000
const MAX_FIELDS = 10_000
const MAX_ISSUES = 100

const THEME_VALUES = Object.freeze(['light', 'dark'] as const)
const DIRECTION_VALUES = Object.freeze(['ltr', 'rtl'] as const)
const MOTION_VALUES = Object.freeze(['full', 'reduced'] as const)
const VIEWPORT_VALUES = Object.freeze(['wide', 'narrow'] as const)
const FORCED_COLOR_VALUES = Object.freeze(['none', 'active'] as const)

/** Stable values accepted by each composable presentation environment axis. */
export const PRESENTATION_SCENARIO_ENVIRONMENT_VALUES = Object.freeze({
  theme: THEME_VALUES,
  direction: DIRECTION_VALUES,
  motion: MOTION_VALUES,
  viewport: VIEWPORT_VALUES,
  forcedColors: FORCED_COLOR_VALUES,
})

const ENVIRONMENT_AXES = new Set<string>([
  'theme',
  'direction',
  'motion',
  'viewport',
  'forcedColors',
])
const PRESENTATION_FAMILY_VALUES = [
  'forms-controls',
  'navigation-data',
  'menus-overlays',
  'specialized-tools',
] as const
const PRESENTATION_FAMILIES = new Set<string>(PRESENTATION_FAMILY_VALUES)
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Assert<Value extends true> = Value
type _PresentationFamilyRuntimeValuesMatchContract = Assert<
  Equal<(typeof PRESENTATION_FAMILY_VALUES)[number], PresentationFamily>
>

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
export const DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT = Object.freeze({
  theme: 'light',
  direction: 'ltr',
  motion: 'full',
  viewport: 'wide',
  forcedColors: 'none',
} as const satisfies PresentationScenarioEnvironment)

/** Renderer paths joined by the protocol while remaining implementation-isolated. */
export const PRESENTATION_SCENARIO_PATHS = Object.freeze(['baseline', 'registryTailwind'] as const)

const PRESENTATION_SCENARIO_PATH_SET = new Set<string>(['baseline', 'registryTailwind'])

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
export type CompiledPresentationScenarioCase<
  Case extends PresentationScenarioCase = PresentationScenarioCase,
> = Case extends PresentationScenarioCase
  ? {
      readonly id: Case['id']
      readonly label: Case['label']
      readonly input: Case['input']
      readonly environmentAxes: Case['environmentAxes']
      readonly copiedArtifactNames?: Case['copiedArtifactNames']
    }
  : never

type ScenarioId<Definitions extends PresentationScenarioDefinitions> = keyof Definitions & string
type DefinitionCase<
  Definitions extends PresentationScenarioDefinitions,
  Id extends ScenarioId<Definitions>,
> = Definitions[Id]['cases'][number]

type ErasedCompiledPresentationScenario = {
  readonly productId: string
  readonly scenarioId: string
  readonly defaultCaseId: string
  readonly cases: readonly CompiledPresentationScenarioCase[]
}

/** A definition-keyed discriminated union of compiled ProductContract joins. */
export type CompiledPresentationScenario<
  Definitions extends PresentationScenarioDefinitions = PresentationScenarioDefinitions,
> =
  string extends ScenarioId<Definitions>
    ? ErasedCompiledPresentationScenario
    : {
        readonly [Id in ScenarioId<Definitions>]: {
          readonly productId: string
          readonly scenarioId: Id
          readonly defaultCaseId: Definitions[Id]['defaultCaseId']
          readonly cases: readonly CompiledPresentationScenarioCase<
            DefinitionCase<Definitions, Id>
          >[]
        }
      }[ScenarioId<Definitions>]

/** Deterministic, JSON-safe catalog for one presentation family. */
export type CompiledPresentationScenarioFamily<
  Definitions extends PresentationScenarioDefinitions = PresentationScenarioDefinitions,
> = {
  readonly version: 1
  readonly family: PresentationFamily
  readonly scenarios: readonly CompiledPresentationScenario<Definitions>[]
}

/** Route-like request for one scenario case, renderer path, and environment. */
export interface PresentationScenarioSelection {
  readonly productId: string
  readonly caseId?: string
  readonly path: PresentationScenarioPath
  readonly environment?: Partial<PresentationScenarioEnvironment>
  readonly copiedArtifact?: string
}

type ResolvedScenario<Scenario> = Scenario extends {
  readonly scenarioId: infer Id extends string
  readonly cases: readonly (infer Case)[]
}
  ? {
      readonly productId: string
      readonly scenarioId: Id
      readonly case: Case
      readonly path: PresentationScenarioPath
      readonly environment: PresentationScenarioEnvironment
      readonly copiedArtifact?: {
        readonly name: string
        readonly scenarioId: string
      }
    }
  : never

/** Definition-correlated renderer input returned for a presentation selection. */
export type ResolvedPresentationScenarioSelection<
  Definitions extends PresentationScenarioDefinitions = PresentationScenarioDefinitions,
> = ResolvedScenario<CompiledPresentationScenario<Definitions>>

/** Stable failure categories exposed to gallery routing and build tooling. */
export type PresentationScenarioErrorCode =
  | 'invalid-definitions'
  | 'unknown-product'
  | 'unknown-case'
  | 'invalid-environment'
  | 'invalid-copied-artifact'
  | 'invalid-catalog'
  | 'invalid-selection'
  | 'invalid-path'

/** A stable, machine-readable protocol or selection failure. */
export class PresentationScenarioError extends Error {
  override readonly name = 'PresentationScenarioError'
  readonly code: PresentationScenarioErrorCode
  readonly issues: readonly string[]

  constructor(code: PresentationScenarioErrorCode, issues: readonly string[]) {
    const snapshot = Object.freeze([...issues].sort())
    super(snapshot.join('\n'))
    this.code = code
    this.issues = snapshot
    Object.freeze(this)
  }
}

interface InspectedRecord {
  readonly descriptors: Readonly<Record<PropertyKey, PropertyDescriptor>>
  readonly keys: readonly string[]
}

interface InspectedArray {
  readonly source: object
  readonly values: readonly unknown[]
}

interface DecodedCase {
  readonly id: string
  readonly label: string
  readonly input: PresentationScenarioJson
  readonly environmentAxes: readonly PresentationScenarioEnvironmentAxis[]
  readonly copiedArtifactNames?: readonly string[]
}

interface DecodedDefinition {
  readonly defaultCaseId: string
  readonly cases: readonly DecodedCase[]
}

interface DecodedDefinitions {
  readonly definitions: ReadonlyMap<string, DecodedDefinition>
  readonly scenarioIds: readonly string[]
}

interface DecodedScenario {
  readonly productId: string
  readonly scenarioId: string
  readonly defaultCaseId: string
  readonly cases: readonly DecodedCase[]
}

interface DecodedCatalog {
  readonly version: 1
  readonly family: PresentationFamily
  readonly scenarios: readonly DecodedScenario[]
}

interface DecodedSelection {
  readonly productId: string
  readonly caseId?: string
  readonly path: string
  readonly environment: Readonly<Record<string, string>>
  readonly copiedArtifact?: string
}

function childPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`
}

function withPeriod(reason: string): string {
  return reason.endsWith('.') ? reason : `${reason}.`
}

/** The sole untrusted-data boundary for definitions, catalogs, selections, and JSON inputs. */
class BoundaryDecoder {
  readonly #issues: string[] = []
  #nodes = 0
  #fields = 0
  #stringUnits = 0
  #nodeLimitReported = false
  #fieldLimitReported = false
  #stringLimitReported = false
  #issueLimitReported = false

  constructor(private readonly code: PresentationScenarioErrorCode) {}

  issue(path: string, reason: string): void {
    if (this.#issues.length < MAX_ISSUES) {
      this.#issues.push(`${path}: ${withPeriod(reason)}`)
      return
    }
    if (!this.#issueLimitReported) {
      this.#issueLimitReported = true
      this.#issues.push(`$: issue limit of ${MAX_ISSUES} exceeded.`)
    }
  }

  result<T>(value: T | undefined): T {
    if (this.#issues.length > 0 || value === undefined) {
      if (this.#issues.length === 0) this.issue('$', 'value could not be decoded')
      throw new PresentationScenarioError(this.code, this.#issues)
    }
    return value
  }

  #consumeNode(path: string): boolean {
    this.#nodes += 1
    if (this.#nodes <= MAX_NODES) return true
    if (!this.#nodeLimitReported) {
      this.#nodeLimitReported = true
      this.issue(path, `node limit of ${MAX_NODES} exceeded`)
    }
    return false
  }

  #consumeString(value: string, path: string): boolean {
    if (value.length > MAX_STRING_LENGTH) {
      this.issue(path, `string length limit of ${MAX_STRING_LENGTH} exceeded`)
      return false
    }
    this.#stringUnits += value.length
    if (this.#stringUnits <= MAX_TOTAL_STRING_UNITS) return true
    if (!this.#stringLimitReported) {
      this.#stringLimitReported = true
      this.issue(path, `total string-unit limit of ${MAX_TOTAL_STRING_UNITS} exceeded`)
    }
    return false
  }

  #isArray(value: object, path: string): boolean | undefined {
    try {
      return Array.isArray(value)
    } catch {
      this.issue(path, 'value could not be inspected safely')
      return undefined
    }
  }

  #descriptors(value: object, path: string): Record<PropertyKey, PropertyDescriptor> | undefined {
    let keys: readonly PropertyKey[]
    try {
      keys = Reflect.ownKeys(value)
    } catch {
      this.issue(path, 'value could not be inspected safely')
      return undefined
    }
    this.#fields += keys.length
    if (this.#fields > MAX_FIELDS) {
      if (!this.#fieldLimitReported) {
        this.#fieldLimitReported = true
        this.issue(path, `aggregate object-field limit of ${MAX_FIELDS} exceeded`)
      }
      return undefined
    }
    let keysValid = true
    for (const key of keys) {
      if (typeof key === 'string') {
        if (key.length > MAX_STRING_LENGTH) {
          this.issue(path, `property-name length limit of ${MAX_STRING_LENGTH} exceeded`)
          keysValid = false
        } else if (!this.#consumeString(key, childPath(path, key))) {
          keysValid = false
        }
      }
    }
    if (!keysValid) return undefined

    const descriptors = Object.create(null) as Record<PropertyKey, PropertyDescriptor>
    try {
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (descriptor === undefined) {
          this.issue(path, 'own properties changed while being inspected')
          return undefined
        }
        Object.defineProperty(descriptors, key, {
          enumerable: true,
          value: descriptor,
        })
      }
    } catch {
      this.issue(path, 'value could not be inspected safely')
      return undefined
    }
    return descriptors
  }

  #canonicalObjectPrototype(prototype: object, path: string): boolean | undefined {
    try {
      if (Object.getPrototypeOf(prototype) !== null) return false
      const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')
      if (
        constructor === undefined ||
        !('value' in constructor) ||
        typeof constructor.value !== 'function'
      ) {
        return false
      }
      const functionPrototype = Object.getOwnPropertyDescriptor(constructor.value, 'prototype')
      if (
        functionPrototype === undefined ||
        !('value' in functionPrototype) ||
        functionPrototype.value !== prototype ||
        Function.prototype.toString.call(constructor.value) !== OBJECT_SOURCE
      ) {
        return false
      }
      if (Object.getOwnPropertyDescriptor(prototype, 'toJSON') !== undefined) {
        this.issue(path, 'prototype defines a noncanonical toJSON hook')
        return undefined
      }
      if (Object.getOwnPropertyDescriptor(prototype, Symbol.iterator) !== undefined) {
        this.issue(path, 'prototype defines a noncanonical iterator hook')
        return undefined
      }
      return true
    } catch {
      this.issue(path, 'value could not be inspected safely')
      return undefined
    }
  }

  #hasPlainPrototype(value: object, path: string): boolean | undefined {
    try {
      const prototype = Object.getPrototypeOf(value) as object | null
      if (prototype === null) return true
      return this.#canonicalObjectPrototype(prototype, path)
    } catch {
      this.issue(path, 'value could not be inspected safely')
      return undefined
    }
  }

  #hasCanonicalArrayPrototype(value: object, path: string): boolean | undefined {
    try {
      const prototype = Object.getPrototypeOf(value) as object | null
      if (prototype === null) return true
      const parent = Object.getPrototypeOf(prototype) as object | null
      if (parent === null) return false
      const parentStatus = this.#canonicalObjectPrototype(parent, path)
      if (parentStatus !== true) return parentStatus

      const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor')
      const entries = Object.getOwnPropertyDescriptor(prototype, 'entries')
      const iterator = Object.getOwnPropertyDescriptor(prototype, Symbol.iterator)
      const toJSON = Object.getOwnPropertyDescriptor(prototype, 'toJSON')
      if (
        constructor === undefined ||
        !('value' in constructor) ||
        typeof constructor.value !== 'function'
      ) {
        return false
      }
      const functionPrototype = Object.getOwnPropertyDescriptor(constructor.value, 'prototype')
      if (
        functionPrototype === undefined ||
        !('value' in functionPrototype) ||
        functionPrototype.value !== prototype ||
        Function.prototype.toString.call(constructor.value) !== ARRAY_SOURCE
      ) {
        return false
      }
      if (toJSON !== undefined) {
        this.issue(path, 'prototype defines a noncanonical toJSON hook')
        return undefined
      }
      if (
        entries === undefined ||
        !('value' in entries) ||
        typeof entries.value !== 'function' ||
        Function.prototype.toString.call(entries.value) !== ARRAY_ENTRIES_SOURCE ||
        iterator === undefined ||
        !('value' in iterator) ||
        typeof iterator.value !== 'function' ||
        Function.prototype.toString.call(iterator.value) !== ARRAY_ITERATOR_SOURCE
      ) {
        this.issue(path, 'prototype defines noncanonical array iteration hooks')
        return undefined
      }
      return true
    } catch {
      this.issue(path, 'value could not be inspected safely')
      return undefined
    }
  }

  record(value: unknown, path: string): InspectedRecord | undefined {
    if (!this.#consumeNode(path)) return undefined
    if (value === null || typeof value !== 'object') {
      this.issue(path, 'must be a plain object')
      return undefined
    }
    const isArray = this.#isArray(value, path)
    if (isArray === undefined) return undefined
    const plainPrototype = isArray ? false : this.#hasPlainPrototype(value, path)
    if (plainPrototype === undefined) return undefined
    if (isArray || !plainPrototype) {
      this.issue(path, 'must be a plain object')
      return undefined
    }
    const descriptors = this.#descriptors(value, path)
    if (descriptors === undefined) return undefined
    const keys: string[] = []
    let hasSymbol = false
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key === 'symbol') {
        hasSymbol = true
        continue
      }
      const descriptor = descriptors[key]!
      if (!descriptor.enumerable) {
        this.issue(childPath(path, key), 'non-enumerable properties are not supported')
        continue
      }
      keys.push(key)
    }
    if (hasSymbol) this.issue(path, 'symbol-keyed properties are not supported')
    return { descriptors, keys }
  }

  array(value: unknown, path: string): InspectedArray | undefined {
    if (!this.#consumeNode(path)) return undefined
    if (value === null || typeof value !== 'object') {
      this.issue(path, 'must be an array')
      return undefined
    }
    const isArray = this.#isArray(value, path)
    if (isArray === undefined) return undefined
    if (!isArray) {
      this.issue(path, 'must be an array')
      return undefined
    }
    const canonicalPrototype = this.#hasCanonicalArrayPrototype(value, path)
    if (canonicalPrototype === undefined) return undefined
    if (!canonicalPrototype) {
      this.issue(path, 'must use a canonical array prototype or a null prototype')
      return undefined
    }
    const descriptors = this.#descriptors(value, path)
    if (descriptors === undefined) return undefined
    const lengthDescriptor = descriptors['length']
    if (
      lengthDescriptor === undefined ||
      !('value' in lengthDescriptor) ||
      typeof lengthDescriptor.value !== 'number' ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    ) {
      this.issue(`${path}.length`, 'must be a non-negative safe integer data property')
      return undefined
    }
    const length = lengthDescriptor.value
    if (length > MAX_ARRAY_LENGTH) {
      this.issue(`${path}.length`, `array length limit of ${MAX_ARRAY_LENGTH} exceeded`)
      return undefined
    }
    const values = new Array<unknown>(length)
    let valid = true
    let hasSymbol = false
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key === 'symbol') {
        hasSymbol = true
        valid = false
        continue
      }
      if (key === 'length') continue
      if (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= length) {
        valid = false
        this.issue(childPath(path, key), 'non-index array properties are not supported')
      }
    }
    if (hasSymbol) this.issue(path, 'symbol-keyed properties are not supported')
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)]
      const itemPath = `${path}[${index}]`
      if (descriptor === undefined) {
        valid = false
        this.issue(itemPath, 'sparse array entries are not supported')
      } else if (!('value' in descriptor)) {
        valid = false
        this.issue(itemPath, 'accessor properties are not supported')
      } else if (!descriptor.enumerable) {
        valid = false
        this.issue(itemPath, 'non-enumerable properties are not supported')
      } else {
        values[index] = descriptor.value
      }
    }
    return valid ? { source: value, values } : undefined
  }

  field(
    record: InspectedRecord | undefined,
    key: string,
    path: string,
    required: boolean,
  ): { readonly present: boolean; readonly value?: unknown } {
    if (record === undefined) return { present: false }
    const descriptor = record.descriptors[key]
    if (descriptor === undefined || !descriptor.enumerable) {
      if (required) this.issue(childPath(path, key), 'required field is missing')
      return { present: false }
    }
    if (!('value' in descriptor)) {
      this.issue(childPath(path, key), 'accessor properties are not supported')
      return { present: false }
    }
    return { present: true, value: descriptor.value }
  }

  exactFields(
    record: InspectedRecord | undefined,
    allowed: ReadonlySet<string>,
    path: string,
  ): void {
    if (record === undefined) return
    for (const key of record.keys) {
      if (!allowed.has(key)) this.issue(childPath(path, key), 'unexpected field')
    }
  }

  string(value: unknown, path: string): string | undefined {
    if (!this.#consumeNode(path)) return undefined
    if (typeof value !== 'string') {
      this.issue(path, 'must be a string')
      return undefined
    }
    return this.#consumeString(value, path) ? value : undefined
  }

  literalOne(value: unknown, path: string): 1 | undefined {
    if (!this.#consumeNode(path)) return undefined
    if (value !== 1) {
      this.issue(path, 'must equal 1')
      return undefined
    }
    return 1
  }

  json(value: unknown, rootPath: string): PresentationScenarioJson | undefined {
    type Assignment =
      | { readonly kind: 'root' }
      | {
          readonly kind: 'array'
          readonly target: PresentationScenarioJson[]
          readonly index: number
        }
      | {
          readonly kind: 'object'
          readonly target: Record<string, PresentationScenarioJson>
          readonly key: string
        }
    type ValueFrame = {
      readonly kind: 'value'
      readonly value: unknown
      readonly path: string
      readonly depth: number
      readonly assignment: Assignment
    }
    type FinishFrame = {
      readonly kind: 'finish'
      readonly source: object
      readonly target: object
    }
    type Frame = ValueFrame | FinishFrame

    let result: PresentationScenarioJson | undefined
    const active = new WeakSet<object>()
    const stack: Frame[] = [
      { kind: 'value', value, path: rootPath, depth: 0, assignment: { kind: 'root' } },
    ]

    const assign = (assignment: Assignment, snapshot: PresentationScenarioJson): void => {
      if (assignment.kind === 'root') result = snapshot
      else if (assignment.kind === 'array') assignment.target[assignment.index] = snapshot
      else assignment.target[assignment.key] = snapshot
    }

    while (stack.length > 0) {
      const frame = stack.pop()!
      if (frame.kind === 'finish') {
        active.delete(frame.source)
        Object.freeze(frame.target)
        continue
      }

      if (frame.depth > MAX_DEPTH) {
        this.issue(frame.path, `depth limit of ${MAX_DEPTH} exceeded`)
        continue
      }
      if (!this.#consumeNode(frame.path)) continue

      const item = frame.value
      if (item === null || typeof item === 'boolean') {
        assign(frame.assignment, item)
        continue
      }
      if (typeof item === 'string') {
        if (this.#consumeString(item, frame.path)) assign(frame.assignment, item)
        continue
      }
      if (typeof item === 'number') {
        if (!Number.isFinite(item) || Object.is(item, -0)) {
          this.issue(frame.path, 'numbers must be finite and preserve their JSON value')
        } else {
          assign(frame.assignment, item)
        }
        continue
      }
      if (typeof item !== 'object') {
        this.issue(frame.path, `${typeof item} values are not JSON-safe`)
        continue
      }
      if (active.has(item)) {
        this.issue(frame.path, 'cyclic references are not JSON-safe')
        continue
      }

      const isArray = this.#isArray(item, frame.path)
      if (isArray === undefined) continue
      if (isArray) {
        this.#nodes -= 1
        const inspected = this.array(item, frame.path)
        if (inspected === undefined) continue
        const output = new Array<PresentationScenarioJson>(inspected.values.length)
        assign(frame.assignment, output)
        active.add(item)
        stack.push({ kind: 'finish', source: item, target: output })
        for (let index = inspected.values.length - 1; index >= 0; index -= 1) {
          stack.push({
            kind: 'value',
            value: inspected.values[index],
            path: `${frame.path}[${index}]`,
            depth: frame.depth + 1,
            assignment: { kind: 'array', target: output, index },
          })
        }
        continue
      }

      this.#nodes -= 1
      const inspected = this.record(item, frame.path)
      if (inspected === undefined) continue
      const output = Object.create(null) as Record<string, PresentationScenarioJson>
      const dataFields: { readonly key: string; readonly value: unknown }[] = []
      for (const key of inspected.keys) {
        const descriptor = inspected.descriptors[key]!
        if (!('value' in descriptor)) {
          this.issue(childPath(frame.path, key), 'accessor properties are not supported')
          continue
        }
        Object.defineProperty(output, key, {
          configurable: false,
          enumerable: true,
          value: undefined,
          writable: true,
        })
        dataFields.push({ key, value: descriptor.value })
      }
      assign(frame.assignment, output)
      active.add(item)
      stack.push({ kind: 'finish', source: item, target: output })
      for (let index = dataFields.length - 1; index >= 0; index -= 1) {
        const field = dataFields[index]!
        stack.push({
          kind: 'value',
          value: field.value,
          path: childPath(frame.path, field.key),
          depth: frame.depth + 1,
          assignment: { kind: 'object', target: output, key: field.key },
        })
      }
    }

    return result
  }
}

const DEFINITION_FIELDS = new Set(['defaultCaseId', 'cases'])
const CASE_FIELDS = new Set(['id', 'label', 'input', 'environmentAxes', 'copiedArtifactNames'])
const CATALOG_FIELDS = new Set(['version', 'family', 'scenarios'])
const SCENARIO_FIELDS = new Set(['productId', 'scenarioId', 'defaultCaseId', 'cases'])
const SELECTION_FIELDS = new Set(['productId', 'caseId', 'path', 'environment', 'copiedArtifact'])

function decodeStringArray(
  decoder: BoundaryDecoder,
  value: unknown,
  path: string,
): readonly string[] | undefined {
  const inspected = decoder.array(value, path)
  if (inspected === undefined) return undefined
  const output: string[] = []
  for (let index = 0; index < inspected.values.length; index += 1) {
    const item = decoder.string(inspected.values[index], `${path}[${index}]`)
    if (item !== undefined) output.push(item)
  }
  return Object.freeze(output)
}

function decodeCase(
  decoder: BoundaryDecoder,
  value: unknown,
  path: string,
  allowFamilyFields: boolean,
): DecodedCase | undefined {
  const record = decoder.record(value, path)
  if (!allowFamilyFields) decoder.exactFields(record, CASE_FIELDS, path)
  const idField = decoder.field(record, 'id', path, true)
  const labelField = decoder.field(record, 'label', path, true)
  const inputField = decoder.field(record, 'input', path, true)
  const axesField = decoder.field(record, 'environmentAxes', path, true)
  const targetsField = decoder.field(record, 'copiedArtifactNames', path, false)
  const id = idField.present ? decoder.string(idField.value, `${path}.id`) : undefined
  const label = labelField.present ? decoder.string(labelField.value, `${path}.label`) : undefined
  const input = inputField.present ? decoder.json(inputField.value, `${path}.input`) : undefined
  const axes = axesField.present
    ? decodeStringArray(decoder, axesField.value, `${path}.environmentAxes`)
    : undefined
  const targets = targetsField.present
    ? decodeStringArray(decoder, targetsField.value, `${path}.copiedArtifactNames`)
    : undefined
  if (id === undefined || label === undefined || input === undefined || axes === undefined) {
    return undefined
  }
  return Object.freeze({
    id,
    label,
    input,
    environmentAxes: axes as readonly PresentationScenarioEnvironmentAxis[],
    ...(targets === undefined ? {} : { copiedArtifactNames: targets }),
  })
}

function decodeDefinition(
  decoder: BoundaryDecoder,
  value: unknown,
  path: string,
): DecodedDefinition | undefined {
  const record = decoder.record(value, path)
  decoder.exactFields(record, DEFINITION_FIELDS, path)
  const defaultField = decoder.field(record, 'defaultCaseId', path, true)
  const casesField = decoder.field(record, 'cases', path, true)
  const defaultCaseId = defaultField.present
    ? decoder.string(defaultField.value, `${path}.defaultCaseId`)
    : undefined
  const inspectedCases = casesField.present
    ? decoder.array(casesField.value, `${path}.cases`)
    : undefined
  const cases: DecodedCase[] = []
  if (inspectedCases !== undefined) {
    for (let index = 0; index < inspectedCases.values.length; index += 1) {
      const scenarioCase = decodeCase(
        decoder,
        inspectedCases.values[index],
        `${path}.cases[${index}]`,
        true,
      )
      if (scenarioCase !== undefined) cases.push(scenarioCase)
    }
  }
  if (defaultCaseId === undefined || inspectedCases === undefined) return undefined
  return Object.freeze({ defaultCaseId, cases: Object.freeze(cases) })
}

function decodeDefinitions(value: unknown): DecodedDefinitions {
  const decoder = new BoundaryDecoder('invalid-definitions')
  const root = decoder.record(value, '$')
  const definitions = new Map<string, DecodedDefinition>()
  const scenarioIds: string[] = []
  if (root !== undefined) {
    for (const scenarioId of root.keys) {
      const path = childPath('$', scenarioId)
      const descriptor = root.descriptors[scenarioId]!
      if (!('value' in descriptor)) {
        decoder.issue(path, 'accessor properties are not supported')
        continue
      }
      if (scenarioId.length > MAX_STRING_LENGTH) {
        decoder.issue(path, `property-name length limit of ${MAX_STRING_LENGTH} exceeded`)
        continue
      }
      const definition = decodeDefinition(decoder, descriptor.value, path)
      if (definition !== undefined) {
        definitions.set(scenarioId, definition)
        scenarioIds.push(scenarioId)
      }
    }
  }
  return decoder.result({ definitions, scenarioIds: Object.freeze(scenarioIds) })
}

function decodeCatalog(value: unknown): DecodedCatalog {
  const decoder = new BoundaryDecoder('invalid-catalog')
  const root = decoder.record(value, '$')
  decoder.exactFields(root, CATALOG_FIELDS, '$')
  const versionField = decoder.field(root, 'version', '$', true)
  const familyField = decoder.field(root, 'family', '$', true)
  const scenariosField = decoder.field(root, 'scenarios', '$', true)
  const version = versionField.present
    ? decoder.literalOne(versionField.value, '$.version')
    : undefined
  const familyString = familyField.present
    ? decoder.string(familyField.value, '$.family')
    : undefined
  if (familyString !== undefined && !PRESENTATION_FAMILIES.has(familyString)) {
    decoder.issue('$.family', `unknown presentation family ${JSON.stringify(familyString)}`)
  }
  const inspectedScenarios = scenariosField.present
    ? decoder.array(scenariosField.value, '$.scenarios')
    : undefined
  const scenarios: DecodedScenario[] = []
  if (inspectedScenarios !== undefined) {
    for (let index = 0; index < inspectedScenarios.values.length; index += 1) {
      const path = `$.scenarios[${index}]`
      const record = decoder.record(inspectedScenarios.values[index], path)
      decoder.exactFields(record, SCENARIO_FIELDS, path)
      const productField = decoder.field(record, 'productId', path, true)
      const scenarioField = decoder.field(record, 'scenarioId', path, true)
      const defaultField = decoder.field(record, 'defaultCaseId', path, true)
      const casesField = decoder.field(record, 'cases', path, true)
      const productId = productField.present
        ? decoder.string(productField.value, `${path}.productId`)
        : undefined
      const scenarioId = scenarioField.present
        ? decoder.string(scenarioField.value, `${path}.scenarioId`)
        : undefined
      const defaultCaseId = defaultField.present
        ? decoder.string(defaultField.value, `${path}.defaultCaseId`)
        : undefined
      const inspectedCases = casesField.present
        ? decoder.array(casesField.value, `${path}.cases`)
        : undefined
      const cases: DecodedCase[] = []
      if (inspectedCases !== undefined) {
        for (let caseIndex = 0; caseIndex < inspectedCases.values.length; caseIndex += 1) {
          const scenarioCase = decodeCase(
            decoder,
            inspectedCases.values[caseIndex],
            `${path}.cases[${caseIndex}]`,
            false,
          )
          if (scenarioCase !== undefined) cases.push(scenarioCase)
        }
      }
      if (
        productId !== undefined &&
        scenarioId !== undefined &&
        defaultCaseId !== undefined &&
        inspectedCases !== undefined
      ) {
        scenarios.push(
          Object.freeze({
            productId,
            scenarioId,
            defaultCaseId,
            cases: Object.freeze(cases),
          }),
        )
      }
    }
  }
  if (
    version === undefined ||
    familyString === undefined ||
    !PRESENTATION_FAMILIES.has(familyString) ||
    inspectedScenarios === undefined
  ) {
    return decoder.result<DecodedCatalog>(undefined)
  }
  return decoder.result(
    Object.freeze({
      version,
      family: familyString as PresentationFamily,
      scenarios: Object.freeze(scenarios),
    }),
  )
}

function decodeSelection(value: unknown): DecodedSelection {
  const decoder = new BoundaryDecoder('invalid-selection')
  const root = decoder.record(value, '$')
  decoder.exactFields(root, SELECTION_FIELDS, '$')
  const productField = decoder.field(root, 'productId', '$', true)
  const caseField = decoder.field(root, 'caseId', '$', false)
  const pathField = decoder.field(root, 'path', '$', true)
  const environmentField = decoder.field(root, 'environment', '$', false)
  const artifactField = decoder.field(root, 'copiedArtifact', '$', false)
  const productId = productField.present
    ? decoder.string(productField.value, '$.productId')
    : undefined
  const caseId = caseField.present ? decoder.string(caseField.value, '$.caseId') : undefined
  const path = pathField.present ? decoder.string(pathField.value, '$.path') : undefined
  const copiedArtifact = artifactField.present
    ? decoder.string(artifactField.value, '$.copiedArtifact')
    : undefined
  const environmentRecord = environmentField.present
    ? decoder.record(environmentField.value, '$.environment')
    : undefined
  const environment = Object.create(null) as Record<string, string>
  if (environmentRecord !== undefined) {
    for (const axis of environmentRecord.keys) {
      const descriptor = environmentRecord.descriptors[axis]!
      const axisPath = childPath('$.environment', axis)
      if (!('value' in descriptor)) {
        decoder.issue(axisPath, 'accessor properties are not supported')
        continue
      }
      const decoded = decoder.string(descriptor.value, axisPath)
      if (decoded !== undefined) environment[axis] = decoded
    }
  }
  Object.freeze(environment)
  if (
    productId === undefined ||
    path === undefined ||
    (environmentField.present && environmentRecord === undefined) ||
    (caseField.present && caseId === undefined) ||
    (artifactField.present && copiedArtifact === undefined)
  ) {
    return decoder.result<DecodedSelection>(undefined)
  }
  return decoder.result(
    Object.freeze({
      productId,
      path,
      environment,
      ...(caseId === undefined ? {} : { caseId }),
      ...(copiedArtifact === undefined ? {} : { copiedArtifact }),
    }),
  )
}

function caseIssues(
  entry: ProductContract['entries'][number],
  definition: DecodedDefinition | DecodedScenario,
  path: string,
): string[] {
  const issues: string[] = []
  if (definition.cases.length === 0) {
    issues.push(`${path}.cases: must define at least one case.`)
  }
  if (!CASE_ID.test(definition.defaultCaseId)) {
    issues.push(
      `${path}.defaultCaseId: invalid case id ${JSON.stringify(definition.defaultCaseId)}.`,
    )
  }

  const caseIds = new Set<string>()
  const copiedArtifactNames = new Set<string>()
  for (const artifact of entry.copiedArtifacts) copiedArtifactNames.add(artifact.name)
  for (let index = 0; index < definition.cases.length; index += 1) {
    const scenarioCase = definition.cases[index]!
    const casePath = `${path}.cases[${index}]`
    if (!CASE_ID.test(scenarioCase.id)) {
      issues.push(`${casePath}.id: invalid case id ${JSON.stringify(scenarioCase.id)}.`)
    }
    if (caseIds.has(scenarioCase.id)) {
      issues.push(`${casePath}.id: duplicate case id ${JSON.stringify(scenarioCase.id)}.`)
    }
    caseIds.add(scenarioCase.id)
    if (scenarioCase.label.trim() === '') {
      issues.push(`${casePath}.label: must contain non-whitespace text.`)
    }

    const seenAxes = new Set<string>()
    for (let axisIndex = 0; axisIndex < scenarioCase.environmentAxes.length; axisIndex += 1) {
      const axis = scenarioCase.environmentAxes[axisIndex]!
      const axisPath = `${casePath}.environmentAxes[${axisIndex}]`
      if (!ENVIRONMENT_AXES.has(axis)) {
        issues.push(`${axisPath}: unknown environment axis ${JSON.stringify(axis)}.`)
      }
      if (seenAxes.has(axis)) {
        issues.push(`${axisPath}: duplicate environment axis ${JSON.stringify(axis)}.`)
      }
      seenAxes.add(axis)
    }

    const seenTargets = new Set<string>()
    const targets = scenarioCase.copiedArtifactNames ?? []
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
      const target = targets[targetIndex]!
      const targetPath = `${casePath}.copiedArtifactNames[${targetIndex}]`
      if (!copiedArtifactNames.has(target)) {
        issues.push(`${targetPath}: unknown copied artifact ${JSON.stringify(target)}.`)
      }
      if (seenTargets.has(target)) {
        issues.push(`${targetPath}: duplicate copied artifact ${JSON.stringify(target)}.`)
      }
      seenTargets.add(target)
    }
  }
  if (!caseIds.has(definition.defaultCaseId)) {
    issues.push(
      `${path}.defaultCaseId: case ${JSON.stringify(definition.defaultCaseId)} does not exist.`,
    )
  }
  return issues
}

function catalogIntegrityIssues(contract: ProductContract, catalog: DecodedCatalog): string[] {
  const issues: string[] = []
  const entries = contract.entries.filter((entry) => entry.presentation.family === catalog.family)
  if (entries.length === 0) {
    return [
      `$.family: ProductContract has no entries for presentation family ${JSON.stringify(catalog.family)}.`,
    ]
  }

  const entriesByScenario = new Map<string, (typeof entries)[number]>()
  const expectedIndex = new Map<string, number>()
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!
    entriesByScenario.set(entry.scenarioId, entry)
    expectedIndex.set(entry.scenarioId, index)
  }
  const seenProducts = new Set<string>()
  const seenScenarios = new Set<string>()
  for (let index = 0; index < catalog.scenarios.length; index += 1) {
    const scenario = catalog.scenarios[index]!
    const path = `$.scenarios[${index}]`
    if (seenProducts.has(scenario.productId)) {
      issues.push(`${path}.productId: duplicate product ${JSON.stringify(scenario.productId)}.`)
    }
    seenProducts.add(scenario.productId)
    if (seenScenarios.has(scenario.scenarioId)) {
      issues.push(`${path}.scenarioId: duplicate scenario ${JSON.stringify(scenario.scenarioId)}.`)
    }
    seenScenarios.add(scenario.scenarioId)

    const entry = entriesByScenario.get(scenario.scenarioId)
    if (entry === undefined) {
      issues.push(
        `${path}.scenarioId: stale ProductContract scenario ${JSON.stringify(scenario.scenarioId)}.`,
      )
      continue
    }
    if (entry.name !== scenario.productId) {
      issues.push(
        `${path}.productId: expected ${JSON.stringify(entry.name)} for scenario ${JSON.stringify(scenario.scenarioId)}.`,
      )
      continue
    }
    const canonicalIndex = expectedIndex.get(scenario.scenarioId)!
    if (canonicalIndex !== index) {
      issues.push(`${path}: expected canonical ProductContract index ${canonicalIndex}.`)
    }
    issues.push(...caseIssues(entry, scenario, path))
  }

  for (const entry of entries) {
    if (!seenScenarios.has(entry.scenarioId)) {
      issues.push(
        `$.scenarios: missing scenario ${JSON.stringify(entry.scenarioId)} for product ${JSON.stringify(entry.name)}.`,
      )
    }
  }
  return issues
}

function compiledCatalog(
  contract: ProductContract,
  family: PresentationFamily,
  decoded: DecodedDefinitions,
): DecodedCatalog {
  const entries = contract.entries.filter((entry) => entry.presentation.family === family)
  const issues: string[] = []
  if (entries.length === 0) {
    issues.push(
      `$.family: ProductContract has no entries for presentation family ${JSON.stringify(family)}.`,
    )
  }
  const expectedScenarioIds = new Set<string>()
  for (const entry of entries) expectedScenarioIds.add(entry.scenarioId)
  for (const entry of entries) {
    const definition = decoded.definitions.get(entry.scenarioId)
    const path = childPath('$', entry.scenarioId)
    if (definition === undefined) {
      issues.push(`${path}: missing definition for product ${JSON.stringify(entry.name)}.`)
    } else {
      issues.push(...caseIssues(entry, definition, path))
    }
  }
  for (const scenarioId of decoded.scenarioIds) {
    if (!expectedScenarioIds.has(scenarioId)) {
      issues.push(
        `${childPath('$', scenarioId)}: stale definition for presentation family ${JSON.stringify(family)}.`,
      )
    }
  }
  if (issues.length > 0) throw new PresentationScenarioError('invalid-definitions', issues)

  const raw = {
    version: 1,
    family,
    scenarios: entries.map((entry) => {
      const definition = decoded.definitions.get(entry.scenarioId)!
      return {
        productId: entry.name,
        scenarioId: entry.scenarioId,
        defaultCaseId: definition.defaultCaseId,
        cases: definition.cases.map((scenarioCase) => ({
          id: scenarioCase.id,
          label: scenarioCase.label,
          input: scenarioCase.input,
          environmentAxes: scenarioCase.environmentAxes,
          ...(scenarioCase.copiedArtifactNames === undefined
            ? {}
            : { copiedArtifactNames: scenarioCase.copiedArtifactNames }),
        })),
      }
    }),
  }
  const catalog = decodeCatalog(raw)
  const integrityIssues = catalogIntegrityIssues(contract, catalog)
  if (integrityIssues.length > 0) {
    throw new PresentationScenarioError('invalid-definitions', integrityIssues)
  }
  return catalog
}

/** Join family-owned semantic cases to ProductContract's canonical inventory. */
export function compileScenarioFamily<const Definitions extends PresentationScenarioDefinitions>(
  contract: ProductContract,
  family: PresentationFamily,
  definitions: Definitions,
): CompiledPresentationScenarioFamily<Definitions>
/** Validate and compile definitions received from an untyped serialized boundary. */
export function compileScenarioFamily(
  contract: ProductContract,
  family: PresentationFamily,
  definitions: unknown,
): CompiledPresentationScenarioFamily
export function compileScenarioFamily(
  contract: ProductContract,
  family: PresentationFamily,
  definitions: unknown,
): CompiledPresentationScenarioFamily {
  const decoded = decodeDefinitions(definitions)
  return compiledCatalog(contract, family, decoded) as CompiledPresentationScenarioFamily
}

/** Resolve one deterministic renderer input from a compiled family catalog. */
export function resolveScenarioSelection<Definitions extends PresentationScenarioDefinitions>(
  contract: ProductContract,
  catalog: CompiledPresentationScenarioFamily<Definitions>,
  selection: PresentationScenarioSelection,
): ResolvedPresentationScenarioSelection<Definitions>
/** Validate and resolve a catalog and selection received from serialized boundaries. */
export function resolveScenarioSelection(
  contract: ProductContract,
  catalog: unknown,
  selection: unknown,
): ResolvedPresentationScenarioSelection
export function resolveScenarioSelection(
  contract: ProductContract,
  catalog: unknown,
  selection: unknown,
): ResolvedPresentationScenarioSelection {
  const decodedCatalog = decodeCatalog(catalog)
  const catalogIssues = catalogIntegrityIssues(contract, decodedCatalog)
  if (catalogIssues.length > 0) {
    throw new PresentationScenarioError('invalid-catalog', catalogIssues)
  }
  const decodedSelection = decodeSelection(selection)
  const scenario = decodedCatalog.scenarios.find(
    ({ productId }) => productId === decodedSelection.productId,
  )
  if (scenario === undefined) {
    throw new PresentationScenarioError('unknown-product', [
      `$.productId: unknown product ${JSON.stringify(decodedSelection.productId)} in compiled family ${JSON.stringify(decodedCatalog.family)}.`,
    ])
  }
  const entry = contract.entries.find(({ name }) => name === decodedSelection.productId)!
  if (!PRESENTATION_SCENARIO_PATH_SET.has(decodedSelection.path)) {
    throw new PresentationScenarioError('invalid-path', [
      `$.path: unknown presentation path ${JSON.stringify(decodedSelection.path)}.`,
    ])
  }
  const path = decodedSelection.path as PresentationScenarioPath
  if (entry.presentation[path].mode === 'not-applicable') {
    throw new PresentationScenarioError('invalid-path', [
      `$.path: presentation path ${JSON.stringify(path)} is not applicable to product ${JSON.stringify(decodedSelection.productId)}.`,
    ])
  }
  const caseId = decodedSelection.caseId ?? scenario.defaultCaseId
  const scenarioCase = scenario.cases.find(({ id }) => id === caseId)
  if (scenarioCase === undefined) {
    throw new PresentationScenarioError('unknown-case', [
      `$.caseId: unknown case ${JSON.stringify(caseId)} for product ${JSON.stringify(decodedSelection.productId)}.`,
    ])
  }

  const environmentIssues: string[] = []
  for (const [axis, value] of Object.entries(decodedSelection.environment)) {
    const axisPath = childPath('$.environment', axis)
    if (!ENVIRONMENT_AXES.has(axis)) {
      environmentIssues.push(`${axisPath}: unknown environment axis ${JSON.stringify(axis)}.`)
      continue
    }
    const knownAxis = axis as PresentationScenarioEnvironmentAxis
    const allowedValues = PRESENTATION_SCENARIO_ENVIRONMENT_VALUES[knownAxis] as readonly string[]
    if (!allowedValues.includes(value)) {
      environmentIssues.push(`${axisPath}: unknown value ${JSON.stringify(value)}.`)
    } else if (!scenarioCase.environmentAxes.includes(knownAxis)) {
      environmentIssues.push(
        `${axisPath}: case ${JSON.stringify(caseId)} does not support this environment axis.`,
      )
    }
  }
  if (environmentIssues.length > 0) {
    throw new PresentationScenarioError('invalid-environment', environmentIssues)
  }

  if (decodedSelection.copiedArtifact !== undefined && path !== 'registryTailwind') {
    throw new PresentationScenarioError('invalid-copied-artifact', [
      `$.copiedArtifact: target ${JSON.stringify(decodedSelection.copiedArtifact)} is invalid on the baseline path.`,
    ])
  }
  if (
    decodedSelection.copiedArtifact !== undefined &&
    !entry.copiedArtifacts.some(({ name }) => name === decodedSelection.copiedArtifact)
  ) {
    throw new PresentationScenarioError('invalid-copied-artifact', [
      `$.copiedArtifact: product ${JSON.stringify(decodedSelection.productId)} does not own target ${JSON.stringify(decodedSelection.copiedArtifact)}.`,
    ])
  }
  if (
    decodedSelection.copiedArtifact !== undefined &&
    scenarioCase.copiedArtifactNames !== undefined &&
    !scenarioCase.copiedArtifactNames.includes(decodedSelection.copiedArtifact)
  ) {
    throw new PresentationScenarioError('invalid-copied-artifact', [
      `$.copiedArtifact: case ${JSON.stringify(caseId)} does not support target ${JSON.stringify(decodedSelection.copiedArtifact)}.`,
    ])
  }

  const eligibleArtifacts =
    scenarioCase.copiedArtifactNames === undefined
      ? entry.copiedArtifacts
      : entry.copiedArtifacts.filter(({ name }) => scenarioCase.copiedArtifactNames!.includes(name))
  const selectedArtifactName =
    path === 'registryTailwind'
      ? (decodedSelection.copiedArtifact ??
        eligibleArtifacts.find(({ name }) => name === entry.name)?.name ??
        (eligibleArtifacts.length === 1 ? eligibleArtifacts[0]!.name : undefined))
      : undefined
  if (path === 'registryTailwind' && selectedArtifactName === undefined) {
    if (scenarioCase.copiedArtifactNames !== undefined && eligibleArtifacts.length === 0) {
      throw new PresentationScenarioError('invalid-copied-artifact', [
        `$.copiedArtifact: case ${JSON.stringify(caseId)} has no eligible registry target.`,
      ])
    }
    if (eligibleArtifacts.length > 1) {
      const names = eligibleArtifacts
        .map(({ name }) => JSON.stringify(name))
        .sort()
        .join(', ')
      throw new PresentationScenarioError('invalid-copied-artifact', [
        `$.copiedArtifact: case ${JSON.stringify(caseId)} has multiple eligible registry targets; select one of ${names}.`,
      ])
    }
  }
  const copiedArtifact = entry.copiedArtifacts.find(({ name }) => name === selectedArtifactName)
  const environment = Object.freeze({
    ...DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
    ...decodedSelection.environment,
  }) as PresentationScenarioEnvironment
  const result = Object.freeze({
    productId: scenario.productId,
    scenarioId: scenario.scenarioId,
    case: scenarioCase,
    path,
    environment,
    ...(copiedArtifact === undefined
      ? {}
      : {
          copiedArtifact: Object.freeze({
            name: copiedArtifact.name,
            scenarioId: copiedArtifact.scenarioId ?? entry.scenarioId,
          }),
        }),
  })
  return result as ResolvedPresentationScenarioSelection
}
