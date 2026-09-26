// A VALUE import — not just types — but still browser-pure: `product-contract-types.ts` has zero
// runtime imports of its own, so this stays transitively dependency-free (no Node/DOM/zod/LLui
// runtime), which the package-boundary test asserts directly rather than requiring this file to
// have literally no imports at all. `MAX_PRODUCT_IDENTIFIER_LENGTH` is the SAME reason
// `PRESENTATION_FAMILY_VALUES` lives there: one shared constant `product-contract.ts`'s Zod
// schema and this file's `BoundaryDecoder.identifier()` both bind to, so they cannot drift apart
// on what "too long" means.
import {
  MAX_PRODUCT_IDENTIFIER_LENGTH,
  PRESENTATION_FAMILY_VALUES,
} from './product-contract-types.js'
import type {
  PresentationFamily,
  ProductContract,
  ProductPresentation,
} from './product-contract-types.js'

const CASE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const OBJECT_SOURCE = Function.prototype.toString.call(Object)
const ARRAY_SOURCE = Function.prototype.toString.call(Array)
const ARRAY_ENTRIES_SOURCE = Function.prototype.toString.call(Array.prototype.entries)
const ARRAY_ITERATOR_SOURCE = Function.prototype.toString.call(Array.prototype[Symbol.iterator])
const MAX_DEPTH = 64

/**
 * Sizing basis for the boundary-decoding complexity budget below: a realistic family upper bound
 * with generous headroom, not a measured maximum. Real families as of 2026-09 top out at 29
 * products (#264 navigation-data) and 25 (#265 forms-controls) with a handful of cases each; a
 * flat 5,000-node family-wide cap failed a genuine 30-product x 5-case x 20-row family.
 */
const REALISTIC_MAX_PRODUCTS_PER_FAMILY = 40
const REALISTIC_MAX_CASES_PER_PRODUCT = 12
const REALISTIC_MAX_NODES_PER_CASE = 300
const REALISTIC_MAX_ARRAY_LENGTH = 1_000
const COMPLEXITY_HEADROOM_MULTIPLIER = 2

/** Total decoded JSON-tree nodes across one family submission (all scenarios and cases). */
const MAX_NODES =
  REALISTIC_MAX_PRODUCTS_PER_FAMILY *
  REALISTIC_MAX_CASES_PER_PRODUCT *
  REALISTIC_MAX_NODES_PER_CASE *
  COMPLEXITY_HEADROOM_MULTIPLIER
/** One string value's own length; unaffected by family size. */
const MAX_STRING_LENGTH = 100_000
/** Average UTF-16 string units a realistic node contributes (a short label/id/key; most nodes in
 *  a real payload are short strings or primitives, not near `MAX_STRING_LENGTH`), used only to
 *  size the AGGREGATE string budget below with headroom — never a per-string cap of its own. */
const REALISTIC_STRING_UNITS_PER_NODE = 40
/** Total UTF-16 units across every string in one family submission. */
const MAX_TOTAL_STRING_UNITS = MAX_NODES * REALISTIC_STRING_UNITS_PER_NODE
/** One array's own length; unaffected by family size, but still given headroom. */
const MAX_ARRAY_LENGTH = REALISTIC_MAX_ARRAY_LENGTH * COMPLEXITY_HEADROOM_MULTIPLIER
/**
 * Total own fields across one family submission. A flat object's fields and nodes grow at
 * roughly the same rate, so this is sized above `MAX_NODES` rather than equal to it: the two
 * budgets bound genuinely different shapes (a wide, shallow payload versus a narrow, deep one)
 * and should not trip on the same input by coincidence.
 */
const MAX_FIELDS = MAX_NODES * 2
const DIAGNOSTIC_PATH_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * ONE cost model, BY CONSTRUCTION: the payload budgets above
 * (nodes/fields/string units/array length) meter ONLY the content that is byte-identical whether
 * it is read from a raw definitions submission or from a catalog compiled from it — each case's
 * `id`/`label`/`input`/`environmentAxes`/`copiedArtifactNames`, decoded by the SAME function
 * (`decodeCase`) in both places. PROTOCOL SCAFFOLDING — the fixed schema keys (`version`,
 * `family`, `scenarios`, `productId`, `scenarioId`, `defaultCaseId`, `cases`), the family name,
 * and every product/scenario identifier — is NEVER charged to those budgets, because a compiled
 * catalog's scaffolding literally does not exist in the raw definitions it was compiled from (no
 * `productId` field, no `version`/`family` wrapper), so charging it against a SHARED budget can
 * only ever be an ESTIMATE of the difference between the two shapes, not an exact figure — which
 * is what two earlier revisions of this budget got wrong (a flat cap too small for a real family,
 * then a "reserve the estimated scaffolding delta" patch that was still short by 82-872 string
 * units for some family shapes). Scaffolding is instead bounded by its OWN separate, small,
 * EXPLICIT structural limits below, entirely independent of the payload budgets. The result:
 * "every successful compile decodes unchanged through a JSON round trip or `structuredClone`"
 * holds BECAUSE the two decodes literally charge the identical function calls the identical
 * amount for the identical content — not because a reservation was computed to make it so.
 */
/** Hard cap on scenarios (= products) in one family — generous headroom over the largest real
 *  family (29, #264 navigation-data) — AND the ceiling `productId`/`scenarioId` identifiers are
 *  bounded by, since both are validated against `ProductContract`, whose own entries are what
 *  this bounds. */
const MAX_PRODUCTS_PER_FAMILY = REALISTIC_MAX_PRODUCTS_PER_FAMILY * COMPLEXITY_HEADROOM_MULTIPLIER
/** Hard cap on cases per scenario/product. */
const MAX_CASES_PER_PRODUCT = REALISTIC_MAX_CASES_PER_PRODUCT * COMPLEXITY_HEADROOM_MULTIPLIER
/** Hard cap on any protocol IDENTIFIER string: a `scenarioId` (definitions object key or catalog
 *  field), a `productId`, or a `family` name. These are short slugs by construction (`CASE_ID`-
 *  shaped, or one of `PRESENTATION_FAMILY_VALUES`) — this is generous headroom over any realistic
 *  identifier, not a payload-sized budget, and costs nothing against the payload string-unit
 *  budget above. (`defaultCaseId` is NOT one of these: its string VALUE is shared, verbatim,
 *  between a raw definition and its compiled scenario, so it stays on the metered `string()` path
 *  like any other case content — only the WRAPPER holding it is scaffolding.) Aliased from
 *  `product-contract-types.ts` rather than redefined here — see that constant's own doc for why
 *  `product-contract.ts`'s Zod schema and this file's `BoundaryDecoder.identifier()` share ONE
 *  limit. */
const MAX_IDENTIFIER_LENGTH = MAX_PRODUCT_IDENTIFIER_LENGTH

/**
 * The identifier-length invariant, exposed as a plain predicate so it can be enforced OUTSIDE
 * `BoundaryDecoder` too: `compiledCatalog` builds a catalog's `productId`/`scenarioId` directly
 * from an ALREADY-TRUSTED `ProductContract` entry's `name`/`scenarioId`, never through
 * `identifier()` (a `ProductContract` is caller-provided, Zod-validated data, not an untyped
 * boundary — there is nothing to DECODE). "Trusted" meant "not decoded," which used to also mean
 * "not held to the same length bound," so a contract entry with an oversized `name`/`scenarioId`
 * compiled cleanly and then failed to re-decode the moment its own compiled catalog was
 * serialized and handed back through `decodeScenarioSelection`. ONE
 * function enforces the ONE limit from both call sites, so they cannot drift apart again.
 */
function isValidIdentifierLength(value: string): boolean {
  return value.length <= MAX_IDENTIFIER_LENGTH
}
/**
 * Hard cap on the OWN-KEY COUNT of a fixed-schema scaffolding wrapper (a definition, a compiled
 * scenario, or the catalog root) — generous headroom over the largest such schema in this file
 * (4 keys, `SCENARIO_FIELDS`), so a caller's genuinely-mistaken extra field or two is reported
 * individually by `exactFields` (its own diagnostic, at its own path) rather than discarding the
 * whole wrapper. It exists only to keep an ADVERSARIAL flood of bogus keys on one wrapper from
 * costing more than one bounded reflection pass — it is not, and
 * must never become, an estimate of "the real schema size."
 */
const MAX_SCAFFOLDING_RECORD_KEYS = 32

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

/** At most 100 issues (including truncation) and 16,384 UTF-16 units (including paths and separators). */
export const PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS = Object.freeze({
  issues: 100,
  messageUnits: 16_384,
} as const)

/**
 * Frozen boundary-decoding complexity budget. `familyNodes`/`familyFields`/`familyStringUnits`
 * meter ONLY case payload content (never protocol scaffolding — see the constants above this
 * export), summed across one family submission, sized with generous headroom against a
 * realistic worst case of ~40 products x ~12 cases x a few-hundred-node payload each (see the
 * sizing-basis constants above this export). `stringLength` and `arrayLength` bound one payload
 * value at a time and are unaffected by family size. `depth` bounds payload nesting depth to keep
 * the decoder's explicit stack bounded. `products`, `casesPerProduct`, and `identifierLength`
 * bound the SEPARATE structural scaffolding dimensions — how many scenarios/cases a family may
 * declare, and how long a `scenarioId`/`productId`/`family` identifier may be — entirely
 * independent of the payload budgets, which is what makes a compiled catalog's scaffolding
 * (absent from raw definitions) cost nothing against them. (`defaultCaseId` is NOT one of these:
 * its string VALUE is shared, verbatim, between a raw definition and its compiled scenario, so it
 * is metered payload content like any other case content, bounded by `stringLength`/
 * `familyStringUnits` above — only the WRAPPER holding it is scaffolding.)
 */
export const PRESENTATION_SCENARIO_COMPLEXITY_LIMITS = Object.freeze({
  depth: MAX_DEPTH,
  familyNodes: MAX_NODES,
  familyFields: MAX_FIELDS,
  familyStringUnits: MAX_TOTAL_STRING_UNITS,
  stringLength: MAX_STRING_LENGTH,
  arrayLength: MAX_ARRAY_LENGTH,
  products: MAX_PRODUCTS_PER_FAMILY,
  casesPerProduct: MAX_CASES_PER_PRODUCT,
  identifierLength: MAX_IDENTIFIER_LENGTH,
} as const)

const ENVIRONMENT_AXES = new Set<string>(Object.keys(PRESENTATION_SCENARIO_ENVIRONMENT_VALUES))

/** Type-guard membership check — never cast a merely decoded string to
 *  `PresentationScenarioEnvironmentAxis` without going through this. */
function isPresentationScenarioEnvironmentAxis(
  value: string,
): value is PresentationScenarioEnvironmentAxis {
  return ENVIRONMENT_AXES.has(value)
}

/**
 * Per-axis allowed VALUES as plain `ReadonlySet<string>`s — never `readonly string[]`. Indexing
 * `PRESENTATION_SCENARIO_ENVIRONMENT_VALUES` by a (union) `PresentationScenarioEnvironmentAxis`
 * gives a UNION of each axis's own literal tuple type (`readonly ['light','dark'] | readonly
 * ['ltr','rtl'] | …`), and `Array<T>.includes` has no single call signature that accepts a plain
 * `string` against a union of differently-typed arrays — the previous code cast the indexed
 * value to `readonly string[]` to route around that. A `Set<string>.has(value: string)` has no
 * such generic pitfall, so building this lookup once removes the cast entirely.
 */
