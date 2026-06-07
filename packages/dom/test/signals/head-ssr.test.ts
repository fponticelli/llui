import { describe, it, expect } from 'vitest'
import { renderNodes } from '../../src/signals/ssr'
import {
  collectHeadSink,
  mergeStaticHead,
  HEAD_SINK,
  title,
  titleTemplate,
  meta,
  htmlAttr,
} from '../../src/signals/head'
import type { SignalComponentDef } from '../../src/signals/component'

function collect<S, M>(def: SignalComponentDef<S, M>, initial?: S) {
  const sink = collectHeadSink()
  const contexts = new Map<symbol, unknown>([[HEAD_SINK.id, sink]])
  const { dispose } = renderNodes(def, initial, document, contexts)
  const out = sink.serialize(document) // serialize BEFORE disposing (release)
  dispose()
  return out
}

describe('head SSR collection', () => {
  it('collects title + meta into the head string', () => {
    const def: SignalComponentDef<{ x: number }, never> = {
      init: () => ({ x: 0 }),
      update: (s) => s,
      view: () => [title('Home'), meta({ name: 'description', content: 'desc' })],
    }
    const { head } = collect(def)
    expect(head).toContain('<title data-llui-head="title">Home</title>')
    expect(head).toContain('data-llui-head="meta:name=description"')
    expect(head).toContain('name="description"')
    expect(head).toContain('content="desc"')
  })

  it('applies titleTemplate and escapes content', () => {
    const def: SignalComponentDef<{ x: number }, never> = {
      init: () => ({ x: 0 }),
      update: (s) => s,
      view: () => [
        titleTemplate('%s · LLui'),
        title('A & B'),
        meta({ name: 'og:title', content: '<script>"x"' }),
      ],
    }
    const { head } = collect(def)
    expect(head).toContain('<title data-llui-head="title">A &amp; B · LLui</title>')
    // attribute + text escaping comes from the shared SSR serializer: title text
    // escapes &/</>; attribute values escape &/" (angle brackets are legal there)
    expect(head).toContain('content="<script>&quot;x&quot;"')
  })

  it('emits html attribute strings', () => {
    const def: SignalComponentDef<{ x: number }, never> = {
      init: () => ({ x: 0 }),
      update: (s) => s,
      view: () => [htmlAttr({ lang: 'en' })],
    }
    const { htmlAttrs, bodyAttrs } = collect(def)
    expect(htmlAttrs).toBe(' lang="en"')
    expect(bodyAttrs).toBe('')
  })

  it('dedups by key — last writer wins in the collected output', () => {
    // simulate layout(meta) then page(meta) writing the same key in one render
    const def: SignalComponentDef<{ x: number }, never> = {
      init: () => ({ x: 0 }),
      update: (s) => s,
      view: () => [
        meta({ name: 'description', content: 'layout' }),
        meta({ name: 'description', content: 'page' }),
      ],
    }
    const { head } = collect(def)
    expect(head).toContain('content="page"')
    expect(head).not.toContain('content="layout"')
    expect(head.match(/data-llui-head="meta:name=description"/g)?.length).toBe(1)
  })

  it('shares one collector across a layout+page chain (page overrides layout)', () => {
    // Mirrors how @llui/vike threads ONE collectHeadSink through every layer.
    const sink = collectHeadSink()
    const contexts = new Map<symbol, unknown>([[HEAD_SINK.id, sink]])
    const layout: SignalComponentDef<{ x: number }, never> = {
      init: () => ({ x: 0 }),
      update: (s) => s,
      view: () => [title('Layout'), meta({ name: 'description', content: 'layout' })],
    }
    const page: SignalComponentDef<{ x: number }, never> = {
      init: () => ({ x: 0 }),
      update: (s) => s,
      view: () => [title('Page')],
    }
    const a = renderNodes(layout, undefined, document, contexts)
    const b = renderNodes(page, undefined, document, contexts)
    const out = sink.serialize(document)
    a.dispose()
    b.dispose()
    expect(out.head).toContain('<title data-llui-head="title">Page</title>')
    expect(out.head).toContain('content="layout"') // layout-only meta survives
    expect(out.keys).toContain('title')
    expect(out.keys).toContain('meta:name=description')
  })
})

describe('mergeStaticHead', () => {
  const collected = {
    head: '<title data-llui-head="title">Dynamic</title><meta data-llui-head="meta:name=description" name="description" content="dyn" />',
    htmlAttrs: '',
    bodyAttrs: '',
    keys: ['title', 'meta:name=description'] as const,
  }

  it('strips a colliding static <title> so only the component title remains', () => {
    const merged = mergeStaticHead(
      '<title>Static</title><link rel="icon" href="/f.ico" />',
      collected,
    )
    expect(merged).not.toContain('<title>Static</title>')
    expect(merged).toContain('<link rel="icon" href="/f.ico" />') // non-colliding kept
    expect(merged.match(/<title/g)?.length).toBe(1)
  })

  it('strips a colliding static meta by name', () => {
    const merged = mergeStaticHead('<meta name="description" content="static" />', collected)
    expect(merged).not.toContain('content="static"')
    expect(merged).toContain('content="dyn"')
    expect(merged.match(/name="description"/g)?.length).toBe(1)
  })

  it('keeps static tags that do not collide', () => {
    const merged = mergeStaticHead('<meta name="keywords" content="a,b" />', collected)
    expect(merged).toContain('content="a,b"')
  })
})
