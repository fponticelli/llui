// ── Types ─────────────────────────────────────────────────────────

export type {
  ComponentDef,
  Send,
  Props,
  AppHandle,
  Scope,
  Binding,
  BindingKind,
  TransitionOptions,
  BranchOptions,
  ShowOptions,
  EachOptions,
  ItemAccessor,
  PortalOptions,
  ForeignOptions,
  ChildOptions,
} from './types'

// ── Component ─────────────────────────────────────────────────────

export { component } from './component'
export { createView, type View } from './view-helpers'

// ── Mount ─────────────────────────────────────────────────────────

export { mountApp, hydrateApp, type MountOptions } from './mount'
// installDevTools is NOT re-exported here to keep it out of production bundles.
// Import directly: import { installDevTools } from '@llui/dom/devtools'
export type { LluiDebugAPI } from './devtools'

// ── Runtime ───────────────────────────────────────────────────────

export { flush } from './runtime'
export { addressOf } from './addressed'
export { renderToString } from './ssr'
export { mergeHandlers } from './merge-handlers'
export { createContext, provide, useContext, type Context } from './primitives/context'
export { sliceHandler } from './slice-handler'

// ── View Primitives ───────────────────────────────────────────────

export { text } from './primitives/text'
export { branch } from './primitives/branch'
export { each } from './primitives/each'
export { show } from './primitives/show'
export { slice } from './primitives/slice'
export { portal } from './primitives/portal'
export { foreign } from './primitives/foreign'
export { child } from './primitives/child'
export { memo } from './primitives/memo'
export { selector } from './primitives/selector'
export { onMount } from './primitives/on-mount'
export { errorBoundary } from './primitives/error-boundary'

// ── Element Helpers ───────────────────────────────────────────────

export {
  a,
  abbr,
  article,
  aside,
  b,
  blockquote,
  br,
  button,
  canvas,
  code,
  dd,
  details,
  dialog,
  div,
  dl,
  dt,
  em,
  fieldset,
  figcaption,
  figure,
  footer,
  form,
  h1,
  h2,
  h3,
  h4,
  h5,
  h6,
  header,
  hr,
  i,
  iframe,
  img,
  input,
  label,
  legend,
  li,
  main,
  mark,
  nav,
  ol,
  optgroup,
  option,
  output,
  p,
  pre,
  progress,
  section,
  select,
  small,
  span,
  strong,
  sub,
  summary,
  sup,
  table,
  tbody,
  td,
  textarea,
  tfoot,
  th,
  thead,
  time,
  tr,
  ul,
  video,
} from './elements'

// ── Form Utilities ────────────────────────────────────────────────

export { applyField, type FieldMsg } from './form'

// ── Compiler Target ───────────────────────────────────────────────

export { elSplit } from './el-split'
export { elTemplate } from './el-template'
export { applyBinding as __applyBinding } from './binding'
