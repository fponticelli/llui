import type { StandardSchemaV1 } from '@standard-schema/spec'

export type { StandardSchemaV1 } from '@standard-schema/spec'

type AnySchema = StandardSchemaV1<unknown, unknown>

/** A synchronous parser/validator paired with its canonical URL formatter. */
export interface RouteCodec<Output, Multiple extends boolean = false> {
  readonly schema: StandardSchemaV1<unknown, Output>
  readonly format: (value: Output) => Multiple extends true ? readonly string[] : string
  readonly multiple: Multiple
}

/** Define a scalar path or query route codec. */
export function routeCodec<Schema extends StandardSchemaV1>(
  schema: Schema,
  format: (value: StandardSchemaV1.InferOutput<Schema>) => string,
): RouteCodec<StandardSchemaV1.InferOutput<Schema>> {
  return { schema, format, multiple: false }
}

/** Define a route codec whose URL representation is an ordered repeated value. */
export function repeatedRouteCodec<Schema extends StandardSchemaV1>(
  schema: Schema,
  format: (value: StandardSchemaV1.InferOutput<Schema>) => readonly string[],
): RouteCodec<StandardSchemaV1.InferOutput<Schema>, true> {
  return { schema, format, multiple: true }
}

interface AnyCodec {
  readonly schema: StandardSchemaV1<unknown, unknown>
  readonly format: (value: never) => string | readonly string[]
  readonly multiple: boolean
}
type CodecMap = Readonly<Record<string, AnyCodec | undefined>>
type Simplify<T> = { [K in keyof T]: T[K] } & {}
type EmptyRecord = Readonly<Record<never, never>>

type SegmentName<Segment extends string> = Segment extends `:${infer Name}?`
  ? Name
  : Segment extends `:${infer Name}`
    ? Name
    : Segment extends `*${infer Name}`
      ? Name
      : never

type PathNames<Path extends string> = Path extends `${infer Head}/${infer Tail}`
  ? SegmentName<Head> | PathNames<Tail>
  : SegmentName<Path>

type OptionalPathNames<Path extends string> = Path extends `${infer Head}/${infer Tail}`
  ? (Head extends `:${infer Name}?` ? Name : never) | OptionalPathNames<Tail>
  : Path extends `:${infer Name}?`
    ? Name
    : never

type RestPathNames<Path extends string> = Path extends `${infer Head}/${infer Tail}`
  ? (Head extends `*${infer Name}` ? Name : never) | RestPathNames<Tail>
  : Path extends `*${infer Name}`
    ? Name
    : never

type CodecOutput<Codec> = Codec extends RouteCodec<infer Output, boolean> ? Output : never

type PathValue<
  Path extends string,
  Params extends CodecMap,
  Name extends PathNames<Path>,
> = Name extends keyof Params
  ? CodecOutput<Params[Name]>
  : Name extends RestPathNames<Path>
    ? string[]
    : string

type ParameterValues<Path extends string, Params extends CodecMap, Query extends CodecMap> = {
  [Name in PathNames<Path> | keyof Query]: Name extends PathNames<Path>
    ? PathValue<Path, Params, Name>
    : Name extends keyof Query
      ? CodecOutput<Query[Name]>
      : never
}

type NormalizedParams<
  Path extends string,
  Params extends CodecMap,
  Query extends CodecMap,
  Defaults extends Partial<ParameterValues<Path, Params, Query>>,
> = {
  [Name in keyof ParameterValues<Path, Params, Query>]: Name extends keyof Defaults
    ? ParameterValues<Path, Params, Query>[Name]
    : Name extends OptionalPathNames<Path> | keyof Query
      ? ParameterValues<Path, Params, Query>[Name] | undefined
      : ParameterValues<Path, Params, Query>[Name]
}

type OptionalGenerationNames<
  Path extends string,
  Params extends CodecMap,
  Query extends CodecMap,
  Defaults extends Partial<ParameterValues<Path, Params, Query>>,
> = OptionalPathNames<Path> | keyof Query | keyof Defaults

type GenerationParams<
  Path extends string,
  Params extends CodecMap,
  Query extends CodecMap,
  Defaults extends Partial<ParameterValues<Path, Params, Query>>,
