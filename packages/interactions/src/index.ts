export { watchInteractOutside } from './interact-outside.js'
export type { InteractOutsideOptions } from './interact-outside.js'

export { pushDismissable, _dismissableStackSize } from './dismissable.js'
export type { DismissableOptions, DismissSource } from './dismissable.js'

export { pushFocusTrap, _focusTrapStackSize } from './focus-trap.js'
export type { FocusTrapOptions } from './focus-trap.js'

export { engineFocus, runEngineFocus, isEngineFocusInProgress } from './engine-focus.js'
export type { SyncEngineFocusBodyRequired } from './engine-focus.js'

export { setAriaHiddenOutside } from './aria-hidden.js'
export { lockBodyScroll, _scrollLockCount } from './remove-scroll.js'

export {
  registerNestedLayer,
  getNestedLayers,
  isInNestedLayer,
  ALL_NESTED_LAYER_ASPECTS,
  _nestedLayerCount,
} from './nested-layer.js'
export type { NestedLayerAspect, NestedLayerOptions, NestedLayerScope } from './nested-layer.js'

export { getFocusables, isFocusable } from './focusables.js'
export type { ElementSource } from './dom.js'

export { attachFloating } from './floating.js'
export type { FloatingOptions, Placement } from './floating.js'

export { resolveDir, flipArrow, resolveTextDirection } from './direction.js'
export type { TextDirection } from './direction.js'

export {
  resolveRovingMove,
  focusRovingTab,
  focusRovingItem,
  firstEnabled,
  lastEnabled,
  nextEnabled,
} from './roving.js'
export type { RovingItem, RovingMove, RovingOptions, RovingOrientation } from './roving.js'
