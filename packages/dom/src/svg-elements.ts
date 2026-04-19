import type { BindingKind } from './types.js'
import { getRenderContext } from './render-context.js'
import { createBinding, applyBinding } from './binding.js'
import { FULL_MASK } from './update-loop.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

type ElementProps = Record<string, unknown>
type Child = Node | string | Node[]
type Children = Child[]

function createSvgElement(
  tag: string,
  propsOrChildren?: ElementProps | Children,
  maybeChildren?: Children,
): SVGElement {
  const ctx = getRenderContext()
  const el = ctx.dom.createElementNS(SVG_NS, tag) as SVGElement

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
        el.appendChild(ctx.dom.createTextNode(child))
      } else if (Array.isArray(child)) {
        for (const node of child) el.appendChild(node)
      } else {
        el.appendChild(child)
      }
    }
  }

  return el
}

type SvgElFn = {
  (): SVGElement
  (props: ElementProps, children?: Children): SVGElement
  (children: Children): SVGElement
}

type SvgVoidElFn = {
  (): SVGElement
  (props: ElementProps): SVGElement
}

/* v8 ignore start — mechanical tag wrappers */
// Container / structural
// prettier-ignore
export const svg = ((p?: ElementProps | Children, c?: Children) => createSvgElement('svg', p, c)) as SvgElFn
// prettier-ignore
export const g = ((p?: ElementProps | Children, c?: Children) => createSvgElement('g', p, c)) as SvgElFn
// prettier-ignore
export const defs = ((p?: ElementProps | Children, c?: Children) => createSvgElement('defs', p, c)) as SvgElFn
// prettier-ignore
export const symbol = ((p?: ElementProps | Children, c?: Children) => createSvgElement('symbol', p, c)) as SvgElFn
// prettier-ignore
export const use = ((p?: ElementProps | Children, c?: Children) => createSvgElement('use', p, c)) as SvgElFn

// Shapes
// prettier-ignore
export const circle = ((p?: ElementProps | Children, c?: Children) => createSvgElement('circle', p, c)) as SvgElFn
// prettier-ignore
export const ellipse = ((p?: ElementProps | Children, c?: Children) => createSvgElement('ellipse', p, c)) as SvgElFn
// prettier-ignore
export const line = ((p?: ElementProps | Children, c?: Children) => createSvgElement('line', p, c)) as SvgElFn
// prettier-ignore
export const path = ((p?: ElementProps | Children, c?: Children) => createSvgElement('path', p, c)) as SvgElFn
// prettier-ignore
export const polygon = ((p?: ElementProps) => createSvgElement('polygon', p)) as SvgVoidElFn
// prettier-ignore
export const polyline = ((p?: ElementProps) => createSvgElement('polyline', p)) as SvgVoidElFn
// prettier-ignore
export const rect = ((p?: ElementProps | Children, c?: Children) => createSvgElement('rect', p, c)) as SvgElFn

// Text
// prettier-ignore
export const text = ((p?: ElementProps | Children, c?: Children) => createSvgElement('text', p, c)) as SvgElFn
// prettier-ignore
export const tspan = ((p?: ElementProps | Children, c?: Children) => createSvgElement('tspan', p, c)) as SvgElFn
// prettier-ignore
export const textPath = ((p?: ElementProps | Children, c?: Children) => createSvgElement('textPath', p, c)) as SvgElFn

// Paint server / clipping / masking
// prettier-ignore
export const clipPath = ((p?: ElementProps | Children, c?: Children) => createSvgElement('clipPath', p, c)) as SvgElFn
// prettier-ignore
export const linearGradient = ((p?: ElementProps | Children, c?: Children) => createSvgElement('linearGradient', p, c)) as SvgElFn
// prettier-ignore
export const radialGradient = ((p?: ElementProps | Children, c?: Children) => createSvgElement('radialGradient', p, c)) as SvgElFn
// prettier-ignore
export const stop = ((p?: ElementProps) => createSvgElement('stop', p)) as SvgVoidElFn
// prettier-ignore
export const mask = ((p?: ElementProps | Children, c?: Children) => createSvgElement('mask', p, c)) as SvgElFn
// prettier-ignore
export const pattern = ((p?: ElementProps | Children, c?: Children) => createSvgElement('pattern', p, c)) as SvgElFn
// prettier-ignore
export const marker = ((p?: ElementProps | Children, c?: Children) => createSvgElement('marker', p, c)) as SvgElFn

