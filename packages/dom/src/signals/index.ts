// The signal reactive surface — re-exported as the `@llui/dom` package root
// (`src/index.ts` is `export * from './signals/index.js'`). This is THE public
// entry; there is no separate legacy runtime or `/signals` subpath anymore.
//
// Two layers share this entry:
//  - AUTHORING (what humans write): component, mountApp, text, div/span/…, each,
//    show, branch — rewritten by the compiler.
//  - RUNTIME (what the compiler emits): signalText, el, react, signalEach, … —
//    plus mountSignalComponent. The transform replaces authoring calls with these.
// Runtime internals (mask, runtime driver) stay private.

export type { Signal, LiveSignal, ValidPath, PathValue } from './types.js'
// Construct a runtime signal handle from a live value getter — for tests and
// advanced foreign/composition cases that build signals outside a component bag.
// `derived` (combine N signals) is a handle constructor, so it lives here too.
export { derived, pathHandle, isSignalHandle, type SignalHandle } from './handle.js'
// Shared, runtime-agnostic type used by transition/animation helpers.
export type { TransitionOptions } from '../types.js'
// Agent-handler introspection (runtime-agnostic — tags a handler with the msg
// variants it can send for the agent protocol).
export { tagSend } from '../binding-descriptors.js'

// ── Runtime (compiler-emitted) ──────────────────────────────────────
export {
  signalText,
  staticText,
  el,
  elNS,
  react,
  signalEach,
  signalShow,
  signalUnsafeHtml,
  signalBranch,
  signalForeign,
  signalLazy,
  signalVirtualEach,
  onMount,
  portal,
  createContext,
  provide,
  useContext,
  isMountable,
  mountable,
  type Context,
  type Mountable,
  type Renderable,
  type ChildNode,
  mountSignal,
  __registerScopeVariants,
  __currentBuildInfo,
  type MountTarget,
  type PropValue,
  type EventHandler,
  type EachSource,
  type RowCtx,
  type ShowCond,
  type SignalSpec,
  type ForeignSpec,
  type SignalMount,
  type SignalLazyOptions,
  type VirtualEachSpec,
} from './dom.js'
export {
  mountSignalComponent,
  hydrateSignalApp,
  type SignalComponentDef,
  type SignalComponentHandle,
  type MountSignalOptions,
  type ComponentBag,
  type EffectApi,
  type StateHandle,
} from './component.js'
export type { BindingError } from './runtime.js'
// ── SSR (server render → string; client hydrates via hydrateSignalApp) ──
export { renderToString, renderNodes, serializeNodes, type ServerDoc } from './ssr.js'

// ── Debug API (relay/agent surface) ─────────────────────────────────
// Canonical home of the MCP/agent-relay contract. Lives in the signal runtime
// so it survives legacy-runtime deletion. installSignalDebug registers the
// required subset; binding/scope/effect introspection methods are optional.
export {
  installSignalDebug,
  type LluiDebugAPI,
  type SignalDebugHooks,
  type SignalMessageRecord,
  type MessageRecord,
  type StateDiff,
  type ValidationError,
  type BindingDebugInfo,
  type UpdateExplanation,
  type ComponentInfo,
  type MessageSchemaInfo,
  type BindingLocation,
  type ElementReport,
  type HydrationDivergence,
} from './devtools.js'
// Runtime-agnostic data shapes used by the debug API / MCP tools.
export type { CoverageSnapshot } from '../tracking/coverage.js'
export type { EachDiff } from '../tracking/each-diff.js'
export type { DisposerEvent } from '../tracking/disposer-log.js'
export type {
  PendingEffect,
  EffectTimelineEntry,
  EffectMatch,
} from '../tracking/effect-timeline.js'
export type { LifetimeNode } from '../types.js'

// ── Authoring (human-written; compiler-rewritten) ───────────────────
export {
  component,
  mountApp,
  text,
  unsafeHtml,
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
  canvas,
  aside,
  article,
  figure,
  figcaption,
  blockquote,
  h4,
  h5,
  h6,
  hr,
  br,
  select,
  option,
  optgroup,
  textarea,
  fieldset,
  legend,
  dl,
  dt,
  dd,
  caption,
  time,
  details,
  summary,
  svg,
  path,
  g,
  circle,
  rect,
  line,
  polyline,
  polygon,
  ellipse,
  svgText,
  each,
  show,
  branch,
  foreign,
  lazy,
  virtualEach,
  type Send,
  type Reactive,
  type AttrValue,
  type ElProps,
  type SignalViewBag,
  type SignalComponentSpec,
} from './authoring.js'
