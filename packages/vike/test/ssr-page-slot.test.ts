// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { browserEnv } from '@llui/dom/ssr'
import { component, div, text, renderNodes } from '@llui/dom'
import type { SignalComponentDef } from '@llui/dom'
import { pageSlot } from '../src/page-slot.js'
import { _renderChain } from '../src/on-render-html.js'

const env = browserEnv()

// ──── Fixtures ────

type LayoutState = { title: string }
function makeSimpleLayout(): SignalComponentDef<LayoutState, never, never> {
  return {
    name: 'SimpleLayout',
    init: () => ({ title: 'My Site' }),
    update: (s) => s,
    view: ({ state }) => [
      div({ class: 'layout' }, [
        div({ class: 'header' }, [text(state.map((s) => s.title))]),
        div({ class: 'content' }, [pageSlot()]),
      ]),
    ],
  }
}

type PageState = { label: string }
function makeSimplePage(): SignalComponentDef<PageState, never, never> {
  return {
    name: 'SimplePage',
    init: () => ({ label: 'hello' }),
    update: (s) => s,
    view: ({ state }) => [div({ class: 'page' }, [text(state.map((s) => s.label))])],
  }
}

// Minimal layout that only emits the slot (no wrapping element), so we
// can inspect sibling structure directly.
function makeSlotOnlyLayout(): SignalComponentDef<Record<string, never>, never, never> {
  return {
    name: 'SlotOnlyLayout',
    init: () => ({}),
    update: (s) => s,
    view: () => [pageSlot()],
  }
}

// ──── Tests ────

describe('pageSlot() node shape', () => {
  it('returns a Comment node with nodeValue "llui-page-slot"', () => {
    const Layout = makeSlotOnlyLayout()
    // renderNodes runs the layout's view inside a signal build, so pageSlot()
    // can read the in-progress build via __currentBuildInfo() and emit its
    // anchor comment. Pass undefined for state → init() provides the seed.
    const { nodes } = renderNodes(Layout, undefined, env)

    // The slot-only layout's view returns exactly the pageSlot() result.
    // We expect a single Comment node.
    expect(nodes).toHaveLength(1)
    const node = nodes[0]!
    expect(node.nodeType).toBe(8) // Node.COMMENT_NODE
    expect((node as Comment).nodeValue).toBe('llui-page-slot')
  })
})

describe('_renderChain — two-layer render', () => {
  it('emits anchor → page content → end sentinel in composed HTML', () => {
    const Layout = makeSimpleLayout()
    const Page = makeSimplePage()

    const { html } = _renderChain([Layout, Page], [undefined, undefined], env)

    // The comment anchor must appear before the page div.
    const anchorPos = html.indexOf('<!--llui-page-slot-->')
    const pagePos = html.indexOf('class="page"')
    const endPos = html.indexOf('<!--llui-mount-end-->')

    expect(anchorPos, 'anchor comment not found in html').toBeGreaterThanOrEqual(0)
    expect(pagePos, 'page div not found in html').toBeGreaterThanOrEqual(0)
    expect(endPos, 'end sentinel not found in html').toBeGreaterThanOrEqual(0)

    // Order: anchor → page → end sentinel
    expect(anchorPos).toBeLessThan(pagePos)
    expect(pagePos).toBeLessThan(endPos)
  })

  it('serializes both layers dynamic content into the composed tree (no hydrate markers)', () => {
    // Signal hydration rebuilds the deterministic tree client-side and swaps it
    // in atomically — it does NOT claim server nodes, so the serializer emits
    // PLAIN HTML with no `data-llui-hydrate` markers (the legacy claim-marker
    // approach is gone). The composed tree must still carry both layers'
    // dynamically-bound text, rendered against their seed state.
    const Layout = makeSimpleLayout()
    const Page = makeSimplePage()

    const { html } = _renderChain([Layout, Page], [undefined, undefined], env)

    // Layout header dynamic text and page div dynamic text both appear.
    expect(html).toContain('<div class="header">My Site</div>')
    expect(html).toContain('<div class="page">hello</div>')
    // No claim markers in the signal serializer output.
    expect(html).not.toContain('data-llui-hydrate')
  })
})
