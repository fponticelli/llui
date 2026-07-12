// Element / text mountables + DOM prop application.
//
// `el`/`elNS`/`signalText`/`staticText` return lazy `Mountable`s that, when placed,
// create real DOM nodes and register their reactive bindings into the active build
// (see `build-context.ts`). `applyProp`/`applyAttr` own the DOM-application quirks
// (form-control IDL props, `style.*`, event listeners) that the compiler deliberately
// leaves to the runtime.

import {
  requireCtx,
  registerVariants,
  isReactive,
  MountableNode,
  materialize,
  type BuildCtx,
  type Mountable,
  type Producer,
  type Reactive,
} from './build-context.js'
import { isSignalHandle } from './handle.js'

/** A reactive text node bound to a signal accessor. */
class SignalTextMountable extends MountableNode {
  constructor(
    private readonly produce: Producer,
    private readonly deps: readonly string[],
    private readonly componentRooted?: boolean,
  ) {
    super()
  }
  mount(): Node {
    const c = requireCtx()
    const node = c.doc.createTextNode('')
    c.specs.push({
      deps: this.deps,
      produce: this.produce,
      componentRooted: this.componentRooted,
      commit: (v) => {
        node.data = v == null ? '' : String(v)
      },
    })
    return node
  }
}

/** A static text node. */
class StaticTextMountable extends MountableNode {
  constructor(private readonly value: string) {
    super()
  }
  mount(): Node {
    return requireCtx().doc.createTextNode(this.value)
  }
}

/** A reactive text node bound to a signal accessor. Returns a `Mountable` that
 * builds the text node and registers its binding when placed. `componentRooted`
 * (set by the authoring layer from the origin handle) drives correct row rebasing;
 * compiler-emitted calls omit it and rely on dep-string inference. */
export function signalText(
  produce: Producer,
  deps: readonly string[],
  componentRooted?: boolean,
): Mountable {
  return new SignalTextMountable(produce, deps, componentRooted)
}

/** A static text node. */
export function staticText(value: string): Mountable {
  return new StaticTextMountable(value)
}

export type EventHandler = (ev: Event) => void
export type PropValue = string | number | boolean | null | Reactive | EventHandler

/** A child slot: a lazy `Mountable` (everything LLui builds — elements, text, and
 * structural primitives — is a Mountable, materialized at placement), or a bare
 * string/number coerced to a static text node at append time (so `div(['hi', 42])`
 * works without an explicit `text(...)` — the same coercion every mainstream framework
 * does). There is no bare `Node` here: a node lives in one place, so exposing one would
 * reintroduce the silent double-placement footgun. Wrap raw DOM via `foreign`. */
export type ChildNode = Mountable | string | number

/** The result of a render callback / view: lazy `Mountable`s, materialized at
 * placement by `populate`/`runBuild`. */
export type Renderable = readonly Mountable[]

// Memoized camelCase→kebab for `style.*` prop names. A reactive `style.transform`
// binding commits on every tick; without the cache each commit re-ran the regex.
// The set of distinct style-prop names an app uses is tiny, so a module cache
// resolves each name's kebab form exactly once (precomputed on first commit,
// O(1) thereafter) instead of per commit.
const kebabCache = new Map<string, string>()
const toKebab = (s: string): string => {
  let k = kebabCache.get(s)
  if (k === undefined) kebabCache.set(s, (k = s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())))
  return k
}

// Curated set of names the DOM only honours as live IDL properties, NOT as
// content attributes: <textarea>/<select> have no `value` content attribute,
// and a control's `checked`/`selected` content attribute is its *default*,
// not its current state, so `setAttribute` silently leaves `.value`/`.checked`
// untouched. `indeterminate` has no attribute at all. This mirrors how Preact /
// Vue / lit route the same form-control props — the runtime owns DOM
// application, so this DOM quirk belongs here rather than in the compiler.
// Everything else (`disabled`, `hidden`, aria-*, data-*, SVG attrs, …) reflects
// correctly as an attribute and stays on the attribute path below.
// NOTE: scoped to the live-DOM client runtime. Server rendering serializes via
// the separate SSR renderer (a textarea's value → child text, a select's value
// → the matching option's `selected`); this set does not affect that path.
const DOM_PROPERTIES = new Set(['value', 'checked', 'selected', 'indeterminate'])

/** Apply a single non-reactive prop VALUE to `node`: `style.*` → individual style
 * property, form-control IDL props (`value`/`checked`/`selected`/`indeterminate`)
 * → live property assignment, everything else → content attribute (null/false
 * removes, true sets empty). Exported so a compiler-emitted {@link RowFactory}'s
 * reactive-prop `commit` routes through the same DOM-application logic the
 * authoring path uses (rather than re-inlining the IDL/style quirks). */
export function applyAttr(node: Element, name: string, value: unknown): void {
  // `style.transform` / `style.zIndex` -> individual style properties
  if (name.startsWith('style.')) {
    const style = (node as HTMLElement).style
    const prop = toKebab(name.slice(6))
    if (value == null || value === false) style.removeProperty(prop)
    else style.setProperty(prop, String(value))
    return
  }
  // Form-control live properties — assign the IDL property directly when the
  // element actually exposes it (`name in node` keeps an arbitrary `value`
  // attribute on a non-form element, e.g. <div value="…">, on the attr path).
  if (DOM_PROPERTIES.has(name) && name in node) {
    if (name === 'value') {
      ;(node as HTMLInputElement).value = value == null || value === false ? '' : String(value)
    } else if (name === 'selected') {
      ;(node as HTMLOptionElement).selected = value === '' ? true : Boolean(value)
    } else {
      // checked / indeterminate — boolean IDL properties on a form control.
      ;(node as HTMLInputElement)[name as 'checked' | 'indeterminate'] =
        value === '' ? true : Boolean(value)
    }
    return
  }
  if (value == null || value === false) node.removeAttribute(name)
  else node.setAttribute(name, value === true ? '' : String(value))
}

