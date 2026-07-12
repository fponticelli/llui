/**
 * The A2UI "Basic" catalog, rendered on LLui.
 *
 * Layout + display components render as semantic HTML; interactive components
 * are layered onto `@llui/components` headless primitives in `./interactive.js`
 * (composed in via `defineCatalog({ extends })`). This module holds the
 * display/layout half and the shared builder helpers.
 */

import {
  button,
  div,
  hr,
  img,
  el,
  label as labelEl,
  show,
  span,
  text,
  type ChildNode,
  type Mountable,
  type PropValue,
  type Renderable,
  type Signal,
} from '@llui/dom'
import type { BuildArgs, ComponentBuilder } from '../catalog.js'
import { bindString, bindUrl, firstCheckError, resolveDynamic, type Check } from '../binding.js'
import { warnOnce } from '../catalog.js'
import type { Action, ComponentNode, JsonObject, JsonValue } from '../protocol.js'
import { isFunctionCall } from '../protocol.js'
import { MEDIA_PROTOCOLS, safeHttpUrl } from '../security.js'

// ── shared helpers ─────────────────────────────────────────────────

/** `el` with a prop bag that may carry signal handles the type can't express. */
export function elx(
  tag: string,
  props: Record<string, unknown>,
  children: readonly (Mountable | string | number)[] = [],
): Mountable {
  return el(tag, props as Record<string, PropValue>, children)
}

/** A labelled form field: `<label>` wrapping a label span, the control, and an
 * optional reactive validation-error message. Shared by every input builder. */
export function labelledField(
  labelText: Renderable,
  control: Renderable,
  error: Signal<string | null> | null = null,
): Renderable {
  const children: ChildNode[] = [span({ class: 'a2ui-field-label' }, labelText), ...control]
  if (error) {
    children.push(show(error, (e) => [span({ class: 'a2ui-field-error' }, [text(e)])]))
  }
  return [labelEl({ class: 'a2ui-field' }, children)]
}

/** A component's validation checks, if any. */
export function checksOf(node: ComponentNode): Check[] | undefined {
  return Array.isArray(node.checks) ? (node.checks as Check[]) : undefined
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
      if (typeof url === 'string' && typeof window !== 'undefined') {
        // Only open http(s) targets, and never let the opened page reach back
        // via window.opener.
        const safe = safeHttpUrl(url)
        if (safe) window.open(safe, '_blank', 'noopener,noreferrer')
        else warnOnce(`Refusing openUrl to non-http(s) URL "${url}"`)
      }
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
      src: bindUrl(ctx, scope, node.url as never, MEDIA_PROTOCOLS),
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
    src: bindUrl(ctx, scope, node.url as never, MEDIA_PROTOCOLS),
    controls: true,
    style: layoutStyle(node),
  }),
]

const AudioPlayer: ComponentBuilder = ({ node, ctx, scope }) => [
  elx('audio', {
    class: 'a2ui-audio',
    src: bindUrl(ctx, scope, node.url as never, MEDIA_PROTOCOLS),
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
  const checks = Array.isArray(node.checks) ? (node.checks as Check[]) : undefined
  const error = firstCheckError(ctx, scope, checks)
  return [
    button(
      {
        class: `a2ui-button a2ui-button-${variant}`,
        type: 'button',
        style: layoutStyle(node),
        // Disable the button while any check fails.
        disabled: error ? error.map((e) => e !== null) : undefined,
        onClick: () => {
          if (error && error.peek() !== null) return
          runAction(args)
        },
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
