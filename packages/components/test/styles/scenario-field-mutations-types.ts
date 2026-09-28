/**
 * Compile-time gates for `scenario-field-mutations.ts`, checked by this
 * package's `check` (never run). Each `@ts-expect-error` is a mutation the
 * dimension harnesses used to be able to feed an adapter behind a cast, and
 * must now fail to compile; an unused directive fails the check too, so a
 * loosened type is caught in both directions.
 */
import {
  appendText,
  cycle,
  flip,
  mutateField,
  UNCHANGED,
  withField,
  type FieldMutators,
} from './scenario-field-mutations'

interface Input {
  readonly label: string
  readonly variant: 'default' | 'destructive'
  readonly disabled: boolean
}

const input: Input = { label: 'Saved', variant: 'default', disabled: false }

export const complete: FieldMutators<Input> = {
  label: appendText,
  variant: cycle(['default', 'destructive']),
  disabled: flip,
}

export const outsideTheUnion: FieldMutators<Input> = {
  label: appendText,
  // @ts-expect-error — 'outline' is not an Input variant (the Alert case the casts let through).
  variant: cycle(['default', 'destructive', 'outline']),
  disabled: flip,
}

export const missingAMember: FieldMutators<Input> = {
  label: appendText,
  // @ts-expect-error — a cycle that cannot accept 'destructive' is not a total mutator.
  variant: cycle(['default']),
  disabled: flip,
}

// @ts-expect-error — every field needs a mutator; `disabled` has none.
export const incomplete: FieldMutators<Input> = {
  label: appendText,
  variant: cycle(['default', 'destructive']),
}

export const excess: FieldMutators<Input> = {
  label: appendText,
  variant: cycle(['default', 'destructive']),
  disabled: flip,
  // @ts-expect-error — a field the input type does not declare.
  state: flip,
}

export const wrongKind: FieldMutators<Input> = {
  // @ts-expect-error — a boolean mutator for a string field.
  label: flip,
  variant: cycle(['default', 'destructive']),
  disabled: flip,
}

// @ts-expect-error — a replaced field keeps its declared type.
withField(input, 'variant', 'outline')

export const mutated = mutateField(complete, input, 'variant')
if (mutated !== UNCHANGED) {
  const typed: Input = mutated.input
  const value: Input['variant'] = mutated.value
  void typed
  void value
}
