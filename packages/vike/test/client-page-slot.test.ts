// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { component, div, text } from '@llui/dom'
import { pageSlot } from '../src/page-slot.js'
import {
  createOnRenderClient,
  _resetChainForTest,
  _mountChainSuffix,
} from '../src/on-render-client.js'

// ──── Fixtures ────

type LayoutS = { count: number }
type LayoutM = { type: 'lc' }
const Layout = component<LayoutS, LayoutM, never>({
  name: 'TestLayout',
  init: () => ({ count: 0 }),
  update: (s) => s,
  view: ({ state }) => [
    div({ class: 'shell' }, [text(state.map((s) => 'L:' + s.count)), pageSlot()]),
  ],
})

type PageAS = { title: string }
const PageA = component<PageAS, never, never>({
  name: 'PageA',
  init: () => ({ title: 'a' }),
  update: (s) => s,
  view: ({ state }) => [div({ class: 'page-a' }, [text(state.map((s) => s.title))])],
})

type PageBS = { title: string }
const PageB = component<PageBS, never, never>({
  name: 'PageB',
  init: () => ({ title: 'b' }),
  update: (s) => s,
  view: ({ state }) => [div({ class: 'page-b' }, [text(state.map((s) => s.title))])],
})

// Layout that places consumer siblings BOTH before and after pageSlot() in the
// same parent — the arrangement the docs now bless (e.g. a nav-loading bar +
// footer beside the page, no `display: contents` wrapper).
const LayoutWithSiblings = component<LayoutS, LayoutM, never>({
  name: 'TestLayoutSiblings',
  init: () => ({ count: 0 }),
  update: (s) => s,
  view: () => [
    div({ class: 'shell-sib' }, [
      div({ class: 'nav-bar' }, [text('loader')]), // sibling BEFORE the slot
      pageSlot(),
      div({ class: 'footer' }, [text('footer')]), // sibling AFTER the end sentinel
    ]),
  ],
})

// Helper: find a Comment node by its nodeValue anywhere in a subtree.
function findCommentByValue(root: Node, value: string): Comment | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_COMMENT)
  let n: Node | null = walker.nextNode()
  while (n !== null) {
    if ((n as Comment).nodeValue === value) return n as Comment
    n = walker.nextNode()
  }
  return null
}

