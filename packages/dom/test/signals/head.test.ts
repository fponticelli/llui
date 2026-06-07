import { describe, it, expect, afterEach } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { signalShow } from '../../src/signals/dom'
import {
  title,
  titleTemplate,
  meta,
  link,
  htmlAttr,
  bodyAttr,
  base,
  style,
  script,
  noscript,
} from '../../src/signals/head'

const headEl = (): HTMLHeadElement => document.head
const managed = (): Element[] => Array.from(headEl().querySelectorAll('[data-llui-head]'))

afterEach(() => {
  // safety net: nothing should leak between tests once components dispose
  for (const el of managed()) el.remove()
  document.documentElement.removeAttribute('lang')
  document.body.removeAttribute('class')
})

describe('head: title', () => {
  it('sets a static title and removes it on dispose', () => {
    const c = document.createElement('div')
    const h = mountSignalComponent<{ x: number }, never>(c, {
      init: () => ({ x: 0 }),
      update: (s) => s,
      view: () => [title('Home')],
    })
    expect(document.title).toBe('Home')
    h.dispose()
    expect(headEl().querySelector('title')).toBeNull()
    expect(document.title).toBe('')
  })

  it('updates the title reactively', () => {
    const c = document.createElement('div')
    type S = { t: string }
    const h = mountSignalComponent<S, { type: 'set'; t: string }>(c, {
      init: () => ({ t: 'A' }),
      update: (s, m) => (m.type === 'set' ? { t: m.t } : s),
      view: ({ state }) => [title(state.at('t'))],
    })
    expect(document.title).toBe('A')
    h.send({ type: 'set', t: 'B' })
    expect(document.title).toBe('B')
    h.dispose()
  })

  it('composes titleTemplate with title (only while a title is set)', () => {
    const c = document.createElement('div')
    const h = mountSignalComponent<{ x: number }, never>(c, {
      init: () => ({ x: 0 }),
      update: (s) => s,
      view: () => [titleTemplate('%s · LLui'), title('Docs')],
    })
    expect(document.title).toBe('Docs · LLui')
    h.dispose()
  })
})

describe('head: meta / link', () => {
  it('creates a meta tag and updates content reactively, removes on dispose', () => {
    const c = document.createElement('div')
    type S = { d: string }
    const h = mountSignalComponent<S, { type: 'set'; d: string }>(c, {
      init: () => ({ d: 'first' }),
      update: (s, m) => (m.type === 'set' ? { d: m.d } : s),
      view: ({ state }) => [meta({ name: 'description', content: state.at('d') })],
    })
    const el = headEl().querySelector('meta[name="description"]')
    expect(el?.getAttribute('content')).toBe('first')
    h.send({ type: 'set', d: 'second' })
    expect(el?.getAttribute('content')).toBe('second')
    h.dispose()
    expect(headEl().querySelector('meta[name="description"]')).toBeNull()
  })

  it('creates a link tag', () => {
    const c = document.createElement('div')
    const h = mountSignalComponent<{ x: number }, never>(c, {
      init: () => ({ x: 0 }),
      update: (s) => s,
      view: () => [link({ rel: 'canonical', href: 'https://llui.dev/' })],
    })
    const el = headEl().querySelector('link[rel="canonical"]')
    expect(el?.getAttribute('href')).toBe('https://llui.dev/')
    h.dispose()
    expect(headEl().querySelector('link[rel="canonical"]')).toBeNull()
  })

  it('dedups meta by name — last writer wins, restores on unmount', () => {
    const c = document.createElement('div')
    type S = { open: boolean }
    const h = mountSignalComponent<S, { type: 'toggle' }>(c, {
      init: () => ({ open: false }),
      update: (s) => ({ open: !s.open }),
      view: () => [
        meta({ name: 'description', content: 'layout' }),
        signalShow({ produce: (s) => (s as S).open, deps: ['open'] }, () => [
          meta({ name: 'description', content: 'page' }),
        ]),
      ],
    })
    const content = (): string | null | undefined =>
      headEl().querySelector('meta[name="description"]')?.getAttribute('content')
    expect(content()).toBe('layout')
    h.send({ type: 'toggle' }) // show page
    expect(content()).toBe('page')
    h.send({ type: 'toggle' }) // hide page -> layout restored
    expect(content()).toBe('layout')
    // exactly one description meta throughout
    expect(headEl().querySelectorAll('meta[name="description"]').length).toBe(1)
    h.dispose()
  })
})

