// Public entry for the signals reactive surface (opt-in; see
// docs/proposals/signals). Imported by signal-compiled modules as
// `@llui/dom/signals`. Runtime internals (mask, runtime driver) stay private.

export type { Signal, LiveSignal, ValidPath, PathValue } from './types.js'
export { derived } from './types.js'
export {
  signalText,
  staticText,
  el,
  react,
  signalEach,
  signalShow,
  signalBranch,
  signalForeign,
  mountSignal,
  type Reactive,
  type PropValue,
  type EventHandler,
  type EachItems,
  type ShowCond,
  type SignalSpec,
  type ForeignSpec,
  type SignalMount,
} from './dom.js'
export {
  mountSignalComponent,
  type SignalComponentDef,
  type SignalComponentHandle,
  type ComponentBag,
  type EffectApi,
  type StateHandle,
} from './component.js'
