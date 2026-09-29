/**
 * Typed field mutation for the scenario-renderer dimension harnesses
 * (`navigation-data-*` and `menus-overlays-*`, baseline and registry paths).
 *
 * Those harnesses mount a scenario's REAL adapter with a hand-mutated copy of a
 * declared case input — one field changed at a time — and assert the rendered,
 * product-published output moved. The mutated input is deliberately one no
 * declared case has, so the protocol's typed dispatch (which only ever hands an
 * adapter a case the catalog carries) cannot produce it. The harnesses used to
 * bridge that gap by erasing the adapter (`adapter as (h, input: unknown, …)`)
 * and the input (`input as Record<string, unknown>`), and a cast checks
 * nothing: a mutation that produced a value outside a field's declared type (a
 * `variant: 'outline'` fed to an Alert whose variants are `default` and
 * `destructive`) compiled and ran.
 *
 * Here a mutation is a function from a field's declared type to the SAME type
 * (`FieldMutator<Input[Field], Input>`), and a family declares one for every
 * field of every case-input type (`FieldMutators<Input>`, `-?` so an optional
 * field needs one too). `withField` builds `{ ...input, [field]: value }` typed
 * as `Input`, so the harness calls the adapter it was given for that scenario
 * — `Adapter<Inputs[Id]>` — with a value the type system has checked, and a
 * family that grows a case-input field does not compile until the harness can
 * mutate it.
 *
 * Inputs that are intentionally ILL-typed belong to the protocol's runtime
 * validation tests, which go through the untyped `decode…` entry points
 * (`decodeScenarioFamily`/`decodeScenarioSelection`, `unknown` by design) —
 * never through a renderer adapter.
 */
import type { PresentationScenarioEnvironmentAxis } from '@llui/cli/presentation-scenarios'

export type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
export type Assert<Value extends true> = Value

/** A case's supported environment axes, typed without widening each literal
 * array by cast. */
export const axes = (
  ...values: readonly PresentationScenarioEnvironmentAxis[]
): readonly PresentationScenarioEnvironmentAxis[] => values

/** "This field has no materially different value to try here." */
export const UNCHANGED: unique symbol = Symbol('unchanged')

export type Mutated<Value> = Value | typeof UNCHANGED

/** A materially different value of the field's OWN type, or `UNCHANGED`. The
 * whole pre-mutation input is passed for a field whose meaningful domain is a
 * sibling field (a `selection` drawn from `rows`). */
export type FieldMutator<Value, Input> = (value: Value, input: Input) => Mutated<Value>

/** A mutator for every field of `Input`. */
export type FieldMutators<Input> = {
  readonly [Field in keyof Input]-?: FieldMutator<Input[Field], Input>
}

/** One declared case of a scenario, at its case-input TYPE (not the literal the
 * definitions module wrote), so a mutated copy has the same type. */
export interface ScenarioCaseOf<Input> {
  readonly id: string
  readonly label: string
  readonly input: Input
  readonly environmentAxes: readonly PresentationScenarioEnvironmentAxis[]
}

export interface ScenarioDefinitionOf<Input> {
  readonly defaultCaseId: string
  readonly cases: readonly ScenarioCaseOf<Input>[]
}

/** A family's definitions viewed per scenario id at each id's case-input type.
 * Assigning the `as const` definitions literal to this type IS the check that
 * every declared case input conforms to its scenario's input type. */
export type ScenarioDefinitionsOf<Inputs> = {
  readonly [Id in keyof Inputs]: ScenarioDefinitionOf<Inputs[Id]>
}

/** A family's mutators, per scenario id, for that id's case-input type. */
export type FamilyFieldMutators<Inputs> = {
  readonly [Id in keyof Inputs]: FieldMutators<Inputs[Id]>
}

/** Narrows a case input's own key to a field the mutator table declares. The
 * table is an object literal checked against `FieldMutators<Input>` (excess
 * keys rejected), so its own keys are exactly `keyof Input`. A key the table
 * lacks is a runtime key the case-input TYPE does not declare — the harness
 * fails on it rather than skipping it. */
