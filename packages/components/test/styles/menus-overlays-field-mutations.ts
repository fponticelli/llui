/**
 * The menus-overlays family's typed field mutations, shared by both dimension
 * harnesses (`menus-overlays-baseline-renderer.test.ts` here and
 * `registry/test/menus-overlays-scenario-renderer.test.ts`).
 *
 * Every field of every case-input type — and of the nested menu-item and
 * menubar-menu element types the harnesses reach into — has exactly one
 * mutator returning a value of that field's own type (see
 * `scenario-field-mutations.ts`). Closed unions cycle to the next real member;
 * free text gains a marker; booleans flip; numbers shift; a string list drops
 * its last entry. An array of OBJECTS is structural, never mutated whole
 * (`keep`) — a whole-array mutation is ambiguous about WHICH element changed,
 * so the harnesses reach its first element through the nested tables below.
 * `placement`/`x`/`y` have well-typed mutators too, although the harnesses skip
 * those fields (jsdom performs no layout; see their `SKIPPED_FIELDS`).
 */
import type { ToastPlacement, ToastType } from '../../src/components/toast.js'
import type {
  ContextMenuCaseInput,
  DialogLikeCaseInput,
  MenuCaseInput,
  FloatingPlacement,
  FloatingPresenceCaseInput,
  MenubarCaseInput,
  MenubarMenuCaseInput,
  MenuItemCaseInput,
  MenusOverlaysInputs,
  MenusOverlaysPresence,
  ComboboxCaseInput,
} from './menus-overlays-scenarios.js'
import {
  appendText,
  cycle,
  dropLast,
  flip,
  keep,
  orAbsent,
  orNull,
  plus,
  type FamilyFieldMutators,
  type FieldMutators,
} from './scenario-field-mutations.js'

const presence = cycle<MenusOverlaysPresence>(['opening', 'open', 'closing', 'closed'])
const side = cycle(['top', 'right', 'bottom', 'left'])
const orientation = cycle(['horizontal', 'vertical'])
const placement = cycle<FloatingPlacement>([
  'top',
  'top-start',
  'top-end',
  'bottom',
  'bottom-start',
  'bottom-end',
  'left',
  'left-start',
  'left-end',
  'right',
  'right-start',
  'right-end',
])
const toastType = cycle<ToastType>(['info', 'success', 'warning', 'error', 'loading', 'custom'])
const toastPlacement = cycle<ToastPlacement>([
  'top',
  'top-start',
  'top-end',
  'bottom',
  'bottom-start',
  'bottom-end',
])
const shift = plus(7)
const optionalText = orNull(appendText)

export const MENU_ITEM_FIELD_MUTATORS: FieldMutators<MenuItemCaseInput> = {
  value: appendText,
  label: appendText,
  kind: cycle(['action', 'checkbox']),
  disabled: flip,
}

export const MENUBAR_MENU_FIELD_MUTATORS: FieldMutators<MenubarMenuCaseInput> = {
  id: appendText,
  label: appendText,
  disabled: orAbsent(flip),
  items: keep,
}

const dialogLike: FieldMutators<DialogLikeCaseInput> = {
  presence,
  skipAnimations: flip,
  modal: orAbsent(flip),
  title: appendText,
  description: appendText,
  nested: orAbsent(appendText),
}

const floatingPresence: FieldMutators<FloatingPresenceCaseInput> = {
  presence,
  skipAnimations: flip,
  placement,
  label: appendText,
}

const combobox: FieldMutators<ComboboxCaseInput> = {
  open: flip,
  value: dropLast,
  inputValue: appendText,
  items: dropLast,
  disabledItems: dropLast,
  highlightedValue: optionalText,
  status: cycle(['idle', 'loading', 'loaded', 'error']),
}

