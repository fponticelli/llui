// Head / metadata management — `title` / `titleTemplate` / `meta` / `link` /
// `htmlAttr` / `bodyAttr`.
//
// A head primitive is a reactive binding whose `commit` target is a node in
// `document.head` (or an attribute on `<html>`/`<body>`) rather than an inline
// element. It rides the component's one chunked-mask reconciler via
// `registerBinding` (so a reactive value re-fires only when its dep chunks go
// dirty, and a `batch()` burst coalesces into one commit), returns an inline
// placeholder comment (the `portal`/`onMount` pattern), and registers a teardown.
//
// Coordination + dedup live in a `HeadSink`:
//   - `domHeadSink` (client) writes to a live `document.head`, adopting any
//     server-rendered element marked `data-llui-head` so hydration neither
//     duplicates nor flashes.
//   - `collectHeadSink` (server) accumulates entries and serializes to the head /
//     html-attrs / body-attrs strings the SSR adapter stitches into the document.
// Both keep a per-key LAST-WRITER-WINS stack: a nested page's `title`/`meta`
// overrides its layout's, and on unmount the next-most-recent live writer's
// CURRENT value is restored (writers keep their value live even while shadowed).
//
// Resolution: a sink seeded via the `HEAD_SINK` context wins (SSR collector, or an
// explicit provider); otherwise the client falls back to one sink PER DOCUMENT
// (the resource being coordinated is the single shared `document.head`), never a
// cross-document module global.

import {
  applyAttr,
  createContext,
  currentDoc,
  mountable,
  onTeardown,
  registerBinding,
  useContext,
  type Context,
  type Mountable,
  type SignalDoc,
} from './dom.js'
import { isSignalHandle } from './handle.js'
import { serializeNodes, escapeAttr } from './ssr.js'
import type { Signal } from './types.js'

// ── Public value type ───────────────────────────────────────────────
/** A head value: a plain value (committed once) or a `Signal` (committed on
 * mount and on every change). Mirrors how `foreign` accepts handles-or-values. */
export type HeadValue<T> = T | Signal<T>

const EMPTY_DEPS: readonly string[] = []

function toReactive<T>(v: HeadValue<T>): {
  produce: (state: unknown) => unknown
  deps: readonly string[]
} {
  if (isSignalHandle(v)) return { produce: v.produce, deps: v.deps }
  return { produce: () => v, deps: EMPTY_DEPS }
}

/** The static string of a head value, or `undefined` if it is reactive (a handle
 * has no compile-time value — such entries can't contribute to a dedup key). */
function staticStr(v: unknown): string | undefined {
  if (isSignalHandle(v)) return undefined
  return v == null ? undefined : String(v)
}

// ── HeadSink contract ───────────────────────────────────────────────
/** Where a head entry lands: a `<head>` element, an attribute on `<html>`/`<body>`,
 * or the (template-composed) `<title>`. */
export type HeadTarget =
  | { kind: 'element'; tag: string }
  | { kind: 'attr'; on: 'html' | 'body'; name: string }
  | { kind: 'title' }
  | { kind: 'titleTemplate' }

/** A single registered writer's handle: the binding `set`s its value(s) here;
 * teardown `release`s it. */
export interface HeadController {
  set(attrs: Record<string, unknown>, text?: string): void
  release(): void
}

/** The coordinator a head primitive commits through. One per app document (client)
 * or one per render (server collector). */
export interface HeadSink {
  register(key: string, target: HeadTarget): HeadController
}

/** Context carrying the active sink. Default `null` → the client per-document
 * fallback; SSR / explicit coordination seed a sink here. */
export const HEAD_SINK: Context<HeadSink | null> = createContext<HeadSink | null>(null, 'head-sink')

interface Writer {
  attrs: Record<string, unknown>
  text?: string
}

const topOf = <T>(a: readonly T[]): T | undefined => a[a.length - 1]

function composeTitle(title: string | undefined, template: string | undefined): string | undefined {
  // A template only applies when a title is set (React-Helmet semantics): no
  // title → the <title> is unmanaged regardless of any template.
  if (title === undefined) return undefined
  return template === undefined ? title : template.replace('%s', title)
}

// ── domHeadSink: live document.head ─────────────────────────────────
const NOOP_CONTROLLER: HeadController = { set() {}, release() {} }

