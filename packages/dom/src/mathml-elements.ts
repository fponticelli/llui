import type { BindingKind } from './types'
import { getRenderContext } from './render-context'
import { createBinding, applyBinding } from './binding'
import { FULL_MASK } from './update-loop'

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'

type ElementProps = Record<string, unknown>
type Child = Node | string | Node[]
type Children = Child[]

function createMathmlElement(
  tag: string,
  propsOrChildren?: ElementProps | Children,
  maybeChildren?: Children,
): MathMLElement {
  const el = document.createElementNS(MATHML_NS, tag) as MathMLElement
  const ctx = getRenderContext()

  const props: ElementProps | undefined = Array.isArray(propsOrChildren)
    ? undefined
    : propsOrChildren
  const children: Children | undefined = Array.isArray(propsOrChildren)
    ? propsOrChildren
    : maybeChildren

  if (props) {
    for (const [rawKey, value] of Object.entries(props)) {
      if (rawKey === 'key') continue

      if (/^on[A-Z]/.test(rawKey)) {
        const eventName = rawKey.slice(2).toLowerCase()
        el.addEventListener(eventName, value as EventListener)
        continue
      }

      if (typeof value === 'function') {
        const kind: BindingKind = rawKey === 'class' || rawKey === 'className' ? 'class' : 'attr'
        const key = kind === 'class' ? undefined : rawKey
        const accessor = value as (state: never) => unknown
        const perItem = value.length === 0

        const binding = createBinding(ctx.rootScope, {
          mask: FULL_MASK,
          accessor,
          kind,
          node: el,
          key,
          perItem,
        })

        const initialValue = perItem ? (value as () => unknown)() : accessor(ctx.state as never)
        binding.lastValue = initialValue
        applyBinding({ kind, node: el, key }, initialValue)
        continue
      }

      if (rawKey === 'class' || rawKey === 'className') {
        applyBinding({ kind: 'class', node: el, key: undefined }, value)
      } else {
        applyBinding({ kind: 'attr', node: el, key: rawKey }, value)
      }
    }
  }

  if (children) {
    for (const child of children) {
      if (typeof child === 'string') {
        el.appendChild(document.createTextNode(child))
      } else if (Array.isArray(child)) {
        for (const node of child) el.appendChild(node)
      } else {
        el.appendChild(child)
      }
    }
  }

  return el
}

type MathElFn = {
  (): MathMLElement
  (props: ElementProps, children?: Children): MathMLElement
  (children: Children): MathMLElement
}

type MathVoidElFn = {
  (): MathMLElement
  (props: ElementProps): MathMLElement
}

/* v8 ignore start — mechanical tag wrappers */
// Top-level
// prettier-ignore
export const math = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('math', p, c)) as MathElFn

// Token elements
// prettier-ignore
export const mi = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('mi', p, c)) as MathElFn
// prettier-ignore
export const mn = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('mn', p, c)) as MathElFn
// prettier-ignore
export const mo = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('mo', p, c)) as MathElFn
// prettier-ignore
export const ms = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('ms', p, c)) as MathElFn
// prettier-ignore
export const mtext = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('mtext', p, c)) as MathElFn

// Layout
// prettier-ignore
export const mrow = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('mrow', p, c)) as MathElFn
// prettier-ignore
export const mfrac = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('mfrac', p, c)) as MathElFn
// prettier-ignore
export const msqrt = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('msqrt', p, c)) as MathElFn
// prettier-ignore
export const mroot = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('mroot', p, c)) as MathElFn
// prettier-ignore
export const msup = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('msup', p, c)) as MathElFn
// prettier-ignore
export const msub = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('msub', p, c)) as MathElFn
// prettier-ignore
export const msubsup = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('msubsup', p, c)) as MathElFn
// prettier-ignore
export const munder = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('munder', p, c)) as MathElFn
// prettier-ignore
export const mover = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('mover', p, c)) as MathElFn
// prettier-ignore
export const munderover = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('munderover', p, c)) as MathElFn
// prettier-ignore
export const mmultiscripts = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('mmultiscripts', p, c)) as MathElFn
// prettier-ignore
export const mprescripts = ((p?: ElementProps) => createMathmlElement('mprescripts', p)) as MathVoidElFn
// prettier-ignore
export const mnone = ((p?: ElementProps) => createMathmlElement('none', p)) as MathVoidElFn

// Table
// prettier-ignore
export const mtable = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('mtable', p, c)) as MathElFn
// prettier-ignore
export const mtr = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('mtr', p, c)) as MathElFn
// prettier-ignore
export const mtd = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('mtd', p, c)) as MathElFn

// Spacing / visual
// prettier-ignore
export const mspace = ((p?: ElementProps) => createMathmlElement('mspace', p)) as MathVoidElFn
// prettier-ignore
export const mpadded = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('mpadded', p, c)) as MathElFn
// prettier-ignore
export const mphantom = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('mphantom', p, c)) as MathElFn
// prettier-ignore
export const menclose = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('menclose', p, c)) as MathElFn
// prettier-ignore
export const merror = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('merror', p, c)) as MathElFn

// Interactive
// prettier-ignore
export const maction = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('maction', p, c)) as MathElFn

// Semantics
// prettier-ignore
export const semantics = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('semantics', p, c)) as MathElFn
// prettier-ignore
export const annotation = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('annotation', p, c)) as MathElFn
// prettier-ignore
export const annotationXml = ((p?: ElementProps | Children, c?: Children) => createMathmlElement('annotation-xml', p, c)) as MathElFn
/* v8 ignore stop */
