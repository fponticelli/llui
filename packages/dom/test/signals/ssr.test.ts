import { describe, it, expect } from 'vitest'
import { renderToString, renderNodes, serializeNodes } from '../../src/signals/ssr'
import { hydrateSignalApp, mountSignalComponent } from '../../src/signals/component'
import { el, signalText } from '../../src/signals/dom'
import type { SignalComponentDef } from '../../src/signals/component'

interface S {
  count: number
  label: string
}
type M = { type: 'inc' }

// Built with the lowered runtime helpers (uncompiled test) — same tree shape a
// compiled `view` would emit.
const def: SignalComponentDef<S, M> = {
  name: 'SsrCounter',
  init: () => ({ count: 0, label: 'hi' }),
  update: (s, m) => (m.type === 'inc' ? { ...s, count: s.count + 1 } : s),
  view: () => [
    el('div', { class: 'box' }, [
      el('span', { id: 'c' }, [signalText((s) => (s as S).count, ['count'])]),
      el('span', { id: 'l' }, [signalText((s) => (s as S).label, ['label'])]),
    ]),
  ],
}

describe('signal SSR — renderToString / serializeNodes', () => {
  it('renders initial state to HTML (jsdom document as the server doc)', () => {
    const html = renderToString(def, undefined, document)
    expect(html).toBe('<div class="box"><span id="c">0</span><span id="l">hi</span></div>')
  })

  it('honours a provided initial-state override', () => {
    const html = renderToString(def, { count: 7, label: 'x' }, document)
    expect(html).toContain('<span id="c">7</span>')
    expect(html).toContain('<span id="l">x</span>')
  })

  it('escapes text and attribute content', () => {
    const xss: SignalComponentDef<{ t: string }, never> = {
      init: () => ({ t: '<b>&"' }),
      update: (s) => s,
      view: () => [el('p', { title: 'a"b' }, [signalText((s) => (s as { t: string }).t, ['t'])])],
    }
    const html = renderToString(xss, undefined, document)
    expect(html).toBe('<p title="a&quot;b">&lt;b&gt;&amp;"</p>')
  })

  it('does not serialize event-handler attributes', () => {
    const withHandler: SignalComponentDef<S, M> = {
      ...def,
      view: () => [el('button', { onClick: () => {} }, [signalText(() => 'go', [])])],
    }
    const html = renderToString(withHandler, undefined, document)
    expect(html).toBe('<button>go</button>')
  })

  it('renderNodes returns detached nodes + a dispose, serializeNodes composes', () => {
    const a = renderNodes(def, { count: 1, label: 'a' }, document)
    const b = renderNodes(def, { count: 2, label: 'b' }, document)
    const html = serializeNodes([...a.nodes, ...b.nodes])
    expect(html).toContain('<span id="c">1</span>')
    expect(html).toContain('<span id="c">2</span>')
    a.dispose()
    b.dispose()
  })
})

describe('signal hydration — hydrateSignalApp', () => {
  it('takes over server HTML, becomes reactive, skips init effects by default', () => {
    // Simulate a server render landing in the container.
    const container = document.createElement('div')
    container.innerHTML = renderToString(def, { count: 5, label: 'srv' }, document)
    const serverSpan = container.querySelector('#c')!
    expect(serverSpan.textContent).toBe('5')

    const h = hydrateSignalApp(container, def, { count: 5, label: 'srv' })
    // After hydration the DOM shows the server state and is live.
    expect(container.querySelector('#c')!.textContent).toBe('5')
    expect(h.getState()).toEqual({ count: 5, label: 'srv' })
    h.send({ type: 'inc' })
    expect(container.querySelector('#c')!.textContent).toBe('6')
    h.dispose()
  })

  it('hydration replaces (does not duplicate) the server tree', () => {
    const container = document.createElement('div')
    container.innerHTML = renderToString(def, undefined, document)
    expect(container.querySelectorAll('.box').length).toBe(1)
    hydrateSignalApp(container, def, { count: 0, label: 'hi' })
    expect(container.querySelectorAll('.box').length).toBe(1) // swapped, not appended
  })

  it('runs init effects on hydrate only when asked', () => {
    const fired: string[] = []
    const effectful: SignalComponentDef<S, M, { type: 'load' }> = {
      ...def,
      init: () => [{ count: 0, label: 'hi' }, [{ type: 'load' }]],
      onEffect: (e) => {
        fired.push(e.type)
      },
    }
    const c1 = document.createElement('div')
    c1.innerHTML = renderToString(effectful, undefined, document)
    hydrateSignalApp(c1, effectful, { count: 0, label: 'hi' })
    expect(fired).toEqual([]) // skipped by default

    const c2 = document.createElement('div')
    c2.innerHTML = renderToString(effectful, undefined, document)
    hydrateSignalApp(c2, effectful, { count: 0, label: 'hi' }, { runInitEffects: true })
    expect(fired).toEqual(['load'])
  })

  it('a fresh mount (no hydrate) still appends as before', () => {
    const container = document.createElement('div')
    const h = mountSignalComponent(container, def)
    expect(container.querySelector('#c')!.textContent).toBe('0')
    h.dispose()
  })
})
