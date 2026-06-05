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
  signalEachDirect,
  signalBranch,
  applyAttr,
} from '../../src/signals/dom'
import { derived } from '../../src/signals/handle'

// The compiler's direct-construction fast path: a static-skeleton `each` row
// (elements + static attrs + static/signal `text`) lowers to `signalEachDirect`
// with a generated `RowFactory` (direct DOM + binding specs), skipping the
// per-row authoring/Mountable/populate/pathHandle machinery. Richer rows
// (reactive attrs, handlers, structural children) fall back to `signalEach`.
// See docs/proposals/v2-compiler/compiled-row-construction.md.

function compileAndLoad(
  authored: string,
  name: string,
): Parameters<typeof mountSignalComponent>[1] {
  const lowered = transformSignalComponentSource(authored)
  const body = lowered
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('import '))
    .join('\n')
    .replace(/export\s+const/g, 'const')
  const wrapped = `(function(signalText, staticText, el, react, signalShow, signalEach, signalEachDirect, applyAttr, signalBranch, derived, component){
    ${body}
    return { ${name} }
  })`
  const js = ts.transpileModule(wrapped, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText
  const factory = eval(js) as (...args: unknown[]) => Record<string, unknown>
  return factory(
    signalText,
    staticText,
    el,
    react,
    signalShow,
    signalEach,
    signalEachDirect,
    applyAttr,
    signalBranch,
    derived,
    (s: unknown) => s,
  )[name] as Parameters<typeof mountSignalComponent>[1]
}

const ROWS = `
  import { component, ul, li, span, a, text, each } from '@llui/dom'
  export const App = component({
    init: () => [{ rows: [{ id: 1, label: 'a' }, { id: 2, label: 'b' }] }, []],
    update: (s, m) => (m.type === 'set' ? [{ rows: m.rows }, []] : [s, []]),
    view: ({ state }) => [
      ul({}, [
        each(state.at('rows'), {
          key: (r) => r.id,
          render: (item) => [
            li({ class: 'row' }, [
              span({ class: 'id' }, [text(item.map((r) => String(r.id)))]),
              a([text(item.at('label'))]),
            ]),
          ],
        }),
      ]),
    ],
  })
`