const ENVIRONMENT_AXIS_VALUE_SETS: Readonly<
  Record<PresentationScenarioEnvironmentAxis, ReadonlySet<string>>
> = Object.freeze({
  theme: new Set(PRESENTATION_SCENARIO_ENVIRONMENT_VALUES.theme),
  direction: new Set(PRESENTATION_SCENARIO_ENVIRONMENT_VALUES.direction),
  motion: new Set(PRESENTATION_SCENARIO_ENVIRONMENT_VALUES.motion),
  viewport: new Set(PRESENTATION_SCENARIO_ENVIRONMENT_VALUES.viewport),
  forcedColors: new Set(PRESENTATION_SCENARIO_ENVIRONMENT_VALUES.forcedColors),
})
// The one canonical tuple, imported directly from `product-contract-types.ts` — no second
// mirrored copy to drift, and no compile-time equality assertion needed to keep them in sync.
const PRESENTATION_FAMILIES = new Set<string>(PRESENTATION_FAMILY_VALUES)

/** Type-guard membership check — never cast a merely decoded string to
 *  `PresentationFamily` without going through this. */
function isPresentationFamily(value: string): value is PresentationFamily {
  return PRESENTATION_FAMILIES.has(value)
}
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Assert<Value extends true> = Value

/** Renderer-neutral data accepted as a scenario input. */
export type PresentationScenarioJson =
  | null
  | boolean
  | number
  | string
  | readonly PresentationScenarioJson[]
  | { readonly [key: string]: PresentationScenarioJson }

type DeepReadonlyJson<Value> = PresentationScenarioJson extends Value
  ? PresentationScenarioJson
  : Value extends null | boolean | number | string
    ? Value
    : Value extends readonly unknown[]
      ? { readonly [Index in keyof Value]: DeepReadonlyJson<Value[Index]> }
      : Value extends object
        ? { readonly [Key in keyof Value]: DeepReadonlyJson<Value[Key]> }
        : never

/** Recursive readonly shape emitted for a validated JSON input snapshot. */
export type PresentationScenarioJsonSnapshot<
  Value extends PresentationScenarioJson = PresentationScenarioJson,
> = DeepReadonlyJson<Value>

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

const PRESENTATION_SCENARIO_PATH_SET = new Set<string>(PRESENTATION_SCENARIO_PATHS)

/** A renderer path whose availability is owned by ProductContract. */
export type PresentationScenarioPath = (typeof PRESENTATION_SCENARIO_PATHS)[number]

/** Type-guard membership check — never cast a merely decoded string to
 *  `PresentationScenarioPath` without going through this. */
function isPresentationScenarioPath(value: string): value is PresentationScenarioPath {
  return PRESENTATION_SCENARIO_PATH_SET.has(value)
}

/**
 * Compile-time tie to `ProductContract`: a renderer path is exactly one of
 * `ProductPresentation`'s non-`family` fields. If a path is ever added to or removed from
 * `ProductPresentation`, this assertion fails to compile until `PRESENTATION_SCENARIO_PATHS`
 * is updated to match, instead of the two silently drifting apart.
 */
type _PresentationScenarioPathsMatchContract = Assert<
  Equal<PresentationScenarioPath, Exclude<keyof ProductPresentation, 'family'>>
>

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

/**
 * Recursively enforces exactness at compile time for a STATICALLY KNOWN definitions literal: a
 * case may carry only `PresentationScenarioCase`'s own fields
 * (never a `render`/renderer-metadata field alongside them), and a definition may carry only
 * `PresentationScenarioDefinition`'s. `input` is deliberately left untouched at every level — it
 * is arbitrary `PresentationScenarioJson` the family owns, not protocol structure, so it has no
 * fixed "shape" to be exact against.
 *
 * An excess field collapses its case (or definition) to `never`, which is what turns a
 * `compileScenarioFamily(contract, family, literal)` call carrying an extra field into an
 * "argument is not assignable to parameter of type `never`" compile error instead of a silently
 * accepted value: TypeScript does NOT excess-property-check an object literal against a GENERIC
 * type parameter's constraint the way it excess-property-checks against a concrete parameter
 * type (`f<const T extends Shape>(x: T)` accepts a `{ ...Shape, extra: 1 }` literal silently,
 * measured), so `Definitions extends PresentationScenarioDefinitions` alone is not enough — the
 * PARAMETER's declared type itself must be this exactness-checked shape for the check to fire.
 */
/**
 * `keyof` a UNION type is the INTERSECTION of each member's keys (only keys guaranteed present on
 * every member), which is exactly wrong for excess-property detection: a key that exists on only
 * SOME members (an excess field smuggled onto one arm of a union-typed cases array) is invisible
 * to a plain `keyof`. Distributing over a naked type parameter instead unions the per-member key
 * sets, surfacing every member's keys — including ones only one arm has.
 */
type UnionKeys<Value> = Value extends unknown ? keyof Value : never

// `[Case]`/`[PresentationScenarioCase]` are wrapped in one-tuples so this `extends` check does
// NOT distribute over a union `Case` — distributing here would evaluate each member separately
// and re-union the (correct, `never`) result for a bad member alongside the (unchanged) result
// for a good one, silently dropping the bad member via `X | never === X` instead of poisoning the
// whole type. `UnionKeys` above is the one place that MUST distribute.
type ExactCase<Case> = [Case] extends [PresentationScenarioCase]
  ? Exclude<UnionKeys<Case>, keyof PresentationScenarioCase> extends never
    ? Case
    : never
  : Case

// Same fix as `ExactCase` above, mirrored one level up: a bare
// `Definition extends {...}` distributes over a union `Definition` (silently dropping a bad
// member via `X | never === X`, exactly the failure the one-tuple wrap on `ExactCase` exists to
// prevent), and a plain `keyof Definition` on a union type is the INTERSECTION of its members'
// keys — invisible to an excess field smuggled onto only ONE arm of a union
// (`Def | (Def & { render: () => void })` compiled where it should not have). `[Definition]
// extends [...]` suppresses distribution on the outer check; `UnionKeys` (already defined above,
// for this exact reason) distributes deliberately on the inner one.
type ExactDefinition<Definition> = [Definition] extends [
  {
    readonly defaultCaseId: string
    readonly cases: readonly unknown[]
  },
]
  ? Exclude<UnionKeys<Definition>, keyof PresentationScenarioDefinition> extends never
    ? {
        readonly defaultCaseId: Definition['defaultCaseId']
        readonly cases: {
          readonly [Index in keyof Definition['cases']]: ExactCase<Definition['cases'][Index]>
        }
      }
    : never
  : Definition

/** Applied to `compileScenarioFamily`'s `definitions` parameter type; see `ExactCase` above. */
type ExactDefinitions<Definitions> = {
  readonly [ScenarioId in keyof Definitions]: ExactDefinition<Definitions[ScenarioId]>
}

/** Canonical renderer input copied from a validated family case. */
export type CompiledPresentationScenarioCase<
  Case extends PresentationScenarioCase = PresentationScenarioCase,
> = Case extends PresentationScenarioCase
  ? {
      readonly id: Case['id']
      readonly label: Case['label']
      readonly input: PresentationScenarioJsonSnapshot<Case['input']>
      readonly environmentAxes: Readonly<Case['environmentAxes']>
      readonly copiedArtifactNames?: Readonly<NonNullable<Case['copiedArtifactNames']>>
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
  // Structurally decoded strings only — genuinely unknown axis names are still possible here and
  // are reported by `collectCaseIssues` (which runs after every `DecodedCase` in a family exists
  // to cross-reference against). Widened deliberately: narrowing this to
  // `PresentationScenarioEnvironmentAxis[]` at construction would need a cast BEFORE that
  // validation ever runs. The public surface only ever sees a compiled catalog
  // AFTER `diagnostics.throwIfAny` has confirmed every axis is valid.
  readonly environmentAxes: readonly string[]
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
  // Structurally decoded only — see `DecodedCase.environmentAxes`'s comment for why this is not
  // narrowed to `PresentationFamily` at construction.
  readonly family: string
  readonly scenarios: readonly DecodedScenario[]
}

interface DecodedSelection {
  readonly productId: string
  readonly caseId?: string
  readonly path: string
  readonly environment: Readonly<Record<string, string>>
  readonly copiedArtifact?: string
}

interface DiagnosticPropertySegment {
  readonly kind: 'property'
  readonly key: string
  readonly identifier: boolean
}

interface DiagnosticIndexSegment {
  readonly kind: 'index'
  readonly index: number
}

type DiagnosticPathSegment = DiagnosticPropertySegment | DiagnosticIndexSegment

interface DiagnosticPath {
  readonly parent?: DiagnosticPath
  readonly segment?: DiagnosticPathSegment
  /** How many LEADING segments (counted from `$`) must never be elided by `clipDiagnosticPath` —
   *  inherited from the nearest ancestor `protectedPath()` marked, all the way down to every leaf
   *  built from it. See `protectedPath()`'s doc. */
  readonly protectedDepth?: number
}

interface QuotedDiagnosticPart {
  readonly kind: 'quoted'
  readonly value: string
}

type DiagnosticPart = string | number | QuotedDiagnosticPart

const ROOT_DIAGNOSTIC_PATH: DiagnosticPath = Object.freeze({})
const DIAGNOSTIC_TRUNCATION_ISSUE = `$: diagnostics truncated at ${PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS.issues} issues or ${PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS.messageUnits} aggregate message/path units.`

/**
 * Per-issue clipping budget: rendering one issue's path or reason text is
 * always cheap and bounded regardless of source-data size (a path chain is at most a few dozen
 * segments deep, and a single quoted value or key is rendered exactly once), so there is no need
 * to estimate units before rendering. What DOES need bounding is the RENDERED SIZE any one issue
 * is allowed to contribute to the aggregate message budget: without a per-issue cap, a single
 * pathologically long path segment or quoted value (a 20,000-character stale key; a ~6,000-
 * character unknown environment value) could by itself exceed the entire aggregate budget,
 * making `add` truncate the WHOLE report before any issue — including this one, with the path
 * that names the actual problem — is ever recorded. Each is small relative to the aggregate
 * budget, so many issues can still coexist in one report.
 */
const MAX_ISSUE_PATH_UNITS = 200
const MAX_ISSUE_REASON_UNITS = 200
const ELISION_MARKER = '…'

/** Clips `text` to `limit` UTF-16 units, deterministically marking the elision with its full,
 *  pre-clip length so two truncated renders of the same oversized input are byte-identical. */
function clipRenderedText(text: string, limit: number): string {
  if (text.length <= limit) return text
  const marker = `${ELISION_MARKER}(${text.length})`
  const keep = Math.max(0, limit - marker.length)
  return `${text.slice(0, keep)}${marker}`
}

function propertyPath(parent: DiagnosticPath, key: string): DiagnosticPath {
  const identifier = DIAGNOSTIC_PATH_IDENTIFIER.test(key)
  return {
    parent,
    segment: { kind: 'property', key, identifier },
    protectedDepth: parent.protectedDepth,
  }
}

function indexPath(parent: DiagnosticPath, index: number): DiagnosticPath {
  return { parent, segment: { kind: 'index', index }, protectedDepth: parent.protectedDepth }
}