> = Simplify<
  {
    [Name in Exclude<
      keyof ParameterValues<Path, Params, Query>,
      OptionalGenerationNames<Path, Params, Query, Defaults>
    >]: ParameterValues<Path, Params, Query>[Name]
  } & {
    [Name in Extract<
      keyof ParameterValues<Path, Params, Query>,
      OptionalGenerationNames<Path, Params, Query, Defaults>
    >]?: ParameterValues<Path, Params, Query>[Name]
  }
>

interface StaticSegment {
  readonly kind: 'static'
  readonly value: string
}

interface ParameterSegment {
  readonly kind: 'parameter'
  readonly name: string
  readonly optional: boolean
}

interface RestSegment {
  readonly kind: 'rest'
  readonly name: string
}

type Segment = StaticSegment | ParameterSegment | RestSegment

/** One named route's typed URL contract. Names are supplied by the registry. */
export interface RouteDefinition<
  Path extends string = string,
  Params extends CodecMap = CodecMap,
  Query extends Readonly<Record<string, AnyCodec>> = Readonly<Record<string, AnyCodec>>,
  Defaults extends Partial<ParameterValues<Path, Params, Query>> = Partial<
    ParameterValues<Path, Params, Query>
  >,
> {
  readonly path: Path
  readonly params: Params
  readonly query: Query
  readonly defaults: Defaults
  readonly refine?: StandardSchemaV1
}

type RouteOptionShape<Path extends string> = {
  readonly params?: Partial<Record<PathNames<Path>, AnyCodec>>
  readonly query?: Readonly<Record<string, AnyCodec>>
  readonly defaults?: Readonly<Record<string, unknown>>
  readonly refine?: StandardSchemaV1
}

type OptionParams<Options> = Options extends { readonly params: infer Params extends CodecMap }
  ? Params
  : EmptyRecord
type OptionQuery<Options> = Options extends {
  readonly query: infer Query extends Readonly<Record<string, AnyCodec>>
}
  ? Query
  : EmptyRecord
type OptionDefaults<Options> = Options extends {
  readonly defaults: infer Defaults extends Readonly<Record<string, unknown>>
}
  ? Defaults
  : EmptyRecord

type CheckedDefaults<Path extends string, Options> = Extract<
  OptionDefaults<Options>,
  Partial<ParameterValues<Path, OptionParams<Options>, OptionQuery<Options>>>
>

type OptionRefinement<Options> = Options extends {
  readonly refine: infer Refinement extends StandardSchemaV1
}
  ? Refinement
  : never

type ExactKeys<Expected, Actual> =
  Exclude<keyof Expected, keyof Actual> extends never
    ? Exclude<keyof Actual, keyof Expected> extends never
      ? unknown
      : never
    : never

export function route<const Path extends string>(
  path: Path,
): RouteDefinition<Path, EmptyRecord, EmptyRecord, EmptyRecord>
export function route<const Path extends string, const Options extends RouteOptionShape<Path>>(
  path: Path,
  options: Options & {
    readonly params?: OptionParams<Options> &
      Record<Exclude<keyof OptionParams<Options>, PathNames<Path>>, never>
    readonly query?: OptionQuery<Options> &
      Record<Extract<keyof OptionQuery<Options>, PathNames<Path>>, never>
    readonly defaults?: Partial<
      ParameterValues<Path, OptionParams<Options>, OptionQuery<Options>>
    > &
      Record<
        Exclude<
          keyof OptionDefaults<Options>,
          keyof ParameterValues<Path, OptionParams<Options>, OptionQuery<Options>>
        >,
        never
      >
    readonly refine?: OptionRefinement<Options> &
      StandardSchemaV1<
        NormalizedParams<
          Path,
          OptionParams<Options>,
          OptionQuery<Options>,
          CheckedDefaults<Path, Options>
        >,
        NormalizedParams<
          Path,
          OptionParams<Options>,
          OptionQuery<Options>,
          CheckedDefaults<Path, Options>
        >
      > &
      ExactKeys<
        NormalizedParams<
          Path,
          OptionParams<Options>,
          OptionQuery<Options>,
          CheckedDefaults<Path, Options>
        >,
        StandardSchemaV1.InferOutput<OptionRefinement<Options>>
      >
  },
): RouteDefinition<
  Path,
  OptionParams<Options>,
  OptionQuery<Options>,
  CheckedDefaults<Path, Options>
