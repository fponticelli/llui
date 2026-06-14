// Default inline-level renderers: text, emphasis, strong, delete, inlineCode,
// link, image, break, html, and reference variants.

import { text, em, strong, code, a, img, span, br, el, unsafeHtml } from '@llui/dom'
import type { ChildNode, Mountable } from '@llui/dom'
import type {
  Text,
  Emphasis,
  Strong,
  Delete,
  InlineCode,
  Link,
  Image,
  Break,
  Html,
  LinkReference,
  ImageReference,
} from 'mdast'
import type { NodeRenderer } from '../types.js'
import { resolveUrl, sanitizeUrl } from '../security.js'

/** Generic element helper for tags @llui/dom doesn't export by name (e.g. `del`). */
function tag(name: string) {
  return (props: Record<string, string>, children: readonly ChildNode[] = []): Mountable =>
    el(name, props, children)
}
const del = tag('del')

const renderText: NodeRenderer<Text> = (node) => [text(node.value)]

const renderEmphasis: NodeRenderer<Emphasis> = (node, ctx) => [em(ctx.renderChildren(node))]

const renderStrong: NodeRenderer<Strong> = (node, ctx) => [strong(ctx.renderChildren(node))]

const renderDelete: NodeRenderer<Delete> = (node, ctx) => [del({}, ctx.renderChildren(node))]

const renderInlineCode: NodeRenderer<InlineCode> = (node) => [code([text(node.value)])]

const renderBreak: NodeRenderer<Break> = () => [br([])]

const renderLink: NodeRenderer<Link> = (node, ctx) => {
  const href = resolveUrl(node.url, node, ctx.options)
  const children = ctx.renderChildren(node)
  if (href === null) return [span(children)] // neutralized → keep the visible text
  const props: Record<string, string> = { href }
  if (node.title) props.title = node.title
  return [a(props, children)]
}

const renderImage: NodeRenderer<Image> = (node, ctx) => {
  const src = resolveUrl(node.url, node, ctx.options)
  if (src === null) return [] // blocked → drop the image
  const props: Record<string, string> = { src, alt: node.alt ?? '' }
  if (node.title) props.title = node.title
  return [img(props)]
}

const renderHtml: NodeRenderer<Html> = (node, ctx) => {
  // Raw HTML is dropped by default (safe for untrusted/LLM content). It
  // renders only when the consumer supplies a `sanitizeHtml` hook, which
  // sees the raw string and returns the safe HTML to inject — there is
  // no unsanitized passthrough.
  const sanitize = ctx.options.sanitizeHtml
  if (!sanitize) return []
  return [unsafeHtml(sanitize(node.value))]
}

const renderLinkReference: NodeRenderer<LinkReference> = (node, ctx) => {
  const def = ctx.definitions.get(node.identifier.toLowerCase())
  const children = ctx.renderChildren(node)
  if (!def) return children // unresolved reference → render its label text
  const href = sanitizeUrl(def.url, ctx.options.allowedProtocols)
  if (href === null) return [span(children)]
  const props: Record<string, string> = { href }
  if (def.title) props.title = def.title
  return [a(props, children)]
}

const renderImageReference: NodeRenderer<ImageReference> = (node, ctx) => {
  const def = ctx.definitions.get(node.identifier.toLowerCase())
  if (!def) return [text(node.alt ?? '')]
  const src = sanitizeUrl(def.url, ctx.options.allowedProtocols)
  if (src === null) return []
  const props: Record<string, string> = { src, alt: node.alt ?? '' }
  if (def.title) props.title = def.title
  return [img(props)]
}

export const inlineRenderers = {
  text: renderText,
  emphasis: renderEmphasis,
  strong: renderStrong,
  delete: renderDelete,
  inlineCode: renderInlineCode,
  break: renderBreak,
  link: renderLink,
  image: renderImage,
  html: renderHtml,
  linkReference: renderLinkReference,
  imageReference: renderImageReference,
}
