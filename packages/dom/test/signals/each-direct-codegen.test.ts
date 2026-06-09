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
import { ul, li, button, span, text, show, eachDirect, eachArm } from '../../src/signals/authoring'
import { derived, pathHandle } from '../../src/signals/handle'

/** Compile + load a source that uses view-HELPER functions (authoring ul/li/text +
 * the handle-consuming eachDirect), for the cross-function transform-coverage tests.
 * Provides the authoring helpers the lowered helper bodies reference, on top of the
 * compiled-runtime set. */
function compileAndLoadWithHelpers(
  authored: string,
  name: string,
): Parameters<typeof mountSignalComponent>[1] {
  const lowered = transformSignalComponentSource(authored)
  const body = lowered
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('import '))
    .join('\n')
    .replace(/export\s+const/g, 'const')
  const wrapped = `(function(signalText, staticText, el, react, signalEachDirect, eachDirect, eachArm, rowHandle, applyAttr, ul, li, button, span, text, show, component){
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
    signalEachDirect,
    eachDirect,
    eachArm,
    pathHandle,
    applyAttr,
    ul,
    li,
    button,
    span,
    text,
    show,
    (s: unknown) => s,
  )[name] as Parameters<typeof mountSignalComponent>[1]
}

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

  it('lowers a reactive `value` IDL prop (different applyAttr branch than checked) and updates it', () => {
    // `value` is an IDL property (set via node.value, not setAttribute) — a distinct
    // applyAttr branch from `checked`. Reactive `value` on an input must reflect + update.
    const VALUE_ROW = `
      import { component, ul, li, input, each } from '@llui/dom'
      export const App = component({
        init: () => [{ rows: [{ id: 1, v: 'hi' }] }, []],
        update: (s, m) => (m.type === 'set' ? [{ rows: m.rows }, []] : [s, []]),
        view: ({ state }) => [
          ul({}, [each(state.at('rows'), { key: (r) => r.id, render: (item) => [li([input({ value: item.at('v') })])] })]),
        ],
      })
    `
    expect(transformSignalComponentSource(VALUE_ROW)).toContain('signalEachDirect(')
    const def = compileAndLoad(VALUE_ROW, 'App')
    const container = document.createElement('div')
    const h = mountSignalComponent(container, def)
    const inp = (): HTMLInputElement => container.querySelector('input')!
    expect(inp().value).toBe('hi') // IDL property set, not just attribute
    h.send({ type: 'set', rows: [{ id: 1, v: 'bye' }] })
    expect(inp().value).toBe('bye')
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

  it('compiled auto-batch handler coalesces a multi-send burst into one reconcile', () => {
    // Opportunity A: a straight-line multi-send handler is auto-wrapped in batch(),
    // so clicking commits ONE reconcile against the final state. We observe the
    // reconcile count via a binding's commit counter.
    const MULTI = `
      import { component, div, button, text } from '@llui/dom'
      export const App = component({
        init: () => [{ n: 0 }, []],
        update: (s, m) => (m.type === 'inc' ? [{ n: s.n + 1 }, []] : [s, []]),
        view: ({ state, send }) => [
          div({}, [
            button({ onClick: () => { send({ type: 'inc' }); send({ type: 'inc' }); send({ type: 'inc' }) } }, [text('go')]),
            div({ class: 'out' }, [text(state.at('n').map((v) => String(v)))]),
          ]),
        ],
      })
    `
    const out = transformSignalComponentSource(MULTI)
    expect(out).toContain('batch(() =>') // wrapped
    expect(out).toContain('({ batch, state, send })') // bag injected

    const def = compileAndLoad(MULTI, 'App')
    const container = document.createElement('div')
    const h = mountSignalComponent(container, def)
    let commits = 0
    h.subscribe(() => commits++)
    container.querySelector('button')!.dispatchEvent(new Event('click'))
    expect((h.getState() as { n: number }).n).toBe(3) // all three reducers ran
    expect(container.querySelector('.out')!.textContent).toBe('3')
    expect(commits).toBe(1) // ONE reconcile for the burst, not three
  })

  it('lowers a BLOCK-BODY row (local from item.peek() + static-from-local + handler) and runs it', () => {
    // The github-explorer file-row shape: a block-body render with a local computed
    // from item.peek(), a static icon chosen by that local, a reactive name, and a
    // handler that dispatches the row path + local. Previously fell to authoring;
    // now lowers to signalEachDirect via cross-function (block-body) lowering.
    const FILES = `
      import { component, ul, li, span, a, text, each } from '@llui/dom'
      export const App = component({
        init: () => [{ files: [{ id: 1, type: 'dir', name: 'src', path: '/src' }, { id: 2, type: 'file', name: 'README', path: '/README' }] }, []],
        update: (s, m) => (m.type === 'open' ? [{ files: s.files, opened: m.path, openedDir: m.isDir }, []] : [s, []]),
        view: ({ state, send }) => [
          ul({}, [
            each(state.at('files'), {
              key: (f) => f.id,
              render: (item) => {
                const isDir = item.peek().type === 'dir'
                return [
                  li({}, [
                    span({ class: isDir ? 'icon-dir' : 'icon-file' }, [text(isDir ? '📁' : '📄')]),
                    a({ href: '#', onClick: (e) => { e.preventDefault(); send({ type: 'open', path: item.peek().path, isDir }) } }, [text(item.at('name'))]),
                  ]),
                ]
              },
            }),
          ]),
        ],
      })
    `
    const out = transformSignalComponentSource(FILES)
    expect(out).toContain('signalEachDirect(')
    expect(out).not.toContain('signalEach(') // not the authoring fallback
    expect(out).toContain("const isDir = getCtx().item.type === 'dir'")

    const def = compileAndLoad(FILES, 'App')
    const container = document.createElement('div')
    const h = mountSignalComponent(container, def)
    const icons = (): string[] =>
      [...container.querySelectorAll('span')].map((s) => s.textContent ?? '')
    const iconClasses = (): string[] =>
      [...container.querySelectorAll('span')].map((s) => s.className)
    const names = (): string[] =>
      [...container.querySelectorAll('a')].map((a) => a.textContent ?? '')

    // static-from-local: icon glyph + class chosen by isDir; reactive name
    expect(icons()).toEqual(['📁', '📄'])
    expect(iconClasses()).toEqual(['icon-dir', 'icon-file'])
    expect(names()).toEqual(['src', 'README'])

    // handler reads the live row path + the per-row local isDir
    container.querySelectorAll('a')[0]!.dispatchEvent(new Event('click'))
    expect((h.getState() as { opened?: string; openedDir?: boolean }).opened).toBe('/src')
    expect((h.getState() as { openedDir?: boolean }).openedDir).toBe(true)
    container.querySelectorAll('a')[1]!.dispatchEvent(new Event('click'))
    expect((h.getState() as { opened?: string }).opened).toBe('/README')
    expect((h.getState() as { openedDir?: boolean }).openedDir).toBe(false)
  })

  it('lowers + runs an each inside a VIEW-HELPER function (eachDirect, items handle verbatim)', () => {
    // The documented composition default: the list `each` lives in a helper function
    // (rowsView), not the component view. Transform coverage lowers it to eachDirect —
    // items handle kept verbatim, row → factory. Verify it renders + dispatches by id.
    const HELPER = `
      import { component, ul, li, button, text, each } from '@llui/dom'
      function rowsView(items, send) {
        return [
          ul({}, [
            each(items, {
              key: (r) => r.id,
              render: (item) => [
                li({}, [button({ onClick: () => send({ type: 'pick', id: item.at('id').peek() }) }, [text(item.at('label'))])]),
              ],
            }),
          ]),
        ]
      }
      export const App = component({
        init: () => [{ rows: [{ id: 10, label: 'a' }, { id: 20, label: 'b' }] }, []],
        update: (s, m) => (m.type === 'pick' ? [{ rows: s.rows, picked: m.id }, []] : [s, []]),
        view: ({ state, send }) => rowsView(state.at('rows'), send),
      })
    `
    const out = transformSignalComponentSource(HELPER)
    expect(out).toContain('eachDirect(items, (r) => r.id,') // helper each lowered, items verbatim
    expect(out).toContain('getCtx().item.id') // handler reads live row id

    const def = compileAndLoadWithHelpers(HELPER, 'App')
    const container = document.createElement('div')
    const h = mountSignalComponent(container, def)
    const labels = (): string[] =>
      [...container.querySelectorAll('button')].map((b) => b.textContent ?? '')
    expect(labels()).toEqual(['a', 'b'])

    container.querySelectorAll('button')[1]!.dispatchEvent(new Event('click'))
    expect((h.getState() as { picked?: number }).picked).toBe(20)
    container.querySelectorAll('button')[0]!.dispatchEvent(new Event('click'))
    expect((h.getState() as { picked?: number }).picked).toBe(10)
  })

  it('lowers + runs a helper each with a STRUCTURAL-child row via the eachArm MID-TIER', () => {
    // The corpus-dominant un-lowerable shape: the row nests a `show` on a
    // helper-param handle, so the factory bails — the render arm still compiles
    // (item reads → ctx producers) and the verbatim show runs inside the row.
    // Verify: compiled item bindings live, the nested show reacts to a
    // STATE-ONLY change (items ref unchanged — the staleness case), and a
    // dispatch-by-id handler works.
    const ARM = `
      import { component, ul, li, span, button, text, each, show } from '@llui/dom'
      function rowsView(items, flag, send) {
        return [
          ul({}, [
            each(items, {
              key: (r) => r.id,
              render: (item) => [
                li({ class: 'arow' }, [
                  span({ class: 'lbl' }, [text(item.at('label'))]),
                  show(flag, () => [span({ class: 'hot' }, [text('!')])]),
                  button({ class: 'rm', onClick: () => send({ type: 'rm', id: item.at('id').peek() }) }, [text('x')]),
                ]),
              ],
            }),
          ]),
        ]
      }
      export const App = component({
        init: () => [{ rows: [{ id: 1, label: 'a' }, { id: 2, label: 'b' }], flag: false }, []],
        update: (s, m) => {
          if (m.type === 'rm') return [{ ...s, rows: s.rows.filter((r) => r.id !== m.id) }, []]
          if (m.type === 'flip') return [{ ...s, flag: !s.flag }, []]
          return [s, []]
        },
        view: ({ state, send }) => rowsView(state.at('rows'), state.at('flag'), send),
      })
    `
    const out = transformSignalComponentSource(ARM)
    expect(out).toContain('eachArm(items, (r) => r.id,') // mid-tier, items verbatim
    expect(out).toContain("signalText((ctx) => ctx.item.label, ['item.label'])")
    expect(out).toContain('show(flag') // structural child stays verbatim inside the arm
    expect(out).not.toMatch(/(?<![A-Za-z])eachDirect\(/)

    const def = compileAndLoadWithHelpers(ARM, 'App')
    const container = document.createElement('div')
    const h = mountSignalComponent(container, def)
    const txt = (sel: string): string[] =>
      [...container.querySelectorAll(sel)].map((e) => e.textContent ?? '')
    expect(txt('.lbl')).toEqual(['a', 'b'])
    expect(container.querySelectorAll('.hot').length).toBe(0)

    // nested verbatim show reacts to a state-only change (items ref unchanged)
    h.send({ type: 'flip' })
    expect(container.querySelectorAll('.hot').length).toBe(2)
    h.send({ type: 'flip' })
    expect(container.querySelectorAll('.hot').length).toBe(0)

    // dispatch-by-id removes the row (handler peeks the live row ctx)
    container.querySelectorAll('.rm')[0]!.dispatchEvent(new Event('click'))
    expect(txt('.lbl')).toEqual(['b'])
  })

  it('binds a LEAKED row param to a rowHandle and runs the verbatim helper child live', () => {
    // The delegation the factory can't reach (imperative helper body): the arm
    // lowers, `item` is bound to a real runtime handle in the prelude, and the
    // helper child runs on the authoring path INSIDE the compiled row — its
    // reactive read updates when the item changes.
    const LEAK = `
      import { component, ul, li, span, text, each } from '@llui/dom'
      function badge(item) {
        const parts = []
        parts.push(span({ class: 'b' }, [text(item.at('label'))]))
        return parts[0]
      }
      function rowsView(items) {
        return [ul({}, [each(items, {
          key: (r) => r.id,
          render: (item) => [li({ class: 'lrow' }, [badge(item)])],
        })])]
      }
      export const App = component({
        init: () => [{ rows: [{ id: 1, label: 'a' }, { id: 2, label: 'b' }] }, []],
        update: (s, m) => (m.type === 'set' ? [{ rows: m.rows }, []] : [s, []]),
        view: ({ state }) => rowsView(state.at('rows')),
      })
    `
    const out = transformSignalComponentSource(LEAK)
    expect(out).toContain('eachArm(items')
    expect(out).toContain("const item = rowHandle(getCtx, 'item')")
    expect(out).toContain('badge(item)')

    const def = compileAndLoadWithHelpers(LEAK, 'App')
    const container = document.createElement('div')
    const h = mountSignalComponent(container, def)
    const badges = (): string[] =>
      [...container.querySelectorAll('.b')].map((e) => e.textContent ?? '')
    expect(badges()).toEqual(['a', 'b'])

    // in-place item update flows through the bound handle's reactive read
    h.send({
      type: 'set',
      rows: [
        { id: 1, label: 'A!' },
        { id: 2, label: 'b' },
      ],
    })
    expect(badges()).toEqual(['A!', 'b'])

    // keyed reorder keeps each badge with its row (live ctx, not stale closure)
    h.send({
      type: 'set',
      rows: [
        { id: 2, label: 'b' },
        { id: 1, label: 'A!' },
      ],
    })
    expect(badges()).toEqual(['b', 'A!'])
  })

  it('inlines a same-file row HELPER and runs it (peek value + reactive item/state reads)', () => {
    // Phase 2: render: (item) => [rowView(item, state.at('mode'))] inlines rowView's
    // body (params → args) → a normal row that lowers. Verify: static-from-peek name,
    // reactive item count, reactive component-state mode — all live. The 'list-item'
    // class also exercises the leak-guard fix (substring 'item' must not bail).
    const INLINE = `
      import { component, div, span, text, each } from '@llui/dom'
      function rowView(item, mode) {
        const u = item.peek()
        return div({ class: 'list-item' }, [
          span({ class: 'nm' }, [text(u.name)]),
          span({ class: 'ct' }, [text(item.at('count').map((c) => String(c)))]),
          span({ class: 'md' }, [text(mode.map((m) => m + '!'))]),
        ])
      }
      export const App = component({
        init: () => [{ items: [{ id: 1, name: 'a', count: 0 }, { id: 2, name: 'b', count: 5 }], mode: 'x' }, []],
        update: (s, m) => {
          if (m.type === 'bump') return [{ ...s, items: s.items.map((it) => (it.id === m.id ? { ...it, count: it.count + 1 } : it)) }, []]
          if (m.type === 'mode') return [{ ...s, mode: m.v }, []]
          return [s, []]
        },
        view: ({ state }) => [div({}, [each(state.at('items'), { key: (it) => it.id, render: (item) => [rowView(item, state.at('mode'))] })])],
      })
    `
    const out = transformSignalComponentSource(INLINE)
    expect(out).toContain('signalEachDirect(') // helper inlined → row lowers
    expect(out).toContain('const u = getCtx().item') // peek local inlined to live ctx

    const def = compileAndLoad(INLINE, 'App')
    const container = document.createElement('div')
    const h = mountSignalComponent(container, def)
    const txt = (sel: string): string[] =>
      [...container.querySelectorAll(sel)].map((e) => e.textContent ?? '')
    expect(container.querySelectorAll('.list-item').length).toBe(2)
    expect(txt('.nm')).toEqual(['a', 'b']) // static from peek
    expect(txt('.ct')).toEqual(['0', '5']) // reactive item
    expect(txt('.md')).toEqual(['x!', 'x!']) // reactive component state

    h.send({ type: 'bump', id: 1 })
    expect(txt('.ct')).toEqual(['1', '5']) // only row 1's reactive count changed
    h.send({ type: 'mode', v: 'y' })
    expect(txt('.md')).toEqual(['y!', 'y!']) // component-state fan-out to all rows
  })

  it('inlines a BARE-call delegation (render decl + multi-root ARRAY helper) and runs it', () => {
    // The corpus-dominant real-world shape (dicerun2 grantRow): the render is a
    // bare call `(grant) => grantRow(state, grant, send)` — no array wrap — with
    // a leading peeked decl inside the HELPER, and the helper returns the
    // documented Renderable ARRAY with TWO root elements. Verify the inlined row
    // mounts both roots per row, binds reactive item/state reads, and that the
    // handler's peeked id dispatches by row (both roots removed on revoke).
    const BARE = `
      import { component, div, span, button, text, each } from '@llui/dom'
      function grantRow(st, grant, send) {
        const uid = grant.peek().id
        return [
          div({ class: 'g-main' }, [
            span({ class: 'em' }, [text(grant.at('email'))]),
            span({ class: 'fl' }, [text(st.at('flag').map((f) => f + '?'))]),
          ]),
          div({ class: 'g-detail' }, [
            button({ class: 'rv', onClick: () => send({ type: 'revoke', id: uid }) }, [text('revoke')]),
          ]),
        ]
      }
      export const App = component({
        init: () => [{ grants: [{ id: 1, email: 'a@x' }, { id: 2, email: 'b@x' }], flag: 'beta' }, []],
        update: (s, m) => {
          if (m.type === 'revoke') return [{ ...s, grants: s.grants.filter((g) => g.id !== m.id) }, []]
          if (m.type === 'flag') return [{ ...s, flag: m.v }, []]
          return [s, []]
        },
        view: ({ state, send }) => [div({}, [each(state.at('grants'), { key: (g) => g.id, render: (grant) => grantRow(state, grant, send) })])],
      })
    `
    const out = transformSignalComponentSource(BARE)
    expect(out).toContain('signalEachDirect(') // bare-call delegation inlined → direct row
    expect(out).toContain('const uid = getCtx().item.id') // helper's peek local inlined
    expect(out).toContain('_sk[1]') // two skeleton roots cloned per row

    const def = compileAndLoad(BARE, 'App')
    const container = document.createElement('div')
    const h = mountSignalComponent(container, def)
    const txt = (sel: string): string[] =>
      [...container.querySelectorAll(sel)].map((e) => e.textContent ?? '')
    expect(container.querySelectorAll('.g-main').length).toBe(2)
    expect(container.querySelectorAll('.g-detail').length).toBe(2)
    expect(txt('.em')).toEqual(['a@x', 'b@x'])
    expect(txt('.fl')).toEqual(['beta?', 'beta?'])

    h.send({ type: 'flag', v: 'ga' })
    expect(txt('.fl')).toEqual(['ga?', 'ga?']) // component-state fan-out

    // dispatch-by-id via the helper's peeked local: revoke row 1 → BOTH its roots go
    ;(container.querySelectorAll('.rv')[0] as HTMLButtonElement).click()
    expect(txt('.em')).toEqual(['b@x'])
    expect(container.querySelectorAll('.g-main').length).toBe(1)
    expect(container.querySelectorAll('.g-detail').length).toBe(1)
  })
})