export const MENUS_OVERLAYS_FIELD_MUTATORS: FamilyFieldMutators<MenusOverlaysInputs> = {
  'component:alert-dialog': dialogLike,
  'component:dialog': dialogLike,
  'component:drawer': {
    presence,
    skipAnimations: flip,
    side,
    title: appendText,
    description: appendText,
  },
  'component:hover-card': floatingPresence,
  'component:popover': floatingPresence,
  'component:tooltip': { presence, animated: flip, placement, label: appendText },
  'component:menu': {
    presence,
    skipAnimations: flip,
    placement,
    items: keep,
    highlighted: optionalText,
    checked: dropLast,
    nestedOpen: flip,
  },
  'component:context-menu': {
    presence,
    skipAnimations: flip,
    x: shift,
    y: shift,
    items: keep,
    highlighted: optionalText,
    nestedOpen: flip,
  },
  'component:menubar': { menus: keep, open: optionalText, focused: optionalText },
  'component:navigation-menu': {
    open: dropLast,
    focused: optionalText,
    branches: keep,
    disabled: flip,
  },
  'component:select': {
    open: flip,
    value: dropLast,
    items: dropLast,
    disabledItems: dropLast,
    highlightedValue: optionalText,
    selectionMode: cycle(['single', 'multiple']),
  },
  'component:combobox': combobox,
  'pattern:searchable-select': combobox,
  'component:toast': {
    toastType,
    title: appendText,
    description: appendText,
    placement: toastPlacement,
    closing: flip,
    animated: flip,
    dismissable: flip,
  },
  'component:toolbar': { items: dropLast, disabledItems: dropLast, orientation },
  'pattern:command-menu': { open: flip, commands: keep, query: appendText },
  'pattern:confirm-dialog': {
    open: flip,
    title: appendText,
    description: appendText,
    destructive: flip,
  },
}

/** A nested array-of-objects field the harnesses reach into through its FIRST
 * element: how to read the array off a case input, how to rebuild the input
 * with that element replaced (at the input's own type), which rendered node
 * the element becomes (`data-value`), and the element type's own mutators. */
export interface NestedElements<Input, Element> {
  readonly label: string
  readonly elements: (input: Input) => readonly Element[]
  readonly withFirst: (input: Input, first: Element) => Input
  readonly dataValue: (element: Element) => string
  readonly mutators: FieldMutators<Element>
}

const menuItemsOf = <
  Input extends { readonly items: readonly MenuItemCaseInput[] },
>(): NestedElements<Input, MenuItemCaseInput> => ({
  label: 'items',
  elements: (input) => input.items,
  withFirst: (input, first) => ({ ...input, items: [first, ...input.items.slice(1)] }),
  dataValue: (item) => item.value,
  mutators: MENU_ITEM_FIELD_MUTATORS,
})

/** `items` on menu. */
export const MENU_ITEMS: NestedElements<MenuCaseInput, MenuItemCaseInput> = menuItemsOf()

/** `items` on context-menu. */
export const CONTEXT_MENU_ITEMS: NestedElements<ContextMenuCaseInput, MenuItemCaseInput> =
  menuItemsOf()

/** `menus` on menubar. */
export const MENUBAR_MENUS: NestedElements<MenubarCaseInput, MenubarMenuCaseInput> = {
  label: 'menus',
  elements: (input) => input.menus,
  withFirst: (input, first) => ({ ...input, menus: [first, ...input.menus.slice(1)] }),
  dataValue: (menu) => menu.id,
  mutators: MENUBAR_MENU_FIELD_MUTATORS,
}

/** `menus[0].items` on menubar — only mounted while that first menu is open. */
export const MENUBAR_FIRST_MENU_ITEMS: NestedElements<MenubarCaseInput, MenuItemCaseInput> = {
  label: 'menus[0].items',
  elements: (input) => input.menus[0]?.items ?? [],
  withFirst: (input, first) => {
    const [menu, ...rest] = input.menus
    if (menu === undefined) return input
    return { ...input, menus: [{ ...menu, items: [first, ...menu.items.slice(1)] }, ...rest] }
  },
  dataValue: (item) => item.value,
  mutators: MENU_ITEM_FIELD_MUTATORS,
}
