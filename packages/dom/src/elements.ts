import type { BindingKind } from './types.js'
import { getRenderContext } from './render-context.js'
import { createBinding, applyBinding } from './binding.js'
import { FULL_MASK } from './update-loop.js'

type ElementProps = Record<string, unknown>
type Child = Node | string | Node[]
type Children = Child[]

// DOM properties set via elem[key] = value rather than setAttribute
const PROP_KEYS = new Set([
  'value',
  'checked',
  'selected',
  'disabled',
  'readOnly',
  'multiple',
  'indeterminate',
  'defaultValue',
  'defaultChecked',
  'innerHTML',
  'textContent',
])

function classifyKind(key: string): BindingKind {
  if (key === 'class' || key === 'className') return 'class'
  if (key.startsWith('style.')) return 'style'
  if (PROP_KEYS.has(key)) return 'prop'
  return 'attr'
}

function resolveKey(key: string, kind: BindingKind): string | undefined {
  if (kind === 'class') return undefined
  if (kind === 'style') return key.slice(6) // strip 'style.'
  if (kind === 'prop') return key
  // attr
  if (key === 'className') return 'class'
  return key
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  propsOrChildren?: ElementProps | Children,
  maybeChildren?: Children,
): HTMLElementTagNameMap[K] {
  const ctx = getRenderContext()
  const el = ctx.dom.createElement(tag) as HTMLElementTagNameMap[K]

  // Distinguish (props, children) from (children,) — if first arg is an Array, it's children
  const props: ElementProps | undefined = Array.isArray(propsOrChildren)
    ? undefined
    : propsOrChildren
  const children: Children | undefined = Array.isArray(propsOrChildren)
    ? propsOrChildren
    : maybeChildren

  // Props that have to apply AFTER children are appended. `<select
  // value=...>` is the canonical case: setting `value` on a select
  // without options is a silent no-op in real browsers + jsdom
  // (value falls through to the first option on append), and a hard
  // throw under linkedom (its HTMLSelectElement.value setter, once
  // patched, walks options — but there are none yet if we set before
  // appending). Deferring the apply fixes all three envs.
  const deferred: Array<() => void> = []

  if (props) {
    for (const [rawKey, value] of Object.entries(props)) {
      if (rawKey === 'key') continue

      // Event handler
      if (/^on[A-Z]/.test(rawKey)) {
        const eventName = rawKey.slice(2).toLowerCase()
        el.addEventListener(eventName, value as EventListener)
        continue
      }

      const isSelectValue = tag === 'select' && rawKey === 'value'

      // Reactive binding — value is a function
      if (typeof value === 'function') {
        const kind = classifyKind(rawKey)
        const key = resolveKey(rawKey, kind)
        const accessor = value as (state: never) => unknown
        const perItem = value.length === 0

        const binding = createBinding(ctx.rootLifetime, {
          mask: FULL_MASK,
          accessor,
          kind,
          node: el,
          key,
          perItem,
        })

        const initialValue = perItem ? (value as () => unknown)() : accessor(ctx.state as never)
        binding.lastValue = initialValue
        if (isSelectValue) {
          deferred.push(() => applyBinding({ kind, node: el, key }, initialValue))
        } else {
          applyBinding({ kind, node: el, key }, initialValue)
        }
        continue
      }

      // Static prop
      const kind = classifyKind(rawKey)
      const key = resolveKey(rawKey, kind)
      if (isSelectValue) {
        deferred.push(() => applyBinding({ kind, node: el, key }, value))
      } else {
        applyBinding({ kind, node: el, key }, value)
      }
    }
  }

  if (children) {
    for (const child of children) {
      if (typeof child === 'string') {
        el.appendChild(ctx.dom.createTextNode(child))
      } else if (Array.isArray(child)) {
        for (const node of child) el.appendChild(node)
      } else {
        el.appendChild(child)
      }
    }
  }

  for (const fn of deferred) fn()

  return el
}

// Element helper signature — accepts (props, children?), (children,), or no args
type ElFn<K extends keyof HTMLElementTagNameMap> = {
  (): HTMLElementTagNameMap[K]
  (props: ElementProps, children?: Children): HTMLElementTagNameMap[K]
  (children: Children): HTMLElementTagNameMap[K]
}

// Void-element helper signature — no children allowed
type VoidElFn<K extends keyof HTMLElementTagNameMap> = {
  (): HTMLElementTagNameMap[K]
  (props: ElementProps): HTMLElementTagNameMap[K]
}