/**
 * Marks `path` as the PROTOCOL-STRUCTURE boundary `clipDiagnosticPath` must never elide past —
 * the case/field root (a definition's `.cases[i]` or a compiled scenario's `.scenarios[i].cases[j]`)
 * — so that `$["<scenarioId>"].cases[i]` / `$.scenarios[i].cases[j]` always survives clipping in
 * full, and elision is confined to segments BUILT FROM IT (i.e. inside the case's own payload,
 * `input` chief among them). Every `propertyPath`/`indexPath` built from the returned path inherits
 * the same `protectedDepth`, so the marker only needs to be applied ONCE, at the case root itself:
 * without it, two issues that differ only near the SCAFFOLDING root
 * (which scenario, which case) but share a deep payload shape collapse to the same clipped path,
 * exactly the defect the leaf-clipping fix in `clipDiagnosticPath` closes one level in, for
 * payload-only siblings.
 */
function protectedPath(path: DiagnosticPath): DiagnosticPath {
  return {
    parent: path.parent,
    segment: path.segment,
    protectedDepth: diagnosticPathSegments(path).length,
  }
}

/** Root-to-leaf ordered segment list for `path` — the shared basis for both a full render and a
 *  clipped one. */
function diagnosticPathSegments(path: DiagnosticPath): DiagnosticPathSegment[] {
  const segments: DiagnosticPathSegment[] = []
  for (let current: DiagnosticPath | undefined = path; current?.segment !== undefined; ) {
    segments.push(current.segment)
    current = current.parent
  }
  segments.reverse()
  return segments
}

function renderPathSegment(segment: DiagnosticPathSegment): string {
  if (segment.kind === 'index') return `[${segment.index}]`
  if (segment.identifier) return `.${segment.key}`
  return `[${JSON.stringify(segment.key)}]`
}

function renderDiagnosticPath(path: DiagnosticPath): string {
  return ['$', ...diagnosticPathSegments(path).map(renderPathSegment)].join('')
}

/**
 * Renders `path` within `limit` UTF-16 units, eliding from the MIDDLE of the PAYLOAD portion —
 * never the head, never the protocol prefix, never the leaf — so two paths that differ only in
 * their leaf segment, or only in WHICH scenario/case they name, stay distinguishable after
 * clipping. A plain head-keep/tail-cut clip (as `clipRenderedText` does for free-form reason
 * text) is wrong here for two separate reasons: sibling issues inside the SAME case typically
 * share a long, identical payload prefix and differ only in their final segment, so clipping the
 * tail away collapses them to the same byte-identical path; and issues from DIFFERENT
 * scenarios/cases can share a long, identical
 * PAYLOAD SHAPE while differing only near the root — the scaffolding segments a plain middle-clip
 * has no reason to prefer keeping — so eliding those away the same way collapses distinct
 * findings just as badly. `path.protectedDepth` (set once, at the case root, by
 * `protectedPath()`) names the boundary: segments `[0, protectedDepth)` are the protocol prefix
 * and are ALWAYS rendered WHOLE — not merely un-elided, but never passed through the per-segment
 * `clipRenderedText` either, since that clips to a head-keep/tail-cut ~50-unit window and two
 * long scenario/stale-key identifiers differing only near their OWN tail would collapse to the
 * same clipped prefix — the same defect this whole mechanism exists to prevent, reintroduced one
 * level in. Each protocol segment is already bounded by a small, fixed ceiling
 * (`MAX_IDENTIFIER_LENGTH`, 256 units) regardless, so rendering it whole cannot reopen an
 * unbounded-size hole — it can only, rarely, make ONE issue's rendered path exceed `limit`; the
 * aggregate message budget, not this per-issue heuristic, is what actually bounds total output.
 * Only PAYLOAD segments (from `protectedDepth` up to, but not including, the leaf) are eligible
 * for elision, and an individual payload segment that is itself too long to fit is clipped
 * internally via `clipRenderedText` rather than dropped whole.
 */
function clipDiagnosticPath(path: DiagnosticPath, limit: number): string {
  const segments = diagnosticPathSegments(path)
  const full = renderDiagnosticPath(path)
  if (full.length <= limit) return full
  if (segments.length === 0) return clipRenderedText(full, limit)

  // No single PAYLOAD segment (however long) may consume the whole budget by itself — leaves
  // room for `$`, the elision marker, and at least the leaf.
  const perSegmentLimit = Math.max(24, Math.floor(limit / 4))
  const leafIndex = segments.length - 1
  const leaf = clipRenderedText(renderPathSegment(segments[leafIndex]!), perSegmentLimit)

  // The protocol prefix is never elided AND never per-segment clipped — rendered whole, exactly
  // as `renderDiagnosticPath` would render it (see this function's doc).
  const protectedDepth = Math.min(path.protectedDepth ?? 0, leafIndex)
  const protectedText = segments
    .slice(0, protectedDepth)
    .map((segment) => renderPathSegment(segment))
    .join('')

  // Greedily keep as many of the remaining (payload) segments as fit, working from the one
  // closest to the LEAF back toward the protected boundary — segments nearer the leaf are
  // typically the more specific/relevant ones.
  const kept: string[] = []
  let keptLength = 0
  let index = leafIndex - 1
  for (; index >= protectedDepth; index -= 1) {
    const text = clipRenderedText(renderPathSegment(segments[index]!), perSegmentLimit)
    const elidedBefore = index - protectedDepth // payload segments that would remain unshown
    const markerLength = elidedBefore > 0 ? `${ELISION_MARKER}(${elidedBefore})`.length : 0
    if (1 + protectedText.length + markerLength + keptLength + text.length + leaf.length > limit) {
      break
    }
    kept.unshift(text)
    keptLength += text.length
  }
  const elidedCount = index + 1 - protectedDepth
  const marker = elidedCount > 0 ? `${ELISION_MARKER}(${elidedCount})` : ''
  return `$${protectedText}${marker}${kept.join('')}${leaf}`
}

function quoted(value: string): QuotedDiagnosticPart {
  return { kind: 'quoted', value }
}

function renderDiagnosticPart(part: DiagnosticPart): string {
  if (typeof part === 'string') return part
  if (typeof part === 'number') return String(part)
  return JSON.stringify(part.value)
}

/** How many candidate names an ambiguous-registry-target diagnostic suggests before summarizing the rest. */
const MAX_SUGGESTED_ARTIFACT_NAMES = 8

function boundedSortedArtifactNames(
  artifacts: readonly ProductContract['entries'][number]['copiedArtifacts'][number][],
  limit = MAX_SUGGESTED_ARTIFACT_NAMES,
): readonly string[] {
  const names: string[] = []
  for (const { name } of artifacts) {
    const insertionIndex = names.findIndex((candidate) => name < candidate)
    if (insertionIndex === -1) names.push(name)
    else names.splice(insertionIndex, 0, name)
    if (names.length > limit) names.pop()
  }
  return names
}

/** One lazy, total budget for every public protocol diagnostic phase. */
class DiagnosticCollector {
  readonly #issues: string[] = []
  #messageUnits = 0
  #truncated = false

  get hasIssues(): boolean {
    return this.#issues.length > 0
  }

