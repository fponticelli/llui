export { anatomy, resetAnatomyIdCounter } from './anatomy.js'
export type { Anatomy, AnatomyScope } from './anatomy.js'

export { watchInteractOutside } from './interact-outside.js'
export type { InteractOutsideOptions } from './interact-outside.js'

export { pushDismissable } from './dismissable.js'
export type { DismissableOptions, DismissSource } from './dismissable.js'

export { presenceEndHandler } from './presence-end.js'

export { pushFocusTrap } from './focus-trap.js'
export type { FocusTrapOptions } from './focus-trap.js'

export { setAriaHiddenOutside } from './aria-hidden.js'
export { lockBodyScroll } from './remove-scroll.js'

export { registerNestedLayer, getNestedLayers, isInNestedLayer } from './nested-layer.js'

export { getFocusables, isFocusable } from './focusables.js'
export type { ElementSource } from './dom.js'

export { attachFloating, flipPlacement } from './floating.js'
export type { FloatingOptions, Placement } from './floating.js'

export {
  typeaheadAccumulate,
  typeaheadMatch,
  typeaheadMatchByItems,
  isTypeaheadKey,
  TYPEAHEAD_TIMEOUT_MS,
} from './typeahead.js'

export { TreeCollection } from './tree-collection.js'
export type { TreeNode } from './tree-collection.js'

export { deriveOnce, indexMap, membershipSet } from './derive.js'

export { clamp, clampToStep, decimalPlaces, snapToStep, stepBy } from './number.js'
export type { NumericGrid } from './number.js'

export { isDateOnly, parseDateValue } from './date.js'
export type { DateValue, ParsedDateValue } from './date.js'

export { resolveDir, flipArrow, resolveTextDirection } from './direction.js'
export type { TextDirection } from './direction.js'

export { resolveRovingMove, focusRovingTab, focusRovingItem } from './roving.js'
export type { RovingItem, RovingMove, RovingOptions, RovingOrientation } from './roving.js'

export {
  applySelection,
  firstEnabled,
  firstEnabledIndex,
  isEnabledItem,
  lastEnabled,
  lastEnabledIndex,
  nextEnabled,
  nextEnabledIndex,
  pruneToEnabled,
  rovingTabStop,
} from './list-navigation.js'
// `SelectionMode` is deliberately NOT re-exported here: `select` already
// exports that name through the components barrel, and `export *` from both
// would make it ambiguous.