>
export function route(path: string, rawOptions?: unknown): unknown {
  const options = (rawOptions ?? {}) as Record<string, unknown>
  return {
    path,
    params: (options.params ?? {}) as CodecMap,
    query: (options.query ?? {}) as CodecMap,
    defaults: (options.defaults ?? {}) as Record<string, unknown>,
    refine: options.refine as StandardSchemaV1 | undefined,
  }
}

interface RouteDefinitionShape {
  readonly path: string
  readonly params: Readonly<Record<string, AnyCodec | undefined>>
  readonly query: Readonly<Record<string, AnyCodec>>
  readonly defaults: Readonly<Record<string, unknown>>
  readonly refine?: StandardSchemaV1
}

export type RouteRegistry = Readonly<Record<string, RouteDefinitionShape>>

type DefinitionNormalized<Definition> =
  Definition extends RouteDefinition<infer Path, infer Params, infer Query, infer Defaults>
    ? NormalizedParams<Path, Params, Query, Defaults>
    : never

type DefinitionGeneration<Definition> =
  Definition extends RouteDefinition<infer Path, infer Params, infer Query, infer Defaults>
    ? GenerationParams<Path, Params, Query, Defaults>
    : never

export type RouteLocation<Registry extends RouteRegistry> = {
  [Name in keyof Registry & string]: {
    name: Name
    params: Simplify<DefinitionNormalized<Registry[Name]>>
  }
}[keyof Registry & string]

export type RouteDestination<Registry extends RouteRegistry> = {
  [Name in keyof Registry & string]: keyof DefinitionGeneration<Registry[Name]> extends never
    ? [name: Name]
    : [name: Name, params: Simplify<DefinitionGeneration<Registry[Name]>>]
}[keyof Registry & string]

export type RouteGenerationParams<
  Registry extends RouteRegistry,
  Name extends keyof Registry & string,
> = Simplify<DefinitionGeneration<Registry[Name]>>

type ExactParameters<Expected, Actual extends Expected> = Actual &
  Record<Exclude<keyof Actual, keyof Expected>, never>

/** The parameter tail for one exact, route-name-specific destination call. */
export type RouteDestinationArguments<
  Registry extends RouteRegistry,
  Name extends keyof Registry & string,
  Params extends RouteGenerationParams<Registry, Name> = RouteGenerationParams<Registry, Name>,
> = keyof RouteGenerationParams<Registry, Name> extends never
  ? []
  : [params: ExactParameters<RouteGenerationParams<Registry, Name>, Params>]

export interface RouterConfig {
  readonly mode?: 'hash' | 'history'
  /** History-mode base path. */
  readonly base?: string
}

export interface Router<Registry extends RouteRegistry> {
  match(input: string): RouteLocation<Registry> | null
  location<
    const Name extends keyof Registry & string,
    const Params extends RouteGenerationParams<Registry, Name> = RouteGenerationParams<
      Registry,
      Name
    >,
  >(
    name: Name,
    ...args: RouteDestinationArguments<Registry, Name, Params>
  ): RouteLocation<Registry>
  toPath<
    const Name extends keyof Registry & string,
    const Params extends RouteGenerationParams<Registry, Name> = RouteGenerationParams<
      Registry,
      Name
    >,
  >(
    name: Name,
    ...args: RouteDestinationArguments<Registry, Name, Params>
  ): string
  href<
    const Name extends keyof Registry & string,
    const Params extends RouteGenerationParams<Registry, Name> = RouteGenerationParams<
      Registry,
      Name
    >,
  >(
    name: Name,
    ...args: RouteDestinationArguments<Registry, Name, Params>
  ): string
  readonly mode: 'hash' | 'history'
  readonly base: string
  readonly routes: Registry
}

interface CompiledVariant {
  readonly segments: readonly Segment[]
  readonly specificity: readonly number[]
}

interface CompiledDefinition {
  readonly name: string
  readonly definition: RouteDefinitionShape
  readonly segments: readonly Segment[]
  readonly variants: readonly CompiledVariant[]
}

const stringSchema: StandardSchemaV1<string> = {
  '~standard': {
    version: 1,
    vendor: '@llui/router',
    validate: (value) =>
      typeof value === 'string' ? { value } : { issues: [{ message: 'Expected a string' }] },
  },
}

const stringCodec = routeCodec(stringSchema, (value) => value)