  add(path: DiagnosticPath, ...reason: readonly DiagnosticPart[]): void {
    if (this.#truncated) return
    if (this.#issues.length >= PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS.issues - 1) {
      this.#truncate()
      return
    }

    // Clip the path and reason INDEPENDENTLY, before either is measured against the aggregate
    // budget, so one oversized path or value can only ever cost this one issue a bounded, fixed
    // amount — never the whole report.
    const renderedPath = clipDiagnosticPath(path, MAX_ISSUE_PATH_UNITS)
    const renderedReason = clipRenderedText(
      reason.map(renderDiagnosticPart).join(''),
      MAX_ISSUE_REASON_UNITS,
    )
    const issue = `${renderedPath}: ${renderedReason}.`
    const separatorUnits = this.#issues.length === 0 ? 0 : 1
    const reservedMarkerUnits = DIAGNOSTIC_TRUNCATION_ISSUE.length + 1
    if (
      this.#messageUnits + separatorUnits + issue.length >
      PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS.messageUnits - reservedMarkerUnits
    ) {
      this.#truncate()
      return
    }

    this.#issues.push(issue)
    this.#messageUnits += separatorUnits + issue.length
  }

  result<T>(value: T | undefined, code: PresentationScenarioErrorCode): T {
    if (value === undefined && !this.hasIssues) {
      this.add(ROOT_DIAGNOSTIC_PATH, 'value could not be decoded')
    }
    this.throwIfAny(code)
    return value!
  }

  throwIfAny(code: PresentationScenarioErrorCode): void {
    if (this.hasIssues) throw new PresentationScenarioError(code, this.#issues)
  }

  error(code: PresentationScenarioErrorCode): PresentationScenarioError {
    if (!this.hasIssues) this.add(ROOT_DIAGNOSTIC_PATH, 'operation failed')
    return new PresentationScenarioError(code, this.#issues)
  }

  #truncate(): void {
    if (this.#truncated) return
    const separatorUnits = this.#issues.length === 0 ? 0 : 1
    this.#issues.push(DIAGNOSTIC_TRUNCATION_ISSUE)
    this.#messageUnits += separatorUnits + DIAGNOSTIC_TRUNCATION_ISSUE.length
    this.#truncated = true
  }
}

/**
 * Raw, role-agnostic facts about one object's own keys — the output of the single expensive
 * reflection step (`Reflect.ownKeys` + `Object.getOwnPropertyDescriptor` per key). It carries no
 * opinion about which budget or cap applies: `totalKeyStringUnits`/`maxKeyLength` are read by
 * EITHER a metered caller (against `MAX_STRING_LENGTH`/the payload string-unit budget) or a
 * structural caller (against `MAX_IDENTIFIER_LENGTH`, charging nothing) — which is what lets one
 * cached snapshot safely serve either role.
 */
/**
 * Phase one of reflection: JUST `Reflect.ownKeys` plus a cheap categorizing walk (typeof checks,
 * length sums) — no `Object.getOwnPropertyDescriptor` calls. Cheap enough that callers check their
 * OWN cap (an aggregate field charge, or a fixed structural `maxKeys`) against `stringKeys.length`
 * BEFORE ever moving to the expensive phase two (`#safeDescriptorsFor`), so a value with an
 * adversarially huge key count is rejected without paying for a single descriptor lookup — the
 * property the original single-phase design had and a merged phase would have silently dropped.
 */
interface KeyList {
  readonly stringKeys: readonly string[]
  readonly hasSymbol: boolean
  readonly totalKeyStringUnits: number
  readonly maxKeyLength: number
}

/**
 * The ONE difference between a metered (payload) and a structural (scaffolding) record/array
 * inspection: how the own-key COUNT is bounded. `'metered'` charges the aggregate payload budget
 * (nodes/fields/string-units are shared across the whole family); `'structural'` checks a fixed,
 * caller-named cap and charges nothing. Everything else about inspecting a record or an array is
 * identical regardless of which policy applies — see `#recordWithPolicy`/`#arrayWithPolicy`.
 */
type RecordPolicy =
  | { readonly kind: 'metered' }
  | { readonly kind: 'structural'; readonly maxKeys: number }
type ArrayPolicy =
  | { readonly kind: 'metered' }
  | { readonly kind: 'structural'; readonly maxLength: number }
const METERED_POLICY: RecordPolicy & ArrayPolicy = { kind: 'metered' }

/** The cached, role-agnostic result of walking an array's real own keys once: validated
 *  hole/accessor/symbol-free dense content, in order. */
interface ArrayContentSnapshot {
  readonly values: readonly unknown[]
}

/** Descriptor-only decoder for ordinary definitions, catalogs, selections, and JSON inputs. */
class BoundaryDecoder {
  #nodes = 0
  #fields = 0
  #stringUnits = 0
  #nodeLimitReported = false
  #fieldLimitReported = false
  #stringLimitReported = false
  // Set once ANY payload budget (nodes/fields/string-units) is exhausted. Checked at the top of
  // every method that does real inspection work, so a budget overrun stops ALL further reflection
  // immediately rather than merely refusing to charge for it — the
  // aggregate budgets alone do not bound WORK, only the accepted RESULT, and exhausting one used
  // to leave every remaining node in the tree to still pay full Reflect.ownKeys /
  // getOwnPropertyDescriptor cost on the way to being rejected anyway.
  #fatal = false
  // Per-object memoization of the expensive reflection step: a value
  // referenced many times from the tree pays `Reflect.ownKeys` / `getOwnPropertyDescriptor` ONCE,
  // not once per reference. Charging still happens per OCCURRENCE (see `#chargeFields`), using the
  // cached counts — so a shared object with K keys referenced R times still exhausts the field
  // budget in O(R) cheap arithmetic operations after the first O(K) reflection, never O(R*K)
  // reflection calls. `'unsafe'` remembers a value that failed reflection or descriptor lookup;
  // repeat occurrences fail silently (no repeated diagnostic — the first occurrence already named
  // the reason) rather than re-attempting the same failing reflection.
  #keyListCache = new WeakMap<object, KeyList | 'unsafe'>()
  #descriptorCache = new WeakMap<
    object,
    Readonly<Record<PropertyKey, PropertyDescriptor>> | 'unsafe'
  >()
  #arrayContentCache = new WeakMap<object, ArrayContentSnapshot | 'unsafe'>()

  constructor(
    private readonly code: PresentationScenarioErrorCode,
    private readonly diagnostics: DiagnosticCollector,
  ) {}

  issue(path: DiagnosticPath, ...reason: readonly DiagnosticPart[]): void {
    this.diagnostics.add(path, ...reason)
  }

  result<T>(value: T | undefined): T {
    return this.diagnostics.result(value, this.code)
  }

  #consumeNode(path: DiagnosticPath): boolean {
    if (this.#fatal) return false
    this.#nodes += 1
    if (this.#nodes <= MAX_NODES) return true
    if (!this.#nodeLimitReported) {
      this.#nodeLimitReported = true
      this.issue(path, `node limit of ${MAX_NODES} exceeded`)
    }
    this.#fatal = true
    return false
  }

  #consumeString(value: string, path: DiagnosticPath): boolean {
    if (this.#fatal) return false
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
    this.#fatal = true
    return false
  }

  /** Charges an already-known key COUNT and string-unit total (from a cached or fresh
   *  `KeyList`) against the aggregate payload budgets — the per-OCCURRENCE half of the
   *  memoization scheme: cheap arithmetic every time, regardless of whether the list itself
   *  was a cache hit. */
  #chargeFields(count: number, stringUnits: number, path: DiagnosticPath): boolean {
    if (this.#fatal) return false
    this.#fields += count
    if (this.#fields > MAX_FIELDS) {
      if (!this.#fieldLimitReported) {
        this.#fieldLimitReported = true
        this.issue(path, `aggregate object-field limit of ${MAX_FIELDS} exceeded`)
      }
      this.#fatal = true
      return false
    }
    this.#stringUnits += stringUnits
    if (this.#stringUnits > MAX_TOTAL_STRING_UNITS) {
      if (!this.#stringLimitReported) {
        this.#stringLimitReported = true
        this.issue(path, `total string-unit limit of ${MAX_TOTAL_STRING_UNITS} exceeded`)
      }
      this.#fatal = true
      return false
    }
    return true
  }

  #isArray(value: object, path: DiagnosticPath): boolean | undefined {
    try {
      return Array.isArray(value)
    } catch {
      this.issue(path, 'value could not be inspected safely')
      return undefined
    }
  }

  /** Phase one (see `KeyList`'s doc): `Reflect.ownKeys` plus categorization, memoized per object
   *  reference. Cheap relative to phase two, but still O(own key count), so a value referenced
   *  many times still pays it only once. */
  #safeKeyList(value: object, path: DiagnosticPath): KeyList | undefined {
    const cached = this.#keyListCache.get(value)
    if (cached === 'unsafe') return undefined
    if (cached !== undefined) return cached

    let keys: readonly PropertyKey[]
    try {
      keys = Reflect.ownKeys(value)
    } catch {
      this.issue(path, 'value could not be inspected safely')
      this.#keyListCache.set(value, 'unsafe')
      return undefined
    }
    let hasSymbol = false
    let totalKeyStringUnits = 0
    let maxKeyLength = 0
    const stringKeys: string[] = []
    for (const key of keys) {
      if (typeof key !== 'string') {
        hasSymbol = true
        continue
      }
      totalKeyStringUnits += key.length
      if (key.length > maxKeyLength) maxKeyLength = key.length
      stringKeys.push(key)
    }
    const list: KeyList = { stringKeys, hasSymbol, totalKeyStringUnits, maxKeyLength }
    this.#keyListCache.set(value, list)
    return list
  }

  /**
   * Phase two: `Object.getOwnPropertyDescriptor` for every STRING key phase one found (never a
   * symbol key — nothing downstream ever reads a symbol-keyed descriptor, since a symbol key is
   * always rejected on sight). Memoized separately from phase one and reached ONLY after a caller
   * has already checked `keyList`'s cheap facts against its own cap, so an adversarially wide
   * object that fails that cap never reaches this, the genuinely expensive step.
   */
  #safeDescriptorsFor(
    value: object,
    path: DiagnosticPath,
    keyList: KeyList,
  ): Readonly<Record<PropertyKey, PropertyDescriptor>> | undefined {
    const cached = this.#descriptorCache.get(value)
    if (cached === 'unsafe') return undefined
    if (cached !== undefined) return cached

    const descriptors = Object.create(null) as Record<PropertyKey, PropertyDescriptor>
    try {
      for (const key of keyList.stringKeys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (descriptor === undefined) {
          this.issue(path, 'own properties changed while being inspected')
          this.#descriptorCache.set(value, 'unsafe')
          return undefined
        }
        Object.defineProperty(descriptors, key, {
          enumerable: true,
          value: descriptor,
        })
      }
    } catch {
      this.issue(path, 'value could not be inspected safely')
      this.#descriptorCache.set(value, 'unsafe')
      return undefined
    }
    this.#descriptorCache.set(value, descriptors)
    return descriptors
  }

  #canonicalObjectPrototype(prototype: object, path: DiagnosticPath): boolean | undefined {
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

  #hasPlainPrototype(value: object, path: DiagnosticPath): boolean | undefined {
    try {
      const prototype = Object.getPrototypeOf(value) as object | null
      if (prototype === null) return true
      return this.#canonicalObjectPrototype(prototype, path)
    } catch {
      this.issue(path, 'value could not be inspected safely')
      return undefined
    }
  }

  #hasCanonicalArrayPrototype(value: object, path: DiagnosticPath): boolean | undefined {
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