/** Build a sink that writes to `doc`'s live `<head>` / `<html>` / `<body>`. Returns
 * an inert sink when the document has no `<head>` (server `DomEnv` — those go
 * through the collector instead). */
export function domHeadSink(doc: SignalDoc): HeadSink {
  const head = doc.head
  if (!head) return { register: () => NOOP_CONTROLLER }
  const htmlEl = doc.documentElement ?? null
  const bodyEl = doc.body ?? null

  interface ElRec {
    el: Element
    adopted: boolean
    baseText: string | null
    baseAttrs: Map<string, string | null>
    managed: Set<string>
  }
  const elements = new Map<string, ElRec>()
  const elementWriters = new Map<string, Writer[]>()
  const attrWriters = new Map<string, Writer[]>()
  const attrBases = new Map<string, string | null>()
  const titleWriters: Writer[] = []
  const templateWriters: Writer[] = []

  const targetEl = (on: 'html' | 'body'): Element | null => (on === 'html' ? htmlEl : bodyEl)

  function findMarked(key: string): Element | null {
    const kids = head!.children
    for (let i = 0; i < kids.length; i++) {
      if (kids[i]!.getAttribute('data-llui-head') === key) return kids[i]!
    }
    return null
  }

  function ensureEl(key: string, tag: string): ElRec {
    const existing = elements.get(key)
    if (existing) return existing
    let el = findMarked(key)
    if (!el && tag === 'title') el = head!.querySelector('title')
    let rec: ElRec
    if (el) {
      const baseAttrs = new Map<string, string | null>()
      const attrs = el.attributes
      for (let i = 0; i < attrs.length; i++) baseAttrs.set(attrs[i]!.name, attrs[i]!.value)
      rec = { el, adopted: true, baseText: el.textContent, baseAttrs, managed: new Set() }
    } else {
      el = doc.createElement(tag)
      el.setAttribute('data-llui-head', key)
      head!.appendChild(el)
      rec = { el, adopted: false, baseText: null, baseAttrs: new Map(), managed: new Set() }
    }
    elements.set(key, rec)
    return rec
  }

  function writeEl(rec: ElRec, attrs: Record<string, unknown>, text: string | undefined): void {
    // Drop managed attrs no longer present in the active writer (restore the
    // adopted base, else remove); then apply the active writer's attrs.
    for (const name of rec.managed) {
      if (!(name in attrs)) {
        if (rec.baseAttrs.has(name)) applyAttr(rec.el, name, rec.baseAttrs.get(name))
        else applyAttr(rec.el, name, null)
      }
    }
    const managed = new Set<string>()
    for (const [name, val] of Object.entries(attrs)) {
      if (name === 'data-llui-head') continue
      applyAttr(rec.el, name, val)
      managed.add(name)
    }
    rec.managed = managed
    if (text !== undefined) rec.el.textContent = text
  }

  function clearEl(key: string): void {
    const rec = elements.get(key)
    if (!rec) return
    if (rec.adopted) {
      for (const name of rec.managed) if (!rec.baseAttrs.has(name)) applyAttr(rec.el, name, null)
      for (const [name, val] of rec.baseAttrs) applyAttr(rec.el, name, val)
      rec.el.textContent = rec.baseText ?? ''
    } else {
      rec.el.parentNode?.removeChild(rec.el)
    }
    elements.delete(key)
  }

  function renderTitle(): void {
    const text = composeTitle(topOf(titleWriters)?.text, topOf(templateWriters)?.text)
    if (text === undefined) clearEl('title')
    else writeEl(ensureEl('title', 'title'), {}, text)
  }

  function makeController(stack: Writer[], onTop: () => void, onEmpty: () => void): HeadController {
    const writer: Writer = { attrs: {} }
    stack.push(writer)
    return {
      set(attrs, text) {
        Object.assign(writer.attrs, attrs)
        if (text !== undefined) writer.text = text
        if (topOf(stack) === writer) onTop()
      },
      release() {
        const i = stack.indexOf(writer)
        if (i === -1) return
        const wasTop = i === stack.length - 1
        stack.splice(i, 1)
        if (wasTop) (stack.length ? onTop : onEmpty)()
      },
    }
  }

  return {
    register(key, target) {
      switch (target.kind) {
        case 'title':
          return makeController(titleWriters, renderTitle, renderTitle)
        case 'titleTemplate':
          return makeController(templateWriters, renderTitle, renderTitle)
        case 'element': {
          let stack = elementWriters.get(key)
          if (!stack) elementWriters.set(key, (stack = []))
          const apply = (): void => {
            const top = topOf(stack!)!
            writeEl(ensureEl(key, target.tag), top.attrs, top.text)
          }
          return makeController(stack, apply, () => clearEl(key))
        }
        case 'attr': {
          let stack = attrWriters.get(key)
          if (!stack) attrWriters.set(key, (stack = []))
          if (stack.length === 0) {
            const el = targetEl(target.on)
            attrBases.set(key, el ? el.getAttribute(target.name) : null)
          }
          const apply = (): void => {
            const el = targetEl(target.on)
            if (el) applyAttr(el, target.name, topOf(stack!)!.attrs[target.name])
          }
          const clear = (): void => {
            const el = targetEl(target.on)
            if (el) applyAttr(el, target.name, attrBases.get(key) ?? null)
            attrBases.delete(key)
          }
          return makeController(stack, apply, clear)
        }
      }
    },
  }
}

