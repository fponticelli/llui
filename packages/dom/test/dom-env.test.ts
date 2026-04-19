import { describe, it, expect } from 'vitest'
import { renderToString } from '../src/ssr'
import { browserEnv } from '../src/dom-env'
import { component, div, span, text } from '../src/index'

type State = { label: string; count: number }

const Sample = component<State, never, never>({
  name: 'Sample',
  init: () => [{ label: 'x', count: 0 }, []],
  update: (s) => [s, []],
  view: () => [
    div({ class: 'sample' }, [
      span({}, [text((s: State) => s.label)]),
      text((s: State) => String(s.count)),
    ]),
  ],
})

describe('DomEnv threading', () => {
  it('renderToString uses the provided env (browserEnv wraps globalThis)', () => {
    const env = browserEnv()
    const html = renderToString(Sample, { label: 'hello', count: 42 }, env)
    expect(html).toContain('class="sample"')
    expect(html).toContain('hello')
    expect(html).toContain('42')
  })

  it('two concurrent renders with separate env instances do not share state', () => {
    const env1 = browserEnv()
    const env2 = browserEnv()
    // Same underlying globalThis document under vitest-jsdom — the point
    // is that the render path threads env through rather than reading a
    // shared global. Independent env instances must produce independent
    // output.
    const a = renderToString(Sample, { label: 'a', count: 1 }, env1)
    const b = renderToString(Sample, { label: 'b', count: 2 }, env2)
    expect(a).toContain('>a<')
    expect(a).toContain('1')
    expect(b).toContain('>b<')
    expect(b).toContain('2')
    expect(a).not.toContain('>b<')
    expect(b).not.toContain('>a<')
  })

  it('browserEnv() exposes the expected DOM class identities', () => {
    const env = browserEnv()
    expect(env.Element).toBe(globalThis.Element)
    expect(env.Text).toBe(globalThis.Text)
    expect(env.Comment).toBe(globalThis.Comment)
    expect(env.HTMLElement).toBe(globalThis.HTMLElement)
  })
})