describe('client pageSlot with comment anchor', () => {
  beforeEach(() => {
    _resetChainForTest()
    document.body.innerHTML = '<div id="app"></div>'
    delete (window as Record<string, unknown>).__LLUI_STATE__
  })

  it('hydrate: swaps server content for client content between anchor and end sentinel', async () => {
    const root = document.getElementById('app')!
    // Simulate SSR-emitted HTML: layout shell wrapping anchor + page content + end sentinel.
    root.innerHTML =
      '<div class="shell">L:0' +
      '<!--llui-page-slot-->' +
      '<div class="page-a">a-from-server</div>' +
      '<!--llui-mount-end-->' +
      '</div>'

    // Set up the hydration state envelope that the adapter expects.
    ;(window as Record<string, unknown>).__LLUI_STATE__ = {
      layouts: [{ name: 'TestLayout', state: { count: 0 } }],
      page: { name: 'PageA', state: { title: 'a' } },
    }

    const render = createOnRenderClient({ Layout })
    await render({ Page: PageA, isHydration: true })

    // After hydrate, the page-a div should still exist (re-rendered by client).
    expect(root.querySelector('.page-a')).not.toBeNull()

    // The comment anchor (llui-page-slot) must still be present — the
    // anchor is the start of the owned region and must be preserved.
    const anchor = findCommentByValue(root, 'llui-page-slot')
    expect(anchor).not.toBeNull()

    // The end sentinel must be present too.
    const endSentinel = findCommentByValue(root, 'llui-mount-end')
    expect(endSentinel).not.toBeNull()

    // Order invariant: anchor before page-a before end sentinel.
    const shell = root.querySelector('.shell')!
    const childNodes = Array.from(shell.childNodes)
    const anchorIdx = childNodes.indexOf(anchor!)
    const pageIdx = childNodes.indexOf(root.querySelector('.page-a')!)
    const endIdx = childNodes.indexOf(endSentinel!)
    expect(anchorIdx).toBeGreaterThanOrEqual(0)
    expect(pageIdx).toBeGreaterThan(anchorIdx)
    expect(endIdx).toBeGreaterThan(pageIdx)
  })

  it('nav: swapping the innermost page preserves the layout DOM and anchor identity', async () => {
    const render = createOnRenderClient({ Layout })

    // First mount — layout + PageA.
    await render({ Page: PageA, isHydration: false })

    const root = document.getElementById('app')!
    const shellBefore = root.querySelector('.shell')
    expect(shellBefore).not.toBeNull()
    expect(root.querySelector('.page-a')).not.toBeNull()

    // Capture anchor identity before nav.
    const anchorBefore = findCommentByValue(root, 'llui-page-slot')
    expect(anchorBefore).not.toBeNull()

    // Navigate to PageB — same Layout, different innermost.
    await render({ Page: PageB, isHydration: false })

    // Layout DOM node identity must be unchanged — same object reference.
    expect(root.querySelector('.shell')).toBe(shellBefore)

    // Old page is gone, new page is present.
    expect(root.querySelector('.page-a')).toBeNull()
    expect(root.querySelector('.page-b')).not.toBeNull()

    // Anchor identity must be preserved — the comment node is owned by
    // the layout's slot and must not be recreated on nav.
    const anchorAfter = findCommentByValue(root, 'llui-page-slot')
    expect(anchorAfter).toBe(anchorBefore)
  })

  it('nav: consumer siblings placed before AND after pageSlot() survive a page swap', async () => {
    const render = createOnRenderClient({ Layout: LayoutWithSiblings })

    // First mount — layout (with siblings) + PageA.
    await render({ Page: PageA, isHydration: false })

    const root = document.getElementById('app')!
    const navBarBefore = root.querySelector('.nav-bar')
    const footerBefore = root.querySelector('.footer')
    expect(navBarBefore).not.toBeNull()
    expect(footerBefore).not.toBeNull()
    expect(root.querySelector('.page-a')).not.toBeNull()

    // Order invariant: nav-bar (sibling) → anchor → page-a → end sentinel → footer.
    const shell = root.querySelector('.shell-sib')!
    const order = Array.from(shell.childNodes)
    const navIdx = order.indexOf(navBarBefore!)
    const anchorIdx = order.indexOf(findCommentByValue(shell, 'llui-page-slot')!)
    const pageIdx = order.indexOf(root.querySelector('.page-a')!)
    const endIdx = order.indexOf(findCommentByValue(shell, 'llui-mount-end')!)
    const footerIdx = order.indexOf(footerBefore!)
    expect(navIdx).toBeLessThan(anchorIdx)
    expect(anchorIdx).toBeLessThan(pageIdx)
    expect(pageIdx).toBeLessThan(endIdx)
    expect(endIdx).toBeLessThan(footerIdx)

    // Navigate to PageB — only the slot region swaps.
    await render({ Page: PageB, isHydration: false })

    // Both consumer siblings keep their exact node identity across the nav…
    expect(root.querySelector('.nav-bar')).toBe(navBarBefore)
    expect(root.querySelector('.footer')).toBe(footerBefore)
    // …while the page region swapped underneath them.
    expect(root.querySelector('.page-a')).toBeNull()
    expect(root.querySelector('.page-b')).not.toBeNull()
  })

  it('dispose of an anchor-mounted layer removes its region but not outer siblings', async () => {
    const root = document.getElementById('app')!

    // Mount directly into the shell parent by calling _mountChainSuffix
    // with a hand-built anchor. This verifies the anchor-based dispose
    // contract without going through the full nav cycle.
    const parent = document.createElement('div')
    parent.className = 'outer'
    document.getElementById('app')!.appendChild(parent)

    const outerText = document.createTextNode('outer-sibling')
    parent.appendChild(outerText)

    const anchor = document.createComment('llui-page-slot')
    parent.appendChild(anchor)

    const afterText = document.createTextNode('after-sibling')
    parent.appendChild(afterText)

    // Mount PageA at the anchor.
    _mountChainSuffix([PageA], [undefined], 0, anchor, undefined, { mode: 'mount' })

    // PageA's content appears between the anchor and end sentinel.
    expect(parent.querySelector('.page-a')).not.toBeNull()

    // Outer siblings are untouched.
    expect(parent.childNodes[0]).toBe(outerText)
    expect(parent.lastChild).toBe(afterText)

    // Dispose by resetting — disposes all layers in chainHandles.
    _resetChainForTest()

    // PageA's content is removed.
    expect(parent.querySelector('.page-a')).toBeNull()

    // The anchor and the outer/after text nodes remain.
    expect(anchor.parentNode).toBe(parent)
    expect(parent.childNodes[0]).toBe(outerText)
    expect(parent.lastChild).toBe(afterText)
  })
})
