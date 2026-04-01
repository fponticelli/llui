import type { BindingKind } from './types'
import { getRenderContext } from './render-context'
import { createBinding, applyBinding } from './binding'

type ElementProps = Record<string, unknown>

const FULL_MASK = 0xffffffff

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
  props?: ElementProps,
  children?: Node[],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  const ctx = getRenderContext()

  if (props) {
    for (const [rawKey, value] of Object.entries(props)) {
      if (rawKey === 'key') continue

      // Event handler
      if (/^on[A-Z]/.test(rawKey)) {
        const eventName = rawKey.slice(2).toLowerCase()
        el.addEventListener(eventName, value as EventListener)
        continue
      }

      // Reactive binding — value is a function
      if (typeof value === 'function') {
        const kind = classifyKind(rawKey)
        const key = resolveKey(rawKey, kind)
        const accessor = value as (state: never) => unknown

        const binding = createBinding(ctx.rootScope, {
          mask: FULL_MASK, // uncompiled — no mask info, re-evaluate every time
          accessor,
          kind,
          node: el,
          key,
          perItem: false,
        })

        const initialValue = accessor(ctx.state as never)
        binding.lastValue = initialValue
        applyBinding({ kind, node: el, key }, initialValue)
        continue
      }

      // Static prop
      const kind = classifyKind(rawKey)
      const key = resolveKey(rawKey, kind)
      applyBinding({ kind, node: el, key }, value)
    }
  }

  if (children) {
    for (const child of children) {
      el.appendChild(child)
    }
  }

  return el
}

