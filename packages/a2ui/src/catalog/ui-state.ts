/**
 * Typed access to a surface's client-local UI-state store (`Surface.uiState`).
 *
 * The store is ONE JSON object keyed by component instance, and it is
 * heterogeneous: a Tabs keeps its `TabsState` there, a Modal its `DialogState`,
 * and so on. A key alone does not say which type its blob has — the server may
 * re-type a component id with `updateComponents` while the old blob stays — so
 * a READ is a runtime check, never an assertion: {@link readUiState} hands a
 * blob to a component only when its shape is that component's state type, and
 * reports "no state yet" otherwise. A WRITE checks the other direction: the
 * state must be a JSON value, since the store is serialized state.
 *
 * The guards are built from combinators whose TYPES force them to be complete:
 * {@link shape} demands a guard for every property of the state type, each
 * checking exactly that property's type, and {@link oneOf} demands every member
 * of a literal union — so a guard cannot silently drift narrower than the
 * `@llui/components` type it vouches for.
 */

import type * as combobox from '@llui/components/combobox'
import type * as datePicker from '@llui/components/date-picker'
import type * as dialog from '@llui/components/dialog'
import type * as tabs from '@llui/components/tabs'
import type { JsonObject, JsonValue } from '../protocol.js'

/** A runtime check that a value has type `T`. */
export type Guard<T> = (value: unknown) => value is T

export const isString: Guard<string> = (v): v is string => typeof v === 'string'
export const isBoolean: Guard<boolean> = (v): v is boolean => typeof v === 'boolean'
export const isNumber: Guard<number> = (v): v is number =>
  typeof v === 'number' && Number.isFinite(v)

export function nullable<T>(guard: Guard<T>): Guard<T | null> {
  return (v): v is T | null => v === null || guard(v)
}

/** An optional property: absent (read as `undefined`) or a `T`. */
export function optional<T>(guard: Guard<T>): Guard<T | undefined> {
  return (v): v is T | undefined => v === undefined || guard(v)
}

export function arrayOf<T>(guard: Guard<T>): Guard<T[]> {
  return (v): v is T[] => Array.isArray(v) && v.every((item) => guard(item))
}

/** `unknown` when the list `L` names every member of `U`; otherwise a type no
 * array literal satisfies, naming the members it is missing. */
type CoversAll<U, L extends readonly unknown[]> = [Exclude<U, L[number]>] extends [never]
  ? unknown
  : { readonly missingMembers: Exclude<U, L[number]> }

/**
 * A guard for the literal union `U`, from a list that must name EVERY member:
 * `oneOf<'a' | 'b'>()(['a'])` does not compile. (A missing member would make the
 * guard reject a valid state, which reads back as "no state" forever.)
 */
export function oneOf<U extends string | number>() {
  return <const L extends readonly U[]>(members: L & CoversAll<U, L>): Guard<U> =>
    (v): v is U =>
      members.some((m) => m === v)
}

