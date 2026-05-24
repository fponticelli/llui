/**
 * Per-element prop types for the element helpers (`div`, `input`,
 * `button`, …). Replaces the previous `Record<string, unknown>` shape,
 * which gave zero autocomplete and let typos through silently.
 *
 * The framework's prop contract is unusual: every value can be EITHER
 * a static T OR a reactive accessor. So a prop typed `string` here is
 * actually `string | ((s: any) => string) | (() => string)` at the
 * helper-call site. The `Reactive<T>` mapped type does that
 * transformation in one place; per-element interfaces just declare
 * their PLAIN value types.
 *
 * Variance note: `(s: any) => T` (not `(s: unknown) => T`) so a user's
 * `(s: State) => T` accessor type-checks. Under
 * `--strictFunctionTypes`, function parameters are contravariant —
 * `(s: State) => T` is NOT assignable to `(s: unknown) => T` because
 * unknown is wider than State. Using `any` preserves the existing
 * permissive behavior without forcing per-call State generics.
 *
 * Escape hatch: aria-* and data-* are typed via template-literal
 * index signatures; arbitrary attrs aren't otherwise permitted at the
 * type level. If a real attribute is missing from a per-element
 * interface, add it there — don't reach for an unsafe cast.
 */

/**
 * Any prop value can be a static T or a reactive accessor of T.
 *
 * The state parameter is typed `any` (not `unknown`) on purpose —
 * see the file header for the variance rationale. Disabling the
 * `no-explicit-any` rule here is load-bearing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Reactive<T> = T | ((s: any) => T) | (() => T)

/** Apply `Reactive<>` to every value type in an interface. */
type ReactiveProps<T> = { [K in keyof T]?: Reactive<T[K]> }

/** Event handlers — typed (event: E) => void; not reactive. */
export type EventHandler<E extends Event = Event> = (event: E) => void

// ── Common event handlers ─────────────────────────────────────────
// All elements may attach these. Mostly used: onClick, onKeyDown,
// onInput, onFocus, onBlur, onPointer*. Less common ones included for
// completeness without per-element opt-in.
interface CommonEventHandlers {
  // Mouse
  onClick?: EventHandler<MouseEvent>
  onDblClick?: EventHandler<MouseEvent>
  onMouseDown?: EventHandler<MouseEvent>
  onMouseUp?: EventHandler<MouseEvent>
  onMouseMove?: EventHandler<MouseEvent>
  onMouseEnter?: EventHandler<MouseEvent>
  onMouseLeave?: EventHandler<MouseEvent>
  onMouseOver?: EventHandler<MouseEvent>
  onMouseOut?: EventHandler<MouseEvent>
  onContextMenu?: EventHandler<MouseEvent>
  onWheel?: EventHandler<WheelEvent>

  // Keyboard
  onKeyDown?: EventHandler<KeyboardEvent>
  onKeyUp?: EventHandler<KeyboardEvent>
  onKeyPress?: EventHandler<KeyboardEvent>

  // Focus
  onFocus?: EventHandler<FocusEvent>
  onBlur?: EventHandler<FocusEvent>
  onFocusIn?: EventHandler<FocusEvent>
  onFocusOut?: EventHandler<FocusEvent>

  // Form / input
  onInput?: EventHandler<Event>
  onChange?: EventHandler<Event>
  onSubmit?: EventHandler<SubmitEvent>
  onReset?: EventHandler<Event>
  onInvalid?: EventHandler<Event>
  onSelect?: EventHandler<Event>

  // Pointer
  onPointerDown?: EventHandler<PointerEvent>
  onPointerUp?: EventHandler<PointerEvent>
  onPointerMove?: EventHandler<PointerEvent>
  onPointerEnter?: EventHandler<PointerEvent>
  onPointerLeave?: EventHandler<PointerEvent>
  onPointerOver?: EventHandler<PointerEvent>
  onPointerOut?: EventHandler<PointerEvent>
  onPointerCancel?: EventHandler<PointerEvent>
  onGotPointerCapture?: EventHandler<PointerEvent>
  onLostPointerCapture?: EventHandler<PointerEvent>

