export { anatomy, resetAnatomyIdCounter } from './anatomy.js'
export type { Anatomy, AnatomyScope } from './anatomy.js'

export { watchInteractOutside } from './interact-outside.js'
export type { InteractOutsideOptions } from './interact-outside.js'

export { pushDismissable } from './dismissable.js'
export type { DismissableOptions, DismissSource } from './dismissable.js'

export { presenceEndHandler } from './presence-end.js'

export { pushFocusTrap } from './focus-trap.js'
export type { FocusTrapOptions } from './focus-trap.js'

// A custom overlay that restores focus on teardown must route that move through
// `engineFocus`/`runEngineFocus`, or every OTHER open layer reads it as an
// outside interaction and dismisses (#155).
export { engineFocus, runEngineFocus, isEngineFocusInProgress } from './engine-focus.js'
export type { SyncEngineFocusBodyRequired } from './engine-focus.js'

// The one rule for "should this layer pull focus back to its anchor?" — a
// custom overlay's restore must ask it rather than restoring unconditionally
// (#173).
export { focusLingeredInside } from './focus-restore.js'
export type { FocusRestoreQuery } from './focus-restore.js'

export { setAriaHiddenOutside } from './aria-hidden.js'
export { lockBodyScroll } from './remove-scroll.js'

export {
  registerNestedLayer,
  getNestedLayers,
  isInNestedLayer,
  ALL_NESTED_LAYER_ASPECTS,
} from './nested-layer.js'
export type { NestedLayerAspect, NestedLayerOptions, NestedLayerScope } from './nested-layer.js'

export { getFocusables, isFocusable } from './focusables.js'
export type { ElementSource } from './dom.js'

export { attachFloating } from './floating.js'
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

export { deriveOnce, deriveOnceN, indexMap, membershipSet } from './derive.js'
// Chart geometry: scales (data → normalized), path builders, and the
// cartesian/polar projection seam. Public because a consumer measuring or
// testing a chart needs them without mounting one.
export {
  normalize,
  denormalize,
  tickIncrement,
  ticks,
  niceDomain,
  valueDomain,
  bandExtent,
  bandCenter,
  nearestBand,
} from './scale.js'
export type { Sample, Domain, Band } from './scale.js'
export {
  fmt,
  linearPath,
  stepPath,
  monotonePath,
  curvePath,
  areaPath,
  rectPath,
  circlePath,
  polarPoint,
  annularSectorPath,
} from './path.js'
export type { Point, Curve } from './path.js'
// Calendar ticks: the TIME-axis counterpart of `scale.ts`'s numeric `ticks`.
// Public for the same reason — measuring or testing a time axis should not
// require mounting anything.
export {
  MAX_CALENDAR_TICKS,
  addUnits,
  calendarTicks,
  chooseCalendarStep,
  countCalendarTicks,
  floorToUnit,
} from './calendar-ticks.js'
export type {
  CalendarOptions,
  CalendarStep,
  CalendarStepOptions,
  CalendarTick,
  CalendarUnit,
} from './calendar-ticks.js'
export { cartesianProjection, polarProjection, projectionFor } from './projection.js'
export type {
  Projection,
  Frame,
  TickPlacement,
  CartesianOptions,
  PolarOptions,
} from './projection.js'

export {
  allFiniteNumbers,
  clamp,
  clampToStep,
  decimalPlaces,
  finiteBound,
  finiteOrDefault,
  positiveFinite,
  positiveFiniteOrDefault,
  snapToStep,
  stepBy,
} from './number.js'
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