function parseTemplate(name: string, definition: RouteDefinitionShape): readonly Segment[] {
  const path = definition.path
  if (!path.startsWith('/')) {
    throw new TypeError(`[@llui/router] Route "${name}" path must start with "/".`)
  }
  const rawSegments = path.split('/').filter(Boolean)
  const seen = new Set<string>()
  const segments: Segment[] = rawSegments.map((raw, index) => {
    if (raw.startsWith(':')) {
      if ((raw.match(/\?/g)?.length ?? 0) > 1 || (raw.includes('?') && !raw.endsWith('?'))) {
        throw new TypeError(
          `[@llui/router] Route "${name}" has an invalid optional parameter segment "${raw}".`,
        )
      }
      const optional = raw.endsWith('?')
      const parameterName = raw.slice(1, optional ? -1 : undefined)
      assertParameterName(name, parameterName, seen)
      return { kind: 'parameter', name: parameterName, optional }
    }
    if (raw.startsWith('*')) {
      const parameterName = raw.slice(1)
      assertParameterName(name, parameterName, seen)
      if (index !== rawSegments.length - 1) {
        throw new TypeError(
          `[@llui/router] Rest parameter "${parameterName}" in route "${name}" must be last.`,
        )
      }
      return { kind: 'rest', name: parameterName }
    }
    if (raw.includes('?')) {
      throw new TypeError(
        `[@llui/router] Route "${name}" declares query text in its path; use query codecs.`,
      )
    }
    return { kind: 'static', value: decodeLiteral(name, raw) }
  })

  if (
    segments.some((segment) => segment.kind === 'parameter' && segment.optional) &&
    segments.some((segment) => segment.kind === 'rest')
  ) {
    throw new TypeError(
      `[@llui/router] Route "${name}" cannot combine optional and rest parameters because matching would not be bidirectional.`,
    )
  }

  const pathNames = new Set(
    segments.filter((segment) => segment.kind !== 'static').map((segment) => segment.name),
  )
  for (const key of Object.keys(definition.params)) {
    if (!pathNames.has(key)) {
      throw new TypeError(
        `[@llui/router] Route "${name}" has a codec for unknown path parameter "${key}".`,
      )
    }
  }
  for (const key of Object.keys(definition.query)) {
    if (pathNames.has(key)) {
      throw new TypeError(
        `[@llui/router] Route "${name}" declares "${key}" as both a path and query parameter.`,
      )
    }
  }
  for (const segment of segments) {
    if (segment.kind === 'static') continue
    const codec = definition.params[segment.name]
    if (!codec) continue
    if (segment.kind === 'rest' && !codec.multiple) {
      throw new TypeError(
        `[@llui/router] Rest parameter "${segment.name}" in route "${name}" needs a repeated route codec.`,
      )
    }
    if (segment.kind === 'parameter' && codec.multiple) {
      throw new TypeError(
        `[@llui/router] Path parameter "${segment.name}" in route "${name}" needs a scalar route codec.`,
      )
    }
  }
  for (const [key, value] of Object.entries(definition.defaults)) {
    const segment = segments.find(
      (candidate): candidate is ParameterSegment | RestSegment =>
        candidate.kind !== 'static' && candidate.name === key,
    )
    if (segment?.kind === 'parameter' && !segment.optional) {
      throw new TypeError(
        `[@llui/router] Default for required path parameter "${key}" in route "${name}" cannot be omitted from its URL.`,
      )
    }
    if (!segment && !(key in definition.query)) {
      throw new TypeError(
        `[@llui/router] Route "${name}" has a default for unknown parameter "${key}".`,
      )
    }
    void value
  }
  return segments
}

function assertParameterName(routeName: string, name: string, seen: Set<string>): void {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
    throw new TypeError(`[@llui/router] Route "${routeName}" has invalid parameter name "${name}".`)
  }
  if (seen.has(name)) {
    throw new TypeError(`[@llui/router] Route "${routeName}" repeats parameter "${name}".`)
  }
  seen.add(name)
}

function decodeLiteral(routeName: string, literal: string): string {
  try {
    return decodeURIComponent(literal)
  } catch {
    throw new TypeError(`[@llui/router] Route "${routeName}" contains malformed percent encoding.`)
  }
}