// prettier-ignore
export const a = (props?: ElementProps, children?: Node[]) => createElement('a', props, children)
// prettier-ignore
export const abbr = (props?: ElementProps, children?: Node[]) => createElement('abbr', props, children)
// prettier-ignore
export const article = (props?: ElementProps, children?: Node[]) => createElement('article', props, children)
// prettier-ignore
export const aside = (props?: ElementProps, children?: Node[]) => createElement('aside', props, children)
// prettier-ignore
export const b = (props?: ElementProps, children?: Node[]) => createElement('b', props, children)
// prettier-ignore
export const blockquote = (props?: ElementProps, children?: Node[]) => createElement('blockquote', props, children)
// prettier-ignore
export const br = (props?: ElementProps) => createElement('br', props)
// prettier-ignore
export const button = (props?: ElementProps, children?: Node[]) => createElement('button', props, children)
// prettier-ignore
export const canvas = (props?: ElementProps, children?: Node[]) => createElement('canvas', props, children)
// prettier-ignore
export const code = (props?: ElementProps, children?: Node[]) => createElement('code', props, children)
// prettier-ignore
export const dd = (props?: ElementProps, children?: Node[]) => createElement('dd', props, children)
// prettier-ignore
export const details = (props?: ElementProps, children?: Node[]) => createElement('details', props, children)
// prettier-ignore
export const dialog = (props?: ElementProps, children?: Node[]) => createElement('dialog', props, children)
// prettier-ignore
export const div = (props?: ElementProps, children?: Node[]) => createElement('div', props, children)
// prettier-ignore
export const dl = (props?: ElementProps, children?: Node[]) => createElement('dl', props, children)
// prettier-ignore
export const dt = (props?: ElementProps, children?: Node[]) => createElement('dt', props, children)
// prettier-ignore
export const em = (props?: ElementProps, children?: Node[]) => createElement('em', props, children)
// prettier-ignore
export const fieldset = (props?: ElementProps, children?: Node[]) => createElement('fieldset', props, children)
// prettier-ignore
export const figcaption = (props?: ElementProps, children?: Node[]) => createElement('figcaption', props, children)
// prettier-ignore
export const figure = (props?: ElementProps, children?: Node[]) => createElement('figure', props, children)
// prettier-ignore
export const footer = (props?: ElementProps, children?: Node[]) => createElement('footer', props, children)
// prettier-ignore
export const form = (props?: ElementProps, children?: Node[]) => createElement('form', props, children)
// prettier-ignore
export const h1 = (props?: ElementProps, children?: Node[]) => createElement('h1', props, children)
// prettier-ignore
export const h2 = (props?: ElementProps, children?: Node[]) => createElement('h2', props, children)
// prettier-ignore
export const h3 = (props?: ElementProps, children?: Node[]) => createElement('h3', props, children)
// prettier-ignore
export const h4 = (props?: ElementProps, children?: Node[]) => createElement('h4', props, children)
// prettier-ignore
export const h5 = (props?: ElementProps, children?: Node[]) => createElement('h5', props, children)
// prettier-ignore
export const h6 = (props?: ElementProps, children?: Node[]) => createElement('h6', props, children)
// prettier-ignore
export const header = (props?: ElementProps, children?: Node[]) => createElement('header', props, children)
// prettier-ignore
export const hr = (props?: ElementProps) => createElement('hr', props)
// prettier-ignore
export const i = (props?: ElementProps, children?: Node[]) => createElement('i', props, children)
// prettier-ignore
export const iframe = (props?: ElementProps, children?: Node[]) => createElement('iframe', props, children)
// prettier-ignore
export const img = (props?: ElementProps) => createElement('img', props)
// prettier-ignore
export const input = (props?: ElementProps) => createElement('input', props)
// prettier-ignore
export const label = (props?: ElementProps, children?: Node[]) => createElement('label', props, children)
// prettier-ignore
export const legend = (props?: ElementProps, children?: Node[]) => createElement('legend', props, children)
// prettier-ignore
export const li = (props?: ElementProps, children?: Node[]) => createElement('li', props, children)
// prettier-ignore
export const main = (props?: ElementProps, children?: Node[]) => createElement('main', props, children)
// prettier-ignore
export const mark = (props?: ElementProps, children?: Node[]) => createElement('mark', props, children)
// prettier-ignore
export const nav = (props?: ElementProps, children?: Node[]) => createElement('nav', props, children)
// prettier-ignore
export const ol = (props?: ElementProps, children?: Node[]) => createElement('ol', props, children)
// prettier-ignore
export const optgroup = (props?: ElementProps, children?: Node[]) => createElement('optgroup', props, children)
// prettier-ignore
export const option = (props?: ElementProps, children?: Node[]) => createElement('option', props, children)
// prettier-ignore
export const output = (props?: ElementProps, children?: Node[]) => createElement('output', props, children)
// prettier-ignore
export const p = (props?: ElementProps, children?: Node[]) => createElement('p', props, children)
// prettier-ignore
export const pre = (props?: ElementProps, children?: Node[]) => createElement('pre', props, children)
// prettier-ignore
export const progress = (props?: ElementProps, children?: Node[]) => createElement('progress', props, children)
// prettier-ignore
export const section = (props?: ElementProps, children?: Node[]) => createElement('section', props, children)
// prettier-ignore
export const select = (props?: ElementProps, children?: Node[]) => createElement('select', props, children)
// prettier-ignore
export const small = (props?: ElementProps, children?: Node[]) => createElement('small', props, children)
// prettier-ignore
export const span = (props?: ElementProps, children?: Node[]) => createElement('span', props, children)
// prettier-ignore
export const strong = (props?: ElementProps, children?: Node[]) => createElement('strong', props, children)
// prettier-ignore
export const sub = (props?: ElementProps, children?: Node[]) => createElement('sub', props, children)
// prettier-ignore
export const summary = (props?: ElementProps, children?: Node[]) => createElement('summary', props, children)
// prettier-ignore
export const sup = (props?: ElementProps, children?: Node[]) => createElement('sup', props, children)
// prettier-ignore
export const table = (props?: ElementProps, children?: Node[]) => createElement('table', props, children)
// prettier-ignore
export const tbody = (props?: ElementProps, children?: Node[]) => createElement('tbody', props, children)
// prettier-ignore
export const td = (props?: ElementProps, children?: Node[]) => createElement('td', props, children)
// prettier-ignore
export const textarea = (props?: ElementProps, children?: Node[]) => createElement('textarea', props, children)
// prettier-ignore
export const tfoot = (props?: ElementProps, children?: Node[]) => createElement('tfoot', props, children)
// prettier-ignore
export const th = (props?: ElementProps, children?: Node[]) => createElement('th', props, children)
// prettier-ignore
export const thead = (props?: ElementProps, children?: Node[]) => createElement('thead', props, children)
// prettier-ignore
export const time = (props?: ElementProps, children?: Node[]) => createElement('time', props, children)
// prettier-ignore
export const tr = (props?: ElementProps, children?: Node[]) => createElement('tr', props, children)
// prettier-ignore
export const ul = (props?: ElementProps, children?: Node[]) => createElement('ul', props, children)
// prettier-ignore
export const video = (props?: ElementProps, children?: Node[]) => createElement('video', props, children)
