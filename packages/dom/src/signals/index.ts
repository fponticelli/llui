// Public entry for the signals reactive surface (opt-in; see
// docs/proposals/signals). Imported by signal modules as `@llui/dom/signals`.
//
// Two layers share this entry:
//  - AUTHORING (what humans write): component, mountApp, text, div/span/…, each,
//    show, branch — rewritten by the compiler.
//  - RUNTIME (what the compiler emits): signalText, el, react, signalEach, … —
//    plus mountSignalComponent. The transform replaces authoring calls with these.
// Runtime internals (mask, runtime driver) stay private.

export type { Signal, LiveSignal, ValidPath, PathValue } from './types.js'
export { derived } from './types.js'

// ── Runtime (compiler-emitted) ──────────────────────────────────────
export {
  signalText,
  staticText,
  el,
  react,
  signalEach,
  signalShow,
  signalBranch,
  signalForeign,
  onMount,
  mountSignal,
  type PropValue,
  type EventHandler,
  type EachSource,
  type RowCtx,
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

// ── Authoring (human-written; compiler-rewritten) ───────────────────
export {
  component,
  mountApp,
  text,
  div,
  span,
  p,
  a,
  button,
  input,
  label,
  form,
  ul,
  ol,
  li,
  section,
  header,
  footer,
  nav,
  main,
  h1,
  h2,
  h3,
  img,
  small,
  strong,
  em,
  table,
  thead,
  tbody,
  tr,
  td,
  th,
  pre,
  code,
  each,
  show,
  branch,
  foreign,
  type Send,
  type Reactive,
  type AttrValue,
  type ElProps,
  type SignalViewBag,
  type SignalComponentSpec,
} from './authoring.js'