// ── collectHeadSink: SSR string collection ──────────────────────────
/** The serialized output of a server render's head collection. */
export interface CollectedHead {
  /** `<head>` element markup (title/meta/link/…), each marked `data-llui-head`. */
  head: string
  /** Attribute string for `<html …>` (leading space included), already escaped. */
  htmlAttrs: string
  /** Attribute string for `<body …>` (leading space included), already escaped. */
  bodyAttrs: string
  /** Dedup keys present in `head` (e.g. `title`, `meta:name=description`). Used by
   * {@link mergeStaticHead} to strip colliding tags from a static `+Head.ts`. */
  keys: readonly string[]
}

/** A server-side {@link HeadSink} that collects entries and serializes them. Seed
 * it via {@link HEAD_SINK} before rendering, then call `serialize(env)`. */
export interface CollectHeadSink extends HeadSink {
  serialize(doc: SignalDoc): CollectedHead
}

export function collectHeadSink(): CollectHeadSink {
  interface Slot {
    target: HeadTarget
    writers: Writer[]
  }
  const slots = new Map<string, Slot>()
  const titleWriters: Writer[] = []
  const templateWriters: Writer[] = []

  function makeController(writers: Writer[]): HeadController {
    const writer: Writer = { attrs: {} }
    writers.push(writer)
    return {
      set(attrs, text) {
        Object.assign(writer.attrs, attrs)
        if (text !== undefined) writer.text = text
      },
      release() {
        const i = writers.indexOf(writer)
        if (i !== -1) writers.splice(i, 1)
      },
    }
  }

  return {
    register(key, target) {
      if (target.kind === 'title') return makeController(titleWriters)
      if (target.kind === 'titleTemplate') return makeController(templateWriters)
      let slot = slots.get(key)
      if (!slot) slots.set(key, (slot = { target, writers: [] }))
      return makeController(slot.writers)
    },
    serialize(doc) {
      let head = ''
      let htmlAttrs = ''
      let bodyAttrs = ''
      const keys: string[] = []

      const titleText = composeTitle(topOf(titleWriters)?.text, topOf(templateWriters)?.text)
      if (titleText !== undefined) {
        const el = doc.createElement('title')
        el.setAttribute('data-llui-head', 'title')
        el.textContent = titleText
        head += serializeNodes([el])
        keys.push('title')
      }

      for (const [key, slot] of slots) {
        const top = topOf(slot.writers)
        if (!top) continue
        if (slot.target.kind === 'element') {
          const el = doc.createElement(slot.target.tag)
          el.setAttribute('data-llui-head', key)
          for (const [name, val] of Object.entries(top.attrs)) {
            if (name !== 'data-llui-head') applyAttr(el, name, val)
          }
          if (top.text !== undefined) el.textContent = top.text
          head += serializeNodes([el])
          keys.push(key)
        } else if (slot.target.kind === 'attr') {
          const val = top.attrs[slot.target.name]
          if (val == null || val === false) continue
          const s = ` ${slot.target.name}="${escapeAttr(val === true ? '' : String(val))}"`
          if (slot.target.on === 'html') htmlAttrs += s
          else bodyAttrs += s
        }
      }
      return { head, htmlAttrs, bodyAttrs, keys }
    },
  }
}

// ── Static head merge (SSR adapter) ─────────────────────────────────
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Merge a static `+Head.ts` head string with collected component head, letting
 * component entries WIN: any `<title>` / `<meta name|property>` in `staticHead`
 * whose key the component also set is stripped, so the document never carries two
 * `<title>`s (the browser would silently use the first). Returns
 * `strippedStatic + collected.head`. */