  // Touch
  onTouchStart?: EventHandler<TouchEvent>
  onTouchEnd?: EventHandler<TouchEvent>
  onTouchMove?: EventHandler<TouchEvent>
  onTouchCancel?: EventHandler<TouchEvent>

  // Drag / drop
  onDrag?: EventHandler<DragEvent>
  onDragStart?: EventHandler<DragEvent>
  onDragEnd?: EventHandler<DragEvent>
  onDragEnter?: EventHandler<DragEvent>
  onDragLeave?: EventHandler<DragEvent>
  onDragOver?: EventHandler<DragEvent>
  onDrop?: EventHandler<DragEvent>

  // Clipboard
  onCopy?: EventHandler<ClipboardEvent>
  onCut?: EventHandler<ClipboardEvent>
  onPaste?: EventHandler<ClipboardEvent>

  // Composition (IME)
  onCompositionStart?: EventHandler<CompositionEvent>
  onCompositionUpdate?: EventHandler<CompositionEvent>
  onCompositionEnd?: EventHandler<CompositionEvent>

  // Media (img/video/audio)
  onLoad?: EventHandler<Event>
  onError?: EventHandler<Event>
  onAbort?: EventHandler<Event>
  onPlay?: EventHandler<Event>
  onPause?: EventHandler<Event>
  onEnded?: EventHandler<Event>
  onCanPlay?: EventHandler<Event>
  onLoadedData?: EventHandler<Event>
  onLoadedMetadata?: EventHandler<Event>
  onTimeUpdate?: EventHandler<Event>
  onVolumeChange?: EventHandler<Event>

  // Scroll
  onScroll?: EventHandler<Event>

  // Animation / transition
  onAnimationStart?: EventHandler<AnimationEvent>
  onAnimationEnd?: EventHandler<AnimationEvent>
  onAnimationIteration?: EventHandler<AnimationEvent>
  onTransitionEnd?: EventHandler<TransitionEvent>
  onTransitionRun?: EventHandler<TransitionEvent>
  onTransitionStart?: EventHandler<TransitionEvent>
  onTransitionCancel?: EventHandler<TransitionEvent>
}

// ── Base attributes for every element ─────────────────────────────
interface BaseAttributes {
  class?: string
  /** Alias for `class` — accepted for React-style code; emits the same `class` attribute. */
  className?: string
  id?: string
  style?: string
  title?: string
  role?: string
  tabindex?: number | string
  hidden?: boolean
  lang?: string
  dir?: 'ltr' | 'rtl' | 'auto'
  slot?: string
  contenteditable?: boolean | 'true' | 'false' | 'plaintext-only'
  draggable?: boolean
  spellcheck?: boolean
  translate?: 'yes' | 'no'
  autofocus?: boolean
  inert?: boolean
  enterkeyhint?: 'enter' | 'done' | 'go' | 'next' | 'previous' | 'search' | 'send'
  inputmode?: 'none' | 'text' | 'decimal' | 'numeric' | 'tel' | 'search' | 'email' | 'url'
  autocapitalize?: 'off' | 'none' | 'on' | 'sentences' | 'words' | 'characters'
  is?: string
  itemid?: string
  itemprop?: string
  itemref?: string
  itemscope?: boolean
  itemtype?: string
  popover?: 'auto' | 'manual' | ''
}

/**
 * The common prop bag — base HTML attributes (all reactive) + event
 * handlers (not reactive). `aria-*` and `data-*` extensions are added
 * via index signatures on the final `ElementPropsFor<K>` type so
 * they're available everywhere without exploding the per-element
 * interfaces.
 */
export interface CommonHTMLProps extends ReactiveProps<BaseAttributes>, CommonEventHandlers {
  /** Reactive attribute container. Use `'aria-label'`, `'data-testid'`, etc. */
  // Index signatures live on ElementPropsFor below — see the comment there.
}

// ── Element-specific extensions ───────────────────────────────────

interface AnchorAttributes {
  href?: string
  target?: '_self' | '_blank' | '_parent' | '_top' | string
  rel?: string
  download?: string | boolean
  hreflang?: string
  type?: string
  referrerpolicy?: ReferrerPolicy
  ping?: string
}