/** `onClick` -> `click`, `onInput` -> `input`. */
function eventName(prop: string): string {
  return prop.slice(2).toLowerCase()
}

/** Apply one prop: reactive `react(...)` / signal handle → binding spec; `on*` fn →
 * listener; else a static attr applied immediately. */
function applyProp(c: BuildCtx, node: Element, name: string, value: PropValue): void {
  if (isReactive(value)) {
    c.specs.push({
      deps: value.deps,
      produce: value.produce,
      componentRooted: value.componentRooted,
      commit: (out) => applyAttr(node, name, out),
    })
  } else if (isSignalHandle(value)) {
    // A raw signal handle reached a prop slot: the compiler lowers INLINE
    // `state.map(...)` props to `react(...)`, but a signal stored in a variable
    // (a local const, a spread, a helper return) is opaque to it and passes
    // through verbatim. Bind it reactively here — same as the authoring element
    // helpers do — rather than stringifying the handle into the attribute
    // ("[object Object]", a silently-stuck value).
    c.specs.push({
      deps: value.deps,
      produce: value.produce as (s: unknown) => unknown,
      componentRooted: value.rowLocal !== true,
      commit: (out) => applyAttr(node, name, out),
    })
  } else if (typeof value === 'function' && /^on[A-Z]/.test(name)) {
    node.addEventListener(eventName(name), value as EventListener)
    // tagSend-tagged handler → register the agent-dispatchable variants live.
    const variants = (value as { __lluiVariants?: readonly string[] }).__lluiVariants
    if (variants) registerVariants(c, variants)
  } else {
    applyAttr(node, name, value)
  }
}

/** Append children, THEN apply props — and apply form-control SELECTION props
 * (`value`/`checked`/`selected`/`indeterminate`) AFTER all other props.
 *
 * Two ordering rules, both because a browser resolves form-control selection
 * against the element's current shape and silently drops what doesn't fit yet,
 * with no re-commit afterwards (output-equality holds the stale value):
 *
 *  1. Children first → a child's structural binding (an `each`/`show` spec) is
 *     registered, hence COMMITTED at `scope.mount`, before the element's own prop
 *     bindings. So `<select value=…>` whose `<option>`s come from `each()` sees its
 *     options before its `value` commits — otherwise the assignment hits an empty
 *     <select> and falls back to the first/auto-selected option.
 *  2. Selection props last → `<input type=range value=… min=… max=…>` clamps
 *     `.value` to whatever `min`/`max` are set at assignment time, so `value` must
 *     commit after them REGARDLESS of author key order (an LLM may emit props in
 *     any order; behavior must not depend on it).
 *
 * (Per-`<option selected>` ordering relative to the controlling <select> is handled
 * one level up, by `each` mounting a new row only after inserting it — see there.) */
function populate(
  node: Element,
  props: Readonly<Record<string, PropValue>>,
  children: readonly ChildNode[],
): void {
  const c = requireCtx()
  for (const child of children) {
    if (typeof child === 'string' || typeof child === 'number') {
      node.appendChild(c.doc.createTextNode(String(child)))
    } else {
      // A Mountable (structural primitive) builds its live node here, under the
      // current build — so its spec lands in THIS scope and re-placement rebuilds fresh.
      node.appendChild(materialize(child))
    }
  }
  const entries = Object.entries(props)
  for (const [name, value] of entries)
    if (!DOM_PROPERTIES.has(name)) applyProp(c, node, name, value)
  for (const [name, value] of entries) if (DOM_PROPERTIES.has(name)) applyProp(c, node, name, value)
}

/** An element node. `ns === null` → `createElement`; otherwise `createElementNS`.
 * Holds its construction args as fields (no captured closure) and builds with a
 * monomorphic `mount()` — this is the per-node hot path for list rendering. */
class ElementMountable extends MountableNode {
  constructor(
    private readonly tag: string,
    private readonly props: Readonly<Record<string, PropValue>>,
    private readonly children: readonly ChildNode[],
    private readonly ns: string | null,
  ) {
    super()
  }
  mount(): Node {
    const c = requireCtx()
    const node =
      this.ns === null ? c.doc.createElement(this.tag) : c.doc.createElementNS(this.ns, this.tag)
    populate(node, this.props, this.children)
    return node
  }
}

/** Build an element. `on*` function props become event listeners; `react(...)`
 * props become reactive bindings; everything else is a static attribute. Returns a
 * `Mountable` that creates the element and materializes its children when placed. */
export function el(
  tag: string,
  props: Readonly<Record<string, PropValue>> = {},
  children: readonly ChildNode[] = [],
): Mountable {
  return new ElementMountable(tag, props, children, null)
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** Build an SVG-namespaced element (svg/path/g/circle/…). Same prop/child
 * semantics as `el`, via createElementNS. */
export function elNS(
  tag: string,
  props: Readonly<Record<string, PropValue>> = {},
  children: readonly ChildNode[] = [],
): Mountable {
  return new ElementMountable(tag, props, children, SVG_NS)
}
