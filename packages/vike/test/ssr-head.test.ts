// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { browserEnv } from '@llui/dom/ssr'
import { div, text, title, meta, htmlAttr, bodyAttr } from '@llui/dom'
import type { SignalComponentDef } from '@llui/dom'
import { pageSlot } from '../src/page-slot.js'
import { _renderChain, createOnRenderHtml } from '../src/on-render-html.js'

const env = browserEnv()

describe('SSR head collection (_renderChain)', () => {
  it('collects head from a layout+page chain; page title overrides layout', () => {
    const Layout: SignalComponentDef<Record<string, never>, never> = {
      name: 'L',
      init: () => ({}),
      update: (s) => s,
      view: () => [
        title('Layout Title'),
        meta({ name: 'description', content: 'site desc' }),
        htmlAttr({ lang: 'en' }),
        div({ class: 'shell' }, [pageSlot()]),
      ],
    }
    const Page: SignalComponentDef<{ label: string }, never> = {
      name: 'P',
      init: () => ({ label: 'hi' }),
      update: (s) => s,
      view: ({ state }) => [
        title('Page Title'),
        bodyAttr({ class: 'page' }),
        div([text(state.map((s) => s.label))]),
      ],
    }

    const { html, collectedHead } = _renderChain([Layout, Page], [undefined, undefined], env)
    expect(html).toContain('class="shell"')
    expect(collectedHead.head).toContain('<title data-llui-head="title">Page Title</title>')
    expect(collectedHead.head).toContain('content="site desc"') // layout meta threaded through slot
    expect(collectedHead.htmlAttrs).toBe(' lang="en"')
    expect(collectedHead.bodyAttrs).toBe(' class="page"')
  })
})

describe('createOnRenderHtml head wiring', () => {
  const Page: SignalComponentDef<Record<string, never>, never> = {
    name: 'P',
    init: () => ({}),
    update: (s) => s,
    view: () => [title('Hello'), htmlAttr({ lang: 'fr' }), div(['body'])],
  }

  it('injects collected head + html/body attrs into the default document', async () => {
    const onRenderHtml = createOnRenderHtml({ domEnv: () => env })
    const res = await onRenderHtml({ Page })
    const doc = (res.documentHtml as { _escaped: string })._escaped
    expect(doc).toContain('<html lang="fr">')
    expect(doc).toContain('<title data-llui-head="title">Hello</title>')
  })

  it('component head overrides a colliding static +Head.ts title', async () => {
    const onRenderHtml = createOnRenderHtml({ domEnv: () => env })
    const res = await onRenderHtml({
      Page,
      head: '<title>Static</title><link rel="icon" href="/f.ico" />',
    })
    const doc = (res.documentHtml as { _escaped: string })._escaped
    expect(doc).not.toContain('<title>Static</title>')
    expect(doc).toContain('<title data-llui-head="title">Hello</title>')
    expect(doc).toContain('<link rel="icon" href="/f.ico" />') // non-colliding static tag kept
    expect((doc.match(/<title/g) ?? []).length).toBe(1)
  })
})
