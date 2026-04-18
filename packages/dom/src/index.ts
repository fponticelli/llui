// ── Types ─────────────────────────────────────────────────────────

export type {
  ComponentDef,
  Send,
  Props,
  AppHandle,
  Lifetime,
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
} from './types.js'

// ── Component ─────────────────────────────────────────────────────

export { component } from './component.js'
export { createView, type View } from './view-helpers.js'

// ── Mount ─────────────────────────────────────────────────────────

export { mountApp, hydrateApp, mountAtAnchor, hydrateAtAnchor, type MountOptions } from './mount.js'
// installDevTools is NOT re-exported here to keep it out of production bundles.
// Import directly: import { installDevTools } from '@llui/dom/devtools'
export type { LluiDebugAPI, ElementReport, MessageRecord, StateDiff } from './devtools.js'
export type { CoverageSnapshot } from './tracking/coverage.js'
export type { EachDiff } from './tracking/each-diff.js'
export type { DisposerEvent } from './tracking/disposer-log.js'
export type { PendingEffect, EffectTimelineEntry, EffectMatch } from './tracking/effect-timeline.js'
export type { LifetimeNode } from './types.js'

// ── Runtime ───────────────────────────────────────────────────────

export { flush } from './runtime.js'
export { addressOf } from './addressed.js'
export { renderToString, renderNodes, serializeNodes } from './ssr.js'
export { mergeHandlers } from './merge-handlers.js'
export {
  createContext,
  provide,
  provideValue,
  useContext,
  useContextValue,
  type Context,
} from './primitives/context.js'
export { sliceHandler } from './slice-handler.js'
export {
  childHandlers,
  type ChildState,
  type ChildMsg,
  type ModuleState,
  type ModuleMsg,
} from './compose.js'

// ── View Primitives ───────────────────────────────────────────────

export { text } from './primitives/text.js'
export { unsafeHtml } from './primitives/unsafe-html.js'
export { branch } from './primitives/branch.js'
export { each } from './primitives/each.js'
export { virtualEach, type VirtualEachOptions } from './primitives/virtual-each.js'
export { show } from './primitives/show.js'
export { slice } from './primitives/slice.js'
export { portal } from './primitives/portal.js'
export { foreign } from './primitives/foreign.js'
export { child } from './primitives/child.js'
export { lazy, type LazyOptions } from './primitives/lazy.js'
export type { LazyDef, AnyComponentDef } from './types.js'
export { memo } from './primitives/memo.js'
export { selector } from './primitives/selector.js'
export { onMount } from './primitives/on-mount.js'
export { errorBoundary } from './primitives/error-boundary.js'

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
} from './elements.js'

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
} from './svg-elements.js'

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
} from './mathml-elements.js'

// ── Form Utilities ────────────────────────────────────────────────

export { applyField, type FieldMsg } from './form.js'

// ── Compiler Target ───────────────────────────────────────────────

export { elSplit } from './el-split.js'
export { elTemplate } from './el-template.js'
export { _runPhase2 as __runPhase2, _handleMsg as __handleMsg } from './update-loop.js'