function expandVariants(segments: readonly Segment[]): readonly CompiledVariant[] {
  let variants: Segment[][] = [[]]
  for (const segment of segments) {
    if (segment.kind === 'parameter' && segment.optional) {
      variants = variants.flatMap((variant) => [variant, [...variant, segment]])
    } else {
      for (const variant of variants) variant.push(segment)
    }
  }
  return variants.map((variant) => ({
    segments: variant,
    specificity: specificityOf(variant),
  }))
}

function specificityOf(segments: readonly Segment[]): readonly number[] {
  return segments.map((segment) => {
    if (segment.kind === 'static') return 2
    if (segment.kind === 'parameter') return 1
    return -1
  })
}

function compareSpecificity(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function variantsOverlap(a: CompiledVariant, b: CompiledVariant): boolean {
  const aRest = a.segments.at(-1)?.kind === 'rest'
  const bRest = b.segments.at(-1)?.kind === 'rest'
  const minimum = Math.min(a.segments.length - (aRest ? 1 : 0), b.segments.length - (bRest ? 1 : 0))
  for (let index = 0; index < minimum; index++) {
    const left = a.segments[index]!
    const right = b.segments[index]!
    if (left.kind === 'static' && right.kind === 'static' && left.value !== right.value)
      return false
  }
  if (!aRest && !bRest) return a.segments.length === b.segments.length
  if (aRest && !bRest) return b.segments.length >= a.segments.length - 1
  if (!aRest && bRest) return a.segments.length >= b.segments.length - 1
  return true
}

function rejectAmbiguity(definitions: readonly CompiledDefinition[]): void {
  for (let leftIndex = 0; leftIndex < definitions.length; leftIndex++) {
    const left = definitions[leftIndex]!
    for (let rightIndex = leftIndex; rightIndex < definitions.length; rightIndex++) {
      const right = definitions[rightIndex]!
      for (let aIndex = 0; aIndex < left.variants.length; aIndex++) {
        const a = left.variants[aIndex]!
        for (let bIndex = 0; bIndex < right.variants.length; bIndex++) {
          if (leftIndex === rightIndex && aIndex >= bIndex) continue
          const b = right.variants[bIndex]!
          if (compareSpecificity(a.specificity, b.specificity) !== 0 || !variantsOverlap(a, b))
            continue
          throw new TypeError(
            `[@llui/router] Ambiguous routes "${left.name}" and "${right.name}" can match the same URL at equal specificity.`,
          )
        }
      }
    }
  }
}

interface ValidationSuccess {
  readonly ok: true
  readonly value: unknown
}

interface ValidationFailure {
  readonly ok: false
}

function validate(schema: AnySchema, value: unknown): ValidationSuccess | ValidationFailure {
  const result = schema['~standard'].validate(value)
  if (isPromiseLike(result)) {
    throw new TypeError(
      `[@llui/router] Route schemas must be synchronous; vendor "${schema['~standard'].vendor}" returned a Promise.`,
    )
  }
  return result.issues ? { ok: false } : { ok: true, value: result.value }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

function malformedEncoding(value: string): boolean {
  return /%(?![\da-fA-F]{2})/.test(value)
}

function decode(value: string): string | null {
  if (malformedEncoding(value)) return null
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (a instanceof Map && b instanceof Map) {
    const left = [...a.entries()]
    const right = [...b.entries()]
    return (
      left.length === right.length &&
      left.every(
        ([key, value], index) =>
          valuesEqual(key, right[index]?.[0]) && valuesEqual(value, right[index]?.[1]),
      )
    )
  }
  if (a instanceof Set && b instanceof Set) {
    const left = [...a.values()]
    const right = [...b.values()]
    return (
      left.length === right.length && left.every((value, index) => valuesEqual(value, right[index]))
    )
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => valuesEqual(value, b[index]))
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false
  const aRecord = a as Record<string, unknown>
  const bRecord = b as Record<string, unknown>
  const aKeys = Object.keys(aRecord)
  const bKeys = Object.keys(bRecord)
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) => Object.hasOwn(bRecord, key) && valuesEqual(aRecord[key], bRecord[key]))
  )
}

