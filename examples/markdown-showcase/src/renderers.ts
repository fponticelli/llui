// "Fancy" custom renderers, toggled on in the demo, showing per-node overrides:
//   • headings get slug ids + a hover anchor link
//   • blockquotes become styled callouts
//   • fenced code gets a language-badge header bar
// Every node type NOT overridden here keeps its built-in rendering.

import { div, span, a, pre, code, text, figure, figcaption } from '@llui/dom'
import { defaultRenderers, type Renderers, type NodeRenderer } from '@llui/markdown'
import type { Heading, Blockquote, Code, PhrasingContent } from 'mdast'

/** Flatten a heading's inline children to plain text for slug/id generation. */
function plainText(nodes: readonly PhrasingContent[]): string {
  return nodes
    .map((n) => ('value' in n ? n.value : 'children' in n ? plainText(n.children) : ''))
    .join('')
}

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')

const heading: NodeRenderer<Heading> = (node, ctx) => {
  const id = slug(plainText(node.children))
  return [
    span({ class: 'heading-wrap', id }, [
      a({ class: 'heading-anchor', href: `#${id}`, 'aria-hidden': 'true' }, [text('#')]),
      // Reuse the default heading renderer for the correct <h1-6> semantics.
      ...defaultRenderers.heading(node, ctx),
    ]),
  ]
}

const blockquote: NodeRenderer<Blockquote> = (node, ctx) => [
  div({ class: 'callout' }, [
    span({ class: 'callout-icon', 'aria-hidden': 'true' }, [text('💡')]),
    div({ class: 'callout-body' }, ctx.renderChildren(node)),
  ]),
]

const codeRenderer: NodeRenderer<Code> = (node) => {
  const lang = node.lang ?? 'text'
  const codeProps = { class: `language-${lang}` }
  return [
    figure({ class: 'code-block' }, [
      figcaption({ class: 'code-lang' }, [text(lang)]),
      pre([code(codeProps, [text(node.value)])]),
    ]),
  ]
}

export const fancyRenderers: Renderers = {
  heading,
  blockquote,
  code: codeRenderer,
}
