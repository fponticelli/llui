// ── Types ─────────────────────────────────────────────────────────

export type {
  ComponentDef,
  Send,
  AppHandle,
  Scope,
  Binding,
  BindingKind,
  TransitionOptions,
  BranchOptions,
  ShowOptions,
  EachOptions,
  PortalOptions,
  ForeignOptions,
  ChildOptions,
} from './types'

// ── Component ─────────────────────────────────────────────────────

export { component } from './component'

// ── Mount ─────────────────────────────────────────────────────────

export { mountApp, hydrateApp, type MountOptions } from './mount'
export { installDevTools, type LluiDebugAPI } from './devtools'

// ── Runtime ───────────────────────────────────────────────────────

export { flush } from './runtime'
export { addressOf } from './addressed'
export { renderToString } from './ssr'

// ── View Primitives ───────────────────────────────────────────────

export { text } from './primitives/text'
export { branch } from './primitives/branch'
export { each } from './primitives/each'
export { show } from './primitives/show'
export { portal } from './primitives/portal'
export { foreign } from './primitives/foreign'
export { child } from './primitives/child'
export { memo } from './primitives/memo'
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

// ── Compiler Target ───────────────────────────────────────────────

export { elSplit } from './el-split'
export { elTemplate } from './el-template'
