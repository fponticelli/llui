// @vitest-environment jsdom
// #240 — a chain layer is its own build, so it is structurally an island: an
// anonymous head entry (`style()` with no `id`) is keyed by an ordinal, and every
// layer numbering from 1 made a layout's Nth anonymous `<style>` and its page's Nth
// resolve to ONE key, one silently overwriting the other. Each layer therefore
// declares a head namespace derived from its INDEX IN THE CHAIN — the one thing the
// server render and the client mount agree on — so the keys stay distinct AND stay
// equal between the two sides.
import { describe, it, expect, beforeEach } from 'vitest'
import { browserEnv } from '@llui/dom/ssr'
import { div, style, text } from '@llui/dom'
import type { SignalComponentDef } from '@llui/dom'
import { pageSlot } from '../src/page-slot.js'
import { _renderChain } from '../src/on-render-html.js'
import {
  createOnRenderClient,
  _mountChainSuffix,
  _resetChainForTest,
} from '../src/on-render-client.js'

const env = browserEnv()

const Layout: SignalComponentDef<Record<string, never>, never> = {
  name: 'L',
  init: () => ({}),
  update: (s) => s,
  view: () => [style('/* LAYOUT */'), div({ class: 'shell' }, [pageSlot()])],
}
/** Every marked `<style>` in the live head as `[key, content]`, sorted. */
function headStyles(): Array<[string, string]> {
  return [...document.head.querySelectorAll('style[data-llui-head]')]
    .map((el): [string, string] => [el.getAttribute('data-llui-head') ?? '', el.textContent ?? ''])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

const PageA: SignalComponentDef<{ tag: string }, never> = {
  name: 'PageA',
  init: () => ({ tag: 'A' }),
  update: (s) => s,
  view: () => [style('/* PAGE-A */'), div({ class: 'page-a' }, [text('A')])],
}
const PageB: SignalComponentDef<{ tag: string }, never> = {
  name: 'PageB',
  init: () => ({ tag: 'B' }),
  update: (s) => s,
  view: () => [style('/* PAGE-B */'), div({ class: 'page-b' }, [text('B')])],
}

const Page: SignalComponentDef<{ label: string }, never> = {
  name: 'P',
  init: () => ({ label: 'hi' }),
  update: (s) => s,
  view: ({ state }) => [style('/* PAGE */'), div([text(state.map((s) => s.label))])],
}

describe('#240 — anonymous head keys across a vike layout chain', () => {
  it('a layout and its page mint DISTINCT keys and both entries survive', () => {
    const { collectedHead } = _renderChain([Layout, Page], [undefined, undefined], env)
    // The outermost layer keeps the unprefixed root namespace (a chain of one is a
    // plain mount); each nested layer gets its own.
    expect([...collectedHead.keys].sort()).toEqual(['style:#1', 'style:#L1/1'])
    expect(collectedHead.head).toContain('/* LAYOUT */')
    expect(collectedHead.head).toContain('/* PAGE */')
  })

  it('three layers stay distinct', () => {
    const Mid: SignalComponentDef<Record<string, never>, never> = {
      name: 'M',
      init: () => ({}),
      update: (s) => s,
      view: () => [style('/* MID */'), div({ class: 'mid' }, [pageSlot()])],
    }
    const { collectedHead } = _renderChain(
      [Layout, Mid, Page],
      [undefined, undefined, undefined],
      env,
    )
    expect([...collectedHead.keys].sort()).toEqual(['style:#1', 'style:#L1/1', 'style:#L2/1'])
    for (const marker of ['/* LAYOUT */', '/* MID */', '/* PAGE */']) {
      expect(collectedHead.head).toContain(marker)
    }
  })

  it('a lone page (chain of one) keeps the unprefixed keys a plain mount produces', () => {
    const { collectedHead } = _renderChain([Page], [undefined], env)
    expect([...collectedHead.keys]).toEqual(['style:#1'])
  })
})

describe('#240 — a client navigation mounts a SUFFIX, and the survivors keep their keys', () => {
  beforeEach(() => {
    _resetChainForTest()
    for (const el of [...document.head.querySelectorAll('[data-llui-head]')]) el.remove()
    document.body.innerHTML = ''
    const container = document.createElement('div')
    container.id = 'app'
    document.body.appendChild(container)
  })

  it('leaves the surviving layout layer’s key AND content untouched across a nav', async () => {
    // The namespace comes from the layer's INDEX IN THE CHAIN, never from its position
    // in the mount pass — and a navigation is where those two part company. The layout
    // SURVIVES (the chain diff finds it identical) and only the page re-mounts, so the
    // suffix mount starts at index 1 with one layer to place. A namespace derived from
    // mount order (`i - startAt`, i.e. "the first layer I am mounting") renumbers the
    // incoming page to the ROOT namespace, where it lands on the key the surviving
    // layout's `<style>` already owns and overwrites its content — the layout loses its
    // stylesheet on every navigation, with both tags still present and correctly marked.
    // ASSERT THE CONTENT: the key set alone is identical under that mutation.
    const render = createOnRenderClient({ Layout })

    await render({ Page: PageA, isHydration: false })
    expect(headStyles()).toEqual([
      ['style:#1', '/* LAYOUT */'],
      ['style:#L1/1', '/* PAGE-A */'],
    ])

    await render({ Page: PageB, isHydration: false })
    expect(headStyles()).toEqual([
      ['style:#1', '/* LAYOUT */'],
      ['style:#L1/1', '/* PAGE-B */'],
    ])
  })
})

describe('#240 — the CLIENT chain mount produces the server key set', () => {
  beforeEach(() => {
    _resetChainForTest()
    for (const el of [...document.head.querySelectorAll('[data-llui-head]')]) el.remove()
  })

  it('mounts a layout + page into the live head as TWO distinct anonymous styles', () => {
    // On the client the sink is the live `document.head`, so a collision is directly
    // visible: one key means one `<style>` ELEMENT and one of the two rules is simply
    // gone from the page. This is the same key set `_renderChain` collects above, so
    // hydration adopts the server's tags rather than accumulating duplicates.
    const root = document.createElement('div')
    document.body.appendChild(root)
    _mountChainSuffix([Layout, Page], [undefined, undefined], 0, root, undefined, {
      mode: 'mount',
    })

    const styles = [...document.head.querySelectorAll('style[data-llui-head]')]
    expect(styles.map((el) => el.getAttribute('data-llui-head')).sort()).toEqual([
      'style:#1',
      'style:#L1/1',
    ])
    expect(styles.map((el) => el.textContent).sort()).toEqual(['/* LAYOUT */', '/* PAGE */'])
    root.remove()
  })
})