function isRecord(v: unknown): v is object {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * A guard for the object type `S` from one guard PER PROPERTY — `Required`, so
 * an optional property still needs its (`optional(...)`) guard and no property
 * can go unchecked. Extra properties are allowed, as they are in `S` itself.
 */
export function shape<S extends object>(
  fields: Required<{ [K in keyof S]: Guard<S[K]> }>,
): Guard<S> {
  return (v): v is S => {
    if (!isRecord(v)) return false
    for (const key in fields) {
      const property: unknown = Reflect.get(v, key)
      if (!fields[key](property)) return false
    }
    return true
  }
}

/**
 * Whether `v` is a {@link JsonValue}: `null`, a string, a finite number, a
 * boolean, or an array / plain object of JSON values. An object property whose
 * value is `undefined` is NOT one (JSON has no `undefined`; `JSON.stringify`
 * silently drops it, so a store holding it would not round-trip).
 */
export function isJsonValue(v: unknown): v is JsonValue {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true
  if (typeof v === 'number') return Number.isFinite(v)
  if (Array.isArray(v)) return v.every((item) => isJsonValue(item))
  if (!isRecord(v)) return false
  const proto: unknown = Object.getPrototypeOf(v)
  if (proto !== Object.prototype && proto !== null) return false
  return Object.values(v).every((item) => isJsonValue(item))
}

// ── The component states the Basic catalog keeps in the store ──────────────

const isStringList = arrayOf(isString)

export const isTabsState: Guard<tabs.TabsState> = shape<tabs.TabsState>({
  value: isString,
  items: isStringList,
  disabledItems: isStringList,
  orientation: oneOf<tabs.TabsState['orientation']>()(['horizontal', 'vertical']),
  activation: oneOf<tabs.TabsState['activation']>()(['automatic', 'manual']),
  focused: nullable(isString),
  loopFocus: isBoolean,
  deselectable: isBoolean,
  dir: oneOf<tabs.TabsState['dir']>()(['ltr', 'rtl']),
  dirSource: oneOf<tabs.TabsState['dirSource']>()(['dom', 'explicit']),
})

const isPresenceStatus = oneOf<NonNullable<dialog.DialogState['status']>>()([
  'closed',
  'opening',
  'open',
  'closing',
])

export const isDialogState: Guard<dialog.DialogState> = shape<dialog.DialogState>({
  open: isBoolean,
  status: optional(isPresenceStatus),
  skipAnimations: optional(isBoolean),
})

const isComboboxGroup: Guard<combobox.ComboboxGroup> = shape<combobox.ComboboxGroup>({
  id: isString,
  label: isString,
  items: isStringList,
})

export const isComboboxState: Guard<combobox.ComboboxState> = shape<combobox.ComboboxState>({
  open: isBoolean,
  value: isStringList,
  inputValue: isString,
  items: isStringList,
  groups: arrayOf(isComboboxGroup),
  disabledItems: isStringList,
  filteredItems: isStringList,
  highlightedValue: nullable(isString),
  selectionMode: oneOf<combobox.ComboboxState['selectionMode']>()(['single', 'multiple']),
  disabled: isBoolean,
  allowCreate: isBoolean,
  status: oneOf<combobox.ComboboxState['status']>()(['idle', 'loading', 'loaded', 'error']),
  requestId: isNumber,
  error: nullable(isString),
})

export const isDatePickerState: Guard<datePicker.DatePickerState> =
  shape<datePicker.DatePickerState>({
    mode: oneOf<datePicker.DatePickerState['mode']>()(['single', 'range']),
    value: nullable(isString),
    start: nullable(isString),
    end: nullable(isString),
    hoverDate: nullable(isString),
    visibleMonth: isNumber,
    visibleYear: isNumber,
    months: isNumber,
    focused: isString,
    min: nullable(isString),
    max: nullable(isString),
    weekStartsOn: oneOf<datePicker.DatePickerState['weekStartsOn']>()([0, 1]),
    disabled: isBoolean,
    today: nullable(isString),
    unavailable: isStringList,
  })

// ── Store access ─────────────────────────────────────────────────────────────

/**
 * A component's own state from the store: the stored blob when `guard` accepts
 * it (the SAME reference, so an unchanged store keeps derived signals quiet),
 * otherwise `fallback` — the key was never written, or was written by a
 * different component type that previously held this id.
 */
export function readUiState<T>(ui: JsonObject, key: string, guard: Guard<T>, fallback: T): T {
  const stored = ui[key]
  return guard(stored) ? stored : fallback
}

/**
 * The JSON form of a component state, for `RenderContext.setUi`. A state that
 * is not JSON (`undefined` property values, a `Date`, a non-finite number, …)
 * breaks the store's contract, so it throws rather than storing something that
 * would not survive serialization.
 */
export function uiStateJson(state: unknown, component: string): JsonValue {
  if (isJsonValue(state)) return state
  throw new Error(`[a2ui] ${component} UI state is not JSON-serializable`)
}
