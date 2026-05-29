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
  mountSignal,
  type Reactive,
  type PropValue,
  type EventHandler,
  type EachItems,
  type ShowCond,
  type SignalMount,
} from './dom.js'
export {
  mountSignalComponent,
  type SignalComponentDef,
  type SignalComponentHandle,
} from './component.js'