interface ButtonAttributes {
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  name?: string
  value?: string | number
  form?: string
  formaction?: string
  formenctype?: string
  formmethod?: string
  formnovalidate?: boolean
  formtarget?: string
}

interface InputAttributes {
  type?:
    | 'text'
    | 'password'
    | 'email'
    | 'number'
    | 'tel'
    | 'url'
    | 'search'
    | 'checkbox'
    | 'radio'
    | 'file'
    | 'hidden'
    | 'submit'
    | 'reset'
    | 'button'
    | 'date'
    | 'datetime-local'
    | 'month'
    | 'time'
    | 'week'
    | 'color'
    | 'range'
    | 'image'
  value?: string | number
  defaultValue?: string | number
  checked?: boolean
  defaultChecked?: boolean
  name?: string
  placeholder?: string
  disabled?: boolean
  readonly?: boolean
  readOnly?: boolean
  required?: boolean
  min?: string | number
  max?: string | number
  step?: string | number
  pattern?: string
  size?: number
  maxlength?: number
  maxLength?: number
  minlength?: number
  minLength?: number
  autocomplete?: string
  autocorrect?: 'on' | 'off'
  list?: string
  accept?: string
  multiple?: boolean
  capture?: 'user' | 'environment' | boolean
  src?: string
  alt?: string
  width?: number | string
  height?: number | string
  form?: string
  formaction?: string
  formenctype?: string
  formmethod?: string
  formnovalidate?: boolean
  formtarget?: string
  indeterminate?: boolean
}

interface FormAttributes {
  action?: string
  method?: 'get' | 'post' | 'dialog'
  enctype?: 'application/x-www-form-urlencoded' | 'multipart/form-data' | 'text/plain'
  autocomplete?: 'on' | 'off'
  novalidate?: boolean
  target?: string
  name?: string
  acceptCharset?: string
}

interface LabelAttributes {
  for?: string
  htmlFor?: string
  form?: string
}

interface SelectAttributes {
  value?: string | number
  name?: string
  disabled?: boolean
  multiple?: boolean
  required?: boolean
  size?: number
  autocomplete?: string
  form?: string
}

interface OptionAttributes {
  value?: string | number
  label?: string
  selected?: boolean
  defaultSelected?: boolean
  disabled?: boolean
}

interface OptgroupAttributes {
  label?: string
  disabled?: boolean
}

interface TextareaAttributes {
  value?: string
  defaultValue?: string
  name?: string
  placeholder?: string
  disabled?: boolean
  readonly?: boolean
  readOnly?: boolean
  required?: boolean
  rows?: number
  cols?: number
  maxlength?: number
  maxLength?: number
  minlength?: number
  minLength?: number
  autocomplete?: string
  autocorrect?: 'on' | 'off'
  wrap?: 'hard' | 'soft' | 'off'
  form?: string
}

interface ImgAttributes {
  src?: string
  alt?: string
  width?: number | string
  height?: number | string
  loading?: 'eager' | 'lazy'
  decoding?: 'sync' | 'async' | 'auto'
  srcset?: string
  sizes?: string
  crossorigin?: 'anonymous' | 'use-credentials' | ''
  referrerpolicy?: ReferrerPolicy
  usemap?: string
  ismap?: boolean
}

interface VideoAttributes {
  src?: string
  poster?: string
  width?: number | string
  height?: number | string
  controls?: boolean
  autoplay?: boolean
  loop?: boolean
  muted?: boolean
  playsinline?: boolean
  preload?: 'none' | 'metadata' | 'auto' | ''
  crossorigin?: 'anonymous' | 'use-credentials' | ''
}

interface AudioAttributes {
  src?: string
  controls?: boolean
  autoplay?: boolean
  loop?: boolean
  muted?: boolean
  preload?: 'none' | 'metadata' | 'auto' | ''
  crossorigin?: 'anonymous' | 'use-credentials' | ''
}

interface SourceAttributes {
  src?: string
  type?: string
  srcset?: string
  sizes?: string
  media?: string
}

interface IframeAttributes {
  src?: string
  srcdoc?: string
  name?: string
  width?: number | string
  height?: number | string
  loading?: 'eager' | 'lazy'
  allow?: string
  allowfullscreen?: boolean
  referrerpolicy?: ReferrerPolicy
  sandbox?: string
}