  /**
   * The two record-inspection roles differ in exactly TWO respects — how the own-key COUNT is
   * bounded (an aggregate charge against the shared payload budget, or a fixed structural cap)
   * and how an individual key's own LENGTH is bounded (`MAX_STRING_LENGTH`, or the much smaller
   * `MAX_IDENTIFIER_LENGTH`) — everything else (shape/prototype checks, the key-list/descriptor
   * phases, building `keys`) is identical, so ONE method takes the difference as data instead of
   * two call paths that could silently drift apart.
   */
  #recordPolicy(policy: RecordPolicy, keyList: KeyList, path: DiagnosticPath): boolean {
    if (policy.kind === 'metered') {
      // Charged (and, on overflow, rejected) BEFORE ever building descriptors — an adversarially
      // wide object pays only the cheap phase-one categorization, never the expensive per-key
      // `getOwnPropertyDescriptor` walk.
      if (!this.#chargeFields(keyList.stringKeys.length, keyList.totalKeyStringUnits, path)) {
        return false
      }
      if (keyList.maxKeyLength > MAX_STRING_LENGTH) {
        this.issue(path, `property-name length limit of ${MAX_STRING_LENGTH} exceeded`)
        return false
      }
      return true
    }
    // Checked BEFORE descriptors: an adversarial flood of bogus keys on a scaffolding wrapper is
    // rejected on the cheap phase-one categorization alone.
    if (keyList.stringKeys.length > policy.maxKeys) {
      this.issue(path, `own-key limit of ${policy.maxKeys} exceeded`)
      return false
    }
    if (keyList.maxKeyLength > MAX_IDENTIFIER_LENGTH) {
      this.issue(path, `identifier length limit of ${MAX_IDENTIFIER_LENGTH} exceeded`)
      return false
    }
    return true
  }

  #recordWithPolicy(
    value: unknown,
    path: DiagnosticPath,
    policy: RecordPolicy,
  ): InspectedRecord | undefined {
    if (this.#fatal) return undefined
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
    const keyList = this.#safeKeyList(value, path)
    if (keyList === undefined) return undefined
    if (!this.#recordPolicy(policy, keyList, path)) return undefined
    const descriptors = this.#safeDescriptorsFor(value, path, keyList)
    if (descriptors === undefined) return undefined
    const keys: string[] = []
    for (const key of keyList.stringKeys) {
      const descriptor = descriptors[key]!
      if (!descriptor.enumerable) {
        this.issue(propertyPath(path, key), 'non-enumerable properties are not supported')
        continue
      }
      keys.push(key)
    }
    if (keyList.hasSymbol) this.issue(path, 'symbol-keyed properties are not supported')
    return { descriptors, keys }
  }

  /** Inspects `value` as a plain object, charging its own node budget first. Every caller uses
   *  this EXCEPT `json()`, which has its own contract — see `#recordAlreadyCharged` below. */
  record(value: unknown, path: DiagnosticPath): InspectedRecord | undefined {
    if (!this.#consumeNode(path)) return undefined
    return this.#recordWithPolicy(value, path, METERED_POLICY)
  }

  /**
   * `json()` must consume exactly one node per JSON-tree value, whether that value turns out to
   * be a record, an array, or neither, before it can even know which — so BY THE TIME it calls
   * this, the node budget for `value` is already charged. This is a SEPARATE, unexported method
   * (rather than a `precharged` flag on the public `record()`) precisely so that every OTHER
   * caller's type signature makes it impossible to accidentally skip the charge.
   */
  #recordAlreadyCharged(value: unknown, path: DiagnosticPath): InspectedRecord | undefined {
    return this.#recordWithPolicy(value, path, METERED_POLICY)
  }

  /**
   * A protocol SCAFFOLDING object (the root definitions container, a per-definition/per-scenario
   * wrapper) — the same safety checks as `record()`, but charges NOTHING against the payload
   * node/field/string-unit budgets, because this shape does not exist, verbatim, in both decode
   * paths (see the "ONE cost model" doc above `MAX_PRODUCTS_PER_FAMILY`). Bounded instead by an
   * explicit `maxKeys` the caller names, and by
   * `MAX_IDENTIFIER_LENGTH` per key — generous headroom for a short slug, never a payload-sized
   * budget.
   */
  structuralRecord(
    value: unknown,
    path: DiagnosticPath,
    maxKeys: number,
  ): InspectedRecord | undefined {
    return this.#recordWithPolicy(value, path, { kind: 'structural', maxKeys })
  }

  /** A protocol scaffolding IDENTIFIER (`family`, `productId`, `scenarioId`) — unlike `string()`,
   *  charges nothing against the payload string-unit budget, since none of these exist, verbatim,
   *  in the raw definitions this decode was budgeted against.
   *  Bounded instead by `MAX_IDENTIFIER_LENGTH`; `productId`/`scenarioId` are additionally
   *  validated against the `ProductContract` downstream, which is the real bound on their
   *  content. */
  identifier(value: unknown, path: DiagnosticPath): string | undefined {
    if (this.#fatal) return undefined
    if (typeof value !== 'string') {
      this.issue(path, 'must be a string')
      return undefined
    }
    if (!isValidIdentifierLength(value)) {
      this.issue(path, `identifier length limit of ${MAX_IDENTIFIER_LENGTH} exceeded`)
      return undefined
    }
    return value
  }

  /**
   * Reads JUST the `length` descriptor — an O(1) peek, unlike `#descriptors()` below, which calls
   * `Reflect.ownKeys` and is O(length) even for an ordinary DENSE array with no other defect.
   * Rejecting an over-long array here, before ever calling `#descriptors()`, is what keeps a
   * dense array far past `MAX_ARRAY_LENGTH` from paying that enumeration cost at all (#270
   * finding 2).
   */
  #arrayLength(value: object, path: DiagnosticPath): number | undefined {
    let lengthDescriptor: PropertyDescriptor | undefined
    try {
      lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    } catch {
      this.issue(path, 'value could not be inspected safely')
      return undefined
    }
    if (
      lengthDescriptor === undefined ||
      !('value' in lengthDescriptor) ||
      typeof lengthDescriptor.value !== 'number' ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    ) {
      this.issue(propertyPath(path, 'length'), 'must be a non-negative safe integer data property')
      return undefined
    }
    return lengthDescriptor.value
  }

  /** Inspects `value` as an array, charging its own node budget first. Every caller uses this
   *  EXCEPT `json()` — see `#recordAlreadyCharged`'s doc; the same contract applies here. */
  array(value: unknown, path: DiagnosticPath): InspectedArray | undefined {
    if (!this.#consumeNode(path)) return undefined
    return this.#arrayWithPolicy(value, path, METERED_POLICY)
  }

  /** See `#recordAlreadyCharged`'s doc — the array-specific counterpart, used only by `json()`. */
  #arrayAlreadyCharged(value: unknown, path: DiagnosticPath): InspectedArray | undefined {
    return this.#arrayWithPolicy(value, path, METERED_POLICY)
  }

  /**
   * A valid array of `maxLength` or fewer real elements can have AT MOST `maxLength` index keys
   * plus `'length'` itself — any MORE string own keys than that are, by construction, non-index
   * junk `#inspectArrayContents` would reject one at a time anyway, via its own (expensive,
   * per-key) descriptor phase. Checked from `keyList` ALONE — the cheap, `Reflect.ownKeys`-only
   * phase — so a proxy or plain array claiming a small `length` while carrying millions of extra
   * named properties (as `cases`, `scenarios`, or an ordinary payload array) is rejected before a
   * single `Object.getOwnPropertyDescriptor` call, in EITHER the metered or the structural array
   * path — the same defect `structuralRecord`'s `maxKeys` check already closed one level over,
   * missed here because arrays reach their expensive phase through a different method,
   * `#inspectArrayContents`, not `#safeDescriptorsFor` directly.
   */
  #rejectOversizedArrayKeyList(keyList: KeyList, maxLength: number, path: DiagnosticPath): boolean {
    if (keyList.stringKeys.length > maxLength + 1) {
      this.issue(path, `array own-key count exceeds what a length-${maxLength} array can have`)
      return false
    }
    return true
  }

  /**
   * Walks an array's real own keys ONCE, validating hole/accessor/non-index/symbol-freedom and
   * collecting values in order — memoized per object reference, so
   * a shared array referenced many times pays this walk once, not once per reference. Shared with
   * `structuralArray()`: the walk itself has no opinion about which length CAP applies (that is
   * checked by the caller, from the cheap O(1) `#arrayLength` peek, before this is ever reached),
   * so one cached result safely serves either role. Builds `values` incrementally rather than
   * pre-allocating `new Array(length)` up front, since a rejected (non-dense) array never needs
   * the full-length backing store at all. Callers are expected to have ALREADY rejected an
   * oversized own-key count via `#rejectOversizedArrayKeyList` before reaching this — this method
   * itself still calls the (memoized) expensive descriptor phase unconditionally, so it is not
   * itself the guard.
   */
  #inspectArrayContents(
    value: object,
    path: DiagnosticPath,
    length: number,
  ): ArrayContentSnapshot | undefined {
    const cachedContents = this.#arrayContentCache.get(value)
    if (cachedContents === 'unsafe') return undefined
    if (cachedContents !== undefined) return cachedContents

    const keyList = this.#safeKeyList(value, path)
    if (keyList === undefined) {
      this.#arrayContentCache.set(value, 'unsafe')
      return undefined
    }
    const descriptors = this.#safeDescriptorsFor(value, path, keyList)
    if (descriptors === undefined) {
      this.#arrayContentCache.set(value, 'unsafe')
      return undefined
    }
    const values: unknown[] = []
    let valid = true
    let expectedIndex = 0
    let holeReported = false
    // ECMA-262 OrdinaryOwnPropertyKeys returns integer-index keys in ascending numeric order
    // first, then other string keys, then symbols — so walking this list once and comparing each
    // index key to the RUNNING expected value finds the position of the FIRST hole in time
    // proportional to the array's REAL own-key count, never to `length`. A mostly-or-fully sparse
    // array — the adversarial shape, since a shared reference to one costs `length` work at EVERY
    // occurrence if scanned naively — is thereby rejected in O(1), not O(length).
    for (const key of keyList.stringKeys) {
      if (key === 'length') continue
      if (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= length) {
        valid = false
        this.issue(propertyPath(path, key), 'non-index array properties are not supported')
        continue
      }
      const index = Number(key)
      if (!holeReported && index !== expectedIndex) {
        this.issue(indexPath(path, expectedIndex), 'sparse array entries are not supported')
        valid = false
        holeReported = true
      }
      if (!holeReported) {
        const descriptor = descriptors[key]!
        if (!('value' in descriptor)) {
          valid = false
          this.issue(indexPath(path, index), 'accessor properties are not supported')
        } else if (!descriptor.enumerable) {
          valid = false
          this.issue(indexPath(path, index), 'non-enumerable properties are not supported')
        } else {
          values.push(descriptor.value)
        }
      }
      expectedIndex = index + 1
    }
    if (!holeReported && expectedIndex !== length) {
      this.issue(indexPath(path, expectedIndex), 'sparse array entries are not supported')
      valid = false
    }
    if (keyList.hasSymbol) {
      this.issue(path, 'symbol-keyed properties are not supported')
      valid = false
    }
    if (!valid) {
      this.#arrayContentCache.set(value, 'unsafe')
      return undefined
    }
    const contents: ArrayContentSnapshot = { values }
    this.#arrayContentCache.set(value, contents)
    return contents
  }

  /**
   * The array counterpart of `#recordWithPolicy` — same rationale, same single difference
   * (own-length-bounded-and-charged vs own-length-bounded-to-a-fixed-cap-and-uncharged), see that
   * method's doc.
   */
  #arrayWithPolicy(
    value: unknown,
    path: DiagnosticPath,
    policy: ArrayPolicy,
  ): InspectedArray | undefined {
    if (this.#fatal) return undefined
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
    const length = this.#arrayLength(value, path)
    if (length === undefined) return undefined
    const maxLength = policy.kind === 'metered' ? MAX_ARRAY_LENGTH : policy.maxLength
    if (length > maxLength) {
      this.issue(propertyPath(path, 'length'), `array length limit of ${maxLength} exceeded`)
      return undefined
    }
    const keyList = this.#safeKeyList(value, path)
    if (keyList === undefined) return undefined
    if (!this.#rejectOversizedArrayKeyList(keyList, maxLength, path)) return undefined
    if (policy.kind === 'metered') {
      if (!this.#chargeFields(keyList.stringKeys.length, keyList.totalKeyStringUnits, path)) {
        return undefined
      }
    }
    const contents = this.#inspectArrayContents(value, path, length)
    if (contents === undefined) return undefined
    return { source: value, values: contents.values }
  }

  /**
   * The array-scaffolding counterpart of `structuralRecord()` — used for `scenarios` (bounded by
   * `MAX_PRODUCTS_PER_FAMILY`) and `cases` (bounded by `MAX_CASES_PER_PRODUCT`). Bounds LENGTH by
   * the caller-supplied `maxLength` rather than `MAX_ARRAY_LENGTH`, and charges nothing against
   * the payload node/field/string-unit budgets — the array header itself (its length, its index
   * keys) is protocol structure, not case content.
   */
  structuralArray(
    value: unknown,
    path: DiagnosticPath,
    maxLength: number,
  ): InspectedArray | undefined {
    return this.#arrayWithPolicy(value, path, { kind: 'structural', maxLength })
  }

  field(
    record: InspectedRecord | undefined,
    key: string,
    path: DiagnosticPath,
    required: boolean,
  ): { readonly present: boolean; readonly value?: unknown } {
    if (record === undefined) return { present: false }
    const descriptor = record.descriptors[key]
    if (descriptor === undefined || !descriptor.enumerable) {
      if (required) this.issue(propertyPath(path, key), 'required field is missing')
      return { present: false }
    }
    if (!('value' in descriptor)) {
      this.issue(propertyPath(path, key), 'accessor properties are not supported')
      return { present: false }
    }
    return { present: true, value: descriptor.value }
  }

  exactFields(
    record: InspectedRecord | undefined,
    allowed: ReadonlySet<string>,
    path: DiagnosticPath,
  ): void {
    if (record === undefined) return
    for (const key of record.keys) {
      if (!allowed.has(key)) this.issue(propertyPath(path, key), 'unexpected field')
    }
  }

  string(value: unknown, path: DiagnosticPath): string | undefined {
    if (!this.#consumeNode(path)) return undefined
    if (typeof value !== 'string') {
      this.issue(path, 'must be a string')
      return undefined
    }
    return this.#consumeString(value, path) ? value : undefined
  }

  /** `version` exists only in a compiled catalog — raw definitions carry no version marker at
   *  all — so, like `identifier()`, it charges nothing against the shared payload budget. */
  literalOne(value: unknown, path: DiagnosticPath): 1 | undefined {
    if (this.#fatal) return undefined
    if (value !== 1) {
      this.issue(path, 'must equal 1')
      return undefined
    }
    return 1
  }

  json(value: unknown, rootPath: DiagnosticPath): PresentationScenarioJson | undefined {
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
      readonly path: DiagnosticPath
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
        this.issue(frame.path, typeof item, ' values are not JSON-safe')
        continue
      }
      if (active.has(item)) {
        this.issue(frame.path, 'cyclic references are not JSON-safe')
        continue
      }

      const isArray = this.#isArray(item, frame.path)
      if (isArray === undefined) continue
      if (isArray) {
        const inspected = this.#arrayAlreadyCharged(item, frame.path)
        if (inspected === undefined) continue
        const output = new Array<PresentationScenarioJson>(inspected.values.length)
        assign(frame.assignment, output)
        active.add(item)
        stack.push({ kind: 'finish', source: item, target: output })
        for (let index = inspected.values.length - 1; index >= 0; index -= 1) {
          stack.push({
            kind: 'value',
            value: inspected.values[index],
            path: indexPath(frame.path, index),
            depth: frame.depth + 1,
            assignment: { kind: 'array', target: output, index },
          })
        }
        continue
      }

      const inspected = this.#recordAlreadyCharged(item, frame.path)
      if (inspected === undefined) continue
      // An ORDINARY plain object (not `Object.create(null)`): every key here was copied from an
      // OWN, enumerable, data-descriptor property of already-inspected source data (never a
      // getter, `toJSON`, or iteration hook), so a normal `Object.prototype` is safe and matches
      // what every ordinary consumer record already has — `${input}` and
      // `input.hasOwnProperty(...)` no longer throw the way they do on a null-prototype value.
      // `Object.defineProperty` — never a later plain assignment — is what actually WRITES a key
      // literally named `__proto__`: it always creates a genuine own data property regardless of
      // the key's name, whereas `output['__proto__'] = value` would instead invoke
      // `Object.prototype`'s `__proto__` ACCESSOR and reassign the object's prototype. Defining
      // the slot here first (even before its real value is known) means the later plain
      // assignment in `assign()` below writes to this now-shadowing OWN property, not the
      // accessor — see `test/presentation-scenarios-boundaries.test.ts`'s `__proto__` case.
      const output: Record<string, PresentationScenarioJson> = {}
      const dataFields: { readonly key: string; readonly value: unknown }[] = []
      for (const key of inspected.keys) {
        const descriptor = inspected.descriptors[key]!
        if (!('value' in descriptor)) {
          this.issue(propertyPath(frame.path, key), 'accessor properties are not supported')
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
          path: propertyPath(frame.path, field.key),
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
  path: DiagnosticPath,
): readonly string[] | undefined {
  const inspected = decoder.array(value, path)
  if (inspected === undefined) return undefined
  const output: string[] = []
  for (let index = 0; index < inspected.values.length; index += 1) {
    const item = decoder.string(inspected.values[index], indexPath(path, index))
    if (item !== undefined) output.push(item)
  }
  return Object.freeze(output)
}

function decodeCase(
  decoder: BoundaryDecoder,
  value: unknown,
  rawPath: DiagnosticPath,
): DecodedCase | undefined {
  // The case root — `$["<scenarioId>"].cases[i]` or `$.scenarios[i].cases[j]` — is the protocol
  // boundary every diagnostic below it must keep intact when clipped: see `protectedPath()`'s
  // doc.
  const path = protectedPath(rawPath)
  const record = decoder.record(value, path)
  decoder.exactFields(record, CASE_FIELDS, path)
  const idField = decoder.field(record, 'id', path, true)
  const labelField = decoder.field(record, 'label', path, true)
  const inputField = decoder.field(record, 'input', path, true)
  const axesField = decoder.field(record, 'environmentAxes', path, true)
  const targetsField = decoder.field(record, 'copiedArtifactNames', path, false)
  const id = idField.present ? decoder.string(idField.value, propertyPath(path, 'id')) : undefined
  const label = labelField.present
    ? decoder.string(labelField.value, propertyPath(path, 'label'))
    : undefined
  const input = inputField.present
    ? decoder.json(inputField.value, propertyPath(path, 'input'))
    : undefined
  const axes = axesField.present
    ? decodeStringArray(decoder, axesField.value, propertyPath(path, 'environmentAxes'))
    : undefined
  const targets = targetsField.present
    ? decodeStringArray(decoder, targetsField.value, propertyPath(path, 'copiedArtifactNames'))
    : undefined
  if (id === undefined || label === undefined || input === undefined || axes === undefined) {
    return undefined
  }
  return Object.freeze({
    id,
    label,
    input,
    environmentAxes: axes,
    ...(targets === undefined ? {} : { copiedArtifactNames: targets }),
  })
}

function decodeDefinition(
  decoder: BoundaryDecoder,
  value: unknown,
  path: DiagnosticPath,
): DecodedDefinition | undefined {
  // The definition WRAPPER (`defaultCaseId`/`cases`) is protocol scaffolding: a compiled catalog's
  // per-scenario wrapper carries two MORE fixed keys (`productId`/`scenarioId`), so charging
  // either wrapper's own key count against a budget shared with the other would already be
  // asymmetric between the two decode paths before a single byte of real content is considered.
  // `defaultCaseId`'s STRING VALUE and each case's CONTENT
  // (`decodeCase` below) are the shared payload and stay fully metered.
  const record = decoder.structuralRecord(value, path, MAX_SCAFFOLDING_RECORD_KEYS)
  decoder.exactFields(record, DEFINITION_FIELDS, path)
  const defaultField = decoder.field(record, 'defaultCaseId', path, true)
  const casesField = decoder.field(record, 'cases', path, true)
  const defaultCaseId = defaultField.present
    ? decoder.string(defaultField.value, propertyPath(path, 'defaultCaseId'))
    : undefined
  const inspectedCases = casesField.present
    ? decoder.structuralArray(casesField.value, propertyPath(path, 'cases'), MAX_CASES_PER_PRODUCT)
    : undefined
  const casesPath = propertyPath(path, 'cases')
  const cases: DecodedCase[] = []
  if (inspectedCases !== undefined) {
    for (let index = 0; index < inspectedCases.values.length; index += 1) {
      const scenarioCase = decodeCase(
        decoder,
        inspectedCases.values[index],
        indexPath(casesPath, index),
      )
      if (scenarioCase !== undefined) cases.push(scenarioCase)
    }
  }
  if (defaultCaseId === undefined || inspectedCases === undefined) return undefined
  return Object.freeze({ defaultCaseId, cases: Object.freeze(cases) })
}

function decodeDefinitions(value: unknown, diagnostics: DiagnosticCollector): DecodedDefinitions {
  const decoder = new BoundaryDecoder('invalid-definitions', diagnostics)
  // The root object's OWN KEYS are `scenarioId`s — protocol scaffolding, bounded by
  // `MAX_PRODUCTS_PER_FAMILY` (how many scenarios/products a family may declare) and
  // `MAX_IDENTIFIER_LENGTH` per key, never charged against the payload budgets.
  const root = decoder.structuralRecord(value, ROOT_DIAGNOSTIC_PATH, MAX_PRODUCTS_PER_FAMILY)
  const definitions = new Map<string, DecodedDefinition>()
  const scenarioIds: string[] = []
  if (root !== undefined) {
    for (const scenarioId of root.keys) {
      const path = propertyPath(ROOT_DIAGNOSTIC_PATH, scenarioId)
      const descriptor = root.descriptors[scenarioId]!
      if (!('value' in descriptor)) {
        decoder.issue(path, 'accessor properties are not supported')
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

function decodeCatalog(
  value: unknown,
  diagnostics: DiagnosticCollector,
  code: PresentationScenarioErrorCode = 'invalid-catalog',
): DecodedCatalog {
  const decoder = new BoundaryDecoder(code, diagnostics)
  // The catalog root (`version`/`family`/`scenarios`) exists ONLY in a compiled catalog — raw
  // definitions have no such wrapper at all — so it is protocol scaffolding through and through:
  // structurally validated, charged against nothing.
  const root = decoder.structuralRecord(value, ROOT_DIAGNOSTIC_PATH, MAX_SCAFFOLDING_RECORD_KEYS)
  decoder.exactFields(root, CATALOG_FIELDS, ROOT_DIAGNOSTIC_PATH)
  const versionField = decoder.field(root, 'version', ROOT_DIAGNOSTIC_PATH, true)
  const familyField = decoder.field(root, 'family', ROOT_DIAGNOSTIC_PATH, true)
  const scenariosField = decoder.field(root, 'scenarios', ROOT_DIAGNOSTIC_PATH, true)
  const versionPath = propertyPath(ROOT_DIAGNOSTIC_PATH, 'version')
  const familyPath = propertyPath(ROOT_DIAGNOSTIC_PATH, 'family')
  const scenariosPath = propertyPath(ROOT_DIAGNOSTIC_PATH, 'scenarios')
  const version = versionField.present
    ? decoder.literalOne(versionField.value, versionPath)
    : undefined
  const familyString = familyField.present
    ? decoder.identifier(familyField.value, familyPath)
    : undefined
  if (familyString !== undefined && !isPresentationFamily(familyString)) {
    decoder.issue(familyPath, 'unknown presentation family ', quoted(familyString))
  }
  // The `scenarios` array is itself scaffolding (raw definitions use a MAP keyed by scenarioId,
  // never an array) — bounded by `MAX_PRODUCTS_PER_FAMILY`, the SAME structural cap the root
  // record above is bounded by in `decodeDefinitions`, so a family that round-trips through both
  // shapes is held to one consistent ceiling on scenario COUNT.
  const inspectedScenarios = scenariosField.present
    ? decoder.structuralArray(scenariosField.value, scenariosPath, MAX_PRODUCTS_PER_FAMILY)
    : undefined
  const scenarios: DecodedScenario[] = []
  if (inspectedScenarios !== undefined) {
    for (let index = 0; index < inspectedScenarios.values.length; index += 1) {
      const path = indexPath(scenariosPath, index)
      // The per-scenario WRAPPER (`productId`/`scenarioId`/`defaultCaseId`/`cases`) is scaffolding
      // too — see `decodeDefinition`'s doc for why it cannot share a budget with the definition
      // wrapper it round-trips against.
      const record = decoder.structuralRecord(
        inspectedScenarios.values[index],
        path,
        MAX_SCAFFOLDING_RECORD_KEYS,
      )
      decoder.exactFields(record, SCENARIO_FIELDS, path)
      const productField = decoder.field(record, 'productId', path, true)
      const scenarioField = decoder.field(record, 'scenarioId', path, true)
      const defaultField = decoder.field(record, 'defaultCaseId', path, true)
      const casesField = decoder.field(record, 'cases', path, true)
      // `productId` has NO equivalent in raw definitions at all — it is a field the catalog adds,
      // copied from `ProductContract` — so it is an `identifier()`, not a `string()`: unmetered,
      // bounded by `MAX_IDENTIFIER_LENGTH`, and further validated against the `ProductContract`
      // downstream, which is the real bound on its content.
      const productId = productField.present
        ? decoder.identifier(productField.value, propertyPath(path, 'productId'))
        : undefined
      const scenarioId = scenarioField.present
        ? decoder.identifier(scenarioField.value, propertyPath(path, 'scenarioId'))
        : undefined
      const defaultCaseId = defaultField.present
        ? decoder.string(defaultField.value, propertyPath(path, 'defaultCaseId'))
        : undefined
      const inspectedCases = casesField.present
        ? decoder.structuralArray(
            casesField.value,
            propertyPath(path, 'cases'),
            MAX_CASES_PER_PRODUCT,
          )
        : undefined
      const casesPath = propertyPath(path, 'cases')
      const cases: DecodedCase[] = []
      if (inspectedCases !== undefined) {
        for (let caseIndex = 0; caseIndex < inspectedCases.values.length; caseIndex += 1) {
          const scenarioCase = decodeCase(
            decoder,
            inspectedCases.values[caseIndex],
            indexPath(casesPath, caseIndex),
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
    !isPresentationFamily(familyString) ||
    inspectedScenarios === undefined
  ) {
    return decoder.result<DecodedCatalog>(undefined)
  }
  return decoder.result(
    Object.freeze({
      version,
      family: familyString,
      scenarios: Object.freeze(scenarios),
    }),
  )
}

function decodeSelection(value: unknown, diagnostics: DiagnosticCollector): DecodedSelection {
  const decoder = new BoundaryDecoder('invalid-selection', diagnostics)
  const root = decoder.record(value, ROOT_DIAGNOSTIC_PATH)
  decoder.exactFields(root, SELECTION_FIELDS, ROOT_DIAGNOSTIC_PATH)
  const productField = decoder.field(root, 'productId', ROOT_DIAGNOSTIC_PATH, true)
  const caseField = decoder.field(root, 'caseId', ROOT_DIAGNOSTIC_PATH, false)
  const pathField = decoder.field(root, 'path', ROOT_DIAGNOSTIC_PATH, true)
  const environmentField = decoder.field(root, 'environment', ROOT_DIAGNOSTIC_PATH, false)
  const artifactField = decoder.field(root, 'copiedArtifact', ROOT_DIAGNOSTIC_PATH, false)
  const productPath = propertyPath(ROOT_DIAGNOSTIC_PATH, 'productId')
  const casePath = propertyPath(ROOT_DIAGNOSTIC_PATH, 'caseId')
  const selectionPath = propertyPath(ROOT_DIAGNOSTIC_PATH, 'path')
  const environmentPath = propertyPath(ROOT_DIAGNOSTIC_PATH, 'environment')
  const artifactPath = propertyPath(ROOT_DIAGNOSTIC_PATH, 'copiedArtifact')
  const productId = productField.present
    ? decoder.string(productField.value, productPath)
    : undefined
  const caseId = caseField.present ? decoder.string(caseField.value, casePath) : undefined
  const path = pathField.present ? decoder.string(pathField.value, selectionPath) : undefined
  const copiedArtifact = artifactField.present
    ? decoder.string(artifactField.value, artifactPath)
    : undefined
  const environmentRecord = environmentField.present
    ? decoder.record(environmentField.value, environmentPath)
    : undefined
  const environment = Object.create(null) as Record<string, string>
  if (environmentRecord !== undefined) {
    for (const axis of environmentRecord.keys) {
      const descriptor = environmentRecord.descriptors[axis]!
      const axisPath = propertyPath(environmentPath, axis)
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

function collectCaseIssues(
  diagnostics: DiagnosticCollector,
  entry: ProductContract['entries'][number],
  definition: DecodedDefinition | DecodedScenario,
  path: DiagnosticPath,
): void {
  const casesPath = propertyPath(path, 'cases')
  const defaultPath = propertyPath(path, 'defaultCaseId')
  if (definition.cases.length === 0) {
    diagnostics.add(casesPath, 'must define at least one case')
  }
  if (!CASE_ID.test(definition.defaultCaseId)) {
    diagnostics.add(defaultPath, 'invalid case id ', quoted(definition.defaultCaseId))
  }

  const caseIds = new Set<string>()
  const copiedArtifactNames = new Set<string>()
  for (const artifact of entry.copiedArtifacts) copiedArtifactNames.add(artifact.name)
  for (let index = 0; index < definition.cases.length; index += 1) {
    const scenarioCase = definition.cases[index]!
    const casePath = indexPath(casesPath, index)
    const idPath = propertyPath(casePath, 'id')
    if (!CASE_ID.test(scenarioCase.id)) {
      diagnostics.add(idPath, 'invalid case id ', quoted(scenarioCase.id))
    }
    if (caseIds.has(scenarioCase.id)) {
      diagnostics.add(idPath, 'duplicate case id ', quoted(scenarioCase.id))
    }
    caseIds.add(scenarioCase.id)
    if (scenarioCase.label.trim() === '') {
      diagnostics.add(propertyPath(casePath, 'label'), 'must contain non-whitespace text')
    }

    const seenAxes = new Set<string>()
    const axesPath = propertyPath(casePath, 'environmentAxes')
    for (let axisIndex = 0; axisIndex < scenarioCase.environmentAxes.length; axisIndex += 1) {
      const axis = scenarioCase.environmentAxes[axisIndex]!
      const axisPath = indexPath(axesPath, axisIndex)
      if (!isPresentationScenarioEnvironmentAxis(axis)) {
        diagnostics.add(axisPath, 'unknown environment axis ', quoted(axis))
      }
      if (seenAxes.has(axis)) {
        diagnostics.add(axisPath, 'duplicate environment axis ', quoted(axis))
      }
      seenAxes.add(axis)
    }

    const seenTargets = new Set<string>()
    const targets = scenarioCase.copiedArtifactNames ?? []
    const targetsPath = propertyPath(casePath, 'copiedArtifactNames')
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
      const target = targets[targetIndex]!
      const targetPath = indexPath(targetsPath, targetIndex)
      if (!copiedArtifactNames.has(target)) {
        diagnostics.add(targetPath, 'unknown copied artifact ', quoted(target))
      }
      if (seenTargets.has(target)) {
        diagnostics.add(targetPath, 'duplicate copied artifact ', quoted(target))
      }
      seenTargets.add(target)
    }
  }
  if (!caseIds.has(definition.defaultCaseId)) {
    diagnostics.add(defaultPath, 'case ', quoted(definition.defaultCaseId), ' does not exist')
  }
}

function collectCatalogIntegrityIssues(
  diagnostics: DiagnosticCollector,
  contract: ProductContract,
  catalog: DecodedCatalog,
): void {
  const entries = contract.entries.filter((entry) => entry.presentation.family === catalog.family)
  if (entries.length === 0) {
    diagnostics.add(
      propertyPath(ROOT_DIAGNOSTIC_PATH, 'family'),
      'ProductContract has no entries for presentation family ',
      quoted(catalog.family),
    )
    return
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
  const scenariosPath = propertyPath(ROOT_DIAGNOSTIC_PATH, 'scenarios')
  for (let index = 0; index < catalog.scenarios.length; index += 1) {
    const scenario = catalog.scenarios[index]!
    const path = indexPath(scenariosPath, index)
    if (seenProducts.has(scenario.productId)) {
      diagnostics.add(
        propertyPath(path, 'productId'),
        'duplicate product ',
        quoted(scenario.productId),
      )
    }
    seenProducts.add(scenario.productId)
    if (seenScenarios.has(scenario.scenarioId)) {
      diagnostics.add(
        propertyPath(path, 'scenarioId'),
        'duplicate scenario ',
        quoted(scenario.scenarioId),
      )
    }
    seenScenarios.add(scenario.scenarioId)

    const entry = entriesByScenario.get(scenario.scenarioId)
    if (entry === undefined) {
      diagnostics.add(
        propertyPath(path, 'scenarioId'),
        'stale ProductContract scenario ',
        quoted(scenario.scenarioId),
      )
      continue
    }
    if (entry.name !== scenario.productId) {
      diagnostics.add(
        propertyPath(path, 'productId'),
        'expected ',
        quoted(entry.name),
        ' for scenario ',
        quoted(scenario.scenarioId),
      )
      continue
    }
    const canonicalIndex = expectedIndex.get(scenario.scenarioId)!
    if (canonicalIndex !== index) {
      diagnostics.add(path, 'expected canonical ProductContract index ', canonicalIndex)
    }
    collectCaseIssues(diagnostics, entry, scenario, path)
  }

  for (const entry of entries) {
    if (!seenScenarios.has(entry.scenarioId)) {
      diagnostics.add(
        scenariosPath,
        'missing scenario ',
        quoted(entry.scenarioId),
        ' for product ',
        quoted(entry.name),
      )
    }
  }
}

/**
 * Catalog objects THIS MODULE produced and validated in full (`compiledCatalog`, below) — a
 * frozen `CompiledPresentationScenarioFamily` a caller holds a live reference to, never restored
 * from serialization. Membership is by REFERENCE, never by structural shape: a byte-identical
 * `JSON.parse(JSON.stringify(catalog))` copy is a different object and is NOT a member, so it is
 * decoded and integrity-checked in full — the fast path below trusts a specific object this
 * module built, not "any catalog that happens to look right".
 */
const TRUSTED_CATALOGS = new WeakSet<object>()

function isTrustedCatalog(value: unknown): value is DecodedCatalog {
  return typeof value === 'object' && value !== null && TRUSTED_CATALOGS.has(value)
}

function compiledCatalog(
  contract: ProductContract,
  family: PresentationFamily,
  decoded: DecodedDefinitions,
  diagnostics: DiagnosticCollector,
): DecodedCatalog {
  const entries = contract.entries.filter((entry) => entry.presentation.family === family)
  if (entries.length === 0) {
    diagnostics.add(
      propertyPath(ROOT_DIAGNOSTIC_PATH, 'family'),
      'ProductContract has no entries for presentation family ',
      quoted(family),
    )
  }
  const expectedScenarioIds = new Set<string>()
  for (const entry of entries) expectedScenarioIds.add(entry.scenarioId)
  for (const entry of entries) {
    const definition = decoded.definitions.get(entry.scenarioId)
    const path = propertyPath(ROOT_DIAGNOSTIC_PATH, entry.scenarioId)
    // `entry.name`/`entry.scenarioId` are ALREADY-TRUSTED contract data — never decoded through
    // `identifier()` — but they become this catalog's `productId`/`scenarioId` verbatim, which
    // ARE decoded through it on every later serialized re-decode. The SAME predicate
    // (`isValidIdentifierLength`) enforces the SAME limit here, at compile time, so a contract
    // entry that would fail that later re-decode is rejected now instead — see
    // `MAX_PRODUCT_IDENTIFIER_LENGTH`'s doc for the failure this closes.
    if (!isValidIdentifierLength(entry.name)) {
      diagnostics.add(
        propertyPath(path, 'productId'),
        `identifier length limit of ${MAX_IDENTIFIER_LENGTH} exceeded`,
      )
    }
    if (!isValidIdentifierLength(entry.scenarioId)) {
      diagnostics.add(
        propertyPath(path, 'scenarioId'),
        `identifier length limit of ${MAX_IDENTIFIER_LENGTH} exceeded`,
      )
    }
    if (definition === undefined) {
      diagnostics.add(path, 'missing definition for product ', quoted(entry.name))
    } else {
      collectCaseIssues(diagnostics, entry, definition, path)
    }
  }
  for (const scenarioId of decoded.scenarioIds) {
    if (!expectedScenarioIds.has(scenarioId)) {
      diagnostics.add(
        propertyPath(ROOT_DIAGNOSTIC_PATH, scenarioId),
        'stale definition for presentation family ',
        quoted(family),
      )
    }
  }
  diagnostics.throwIfAny('invalid-definitions')

  // Every piece assembled below (`entry.name`/`entry.scenarioId`, and every field of
  // `definition`/its cases) already passed the ONE untrusted-boundary decode above, under its own
  // family-wide complexity budget. Re-decoding this derived, already-typed structure through
  // `decodeCatalog` here would be pure repeated work for data the caller already had validated,
  // so it is built directly from decoded values instead. The compile-to-decode integrity
  // invariant holds not because the two decodes' budgets are RECONCILED against each other, but
  // because they no longer NEED reconciling: `decodeCatalog`'s payload budgets (nodes/fields/
  // string units) meter ONLY case content — decoded by the exact same `decodeCase` this file
  // already ran above — and the scaffolding this function adds (`version`/`family`, and each
  // scenario's `productId`/`scenarioId`) is charged against NEITHER decode's payload budget at
  // all, bounded instead by the separate structural limits (`products`, `casesPerProduct`,
  // `identifierLength`) both decodes apply identically. So a definitions payload that fits the
  // family budget here is GUARANTEED to still fit when `decodeCatalog` later re-derives and
  // validates a genuinely serialized/untyped copy of the catalog built from it (a JSON round trip
  // or `structuredClone` through `resolveScenarioSelection`), at any family size — by
  // construction, not by an estimate sized to match it. See the
  // "one cost model" tests for the worked boundary proof, one budget dimension at a time.
  const catalog: DecodedCatalog = Object.freeze({
    version: 1,
    family,
    scenarios: Object.freeze(
      entries.map((entry) => {
        const definition = decoded.definitions.get(entry.scenarioId)!
        return Object.freeze({
          productId: entry.name,
          scenarioId: entry.scenarioId,
          defaultCaseId: definition.defaultCaseId,
          cases: definition.cases,
        })
      }),
    ),
  })
  collectCatalogIntegrityIssues(diagnostics, contract, catalog)
  diagnostics.throwIfAny('invalid-definitions')
  TRUSTED_CATALOGS.add(catalog)
  return catalog
}

/**
 * Generic over `Definitions` purely so its TWO callers each get their own return type without
 * casting a second time on top of this function's own — `compileScenarioFamily` instantiates it
 * at its caller's literal `Definitions`, `decodeScenarioFamily` leaves it at the default (erased)
 * shape. The cast below is the ONE unavoidable narrowing in this file's whole compile path: the
 * function's OWN body operates on a structurally-decoded, `Definitions`-erased `DecodedCatalog` —
 * there is no runtime information here that could prove it matches an arbitrary caller-chosen
 * `Definitions`, because that guarantee comes from `ExactDefinitions<Definitions>` at the CALLER's
 * own static call site, before erasure, not from anything this function could check.
 */
function compileScenarioFamilyUnknown<
  Definitions extends PresentationScenarioDefinitions = PresentationScenarioDefinitions,
>(
  contract: ProductContract,
  family: PresentationFamily,
  definitions: unknown,
): CompiledPresentationScenarioFamily<Definitions> {
  const diagnostics = new DiagnosticCollector()
  const decoded = decodeDefinitions(definitions, diagnostics)
  return compiledCatalog(
    contract,
    family,
    decoded,
    diagnostics,
  ) as CompiledPresentationScenarioFamily<Definitions>
}

/**
 * Join family-owned semantic cases to ProductContract's canonical inventory. `definitions` must
 * be statically known here — there is no `unknown` fallthrough, so a `Definitions` literal that
 * fails to satisfy `PresentationScenarioDefinitions` (an extra field on a case, an unknown
 * `environmentAxes` value, a function in `input`, …) is a COMPILE error, not a value silently
 * degraded to `CompiledPresentationScenarioFamily`'s erased, `string`-keyed shape. For a
 * definitions value received from an untyped/serialized boundary, decode it with
 * `decodeScenarioFamily` instead.
 */
export function compileScenarioFamily<const Definitions extends PresentationScenarioDefinitions>(
  contract: ProductContract,
  family: PresentationFamily,
  definitions: ExactDefinitions<Definitions>,
): CompiledPresentationScenarioFamily<Definitions> {
  return compileScenarioFamilyUnknown<Definitions>(contract, family, definitions)
}

/**
 * Validate and compile definitions received from an untyped serialized boundary (a network
 * response, a `JSON.parse`, a dynamic import, …). Prefer `compileScenarioFamily` whenever the
 * definitions are a statically-known literal — this is the deliberately erased escape hatch, not
 * a more permissive alternative to it.
 */
export function decodeScenarioFamily(
  contract: ProductContract,
  family: PresentationFamily,
  definitions: unknown,
): CompiledPresentationScenarioFamily {
  return compileScenarioFamilyUnknown(contract, family, definitions)
}

/** Generic for the same reason `compileScenarioFamilyUnknown` is — see its doc. */
function resolveScenarioSelectionUnknown<
  Definitions extends PresentationScenarioDefinitions = PresentationScenarioDefinitions,
>(
  contract: ProductContract,
  catalog: unknown,
  selection: unknown,
): ResolvedPresentationScenarioSelection<Definitions> {
  const diagnostics = new DiagnosticCollector()
  // A catalog THIS MODULE produced and the caller still holds a live reference to has already
  // passed the untrusted-boundary structural decode once, in full, at compile time — re-running
  // it here on every resolve is pure repeated work for a frozen object that cannot have changed
  // since. Skip ONLY that structural re-decode; the integrity cross-check against `contract`
  // below still always runs, because a compiled-then-cached catalog can legitimately be resolved
  // against a DIFFERENT (e.g. stale) contract than the one it was compiled against — trusting the
  // catalog's own shape is not the same as trusting it still matches `contract`.
  const decodedCatalog = isTrustedCatalog(catalog) ? catalog : decodeCatalog(catalog, diagnostics)
  collectCatalogIntegrityIssues(diagnostics, contract, decodedCatalog)
  diagnostics.throwIfAny('invalid-catalog')

  const decodedSelection = decodeSelection(selection, diagnostics)
  const productPath = propertyPath(ROOT_DIAGNOSTIC_PATH, 'productId')
  const selectionPath = propertyPath(ROOT_DIAGNOSTIC_PATH, 'path')
  const casePath = propertyPath(ROOT_DIAGNOSTIC_PATH, 'caseId')
  const artifactPath = propertyPath(ROOT_DIAGNOSTIC_PATH, 'copiedArtifact')
  const scenario = decodedCatalog.scenarios.find(
    ({ productId }) => productId === decodedSelection.productId,
  )
  if (scenario === undefined) {
    diagnostics.add(
      productPath,
      'unknown product ',
      quoted(decodedSelection.productId),
      ' in compiled family ',
      quoted(decodedCatalog.family),
    )
    throw diagnostics.error('unknown-product')
  }
  const entry = contract.entries.find(({ name }) => name === decodedSelection.productId)!
  if (!isPresentationScenarioPath(decodedSelection.path)) {
    diagnostics.add(selectionPath, 'unknown presentation path ', quoted(decodedSelection.path))
    throw diagnostics.error('invalid-path')
  }
  const path = decodedSelection.path
  if (entry.presentation[path].mode === 'not-applicable') {
    diagnostics.add(
      selectionPath,
      'presentation path ',
      quoted(path),
      ' is not applicable to product ',
      quoted(decodedSelection.productId),
    )
    throw diagnostics.error('invalid-path')
  }
  const caseId = decodedSelection.caseId ?? scenario.defaultCaseId
  const scenarioCase = scenario.cases.find(({ id }) => id === caseId)
  if (scenarioCase === undefined) {
    diagnostics.add(
      casePath,
      'unknown case ',
      quoted(caseId),
      ' for product ',
      quoted(decodedSelection.productId),
    )
    throw diagnostics.error('unknown-case')
  }

  const environmentPath = propertyPath(ROOT_DIAGNOSTIC_PATH, 'environment')
  // Built incrementally, ONE validated axis at a time, rather than validating the whole object
  // for side effect and casting the ORIGINAL decoded object to `PresentationScenarioEnvironment`
  // afterward — a merely decoded string never becomes a public typed value except through one of
  // these guards.
  const validatedEnvironment: Partial<PresentationScenarioEnvironment> = {}
  for (const [axis, value] of Object.entries(decodedSelection.environment)) {
    const axisPath = propertyPath(environmentPath, axis)
    if (!isPresentationScenarioEnvironmentAxis(axis)) {
      diagnostics.add(axisPath, 'unknown environment axis ', quoted(axis))
      continue
    }
    const knownAxis = axis
    const allowedValues = ENVIRONMENT_AXIS_VALUE_SETS[knownAxis]
    if (!allowedValues.has(value)) {
      diagnostics.add(axisPath, 'unknown value ', quoted(value))
    } else if (!scenarioCase.environmentAxes.includes(knownAxis)) {
      diagnostics.add(axisPath, 'case ', quoted(caseId), ' does not support this environment axis')
    } else {
      // `allowedValues.has(value)` just confirmed `value` is one of THIS axis's own declared
      // literals (`ENVIRONMENT_AXIS_VALUE_SETS` is built from the very
      // `PRESENTATION_SCENARIO_ENVIRONMENT_VALUES` the type is derived from) — `ReadonlySet.has`
      // does not narrow on its own, so this is the guard's own result restated as a type, applied
      // to exactly the one axis it was just checked against, not a bulk cast of the whole object.
      ;(validatedEnvironment as Record<string, string>)[knownAxis] = value
    }
  }
  diagnostics.throwIfAny('invalid-environment')

  if (decodedSelection.copiedArtifact !== undefined && path !== 'registryTailwind') {
    diagnostics.add(
      artifactPath,
      'target ',
      quoted(decodedSelection.copiedArtifact),
      ' is invalid on the baseline path',
    )
    throw diagnostics.error('invalid-copied-artifact')
  }
  if (
    decodedSelection.copiedArtifact !== undefined &&
    !entry.copiedArtifacts.some(({ name }) => name === decodedSelection.copiedArtifact)
  ) {
    diagnostics.add(
      artifactPath,
      'product ',
      quoted(decodedSelection.productId),
      ' does not own target ',
      quoted(decodedSelection.copiedArtifact),
    )
    throw diagnostics.error('invalid-copied-artifact')
  }
  if (
    decodedSelection.copiedArtifact !== undefined &&
    scenarioCase.copiedArtifactNames !== undefined &&
    !scenarioCase.copiedArtifactNames.includes(decodedSelection.copiedArtifact)
  ) {
    diagnostics.add(
      artifactPath,
      'case ',
      quoted(caseId),
      ' does not support target ',
      quoted(decodedSelection.copiedArtifact),
    )
    throw diagnostics.error('invalid-copied-artifact')
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
      diagnostics.add(artifactPath, 'case ', quoted(caseId), ' has no eligible registry target')
      throw diagnostics.error('invalid-copied-artifact')
    }
    if (eligibleArtifacts.length > 1) {
      const names = boundedSortedArtifactNames(eligibleArtifacts)
      const reason: DiagnosticPart[] = [
        'case ',
        quoted(caseId),
        ' has multiple eligible registry targets; select one of ',
      ]
      for (let index = 0; index < names.length; index += 1) {
        if (index > 0) reason.push(', ')
        reason.push(quoted(names[index]!))
      }
      if (names.length < eligibleArtifacts.length) {
        reason.push(', and ', eligibleArtifacts.length - names.length, ' more')
      }
      diagnostics.add(artifactPath, ...reason)
      throw diagnostics.error('invalid-copied-artifact')
    }
  }
  const copiedArtifact = entry.copiedArtifacts.find(({ name }) => name === selectedArtifactName)
  const environment: PresentationScenarioEnvironment = Object.freeze({
    ...DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
    ...validatedEnvironment,
  })
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
  return result as ResolvedPresentationScenarioSelection<Definitions>
}

/**
 * Resolve one deterministic renderer input from a compiled family catalog. `catalog` must be
 * statically known here — there is no `unknown` fallthrough, so a catalog or selection literal
 * that fails to satisfy its typed shape is a COMPILE error rather than a value silently accepted
 * and narrowed away to `string`. For a catalog or selection received from an
 * untyped/serialized boundary, decode it with `decodeScenarioSelection` instead.
 */
export function resolveScenarioSelection<Definitions extends PresentationScenarioDefinitions>(
  contract: ProductContract,
  catalog: CompiledPresentationScenarioFamily<Definitions>,
  selection: PresentationScenarioSelection,
): ResolvedPresentationScenarioSelection<Definitions> {
  return resolveScenarioSelectionUnknown<Definitions>(contract, catalog, selection)
}

/**
 * Validate and resolve a catalog and selection received from serialized boundaries (a network
 * response, a `JSON.parse`, a dynamic import, …). Prefer `resolveScenarioSelection` whenever the
 * catalog is a statically-known compiled result — this is the deliberately erased escape hatch,
 * not a more permissive alternative to it.
 */
export function decodeScenarioSelection(
  contract: ProductContract,
  catalog: unknown,
  selection: unknown,
): ResolvedPresentationScenarioSelection {
  return resolveScenarioSelectionUnknown(contract, catalog, selection)
}