describe('compiled: direct-construction each (signalEachDirect)', () => {
  it('lowers a static-skeleton row to signalEachDirect', () => {
    const out = transformSignalComponentSource(ROWS)
    expect(out).toContain('signalEachDirect(')
    expect(out).not.toContain('signalEach(') // the slow form is not emitted here
    expect(out).toContain('doc.createElement("li")')
    expect(out).toContain("deps: ['item.label']")
  })

  it('renders, updates, reorders (node reuse), and removes correctly', () => {
    const def = compileAndLoad(ROWS, 'App')
    const container = document.createElement('div')
    const h = mountSignalComponent(container, def)
    const ul = container.querySelector('ul')!
    const rowText = (): string[] => [...ul.querySelectorAll('li')].map((li) => li.textContent ?? '')

    expect(rowText()).toEqual(['1a', '2b'])
    const [li1, li2] = [...ul.querySelectorAll('li')]

    // update a value in place — node reused
    h.send({
      type: 'set',
      rows: [
        { id: 1, label: 'A!' },
        { id: 2, label: 'b' },
      ],
    })
    expect(rowText()).toEqual(['1A!', '2b'])
    expect(ul.querySelector('li')).toBe(li1)

    // reorder by key — nodes reused, just moved
    h.send({
      type: 'set',
      rows: [
        { id: 2, label: 'b' },
        { id: 1, label: 'A!' },
      ],
    })
    expect(rowText()).toEqual(['2b', '1A!'])
    const reordered = [...ul.querySelectorAll('li')]
    expect(reordered[0]).toBe(li2)
    expect(reordered[1]).toBe(li1)

    // remove
    h.send({ type: 'set', rows: [{ id: 1, label: 'A!' }] })
    expect(rowText()).toEqual(['1A!'])
  })

  it('lowers a reactive attribute to a direct binding and updates it', () => {
    const REACTIVE_ATTR = `
      import { component, ul, li, text, each } from '@llui/dom'
      export const App = component({
        init: () => [{ rows: [{ id: 1, label: 'a', cls: 'x' }] }, []],
        update: (s, m) => (m.type === 'set' ? [{ rows: m.rows }, []] : [s, []]),
        view: ({ state }) => [
          ul({}, [
            each(state.at('rows'), {
              key: (r) => r.id,
              render: (item) => [li({ class: item.at('cls') }, [text(item.at('label'))])],
            }),
          ]),
        ],
      })
    `
    expect(transformSignalComponentSource(REACTIVE_ATTR)).toContain('signalEachDirect(')

    const def = compileAndLoad(REACTIVE_ATTR, 'App')
    const container = document.createElement('div')
    const h = mountSignalComponent(container, def)
    const li = (): HTMLElement => container.querySelector('li')!
    expect(li().getAttribute('class')).toBe('x')
    expect(li().textContent).toBe('a')

    // reactive class updates in place; null clears the attribute
    h.send({ type: 'set', rows: [{ id: 1, label: 'a', cls: 'y' }] })
    expect(li().getAttribute('class')).toBe('y')
    h.send({ type: 'set', rows: [{ id: 1, label: 'a', cls: null }] })
    expect(li().hasAttribute('class')).toBe(false)
  })

  it('lowers a todomvc-shaped row (item-handler + reactive checked) and dispatches by id', () => {
    // The universal list row: a reactive `checked` IDL prop + item-referencing
    // toggle/remove handlers. Previously this fell fully verbatim; now it reaches
    // the direct path, with handlers reading the live row ctx for the row id.
    const TODOS = `
      import { component, ul, li, input, label, button, text, each } from '@llui/dom'
      export const App = component({
        init: () => [{ todos: [{ id: 1, text: 'a', done: false }, { id: 2, text: 'b', done: true }] }, []],
        update: (s, m) => {
          if (m.type === 'toggle') return [{ todos: s.todos.map((t) => (t.id === m.id ? { ...t, done: !t.done } : t)) }, []]
          if (m.type === 'remove') return [{ todos: s.todos.filter((t) => t.id !== m.id) }, []]
          return [s, []]
        },
        view: ({ state, send }) => [
          ul({}, [
            each(state.at('todos'), {
              key: (t) => t.id,
              render: (item) => [
                li({}, [
                  input({
                    type: 'checkbox',
                    checked: item.at('done'),
                    onClick: () => send({ type: 'toggle', id: item.at('id').peek() }),
                  }),
                  label({}, [text(item.at('text'))]),
                  button({ class: 'destroy', onClick: () => send({ type: 'remove', id: item.at('id').peek() }) }, [
                    text('x'),
                  ]),
                ]),
              ],
            }),
          ]),
        ],
      })
    `
    const out = transformSignalComponentSource(TODOS)
    expect(out).toContain('signalEachDirect(')
    expect(out).not.toContain('signalEach(') // no slow render-callback fallback
    expect(out).toContain('(doc, getCtx) =>')
    expect(out).toContain('getCtx().item.id') // handler reads the live row id
    expect(out).toContain('applyAttr(') // reactive checked routed through applyAttr

    const def = compileAndLoad(TODOS, 'App')
    const container = document.createElement('div')
    mountSignalComponent(container, def)
    const boxes = (): HTMLInputElement[] => [...container.querySelectorAll('input')]
    const labels = (): string[] =>
      [...container.querySelectorAll('label')].map((l) => l.textContent ?? '')

    // reactive `checked` IDL prop reflects initial state
    expect(boxes().map((b) => b.checked)).toEqual([false, true])
    expect(labels()).toEqual(['a', 'b'])

    // clicking row 1's checkbox dispatches toggle with id:1 (read from the live ctx)
    boxes()[0]!.dispatchEvent(new Event('click'))
    expect(boxes().map((b) => b.checked)).toEqual([true, true])

    // clicking row 2's destroy button dispatches remove with id:2
    const destroyButtons = [...container.querySelectorAll('button.destroy')]
    destroyButtons[1]!.dispatchEvent(new Event('click'))
    expect(labels()).toEqual(['a'])
    expect(boxes().map((b) => b.checked)).toEqual([true])
  })

  it('handler reads stay correct after a keyed reorder (live ctx, not stale closure)', () => {
    // After rows are reordered, each row's handler must still dispatch ITS current
    // id — the closure reads `getCtx()`, which the reconcile keeps current.
    const TODOS = `
      import { component, ul, li, button, text, each } from '@llui/dom'
      export const App = component({
        init: () => [{ rows: [{ id: 1, label: 'a' }, { id: 2, label: 'b' }] }, []],
        update: (s, m) => {
          if (m.type === 'set') return [{ rows: m.rows }, []]
          if (m.type === 'pick') return [{ rows: s.rows, picked: m.id }, []]
          return [s, []]
        },
        view: ({ state, send }) => [
          ul({}, [
            each(state.at('rows'), {
              key: (r) => r.id,
              render: (item) => [
                li({}, [button({ onClick: () => send({ type: 'pick', id: item.at('id').peek() }) }, [text(item.at('label'))])]),
              ],
            }),
          ]),
        ],
      })
    `
    const def = compileAndLoad(TODOS, 'App')
    const container = document.createElement('div')
    const h = mountSignalComponent(container, def)
    const buttons = (): HTMLButtonElement[] => [...container.querySelectorAll('button')]

    // reorder: [2, 1]
    h.send({
      type: 'set',
      rows: [
        { id: 2, label: 'b' },
        { id: 1, label: 'a' },
      ],
    })
    expect(buttons().map((b) => b.textContent)).toEqual(['b', 'a'])

    // the first button is now row id:2 — clicking must dispatch id:2
    buttons()[0]!.dispatchEvent(new Event('click'))
    expect((h.getState() as { picked?: number }).picked).toBe(2)
    buttons()[1]!.dispatchEvent(new Event('click'))
    expect((h.getState() as { picked?: number }).picked).toBe(1)
  })

  it('falls back to signalEach when a row has a structural child', () => {
    const STRUCTURAL = `
      import { component, ul, li, span, text, each, show } from '@llui/dom'
      export const App = component({
        init: () => [{ rows: [{ id: 1, label: 'a', open: true }] }, []],
        update: (s) => [s, []],
        view: ({ state }) => [
          ul({}, [
            each(state.at('rows'), {
              key: (r) => r.id,
              render: (item) => [
                li({}, [show(item.at('open'), () => [span({}, [text(item.at('label'))])])]),
              ],
            }),
          ]),
        ],
      })
    `
    const out = transformSignalComponentSource(STRUCTURAL)
    expect(out).toContain('signalEach(')
    expect(out).not.toContain('signalEachDirect(')
  })
})
