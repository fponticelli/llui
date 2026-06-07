import { describe, it, expect, afterEach } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import { component } from '../../src/signals/authoring'
import { signalShow, signalBranch, signalSubApp } from '../../src/signals/dom'
import { meta, link, script, title } from '../../src/signals/head'

const headEl = (): HTMLHeadElement => document.head
const managed = (): Element[] => Array.from(headEl().querySelectorAll('[data-llui-head]'))

afterEach(() => {
  for (const el of managed()) el.remove()
  document.documentElement.removeAttribute('lang')
  document.body.removeAttribute('class')
})

// Seed an SSR-rendered (adopted-on-hydration) head element into <head>.
function seedSsr(tag: string, key: string, attrs: Record<string, string>, text?: string): void {
  const el = document.createElement(tag)
  el.setAttribute('data-llui-head', key)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  if (text !== undefined) el.textContent = text
  document.head.appendChild(el)
}

describe('head: show()/branch() release of hydration-adopted (SSR) entries', () => {
  it('removes an adopted <meta> when show() flips false', () => {
    seedSsr('meta', 'meta:name=home-only', { name: 'home-only', content: 'yes' })
    const c = document.createElement('div')
    type S = { path: string }
    const h = mountSignalComponent<S, { type: 'nav'; path: string }>(c, {
      init: () => ({ path: '/' }),
      update: (s, m) => (m.type === 'nav' ? { path: m.path } : s),
      view: () => [
        signalShow({ produce: (s) => (s as S).path === '/', deps: ['path'] }, () => [
          meta({ name: 'home-only', content: 'yes' }),
        ]),
      ],
    })
    expect(headEl().querySelector('meta[name="home-only"]')).not.toBeNull()
    h.send({ type: 'nav', path: '/docs' })
    expect(headEl().querySelector('meta[name="home-only"]')).toBeNull()
    h.dispose()
  })

  it('removes an adopted ld+json <script> when show() flips false (dice.run repro)', () => {
    seedSsr(
      'script',
      'script:id=ld-webapplication',
      { type: 'application/ld+json', id: 'ld-webapplication' },
      '{"@type":"WebApplication"}',
    )
    const c = document.createElement('div')
    type S = { path: string }
    const h = mountSignalComponent<S, { type: 'nav'; path: string }>(c, {
      init: () => ({ path: '/' }),
      update: (s, m) => (m.type === 'nav' ? { path: m.path } : s),
      view: () => [
        signalShow({ produce: (s) => (s as S).path === '/', deps: ['path'] }, () => [
          script(
            { type: 'application/ld+json', id: 'ld-webapplication' },
            '{"@type":"WebApplication"}',
          ),
        ]),
      ],
    })
    expect(headEl().querySelector('script#ld-webapplication')).not.toBeNull()
    h.send({ type: 'nav', path: '/docs' })
    expect(headEl().querySelector('script#ld-webapplication')).toBeNull()
    h.dispose()
  })

  it('removes an adopted <link rel=canonical> when branch() swaps arms', () => {
    seedSsr('link', 'link:rel=canonical:href=https://x/', {
      rel: 'canonical',
      href: 'https://x/',
    })
    const c = document.createElement('div')
    type S = { path: string }
    const h = mountSignalComponent<S, { type: 'nav'; path: string }>(c, {
      init: () => ({ path: '/' }),
      update: (s, m) => (m.type === 'nav' ? { path: m.path } : s),
      view: () => [
        signalBranch(
          { produce: (s) => (s as S).path, deps: ['path'] },
          {
            '/': () => [link({ rel: 'canonical', href: 'https://x/' })],
            '/docs': () => [meta({ name: 'other', content: 'x' })],
          },
        ),
      ],
    })
    expect(headEl().querySelector('link[rel="canonical"]')).not.toBeNull()
    h.send({ type: 'nav', path: '/docs' })
    expect(headEl().querySelector('link[rel="canonical"]')).toBeNull()
    h.dispose()
  })

  it('removes an adopted entry inside a subApp page on page-slot swap', () => {
    seedSsr('meta', 'meta:name=home-only', { name: 'home-only', content: 'yes' })
    const HomeSeo = component<{ x: number }, { type: 'noop' }>({
      name: 'HomeSeo',
      init: () => ({ x: 0 }),
      update: (s) => s,
      view: () => [meta({ name: 'home-only', content: 'yes' })],
    })
    const c = document.createElement('div')
    type S = { path: string }
    const h = mountSignalComponent<S, { type: 'nav'; path: string }>(c, {
      init: () => ({ path: '/' }),
      update: (s, m) => (m.type === 'nav' ? { path: m.path } : s),
      view: () => [
        signalShow({ produce: (s) => (s as S).path === '/', deps: ['path'] }, () => [
          signalSubApp({ reason: 'test: isolated page', def: HomeSeo }),
        ]),
      ],
    })
    expect(headEl().querySelector('meta[name="home-only"]')).not.toBeNull()
    h.send({ type: 'nav', path: '/docs' })
    expect(headEl().querySelector('meta[name="home-only"]')).toBeNull()
    h.dispose()
  })

  it('restores an UNMARKED foreign <title> (genuine pre-existing) on release, not removed', () => {
    // A static <title> in the HTML template (no data-llui-head marker) is foreign:
    // LLui adopts it to override while mounted, and must RESTORE it on release —
    // never delete it (it is not LLui's element).
    const existing = document.createElement('title')
    existing.textContent = 'Static App Title'
    document.head.appendChild(existing)
    const c = document.createElement('div')
    type S = { override: boolean }
    const h = mountSignalComponent<S, { type: 'toggle' }>(c, {
      init: () => ({ override: true }),
      update: (s) => ({ override: !s.override }),
      view: () => [
        signalShow({ produce: (s) => (s as S).override, deps: ['override'] }, () => [
          title('Overridden'),
        ]),
      ],
    })
    expect(document.title).toBe('Overridden')
    h.send({ type: 'toggle' }) // hide -> LLui title releases, foreign title restored
    expect(headEl().querySelector('title')?.textContent).toBe('Static App Title')
    expect(document.title).toBe('Static App Title')
    h.dispose()
    existing.remove()
  })
})