export function mergeStaticHead(staticHead: string, collected: CollectedHead): string {
  let s = staticHead
  for (const key of collected.keys) {
    if (key === 'title') {
      s = s.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, '')
    } else if (key.startsWith('meta:name=') || key.startsWith('meta:property=')) {
      const attr = key.startsWith('meta:name=') ? 'name' : 'property'
      const val = key.slice(attr.length + 6) // 'meta:' + attr + '='
      const re = new RegExp(`<meta\\b[^>]*\\b${attr}=["']${escapeRegExp(val)}["'][^>]*?/?>`, 'i')
      s = s.replace(re, '')
    }
  }
  return s + collected.head
}

// ── Sink resolution ─────────────────────────────────────────────────
const fallbackSinks = new WeakMap<object, HeadSink>()

function resolveSink(): HeadSink {
  const seeded = useContext(HEAD_SINK)
  if (seeded) return seeded
  const doc = currentDoc()
  let s = fallbackSinks.get(doc as object)
  if (!s) fallbackSinks.set(doc as object, (s = domHeadSink(doc)))
  return s
}

// ── Authoring primitives ────────────────────────────────────────────
function elementHead(
  key: string,
  tag: string,
  attrs: Record<string, HeadValue<unknown>>,
  text?: HeadValue<string>,
): Mountable {
  return mountable(() => {
    const ctl = resolveSink().register(key, { kind: 'element', tag })
    for (const [name, value] of Object.entries(attrs)) {
      const r = toReactive(value)
      registerBinding(r.deps, r.produce, (out) => ctl.set({ [name]: out }))
    }
    if (text !== undefined) {
      const r = toReactive(text)
      registerBinding(r.deps, r.produce, (out) => ctl.set({}, out == null ? '' : String(out)))
    }
    onTeardown(() => ctl.release())
    return currentDoc().createComment(`head:${tag}`)
  })
}

function titleLike(kind: 'title' | 'titleTemplate', value: HeadValue<string>): Mountable {
  return mountable(() => {
    const ctl = resolveSink().register(kind, { kind })
    const r = toReactive(value)
    registerBinding(r.deps, r.produce, (out) => ctl.set({}, out == null ? '' : String(out)))
    onTeardown(() => ctl.release())
    return currentDoc().createComment(`head:${kind}`)
  })
}

function attrHead(
  on: 'html' | 'body',
  attrs: Record<string, HeadValue<string | boolean | null>>,
): Mountable {
  return mountable(() => {
    const sink = resolveSink()
    const ctls: HeadController[] = []
    for (const [name, value] of Object.entries(attrs)) {
      const ctl = sink.register(`${on}:${name}`, { kind: 'attr', on, name })
      const r = toReactive(value)
      registerBinding(r.deps, r.produce, (out) => ctl.set({ [name]: out }))
      ctls.push(ctl)
    }
    onTeardown(() => {
      for (const c of ctls) c.release()
    })
    return currentDoc().createComment(`head:${on}-attr`)
  })
}

/** Set the document `<title>`. Reactive when given a signal. Last writer in the
 * tree (deepest layout/page) wins; restored on unmount. Combine with
 * {@link titleTemplate}. */
export function title(value: HeadValue<string>): Mountable {
  return titleLike('title', value)
}

/** A `%s` template the active {@link title} is interpolated into — e.g.
 * `titleTemplate('%s · LLui')` + `title('Docs')` → `Docs · LLui`. Applies only
 * while a title is set. */
export function titleTemplate(value: HeadValue<string>): Mountable {
  return titleLike('titleTemplate', value)
}

/** Attributes accepted by {@link meta}. Identity attrs (`name`/`property`/
 * `httpEquiv`/`charset`) should be static so the entry can dedup. */
export interface MetaAttrs {
  name?: string
  property?: string
  httpEquiv?: string
  charset?: string
  content?: HeadValue<string>
  [attr: string]: HeadValue<string> | undefined
}

let anonMeta = 0
let anonLink = 0