export function isDeclaredField<Input>(
  mutators: FieldMutators<Input>,
  key: string,
): key is keyof Input & string {
  return Object.hasOwn(mutators, key)
}

/** `input` with one field replaced, at `input`'s own type. */
export function withField<Input, Field extends keyof Input>(
  input: Input,
  field: Field,
  value: Input[Field],
): Input {
  return { ...input, [field]: value }
}

/** One mutated copy of `input`: the field's new value and the whole new input. */
export interface FieldMutation<Input, Field extends keyof Input> {
  readonly field: Field
  readonly original: Input[Field]
  readonly value: Input[Field]
  readonly input: Input
}

/** Apply `field`'s declared mutator to `input`, or `UNCHANGED`. */
export function mutateField<Input, Field extends keyof Input>(
  mutators: FieldMutators<Input>,
  input: Input,
  field: Field,
): Mutated<FieldMutation<Input, Field>> {
  const mutate: FieldMutator<Input[Field], Input> = mutators[field]
  const original = input[field]
  const value = mutate(original, input)
  if (value === UNCHANGED) return UNCHANGED
  return { field, original, value, input: withField(input, field, value) }
}

// ─── Value mutators ──────────────────────────────────────────────────────────
// Each is total over its declared value type and returns the same type.

/** Appends a marker to free text (`'mutated'` for an empty string). */
export const appendText = (value: string): Mutated<string> =>
  value.length === 0 ? 'mutated' : `${value}-mutated`

export const flip = (value: boolean): Mutated<boolean> => !value

export const plus =
  (delta: number) =>
  (value: number): Mutated<number> => {
    const mutated = value + delta
    return mutated === value ? UNCHANGED : mutated
  }

/** The NEXT member of a closed string union, in declaration order. Assigning
 * the result to a field's mutator checks the member list against the field's
 * type in both directions: a member outside the union fails the return type,
 * a missing member fails the parameter. */
export const cycle =
  <const Member extends string>(members: readonly Member[]) =>
  (value: Member): Mutated<Member> => {
    const next = members[(members.indexOf(value) + 1) % members.length]
    return next === undefined || next === value ? UNCHANGED : next
  }

/** Nothing to try for this field (structural, or covered elsewhere). */
export const keep = <Value>(_value: Value): Mutated<Value> => UNCHANGED

/** `null` has no single meaningful alternative; its sibling case covers it. */
export const orNull =
  <Value>(mutate: (value: Value) => Mutated<Value>) =>
  (value: Value | null): Mutated<Value | null> =>
    value === null ? UNCHANGED : mutate(value)

/** An absent optional field is not a dimension of that case. */
export const orAbsent =
  <Value>(mutate: (value: Value) => Mutated<Value>) =>
  (value: Value | undefined): Mutated<Value | undefined> =>
    value === undefined ? UNCHANGED : mutate(value)

/** Adds a string PROVABLY absent from the set (never a duplicate, which a
 * membership check could not see). */
export const appendDistinctText = (values: readonly string[]): Mutated<readonly string[]> => {
  const last = values[values.length - 1]
  if (last === undefined) return UNCHANGED
  let candidate = `${last}-extra`
  while (values.includes(candidate)) candidate += '-extra'
  return [...values, candidate]
}

/** Adds a number PROVABLY absent from the set. */
export const appendNextNumber = (values: readonly number[]): Mutated<readonly number[]> =>
  values.length === 0 ? UNCHANGED : [...values, Math.max(...values) + 1]

/** Drops the last element. */
export const dropLast = <Element>(values: readonly Element[]): Mutated<readonly Element[]> =>
  values.length === 0 ? UNCHANGED : values.slice(0, -1)

/** Adds the first member of a fixed real-id domain not already in the set. */
export const addAbsentFrom =
  (domain: readonly string[]) =>
  (current: readonly string[]): Mutated<readonly string[]> => {
    const additional = domain.find((id) => !current.includes(id))
    return additional === undefined ? UNCHANGED : [...current, additional]
  }