function cloneRouteValue(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value
  if (typeof value === 'function') return value
  const existing = seen.get(value)
  if (existing !== undefined) return existing
  if (value instanceof Date) return new Date(value.getTime())
  if (value instanceof Map) {
    const clone = new Map<unknown, unknown>()
    seen.set(value, clone)
    for (const [key, entry] of value) {
      clone.set(cloneRouteValue(key, seen), cloneRouteValue(entry, seen))
    }
    return clone
  }
  if (value instanceof Set) {
    const clone = new Set<unknown>()
    seen.set(value, clone)
    for (const entry of value) clone.add(cloneRouteValue(entry, seen))
    return clone
  }
  if (Array.isArray(value)) {
    const clone: unknown[] = []
    seen.set(value, clone)
    for (const item of value) clone.push(cloneRouteValue(item, seen))
    return clone
  }

  const clone = Object.create(Object.getPrototypeOf(value)) as Record<PropertyKey, unknown>
  seen.set(value, clone)
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor) continue
    if ('value' in descriptor) descriptor.value = cloneRouteValue(descriptor.value, seen)
    Object.defineProperty(clone, key, descriptor)
  }
  return clone
}

function normalizeBase(base?: string): string {
  if (!base) return ''
  let normalized = base.trim()
  if (normalized === '' || normalized === '/') return ''
  if (!normalized.startsWith('/')) normalized = '/' + normalized
  return normalized.replace(/\/+$/, '')
}

function stripBase(input: string, base: string): string | null {
  if (!base) return input
  if (input === base || input === base + '/') return '/'
  if (input.startsWith(base + '/')) return input.slice(base.length)
  if (input.startsWith(base + '?') || input.startsWith(base + '#'))
    return '/' + input.slice(base.length)
  return null
}

function withBase(path: string, base: string): string {
  if (!base) return path
  return path === '/' ? base + '/' : base + path
}

function matchSegments(
  variant: CompiledVariant,
  encodedSegments: readonly string[],
): Record<string, unknown> | null {
  const values: Record<string, unknown> = {}
  let inputIndex = 0
  for (const segment of variant.segments) {
    if (segment.kind === 'rest') {
      const restValues: string[] = []
      for (const encoded of encodedSegments.slice(inputIndex)) {
        const decoded = decode(encoded)
        if (decoded === null) return null
        restValues.push(decoded)
      }
      values[segment.name] = restValues
      inputIndex = encodedSegments.length
      continue
    }
    if (inputIndex >= encodedSegments.length) return null
    const decoded = decode(encodedSegments[inputIndex]!)
    if (decoded === null) return null
    if (segment.kind === 'static') {
      if (decoded !== segment.value) return null
    } else {
      values[segment.name] = decoded
    }
    inputIndex++
  }
  return inputIndex === encodedSegments.length ? values : null
}

function queryValues(queryString: string): Map<string, string[]> | null {
  if (malformedEncoding(queryString)) return null
  for (const pair of queryString.split('&')) {
    for (const component of pair.split('=', 2)) {
      try {
        decodeURIComponent(component.replace(/\+/g, ' '))
      } catch {
        return null
      }
    }
  }
  const values = new Map<string, string[]>()
  for (const [key, value] of new URLSearchParams(queryString)) {
    const existing = values.get(key)
    if (existing) existing.push(value)
    else values.set(key, [value])
  }
  return values
}

function assertCanonicalDefaults(
  routeName: string,
  definition: RouteDefinitionShape,
  segments: readonly Segment[],
): void {
  for (const [key, value] of Object.entries(definition.defaults)) {
    const segment = segments.find(
      (candidate): candidate is ParameterSegment | RestSegment =>
        candidate.kind !== 'static' && candidate.name === key,
    )
    const codec = segment
      ? (definition.params[key] ?? (segment.kind === 'parameter' ? stringCodec : undefined))
      : definition.query[key]

    if (!codec) {
      if (
        segment?.kind === 'rest' &&
        Array.isArray(value) &&
        value.every((part) => typeof part === 'string')
      ) {
        continue
      }
      throw new TypeError(
        `[@llui/router] Default "${key}" for route "${routeName}" is not accepted by its route codec.`,
      )
    }

    const formatted = (codec.format as (input: unknown) => string | readonly string[])(value)
    if (codec.multiple ? !Array.isArray(formatted) : typeof formatted !== 'string') {
      throw new TypeError(
        `[@llui/router] Default "${key}" for route "${routeName}" is not accepted by its route codec.`,
      )
    }
    const result = validate(codec.schema as AnySchema, formatted)
    if (!result.ok || !valuesEqual(result.value, value)) {
      throw new TypeError(
        `[@llui/router] Default "${key}" for route "${routeName}" is not accepted by its route codec or does not round-trip canonically.`,
      )
    }
  }
}