function metaKey(attrs: MetaAttrs): string {
  const name = staticStr(attrs.name)
  if (name !== undefined) return `meta:name=${name}`
  const property = staticStr(attrs.property)
  if (property !== undefined) return `meta:property=${property}`
  const httpEquiv = staticStr(attrs.httpEquiv)
  if (httpEquiv !== undefined) return `meta:http-equiv=${httpEquiv}`
  if ('charset' in attrs) return 'meta:charset'
  return `meta:#${++anonMeta}` // no static identity → no dedup
}

/** Add a `<meta>` tag. Dedups by `name`/`property`/`httpEquiv`/`charset`. */
export function meta(attrs: MetaAttrs): Mountable {
  const out: Record<string, HeadValue<unknown>> = {}
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue
    out[k === 'httpEquiv' ? 'http-equiv' : k] = v
  }
  return elementHead(metaKey(attrs), 'meta', out)
}

/** Attributes accepted by {@link link}. */
export interface LinkAttrs {
  rel?: string
  href?: HeadValue<string>
  [attr: string]: HeadValue<string> | undefined
}

function linkKey(attrs: LinkAttrs): string {
  const rel = staticStr(attrs.rel)
  if (rel === undefined) return `link:#${++anonLink}`
  const href = staticStr(attrs.href)
  return href === undefined ? `link:rel=${rel}` : `link:rel=${rel}:href=${href}`
}

/** Add a `<link>` tag (canonical, preload, stylesheet, …). Dedups by `rel`+`href`. */
export function link(attrs: LinkAttrs): Mountable {
  const out: Record<string, HeadValue<unknown>> = {}
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) out[k] = v
  return elementHead(linkKey(attrs), 'link', out)
}

/** Set attribute(s) on `<html>` (e.g. `htmlAttr({ lang })`). Each attribute
 * dedups independently and restores its pre-existing value on unmount. */
export function htmlAttr(attrs: Record<string, HeadValue<string | boolean | null>>): Mountable {
  return attrHead('html', attrs)
}

/** Set attribute(s) on `<body>` (e.g. `bodyAttr({ class: theme })`). */
export function bodyAttr(attrs: Record<string, HeadValue<string | boolean | null>>): Mountable {
  return attrHead('body', attrs)
}

let anonStyle = 0
let anonScript = 0
let anonNoscript = 0

function pickAttrs(attrs: object): Record<string, HeadValue<unknown>> {
  const out: Record<string, HeadValue<unknown>> = {}
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) out[k] = v as HeadValue<unknown>
  return out
}

/** Attributes accepted by {@link base}. */
export interface BaseAttrs {
  href?: HeadValue<string>
  target?: HeadValue<string>
}

/** Set the document `<base>` (one per document — dedups to a single tag). */
export function base(attrs: BaseAttrs): Mountable {
  return elementHead('base', 'base', pickAttrs(attrs))
}

/** Attributes accepted by {@link style} / {@link script}. A static `id` keys the
 * tag for dedup + SSR-hydration adoption; without one the tag is anonymous (no
 * dedup, keyed by stable construction order). */
export interface StyleAttrs {
  id?: string
  media?: HeadValue<string>
  [attr: string]: HeadValue<string> | undefined
}

/** Add an inline `<style>` with `css` as its text content. */
export function style(css: HeadValue<string>, attrs: StyleAttrs = {}): Mountable {
  const id = staticStr(attrs.id)
  const key = id !== undefined ? `style:id=${id}` : `style:#${++anonStyle}`
  return elementHead(key, 'style', pickAttrs(attrs), css)
}

/** Attributes accepted by {@link script}. */
export interface ScriptAttrs {
  src?: HeadValue<string>
  type?: HeadValue<string>
  async?: HeadValue<boolean>
  defer?: HeadValue<boolean>
  id?: string
  [attr: string]: HeadValue<string | boolean> | undefined
}

/** Add a `<script>` (external via `src`, or inline via `body`). Dedups by static
 * `id` or `src`; otherwise anonymous (keyed by stable construction order). */
export function script(attrs: ScriptAttrs = {}, body?: HeadValue<string>): Mountable {
  const id = staticStr(attrs.id)
  const src = staticStr(attrs.src)
  const key =
    id !== undefined
      ? `script:id=${id}`
      : src !== undefined
        ? `script:src=${src}`
        : `script:#${++anonScript}`
  return elementHead(key, 'script', pickAttrs(attrs), body)
}

/** Add a `<noscript>` with `body` as its text content. */
export function noscript(body: HeadValue<string>): Mountable {
  return elementHead(`noscript:#${++anonNoscript}`, 'noscript', {}, body)
}
