import { describe, it, expect, afterEach } from 'vitest'
import { div, span } from '@llui/dom'
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough'
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough'
import { mountStatic, body } from './util.js'
import type { Mounted } from './util.js'
import type { NodeRenderer } from '../src/index.js'
import type { Heading, Delete } from 'mdast'

let mounted: Mounted | undefined
afterEach(() => mounted?.cleanup())

describe('custom renderers', () => {
  it('overrides a built-in renderer (heading → div.custom-heading)', () => {
    const heading: NodeRenderer<Heading> = (node, ctx) => [
      div({ class: 'custom-heading', 'data-depth': String(node.depth) }, ctx.renderChildren(node)),
    ]
    mounted = mountStatic('# Hello', { renderers: { heading } })
    const root = body(mounted.container)
    expect(root.querySelector('h1')).toBeNull()
    const custom = root.querySelector('.custom-heading')
    expect(custom?.getAttribute('data-depth')).toBe('1')
    expect(custom?.textContent).toBe('Hello')
  })

  it('renders a registered custom node type from a syntax extension', () => {
    // Wire a node type purely via extensions (gfm:false so it's not built in) +
    // a matching renderer — the same mechanism real custom node types use.
    const renderDelete: NodeRenderer<Delete> = (node, ctx) => [
      span({ class: 'redacted' }, ctx.renderChildren(node)),
    ]
    mounted = mountStatic('~~secret~~', {
      gfm: false,
      extensions: [gfmStrikethrough()],
      mdastExtensions: [gfmStrikethroughFromMarkdown()],
      renderers: { delete: renderDelete },
    })
    const root = body(mounted.container)
    const redacted = root.querySelector('.redacted')
    expect(redacted?.textContent).toBe('secret')
  })

  it('falls back to default rendering for non-overridden nodes', () => {
    const heading: NodeRenderer<Heading> = (node, ctx) => [div(ctx.renderChildren(node))]
    mounted = mountStatic('# H\n\nparagraph stays default', { renderers: { heading } })
    expect(body(mounted.container).querySelector('p')?.textContent).toBe('paragraph stays default')
  })
})