// Filters
// prettier-ignore
export const filter = ((p?: ElementProps | Children, c?: Children) => createSvgElement('filter', p, c)) as SvgElFn
// prettier-ignore
export const feBlend = ((p?: ElementProps) => createSvgElement('feBlend', p)) as SvgVoidElFn
// prettier-ignore
export const feColorMatrix = ((p?: ElementProps) => createSvgElement('feColorMatrix', p)) as SvgVoidElFn
// prettier-ignore
export const feComponentTransfer = ((p?: ElementProps | Children, c?: Children) => createSvgElement('feComponentTransfer', p, c)) as SvgElFn
// prettier-ignore
export const feComposite = ((p?: ElementProps) => createSvgElement('feComposite', p)) as SvgVoidElFn
// prettier-ignore
export const feConvolveMatrix = ((p?: ElementProps) => createSvgElement('feConvolveMatrix', p)) as SvgVoidElFn
// prettier-ignore
export const feDiffuseLighting = ((p?: ElementProps | Children, c?: Children) => createSvgElement('feDiffuseLighting', p, c)) as SvgElFn
// prettier-ignore
export const feDisplacementMap = ((p?: ElementProps) => createSvgElement('feDisplacementMap', p)) as SvgVoidElFn
// prettier-ignore
export const feDropShadow = ((p?: ElementProps) => createSvgElement('feDropShadow', p)) as SvgVoidElFn
// prettier-ignore
export const feFlood = ((p?: ElementProps) => createSvgElement('feFlood', p)) as SvgVoidElFn
// prettier-ignore
export const feGaussianBlur = ((p?: ElementProps) => createSvgElement('feGaussianBlur', p)) as SvgVoidElFn
// prettier-ignore
export const feImage = ((p?: ElementProps) => createSvgElement('feImage', p)) as SvgVoidElFn
// prettier-ignore
export const feMerge = ((p?: ElementProps | Children, c?: Children) => createSvgElement('feMerge', p, c)) as SvgElFn
// prettier-ignore
export const feMergeNode = ((p?: ElementProps) => createSvgElement('feMergeNode', p)) as SvgVoidElFn
// prettier-ignore
export const feMorphology = ((p?: ElementProps) => createSvgElement('feMorphology', p)) as SvgVoidElFn
// prettier-ignore
export const feOffset = ((p?: ElementProps) => createSvgElement('feOffset', p)) as SvgVoidElFn
// prettier-ignore
export const feSpecularLighting = ((p?: ElementProps | Children, c?: Children) => createSvgElement('feSpecularLighting', p, c)) as SvgElFn
// prettier-ignore
export const feTile = ((p?: ElementProps) => createSvgElement('feTile', p)) as SvgVoidElFn
// prettier-ignore
export const feTurbulence = ((p?: ElementProps) => createSvgElement('feTurbulence', p)) as SvgVoidElFn
// prettier-ignore
export const fePointLight = ((p?: ElementProps) => createSvgElement('fePointLight', p)) as SvgVoidElFn
// prettier-ignore
export const feSpotLight = ((p?: ElementProps) => createSvgElement('feSpotLight', p)) as SvgVoidElFn
// prettier-ignore
export const feDistantLight = ((p?: ElementProps) => createSvgElement('feDistantLight', p)) as SvgVoidElFn
// prettier-ignore
export const feFuncR = ((p?: ElementProps) => createSvgElement('feFuncR', p)) as SvgVoidElFn
// prettier-ignore
export const feFuncG = ((p?: ElementProps) => createSvgElement('feFuncG', p)) as SvgVoidElFn
// prettier-ignore
export const feFuncB = ((p?: ElementProps) => createSvgElement('feFuncB', p)) as SvgVoidElFn
// prettier-ignore
export const feFuncA = ((p?: ElementProps) => createSvgElement('feFuncA', p)) as SvgVoidElFn

// Embedded content
// prettier-ignore
export const image = ((p?: ElementProps | Children, c?: Children) => createSvgElement('image', p, c)) as SvgElFn
// prettier-ignore
export const foreignObject = ((p?: ElementProps | Children, c?: Children) => createSvgElement('foreignObject', p, c)) as SvgElFn

// Animation
// prettier-ignore
export const animate = ((p?: ElementProps) => createSvgElement('animate', p)) as SvgVoidElFn
// prettier-ignore
export const animateMotion = ((p?: ElementProps | Children, c?: Children) => createSvgElement('animateMotion', p, c)) as SvgElFn
// prettier-ignore
export const animateTransform = ((p?: ElementProps) => createSvgElement('animateTransform', p)) as SvgVoidElFn
// prettier-ignore
export const set = ((p?: ElementProps) => createSvgElement('set', p)) as SvgVoidElFn
// prettier-ignore
export const mpath = ((p?: ElementProps) => createSvgElement('mpath', p)) as SvgVoidElFn

// Descriptive
// prettier-ignore
export const desc = ((p?: ElementProps | Children, c?: Children) => createSvgElement('desc', p, c)) as SvgElFn
// prettier-ignore
export const title = ((p?: ElementProps | Children, c?: Children) => createSvgElement('title', p, c)) as SvgElFn
// prettier-ignore
export const metadata = ((p?: ElementProps | Children, c?: Children) => createSvgElement('metadata', p, c)) as SvgElFn
/* v8 ignore stop */
