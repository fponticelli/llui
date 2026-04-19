import { describe, it, expect } from 'vitest'
import { renderToString, hydrateApp, component, div, span, text, elTemplate } from '../src/index'
import { browserEnv } from '../src/dom-env'

const env = browserEnv()

describe('hydration + elTemplate comment placeholders', () => {
  it('SSR output has no <!--$--> placeholders (replaced with text nodes at render)', () => {
    type State = { name: string; count: number }
    const def = component<State, never, never>({
      name: 'Greeter',
      init: () => [{ name: 'world', count: 0 }, []],
      update: (s) => [s, []],
      view: () => [
        div({ class: 'wrap' }, [
          span({}, [text((s: State) => s.name)]),
          span({}, [text('Count: '), text((s: State) => String(s.count))]),
        ]),
      ],
    })

    const html = renderToString(def, { name: 'Alice', count: 5 }, env)
    expect(html).not.toContain('<!--$-->')
    expect(html).toContain('Alice')
    expect(html).toContain('Count: ')
    expect(html).toContain('5')
  })

  it('hydrated DOM matches expected content after atomic swap', () => {
    type State = { greeting: string }
    const def = component<State, never, never>({
      name: 'H',
      init: () => [{ greeting: 'hi' }, []],
      update: (s) => [s, []],
      view: () => [
        div({ class: 'x' }, [
          span({}, [text('before '), text((s: State) => s.greeting), text(' after')]),
        ]),
      ],
    })

    const html = renderToString(def, { greeting: 'hello' }, env)
    const container = document.createElement('div')
    container.innerHTML = html
    hydrateApp(container, def, { greeting: 'hello' })

    // The atomic-swap client DOM should have equivalent content
    const spanEl = container.querySelector('span')!
    expect(spanEl.textContent).toBe('before hello after')
  })

  it('elTemplate comment placeholder is replaced at clone time (simulates compiler output)', () => {
    // Simulates the compiler emitting: div({}, [text('Hello, '), text(name), text('!')])
    // The emitted elTemplate has <!--$--> between static texts.
    type State = { name: string }
    const def = component<State, never, never>({
      name: 'T',
      init: () => [{ name: 'World' }, []],
      update: (s) => [s, []],
      view: () => [
        elTemplate('<div>Hello, <!--$-->!<span></span></div>', (root, __bind) => {
          const __c0 = root.firstChild!.nextSibling!
          const __t0 = document.createTextNode('')
          __c0.parentNode!.replaceChild(__t0, __c0)
          __bind(__t0, 0xffffffff | 0, 'text', undefined, (s) => (s as State).name)
        }),
      ],
      __dirty: (o, n) => (Object.is(o.name, n.name) ? 0 : 1),
    })

    const html = renderToString(def, { name: 'Alice' }, env)
    // Comment placeholder should NOT be in SSR output — replaced by text node before serialization
    expect(html).not.toContain('<!--$-->')
    expect(html).toContain('Hello, ')
    expect(html).toContain('Alice')
    // Hydration should yield equivalent DOM
    const container = document.createElement('div')
    container.innerHTML = html
    hydrateApp(container, def, { name: 'Alice' })
    expect(container.querySelector('div')!.textContent).toBe('Hello, Alice!')
  })

  it('reactive text updates after hydration', () => {
    type State = { value: number }
    type Msg = { type: 'inc' }
    const def = component<State, Msg, never>({
      name: 'Counter',
      init: () => [{ value: 0 }, []],
      update: (s, m) => (m.type === 'inc' ? [{ value: s.value + 1 }, []] : [s, []]),
      view: ({ send }) => [
        div({ onClick: () => send({ type: 'inc' }) }, [
          span({}, [text('v='), text((s: State) => String(s.value))]),
        ]),
      ],
      __dirty: (o, n) => (Object.is(o.value, n.value) ? 0 : 1),
    })

    const html = renderToString(def, { value: 7 }, env)
    const container = document.createElement('div')
    container.innerHTML = html
    const handle = hydrateApp(container, def, { value: 7 })

    expect(container.querySelector('span')!.textContent).toBe('v=7')
    ;(container.querySelector('div') as HTMLElement).click()
    handle.flush()
    expect(container.querySelector('span')!.textContent).toBe('v=8')
  })
})