interface ScriptAttributes {
  src?: string
  type?: string
  async?: boolean
  defer?: boolean
  crossorigin?: 'anonymous' | 'use-credentials' | ''
  integrity?: string
  nomodule?: boolean
  referrerpolicy?: ReferrerPolicy
}

interface DetailsAttributes {
  open?: boolean
  name?: string
}

interface DialogAttributes {
  open?: boolean
}

interface MeterAttributes {
  value?: number
  min?: number
  max?: number
  low?: number
  high?: number
  optimum?: number
  form?: string
}

interface ProgressAttributes {
  value?: number
  max?: number
}

interface OutputAttributes {
  for?: string
  htmlFor?: string
  form?: string
  name?: string
}

interface TimeAttributes {
  datetime?: string
}

interface TableAttributes {
  cellpadding?: number | string
  cellspacing?: number | string
}

interface TdAttributes {
  colspan?: number
  rowspan?: number
  headers?: string
}

interface ThAttributes {
  colspan?: number
  rowspan?: number
  scope?: 'col' | 'row' | 'colgroup' | 'rowgroup'
  abbr?: string
  headers?: string
}

interface ColAttributes {
  span?: number
}

interface BlockquoteAttributes {
  cite?: string
}

interface FieldsetAttributes {
  disabled?: boolean
  form?: string
  name?: string
}

// ── Tag → prop type map ───────────────────────────────────────────

type PerTagAttributes = {
  a: AnchorAttributes
  abbr: object
  article: object
  aside: object
  audio: AudioAttributes
  b: object
  blockquote: BlockquoteAttributes
  br: object
  button: ButtonAttributes
  canvas: object
  code: object
  col: ColAttributes
  dd: object
  details: DetailsAttributes
  dialog: DialogAttributes
  div: object
  dl: object
  dt: object
  em: object
  fieldset: FieldsetAttributes
  figcaption: object
  figure: object
  footer: object
  form: FormAttributes
  h1: object
  h2: object
  h3: object
  h4: object
  h5: object
  h6: object
  header: object
  hr: object
  i: object
  iframe: IframeAttributes
  img: ImgAttributes
  input: InputAttributes
  label: LabelAttributes
  legend: object
  li: object
  main: object
  mark: object
  meter: MeterAttributes
  nav: object
  ol: object
  optgroup: OptgroupAttributes
  option: OptionAttributes
  output: OutputAttributes
  p: object
  pre: object
  progress: ProgressAttributes
  script: ScriptAttributes
  section: object
  select: SelectAttributes
  small: object
  source: SourceAttributes
  span: object
  strong: object
  sub: object
  summary: object
  sup: object
  table: TableAttributes
  tbody: object
  td: TdAttributes
  textarea: TextareaAttributes
  tfoot: object
  th: ThAttributes
  thead: object
  time: TimeAttributes
  tr: object
  ul: object
  video: VideoAttributes
}

/**
 * Final prop type for an element helper. Combines:
 *   - common HTML attributes (class, id, style, role, tabindex, …)
 *   - common event handlers (onClick, onInput, onKeyDown, …)
 *   - tag-specific attributes (href on <a>, value on <input>, …)
 *   - `data-*` and `aria-*` template-literal index signatures
 *   - `style.<prop>` index signature for granular reactive style props
 *
 * Falls back to `CommonHTMLProps` for tags not in `PerTagAttributes`.
 */
export type ElementPropsFor<K extends string> = CommonHTMLProps &
  (K extends keyof PerTagAttributes ? ReactiveProps<PerTagAttributes[K]> : object) & {
    [k: `data-${string}`]: Reactive<string | number | boolean | undefined>
    [k: `aria-${string}`]: Reactive<string | number | boolean | undefined>
    [k: `style.${string}`]: Reactive<string | number | undefined>
    /**
     * Per-row item key — used by `each()`'s key callback. Plain string,
     * not reactive. Kept on the props bag because callers attach it via
     * `div({ key: row.id }, [...])` for ergonomic per-row tagging.
     */
    key?: string | number
  }
