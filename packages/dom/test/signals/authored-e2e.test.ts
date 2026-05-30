import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { transformSignalComponentSource } from '@llui/compiler'
import { mountSignalComponent } from '../../src/signals/component'
import {
  signalText,
  staticText,
  el,
  react,
  signalShow,
  signalEach,
  signalBranch,
} from '../../src/signals/dom'

// End-to-end: take AUTHORED signal source, run it through the real compiler
// transform (transformSignalComponentSource — the same call the Vite plugin
// makes), transpile to JS, evaluate with the signal runtime in scope, then mount
// via the runtime and assert real DOM behavior. This proves authored signal code
// actually compiles and runs across the whole pipeline.

interface Defs {
  [name: string]: Parameters<typeof mountSignalComponent>[1]
}

function compileAndLoad(authored: string, names: string[]): Defs {
  const lowered = transformSignalComponentSource(authored)
  // strip imports + exports, return the named component defs
  const body = lowered
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('import '))
    .join('\n')
    .replace(/export\s+const/g, 'const')
  const wrapped = `(function(signalText, staticText, el, react, signalShow, signalEach, signalBranch, derived, component){
    ${body}
    return { ${names.join(', ')} }
  })`
  const js = ts.transpileModule(wrapped, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText
  const factory = eval(js) as (...args: unknown[]) => Defs
  const identityComponent = (spec: unknown): unknown => spec
  const derivedStub = (): never => {
    throw new Error('derived used outside a slot')
  }
  return factory(
    signalText,
    staticText,
    el,
    react,
    signalShow,
    signalEach,
    signalBranch,
    derivedStub,
    identityComponent,
  )
}

