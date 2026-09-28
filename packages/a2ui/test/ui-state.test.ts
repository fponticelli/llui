import { describe, expect, it } from 'vitest'
import * as combobox from '@llui/components/combobox'
import * as datePicker from '@llui/components/date-picker'
import * as dialog from '@llui/components/dialog'
import * as tabs from '@llui/components/tabs'
import {
  isComboboxState,
  isDatePickerState,
  isDialogState,
  isJsonValue,
  isString,
  isTabsState,
  oneOf,
  optional,
  readUiState,
  shape,
  uiStateJson,
} from '../src/catalog/ui-state.js'

describe('component-state guards', () => {
  const states = {
    tabs: tabs.init({ items: ['a', 'b'], value: 'a' }),
    dialog: dialog.init(),
    combobox: combobox.init({ items: ['x', 'y'], selectionMode: 'multiple' }),
    datePicker: datePicker.init({ value: '2026-01-15' }),
  }
  const guards = {
    tabs: isTabsState,
    dialog: isDialogState,
    combobox: isComboboxState,
    datePicker: isDatePickerState,
  }

  it("accepts each component's own init() state", () => {
    expect(guards.tabs(states.tabs)).toBe(true)
    expect(guards.dialog(states.dialog)).toBe(true)
    expect(guards.combobox(states.combobox)).toBe(true)
    expect(guards.datePicker(states.datePicker)).toBe(true)
  })

  it('accepts states the real reducers produce', () => {
    const [openedDialog] = dialog.update(states.dialog, { type: 'open' })
    expect(isDialogState(openedDialog)).toBe(true)
    const [nextTabs] = tabs.update(states.tabs, { type: 'setValue', value: 'b' })
    expect(isTabsState(nextTabs)).toBe(true)
  })

  it("rejects every OTHER component's state", () => {
    for (const [name, guard] of Object.entries(guards)) {
      for (const [other, state] of Object.entries(states)) {
        if (other === name) continue
        // A dialog's `{ open }` shape is a structural subset of a combobox's,
        // and it IS a valid DialogState then — the one legitimate overlap.
        if (name === 'dialog' && other === 'combobox') continue
        expect(guard(state), `${name} guard on ${other} state`).toBe(false)
      }
    }
  })

  it('rejects a state with one field of the wrong type or a literal outside its union', () => {
    expect(isTabsState({ ...states.tabs, items: 'a,b' })).toBe(false)
    expect(isTabsState({ ...states.tabs, orientation: 'diagonal' })).toBe(false)
    expect(isDialogState({ ...states.dialog, status: 'ajar' })).toBe(false)
    expect(isDatePickerState({ ...states.datePicker, weekStartsOn: 3 })).toBe(false)
    expect(isComboboxState({ ...states.combobox, groups: [{ id: 'g', label: 'G' }] })).toBe(false)
  })

  it('accepts an optional property that is absent', () => {
    expect(isDialogState({ open: true })).toBe(true)
  })
})

describe('guard combinators are complete by construction (compile-time)', () => {
  it('oneOf demands every member of the union', () => {
    const ab = oneOf<'a' | 'b'>()(['a', 'b'])
    expect(ab('a')).toBe(true)
    expect(ab('c')).toBe(false)
    // @ts-expect-error — 'b' is missing, so the guard would reject valid values
    oneOf<'a' | 'b'>()(['a'])
  })

  it('shape demands a guard for every property, optional ones included', () => {
    interface S {
      a: string
      b?: string
    }
    const full = shape<S>({ a: isString, b: optional(isString) })
    expect(full({ a: 'x' })).toBe(true)
    // @ts-expect-error — `b` has no guard, so it would go unchecked
    shape<S>({ a: isString })
    // @ts-expect-error — a required property may not be checked as optional
    shape<S>({ a: optional(isString), b: optional(isString) })
  })
})

describe('store access', () => {
  const initial = tabs.init({ items: ['a'], value: 'a' })

  it('returns the stored blob itself when it has the right shape', () => {
    const stored = { ...initial, value: 'a' }
    expect(readUiState({ k: stored }, 'k', isTabsState, initial)).toBe(stored)
  })

  it('falls back when the key is absent or holds another shape', () => {
    expect(readUiState({}, 'k', isTabsState, initial)).toBe(initial)
    expect(readUiState({ k: uiStateJson(dialog.init(), 'k') }, 'k', isTabsState, initial)).toBe(
      initial,
    )
  })

  it('writes only JSON', () => {
    expect(uiStateJson(initial, 'k')).toBe(initial)
    expect(isJsonValue({ a: [1, 'x', null, { b: true }] })).toBe(true)
    expect(isJsonValue({ a: undefined })).toBe(false)
    expect(isJsonValue({ a: new Date(0) })).toBe(false)
    expect(isJsonValue(Number.NaN)).toBe(false)
    expect(() => uiStateJson({ at: new Date(0) }, 'k')).toThrow(/not JSON-serializable/)
  })
})
