// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { component, div, text, renderNodes } from '@llui/dom'
import type { ComponentDef } from '@llui/dom'
import { pageSlot } from '../src/page-slot.js'
import { _renderChain } from '../src/on-render-html.js'

// ──── Fixtures ────

type LayoutState = { title: string }
function makeSimpleLayout(): ComponentDef<LayoutState, never, never> {
  return {
    name: 'SimpleLayout',
    init: () => [{ title: 'My Site' }, []],
    update: (s) => [s, []],
    view: () => [
      div({ class: 'layout' }, [
        div({ class: 'header' }, [text((s: LayoutState) => s.title)]),
        div({ class: 'content' }, [...pageSlot()]),
      ]),
    ],
  }
}

type PageState = { label: string }
function makeSimplePage(): ComponentDef<PageState, never, never> {
  return {
    name: 'SimplePage',
    init: () => [{ label: 'hello' }, []],
    update: (s) => [s, []],
    view: () => [
      div({ class: 'page' }, [text((s: PageState) => s.label)]),
    ],
  }
}

// Minimal layout that only emits the slot (no wrapping element), so we
// can inspect sibling structure directly.
function makeSlotOnlyLayout(): ComponentDef<{}, never, never> {
  return {
    name: 'SlotOnlyLayout',
    init: () => [{}, []],
    update: (s) => [s, []],
    view: () => [...pageSlot()],
  }
}

// ──── Tests ────

describe('pageSlot() node shape', () => {
  it('returns a Comment node with nodeValue "llui-page-slot"', () => {
    const Layout = makeSlotOnlyLayout()
    const [initialState] = Layout.init(undefined)
    const { nodes } = renderNodes(
      Layout as unknown as Parameters<typeof renderNodes>[0],
      initialState,
    )

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

    const { html } = _renderChain([Layout, Page], [undefined, undefined])

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

  it('places data-llui-hydrate on binding-carrying elements across the composed tree', () => {
    const Layout = makeSimpleLayout()
    const Page = makeSimplePage()

    const { html } = _renderChain([Layout, Page], [undefined, undefined])

    // Both the layout header (has a dynamic text binding) and the page
    // div (has a dynamic text binding) should carry the hydrate marker.
    const headerHydrate = html.match(/<div[^>]*class="header"[^>]*data-llui-hydrate[^>]*>/)
    const pageHydrate = html.match(/<div[^>]*class="page"[^>]*data-llui-hydrate[^>]*>/)

    expect(headerHydrate, 'layout header should have data-llui-hydrate').not.toBeNull()
    expect(pageHydrate, 'page div should have data-llui-hydrate').not.toBeNull()
  })
})
