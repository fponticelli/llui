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
export { virtualEach, type VirtualEachOptions } from './primitives/virtual-each'
export { show } from './primitives/show'
export { slice } from './primitives/slice'
export { portal } from './primitives/portal'
export { foreign } from './primitives/foreign'
export { child } from './primitives/child'
export { lazy, type LazyOptions } from './primitives/lazy'
export type { LazyDef } from './types'
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

// ── SVG Elements ─────────────────────────────────────────────────

export {
  svg,
  g,
  defs,
  symbol,
  use,
  circle,
  ellipse,
  line,
  path,
  polygon,
  polyline,
  rect,
  text as svgText,
  tspan,
  textPath,
  clipPath,
  linearGradient,
  radialGradient,
  stop,
  mask,
  pattern,
  marker,
  filter,
  feBlend,
  feColorMatrix,
  feComponentTransfer,
  feComposite,
  feConvolveMatrix,
  feDiffuseLighting,
  feDisplacementMap,
  feDropShadow,
  feFlood,
  feGaussianBlur,
  feImage,
  feMerge,
  feMergeNode,
  feMorphology,
  feOffset,
  feSpecularLighting,
  feTile,
  feTurbulence,
  fePointLight,
  feSpotLight,
  feDistantLight,
  feFuncR,
  feFuncG,
  feFuncB,
  feFuncA,
  image,
  foreignObject,
  animate,
  animateMotion,
  animateTransform,
  set,
  mpath,
  desc,
  title as svgTitle,
  metadata,
} from './svg-elements'

// ── MathML Elements ──────────────────────────────────────────────

export {
  math,
  mi,
  mn,
  mo,
  ms,
  mtext,
  mrow,
  mfrac,
  msqrt,
  mroot,
  msup,
  msub,
  msubsup,
  munder,
  mover,
  munderover,
  mmultiscripts,
  mprescripts,
  mnone,
  mtable,
  mtr,
  mtd,
  mspace,
  mpadded,
  mphantom,
  menclose,
  merror,
  maction,
  semantics,
  annotation,
  annotationXml,
} from './mathml-elements'

// ── Form Utilities ────────────────────────────────────────────────

export { applyField, type FieldMsg } from './form'

// ── Compiler Target ───────────────────────────────────────────────

export { elSplit } from './el-split'
export { elTemplate } from './el-template'
export { _runPhase2 as __runPhase2, _handleMsg as __handleMsg } from './update-loop'