export function createRouter<const Registry extends RouteRegistry>(
  routes: Registry,
  config?: RouterConfig,
): Router<Registry> {
  const mode = config?.mode ?? 'hash'
  const base = normalizeBase(config?.base)
  const compiled: CompiledDefinition[] = Object.entries(routes).map(([name, definition]) => {
    const segments = parseTemplate(name, definition)
    assertCanonicalDefaults(name, definition, segments)
    return { name, definition, segments, variants: expandVariants(segments) }
  })
  rejectAmbiguity(compiled)

  function matchPath(input: string): RouteLocation<Registry> | null {
    const fragmentIndex = input.indexOf('#')
    const withoutFragment = fragmentIndex === -1 ? input : input.slice(0, fragmentIndex)
    const queryIndex = withoutFragment.indexOf('?')
    const rawPath = queryIndex === -1 ? withoutFragment : withoutFragment.slice(0, queryIndex)
    const rawQuery = queryIndex === -1 ? '' : withoutFragment.slice(queryIndex + 1)
    if (malformedEncoding(rawPath)) return null
    const encodedSegments = rawPath.split('/').filter(Boolean)
    const parsedQuery = queryValues(rawQuery)
    if (parsedQuery === null) return null

    const candidates: Array<{
      compiled: CompiledDefinition
      variant: CompiledVariant
      raw: Record<string, unknown>
    }> = []
    for (const definition of compiled) {
      for (const variant of definition.variants) {
        const raw = matchSegments(variant, encodedSegments)
        if (raw !== null) candidates.push({ compiled: definition, variant, raw })
      }
    }
    candidates.sort((a, b) => compareSpecificity(b.variant.specificity, a.variant.specificity))

    for (const candidate of candidates) {
      const definition = candidate.compiled.definition
      const normalized: Record<string, unknown> = {}
      let valid = true
      for (const segment of candidate.compiled.segments) {
        if (segment.kind === 'static') continue
        const raw = candidate.raw[segment.name]
        if (
          segment.kind === 'rest' &&
          Array.isArray(raw) &&
          raw.length === 0 &&
          Object.hasOwn(definition.defaults, segment.name)
        ) {
          normalized[segment.name] = cloneRouteValue(definition.defaults[segment.name])
          continue
        }
        if (raw === undefined) {
          normalized[segment.name] = Object.hasOwn(definition.defaults, segment.name)
            ? cloneRouteValue(definition.defaults[segment.name])
            : undefined
          continue
        }
        const codec =
          definition.params[segment.name] ?? (segment.kind === 'rest' ? undefined : stringCodec)
        if (!codec) {
          normalized[segment.name] = raw
          continue
        }
        const result = validate(codec.schema as AnySchema, raw)
        if (!result.ok) {
          valid = false
          break
        }
        normalized[segment.name] = result.value
      }
      if (!valid) continue

      for (const [key, codec] of Object.entries(definition.query)) {
        const raw = parsedQuery.get(key)
        if (raw === undefined) {
          normalized[key] = Object.hasOwn(definition.defaults, key)
            ? cloneRouteValue(definition.defaults[key])
            : undefined
          continue
        }
        if (!codec.multiple && raw.length !== 1) {
          valid = false
          break
        }
        const result = validate(codec.schema as AnySchema, codec.multiple ? raw : raw[0])
        if (!result.ok) {
          valid = false
          break
        }
        normalized[key] = result.value
      }
      if (!valid) continue

      if (definition.refine) {
        const refined = validate(definition.refine as AnySchema, cloneRouteValue(normalized))
        if (!refined.ok) continue
        if (!valuesEqual(refined.value, normalized)) {
          throw new TypeError(
            `[@llui/router] Whole-route schema for "${candidate.compiled.name}" transformed its parameters; it may only refine the normalized shape.`,
          )
        }
      }
      return { name: candidate.compiled.name, params: normalized } as RouteLocation<Registry>
    }
    return null
  }

  function definitionFor(name: string): CompiledDefinition {
    const found = compiled.find((definition) => definition.name === name)
    if (!found) throw new TypeError(`[@llui/router] Unknown route name "${name}".`)
    return found
  }

  function format(name: string, input: Record<string, unknown> | undefined): string {
    const compiledDefinition = definitionFor(name)
    const definition = compiledDefinition.definition
    const params: Record<string, unknown> = { ...definition.defaults, ...(input ?? {}) }
    const parts: string[] = []
    for (const segment of compiledDefinition.segments) {
      if (segment.kind === 'static') {
        parts.push(encodeURIComponent(segment.value))
        continue
      }
      const value = params[segment.name]
      if (
        segment.kind === 'rest' &&
        Object.hasOwn(definition.defaults, segment.name) &&
        valuesEqual(value, definition.defaults[segment.name])
      ) {
        continue
      }
      if (segment.kind === 'parameter' && segment.optional) {
        if (value === undefined || valuesEqual(value, definition.defaults[segment.name])) continue
      }
      if (value === undefined) {
        throw new TypeError(
          `[@llui/router] Missing parameter "${segment.name}" for route "${name}".`,
        )
      }
      const codec = definition.params[segment.name]
      if (segment.kind === 'rest') {
        const formatted = codec
          ? ((codec.format as (input: unknown) => readonly string[])(value) as readonly string[])
          : Array.isArray(value)
            ? value.map(String)
            : []
        if (!Array.isArray(value) && !codec) {
          throw new TypeError(
            `[@llui/router] Rest parameter "${segment.name}" for route "${name}" must be an array.`,
          )
        }
        parts.push(...formatted.map((part) => encodeURIComponent(part)))
      } else {
        const formatted = codec
          ? (codec.format as (input: unknown) => string)(value)
          : String(value)
        parts.push(encodeURIComponent(formatted))
      }
    }

    const search = new URLSearchParams()
    for (const [key, codec] of Object.entries(definition.query)) {
      const value = params[key]
      if (value === undefined || valuesEqual(value, definition.defaults[key])) continue
      const formatted = (codec.format as (input: unknown) => string | readonly string[])(value)
      if (codec.multiple) {
        for (const item of formatted as readonly string[]) search.append(key, item)
      } else {
        search.set(key, formatted as string)
      }
    }
    const query = search.toString()
    return '/' + parts.join('/') + (query ? `?${query}` : '')
  }

  function parseDestination(
    destination: readonly unknown[],
  ): [string, Record<string, unknown> | undefined] {
    return [destination[0] as string, destination[1] as Record<string, unknown> | undefined]
  }

  function canonicalDestination(
    name: string,
    params: Record<string, unknown> | undefined,
  ): { readonly path: string; readonly location: RouteLocation<Registry> } {
    const compiledDefinition = definitionFor(name)
    const path = format(name, params)
    const matched = matchPath(path)
    const expected: Record<string, unknown> = {}
    for (const segment of compiledDefinition.segments) {
      if (segment.kind === 'static') continue
      expected[segment.name] = Object.hasOwn(params ?? {}, segment.name)
        ? cloneRouteValue(params?.[segment.name])
        : Object.hasOwn(compiledDefinition.definition.defaults, segment.name)
          ? cloneRouteValue(compiledDefinition.definition.defaults[segment.name])
          : undefined
    }
    for (const key of Object.keys(compiledDefinition.definition.query)) {
      expected[key] = Object.hasOwn(params ?? {}, key)
        ? cloneRouteValue(params?.[key])
        : Object.hasOwn(compiledDefinition.definition.defaults, key)
          ? cloneRouteValue(compiledDefinition.definition.defaults[key])
          : undefined
    }
    if (matched === null || matched.name !== name || !valuesEqual(matched.params, expected)) {
      throw new TypeError(
        `[@llui/router] Parameters for route "${name}" do not round-trip to the same valid location.`,
      )
    }
    return { path, location: matched }
  }

  return {
    match(input) {
      const routeInput = mode === 'hash' ? input.replace(/^#\/?/, '/') : stripBase(input, base)
      return routeInput === null ? null : matchPath(routeInput)
    },
    location(...destination) {
      const [name, params] = parseDestination(destination)
      return canonicalDestination(name, params).location
    },
    toPath(...destination) {
      const [name, params] = parseDestination(destination)
      const path = canonicalDestination(name, params).path
      return mode === 'hash' ? path : withBase(path, base)
    },
    href(...destination) {
      const [name, params] = parseDestination(destination)
      const path = canonicalDestination(name, params).path
      return mode === 'hash' ? `#${path}` : withBase(path, base)
    },
    mode,
    base,
    routes,
  } as Router<Registry>
}