describe('head: html/body attrs', () => {
  it('sets <html lang> and restores the pre-existing value on dispose', () => {
    document.documentElement.setAttribute('lang', 'en')
    const c = document.createElement('div')
    const h = mountSignalComponent<{ x: number }, never>(c, {
      init: () => ({ x: 0 }),
      update: (s) => s,
      view: () => [htmlAttr({ lang: 'fr' })],
    })
    expect(document.documentElement.getAttribute('lang')).toBe('fr')
    h.dispose()
    expect(document.documentElement.getAttribute('lang')).toBe('en')
  })

  it('sets <body class> reactively and removes it when absent on dispose', () => {
    const c = document.createElement('div')
    type S = { theme: string }
    const h = mountSignalComponent<S, { type: 'set'; theme: string }>(c, {
      init: () => ({ theme: 'light' }),
      update: (s, m) => (m.type === 'set' ? { theme: m.theme } : s),
      view: ({ state }) => [bodyAttr({ class: state.at('theme') })],
    })
    expect(document.body.getAttribute('class')).toBe('light')
    h.send({ type: 'set', theme: 'dark' })
    expect(document.body.getAttribute('class')).toBe('dark')
    h.dispose()
    expect(document.body.hasAttribute('class')).toBe(false)
  })
})

describe('head: base / style / script / noscript', () => {
  it('adds a <base> and dedups to one tag', () => {
    const c = document.createElement('div')
    const h = mountSignalComponent<{ x: number }, never>(c, {
      init: () => ({ x: 0 }),
      update: (s) => s,
      view: () => [base({ href: '/app/' }), base({ href: '/override/' })],
    })
    const els = headEl().querySelectorAll('base')
    expect(els.length).toBe(1)
    expect(els[0]?.getAttribute('href')).toBe('/override/')
    h.dispose()
    expect(headEl().querySelector('base')).toBeNull()
  })

  it('adds an inline <style> with css text, keyed by id', () => {
    const c = document.createElement('div')
    const h = mountSignalComponent<{ x: number }, never>(c, {
      init: () => ({ x: 0 }),
      update: (s) => s,
      view: () => [style('.a{color:red}', { id: 'theme' })],
    })
    const el = headEl().querySelector('style[data-llui-head="style:id=theme"]')
    expect(el?.textContent).toBe('.a{color:red}')
    h.dispose()
    expect(headEl().querySelector('style')).toBeNull()
  })

  it('adds a <script> with src and boolean attrs, dedups by src', () => {
    const c = document.createElement('div')
    const h = mountSignalComponent<{ x: number }, never>(c, {
      init: () => ({ x: 0 }),
      update: (s) => s,
      view: () => [script({ src: '/a.js', defer: true }), script({ src: '/a.js', defer: false })],
    })
    const els = headEl().querySelectorAll('script')
    expect(els.length).toBe(1)
    expect(els[0]?.getAttribute('src')).toBe('/a.js')
    expect(els[0]?.hasAttribute('defer')).toBe(false) // last writer won
    h.dispose()
    expect(headEl().querySelector('script')).toBeNull()
  })

  it('adds a <noscript> with body text', () => {
    const c = document.createElement('div')
    const h = mountSignalComponent<{ x: number }, never>(c, {
      init: () => ({ x: 0 }),
      update: (s) => s,
      view: () => [noscript('enable js')],
    })
    expect(headEl().querySelector('noscript')?.textContent).toBe('enable js')
    h.dispose()
    expect(headEl().querySelector('noscript')).toBeNull()
  })
})