/* v8 ignore start — mechanical tag wrappers */
// prettier-ignore
export const a = ((p?: ElementProps | Children, c?: Children) => createElement('a', p, c)) as ElFn<'a'>
// prettier-ignore
export const abbr = ((p?: ElementProps | Children, c?: Children) => createElement('abbr', p, c)) as ElFn<'abbr'>
// prettier-ignore
export const article = ((p?: ElementProps | Children, c?: Children) => createElement('article', p, c)) as ElFn<'article'>
// prettier-ignore
export const aside = ((p?: ElementProps | Children, c?: Children) => createElement('aside', p, c)) as ElFn<'aside'>
// prettier-ignore
export const b = ((p?: ElementProps | Children, c?: Children) => createElement('b', p, c)) as ElFn<'b'>
// prettier-ignore
export const blockquote = ((p?: ElementProps | Children, c?: Children) => createElement('blockquote', p, c)) as ElFn<'blockquote'>
// prettier-ignore
export const br = ((p?: ElementProps) => createElement('br', p)) as VoidElFn<'br'>
// prettier-ignore
export const button = ((p?: ElementProps | Children, c?: Children) => createElement('button', p, c)) as ElFn<'button'>
// prettier-ignore
export const canvas = ((p?: ElementProps | Children, c?: Children) => createElement('canvas', p, c)) as ElFn<'canvas'>
// prettier-ignore
export const code = ((p?: ElementProps | Children, c?: Children) => createElement('code', p, c)) as ElFn<'code'>
// prettier-ignore
export const dd = ((p?: ElementProps | Children, c?: Children) => createElement('dd', p, c)) as ElFn<'dd'>
// prettier-ignore
export const details = ((p?: ElementProps | Children, c?: Children) => createElement('details', p, c)) as ElFn<'details'>
// prettier-ignore
export const dialog = ((p?: ElementProps | Children, c?: Children) => createElement('dialog', p, c)) as ElFn<'dialog'>
// prettier-ignore
export const div = ((p?: ElementProps | Children, c?: Children) => createElement('div', p, c)) as ElFn<'div'>
// prettier-ignore
export const dl = ((p?: ElementProps | Children, c?: Children) => createElement('dl', p, c)) as ElFn<'dl'>
// prettier-ignore
export const dt = ((p?: ElementProps | Children, c?: Children) => createElement('dt', p, c)) as ElFn<'dt'>
// prettier-ignore
export const em = ((p?: ElementProps | Children, c?: Children) => createElement('em', p, c)) as ElFn<'em'>
// prettier-ignore
export const fieldset = ((p?: ElementProps | Children, c?: Children) => createElement('fieldset', p, c)) as ElFn<'fieldset'>
// prettier-ignore
export const figcaption = ((p?: ElementProps | Children, c?: Children) => createElement('figcaption', p, c)) as ElFn<'figcaption'>
// prettier-ignore
export const figure = ((p?: ElementProps | Children, c?: Children) => createElement('figure', p, c)) as ElFn<'figure'>
// prettier-ignore
export const footer = ((p?: ElementProps | Children, c?: Children) => createElement('footer', p, c)) as ElFn<'footer'>
// prettier-ignore
export const form = ((p?: ElementProps | Children, c?: Children) => createElement('form', p, c)) as ElFn<'form'>
// prettier-ignore
export const h1 = ((p?: ElementProps | Children, c?: Children) => createElement('h1', p, c)) as ElFn<'h1'>
// prettier-ignore
export const h2 = ((p?: ElementProps | Children, c?: Children) => createElement('h2', p, c)) as ElFn<'h2'>
// prettier-ignore
export const h3 = ((p?: ElementProps | Children, c?: Children) => createElement('h3', p, c)) as ElFn<'h3'>
// prettier-ignore
export const h4 = ((p?: ElementProps | Children, c?: Children) => createElement('h4', p, c)) as ElFn<'h4'>
// prettier-ignore
export const h5 = ((p?: ElementProps | Children, c?: Children) => createElement('h5', p, c)) as ElFn<'h5'>
// prettier-ignore
export const h6 = ((p?: ElementProps | Children, c?: Children) => createElement('h6', p, c)) as ElFn<'h6'>
// prettier-ignore
export const header = ((p?: ElementProps | Children, c?: Children) => createElement('header', p, c)) as ElFn<'header'>
// prettier-ignore
export const hr = ((p?: ElementProps) => createElement('hr', p)) as VoidElFn<'hr'>
// prettier-ignore
export const i = ((p?: ElementProps | Children, c?: Children) => createElement('i', p, c)) as ElFn<'i'>
// prettier-ignore
export const iframe = ((p?: ElementProps | Children, c?: Children) => createElement('iframe', p, c)) as ElFn<'iframe'>
// prettier-ignore
export const img = ((p?: ElementProps) => createElement('img', p)) as VoidElFn<'img'>
// prettier-ignore
export const input = ((p?: ElementProps) => createElement('input', p)) as VoidElFn<'input'>
// prettier-ignore
export const label = ((p?: ElementProps | Children, c?: Children) => createElement('label', p, c)) as ElFn<'label'>
// prettier-ignore
export const legend = ((p?: ElementProps | Children, c?: Children) => createElement('legend', p, c)) as ElFn<'legend'>
// prettier-ignore
export const li = ((p?: ElementProps | Children, c?: Children) => createElement('li', p, c)) as ElFn<'li'>
// prettier-ignore
export const main = ((p?: ElementProps | Children, c?: Children) => createElement('main', p, c)) as ElFn<'main'>
// prettier-ignore
export const mark = ((p?: ElementProps | Children, c?: Children) => createElement('mark', p, c)) as ElFn<'mark'>
// prettier-ignore
export const nav = ((p?: ElementProps | Children, c?: Children) => createElement('nav', p, c)) as ElFn<'nav'>
// prettier-ignore
export const ol = ((p?: ElementProps | Children, c?: Children) => createElement('ol', p, c)) as ElFn<'ol'>
// prettier-ignore
export const optgroup = ((p?: ElementProps | Children, c?: Children) => createElement('optgroup', p, c)) as ElFn<'optgroup'>
// prettier-ignore
export const option = ((p?: ElementProps | Children, c?: Children) => createElement('option', p, c)) as ElFn<'option'>
// prettier-ignore
export const output = ((p?: ElementProps | Children, c?: Children) => createElement('output', p, c)) as ElFn<'output'>
// prettier-ignore
export const p = ((p?: ElementProps | Children, c?: Children) => createElement('p', p, c)) as ElFn<'p'>
// prettier-ignore
export const pre = ((p?: ElementProps | Children, c?: Children) => createElement('pre', p, c)) as ElFn<'pre'>
// prettier-ignore
export const progress = ((p?: ElementProps | Children, c?: Children) => createElement('progress', p, c)) as ElFn<'progress'>
// prettier-ignore
export const section = ((p?: ElementProps | Children, c?: Children) => createElement('section', p, c)) as ElFn<'section'>
// prettier-ignore
export const select = ((p?: ElementProps | Children, c?: Children) => createElement('select', p, c)) as ElFn<'select'>
// prettier-ignore
export const small = ((p?: ElementProps | Children, c?: Children) => createElement('small', p, c)) as ElFn<'small'>
// prettier-ignore
export const span = ((p?: ElementProps | Children, c?: Children) => createElement('span', p, c)) as ElFn<'span'>
// prettier-ignore
export const strong = ((p?: ElementProps | Children, c?: Children) => createElement('strong', p, c)) as ElFn<'strong'>
// prettier-ignore
export const sub = ((p?: ElementProps | Children, c?: Children) => createElement('sub', p, c)) as ElFn<'sub'>
// prettier-ignore
export const summary = ((p?: ElementProps | Children, c?: Children) => createElement('summary', p, c)) as ElFn<'summary'>
// prettier-ignore
export const sup = ((p?: ElementProps | Children, c?: Children) => createElement('sup', p, c)) as ElFn<'sup'>
// prettier-ignore
export const table = ((p?: ElementProps | Children, c?: Children) => createElement('table', p, c)) as ElFn<'table'>
// prettier-ignore
export const tbody = ((p?: ElementProps | Children, c?: Children) => createElement('tbody', p, c)) as ElFn<'tbody'>
// prettier-ignore
export const td = ((p?: ElementProps | Children, c?: Children) => createElement('td', p, c)) as ElFn<'td'>
// prettier-ignore
export const textarea = ((p?: ElementProps | Children, c?: Children) => createElement('textarea', p, c)) as ElFn<'textarea'>
// prettier-ignore
export const tfoot = ((p?: ElementProps | Children, c?: Children) => createElement('tfoot', p, c)) as ElFn<'tfoot'>
// prettier-ignore
export const th = ((p?: ElementProps | Children, c?: Children) => createElement('th', p, c)) as ElFn<'th'>
// prettier-ignore
export const thead = ((p?: ElementProps | Children, c?: Children) => createElement('thead', p, c)) as ElFn<'thead'>
// prettier-ignore
export const time = ((p?: ElementProps | Children, c?: Children) => createElement('time', p, c)) as ElFn<'time'>
// prettier-ignore
export const tr = ((p?: ElementProps | Children, c?: Children) => createElement('tr', p, c)) as ElFn<'tr'>
// prettier-ignore
export const ul = ((p?: ElementProps | Children, c?: Children) => createElement('ul', p, c)) as ElFn<'ul'>
// prettier-ignore
export const video = ((p?: ElementProps | Children, c?: Children) => createElement('video', p, c)) as ElFn<'video'>
/* v8 ignore stop */