describe('authored signal source — end-to-end (transform -> transpile -> mount)', () => {
  it('Counter: at/map slot, event handler, show, effects, peek', () => {
    const SRC = `
      import { component, mountApp } from '@llui/dom'
      import { text, div, button, show } from '@llui/dom'
      export const Counter = component({
        init: () => [{ count: 0, log: [] }, []],
        update: (s, m) => {
          if (m.type === 'inc') return [{ ...s, count: s.count + 1 }, [{ type: 'beep', n: s.count + 1 }]]
          if (m.type === 'reset') return [{ ...s, count: 0 }, []]
          return [{ ...s, log: [...s.log, m.n] }, []]
        },
        onEffect: (e, api) => { if (e.type === 'beep') api.send({ type: 'logged', n: e.n }) },
        view: ({ state, send }) => [
          div({ class: 'counter' }, [
            button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
            text(state.at('count').map((c) => String(c))),
          ]),
          show(state.at('count').map((c) => c > 0), () => [
            button({ class: 'reset', onClick: () => send({ type: 'reset', at: state.at('count').peek() }) }, [text('Reset')]),
          ]),
        ],
      })
    `
    const Counter = compileAndLoad(SRC, ['Counter']).Counter!
    const container = document.createElement('div')
    const h = mountSignalComponent(container, Counter)

    const countText = (): string =>
      container.querySelector('.counter')!.lastChild!.textContent ?? ''
    expect(countText()).toBe('0')
    expect(container.querySelector('.reset')).toBeNull() // show: count not > 0

    h.send({ type: 'inc' } as never)
    expect(countText()).toBe('1')
    expect(container.querySelector('.reset')).not.toBeNull() // show mounted
    expect((h.getState() as { log: number[] }).log).toEqual([1]) // effect -> send -> log

    h.send({ type: 'reset' } as never)
    expect(countText()).toBe('0')
    expect(container.querySelector('.reset')).toBeNull() // show unmounted
  })

  it('Todos: each (keyed rows), branch (empty/list), in-place row update', () => {
    const SRC = `
      import { component } from '@llui/dom'
      import { text, ul, li, div, each, branch } from '@llui/dom'
      export const Todos = component({
        init: () => [{ todos: [] }, []],
        update: (s, m) => {
          if (m.type === 'set') return [{ todos: m.todos }, []]
          return [s, []]
        },
        view: ({ state }) => [
          branch(state.at('view'), {
            empty: () => [div({ id: 'empty' }, [text('no todos')])],
          }),
          ul({}, [
            each(state.at('todos'), {
              key: (t) => t.id,
              render: (item) => [li({}, [text(item.at('title'))])],
            }),
          ]),
        ],
      })
    `
    const Todos = compileAndLoad(SRC, ['Todos']).Todos!
    const container = document.createElement('div')
    const h = mountSignalComponent(container, Todos)
    const titles = (): string[] =>
      [...container.querySelectorAll('li')].map((n) => n.textContent ?? '')

    expect(titles()).toEqual([])
    h.send({
      type: 'set',
      todos: [
        { id: 1, title: 'a' },
        { id: 2, title: 'b' },
      ],
    } as never)
    expect(titles()).toEqual(['a', 'b'])

    const firstLi = container.querySelector('li')!
    h.send({
      type: 'set',
      todos: [
        { id: 1, title: 'A!' }, // changed
        { id: 2, title: 'b' },
      ],
    } as never)
    expect(titles()).toEqual(['A!', 'b'])
    expect(container.querySelector('li')).toBe(firstLi) // row reused, updated in place
  })

  it('Panel: branch(value, disc, arms) narrows per arm; same-arm update is in place', () => {
    const SRC = `
      import { component } from '@llui/dom'
      import { text, div, branch } from '@llui/dom'
      export const Panel = component({
        init: () => [{ view: { type: 'loading' } }, []],
        update: (s, m) => {
          if (m.type === 'load') return [{ view: { type: 'loaded', data: m.data } }, []]
          if (m.type === 'fail') return [{ view: { type: 'error', message: m.msg } }, []]
          return [s, []]
        },
        view: ({ state }) => [
          branch(state.at('view'), (v) => v.type, {
            loading: () => [div({ id: 'l' }, [text('loading…')])],
            loaded: (v) => [div({ id: 'd' }, [text(v.at('data'))])],
            error: (v) => [div({ id: 'e' }, [text(v.at('message'))])],
          }),
        ],
      })
    `
    const Panel = compileAndLoad(SRC, ['Panel']).Panel!
    const container = document.createElement('div')
    const h = mountSignalComponent(container, Panel)

    // loading arm
    expect(container.querySelector('#l')?.textContent).toBe('loading…')
    expect(container.querySelector('#d')).toBeNull()

    // -> loaded: narrowed v.at('data') renders the variant-only field
    h.send({ type: 'load', data: 'hello' } as never)
    expect(container.querySelector('#l')).toBeNull()
    const loadedEl = container.querySelector('#d')!
    expect(loadedEl.textContent).toBe('hello')

    // same arm (loaded -> loaded): no remount, narrowed field updates in place
    h.send({ type: 'load', data: 'world' } as never)
    expect(container.querySelector('#d')).toBe(loadedEl)
    expect(loadedEl.textContent).toBe('world')

    // -> error arm: swaps, reads its own variant-only field
    h.send({ type: 'fail', msg: 'boom' } as never)
    expect(container.querySelector('#d')).toBeNull()
    expect(container.querySelector('#e')?.textContent).toBe('boom')
  })

  it('Profile: show narrowed then-arm + else arm (reacts in place, toggles)', () => {
    const SRC = `
      import { component } from '@llui/dom'
      import { text, div, show } from '@llui/dom'
      export const Profile = component({
        init: () => [{ user: { name: 'ada' } }, []],
        update: (s, m) => {
          if (m.type === 'clear') return [{ user: null }, []]
          if (m.type === 'set') return [{ user: { name: m.name } }, []]
          return [s, []]
        },
        view: ({ state }) => [
          show(
            state.at('user'),
            (u) => [div({ id: 'has' }, [text(u.at('name'))])],
            () => [div({ id: 'none' }, [text('no user')])],
          ),
        ],
      })
    `
    const Profile = compileAndLoad(SRC, ['Profile']).Profile!
    const container = document.createElement('div')
    const h = mountSignalComponent(container, Profile)

    // then-arm with the narrowed signal read
    const hasEl = container.querySelector('#has')!
    expect(hasEl.textContent).toBe('ada')

    // same-arm update: narrowed v.at('name') refreshes in place, no remount
    h.send({ type: 'set', name: 'lin' } as never)
    expect(container.querySelector('#has')).toBe(hasEl)
    expect(hasEl.textContent).toBe('lin')

    // falsy -> else arm
    h.send({ type: 'clear' } as never)
    expect(container.querySelector('#has')).toBeNull()
    expect(container.querySelector('#none')?.textContent).toBe('no user')
  })
})
