/**
 * The A2UI "Basic" catalog, rendered on LLui.
 *
 * Layout + display components render as semantic HTML; interactive components
 * are layered onto `@llui/components` headless primitives in `./interactive.js`
 * (composed in via `defineCatalog({ extends })`). This module holds the
 * display/layout half and the shared builder helpers.
 */

import { button, div, hr, img, el, span, text, type Mountable, type PropValue } from '@llui/dom'
import type { BuildArgs, ComponentBuilder } from '../catalog.js'
import { bindString, resolveDynamic } from '../binding.js'
import type { Action, ComponentNode, JsonObject, JsonValue } from '../protocol.js'
import { isFunctionCall } from '../protocol.js'

// ── shared helpers ─────────────────────────────────────────────────

/** `el` with a prop bag that may carry signal handles the type can't express. */
export function elx(
  tag: string,
  props: Record<string, unknown>,
  children: readonly (Mountable | string | number)[] = [],
): Mountable {
  return el(tag, props as Record<string, PropValue>, children)
}

/** Layout style shared by every component: `weight` → flex-grow, `align` → self. */
export function layoutStyle(node: ComponentNode, extra = ''): string {
  const parts: string[] = []
  const weight = node.weight
  if (typeof weight === 'number') parts.push(`flex: ${weight}`)
  if (extra) parts.push(extra)
  return parts.join('; ')
}

const JUSTIFY: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  spaceBetween: 'space-between',
  spaceAround: 'space-around',
  spaceEvenly: 'space-evenly',
  stretch: 'stretch',
}
const ALIGN: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
}

function flexStyle(node: ComponentNode, direction: 'row' | 'column'): string {
  const parts = [`display: flex`, `flex-direction: ${direction}`, `gap: var(--a2ui-gap, 0.5rem)`]
  const justify = JUSTIFY[String(node.justify)]
  const align = ALIGN[String(node.align)]
  if (justify) parts.push(`justify-content: ${justify}`)
  if (align) parts.push(`align-items: ${align}`)
  return layoutStyle(node, parts.join('; '))
}

/** Dispatch a component action (server event and/or local function call). */
export function runAction({ node, ctx, scope }: BuildArgs): void {
  const action = node.action as Action | undefined
  if (!action) return
  if (action.event) {
    const context: Record<string, JsonValue> = {}
    for (const [key, value] of Object.entries(action.event.context ?? {})) {
      context[key] = resolveDynamic(ctx, scope, value) ?? null
    }
    ctx.send({
      type: 'action',
      surfaceId: ctx.surfaceId,
      sourceComponentId: node.id,
      name: action.event.name,
      context: context as JsonObject,
    })
  }
  if (action.functionCall && isFunctionCall(action.functionCall)) {
    const call = action.functionCall
    if (call.call === 'openUrl') {
      const url = resolveDynamic(ctx, scope, call.args?.url)
      if (typeof url === 'string' && typeof window !== 'undefined') window.open(url, '_blank')
    }
  }
}

// ── display / layout builders ──────────────────────────────────────

const VARIANT_TAG: Record<string, string> = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h5',
  caption: 'small',
  body: 'p',
}

const Text: ComponentBuilder = ({ node, ctx, scope }) => {
  const variant = typeof node.variant === 'string' ? node.variant : 'body'
  const tag = VARIANT_TAG[variant] ?? 'p'
  return [
    elx(tag, { class: `a2ui-text a2ui-text-${variant}`, style: layoutStyle(node) }, [
      text(bindString(ctx, scope, node.text as never)),
    ]),
  ]
}

const Image: ComponentBuilder = ({ node, ctx, scope }) => {
  const objectFit = typeof node.fit === 'string' ? `object-fit: ${node.fit}` : ''
  return [
    img({
      class: `a2ui-image${node.variant ? ` a2ui-image-${node.variant}` : ''}`,
      src: bindString(ctx, scope, node.url as never),
      alt: bindString(ctx, scope, node.description as never),
      style: layoutStyle(node, objectFit),
    }),
  ]
}

const Icon: ComponentBuilder = ({ node }) => {
  const name = typeof node.name === 'string' ? node.name : ''
  return [
    span({
      class: 'a2ui-icon',
      'data-icon': name,
      role: 'img',
      'aria-label': name,
    }),
  ]
}

const Video: ComponentBuilder = ({ node, ctx, scope }) => [
  elx('video', {
    class: 'a2ui-video',
    src: bindString(ctx, scope, node.url as never),
    controls: true,
    style: layoutStyle(node),
  }),
]

const AudioPlayer: ComponentBuilder = ({ node, ctx, scope }) => [
  elx('audio', {
    class: 'a2ui-audio',
    src: bindString(ctx, scope, node.url as never),
    controls: true,
    'aria-label': bindString(ctx, scope, node.description as never),
  }),
]

const Row: ComponentBuilder = ({ node, ctx, scope }) => [
  elx(
    'div',
    { class: 'a2ui-row', style: flexStyle(node, 'row') },
    ctx.renderChildren(node.children as never, scope),
  ),
]

const Column: ComponentBuilder = ({ node, ctx, scope }) => [
  elx(
    'div',
    { class: 'a2ui-column', style: flexStyle(node, 'column') },
    ctx.renderChildren(node.children as never, scope),
  ),
]

const List: ComponentBuilder = ({ node, ctx, scope }) => {
  const direction = node.direction === 'horizontal' ? 'row' : 'column'
  return [
    elx(
      'div',
      { class: 'a2ui-list', role: 'list', style: flexStyle(node, direction) },
      ctx.renderChildren(node.children as never, scope),
    ),
  ]
}

const Card: ComponentBuilder = ({ node, ctx, scope }) => {
  const childId = typeof node.child === 'string' ? node.child : undefined
  return [
    div(
      { class: 'a2ui-card', style: layoutStyle(node) },
      childId ? ctx.renderById(childId, scope) : [],
    ),
  ]
}

const Divider: ComponentBuilder = ({ node }) => {
  const vertical = node.axis === 'vertical'
  return [hr({ class: `a2ui-divider a2ui-divider-${vertical ? 'vertical' : 'horizontal'}` })]
}

const Button: ComponentBuilder = (args) => {
  const { node, ctx, scope } = args
  const childId = typeof node.child === 'string' ? node.child : undefined
  const variant = typeof node.variant === 'string' ? node.variant : 'default'
  return [
    button(
      {
        class: `a2ui-button a2ui-button-${variant}`,
        type: 'button',
        style: layoutStyle(node),
        onClick: () => runAction(args),
      },
      childId ? ctx.renderById(childId, scope) : [],
    ),
  ]
}

/** The display/layout half of the Basic catalog. */
export const displayComponents: Readonly<Record<string, ComponentBuilder>> = {
  Text,
  Image,
  Icon,
  Video,
  AudioPlayer,
  Row,
  Column,
  List,
  Card,
  Divider,
  Button,
}
