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
import { derived } from '../../src/signals/handle'
import { div, li, span, input, text, each, show } from '../../src/signals/authoring'
import type { Signal } from '../../src/signals/types'

// Regression suite for STRUCTURAL conditions (show/branch) whose discriminant
// reads the ROW ITEM or a MIXED state+item `derived` inside an `each` row — the
// shape the lance sidebar uses (folder/file split + inline rename). Three bugs the
// lance migration surfaced:
//   1. signalShow/Branch fed the cond `ctx.state`, so an item-rooted or compiled
//      (ctx-rooted) cond read the wrong root and crashed. Fixed: the cond is rooted
//      per its deps — all-row-local → full ctx; enclosing component-state → ctx.state.
//   2. The compiler did not collect a nested structural cond's component-state deps
//      into the enclosing each's reconcile deps, so rows never re-evaluated when
//      that state changed. Fixed: show/branch/each lowering feed `collect`.
//   3. A bare structural primitive as a row's top-level node corrupts reorder/
//      removal (empty-fragment anchor). Fixed: a clear authoring error.

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
  const wrapped = `(function(signalText, staticText, el, react, signalShow, signalEach, signalBranch, derived, component){
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
    signalBranch,
    derived,
    (s: unknown) => s,
  )[name] as Parameters<typeof mountSignalComponent>[1]
}

describe('compiled: structural conditions reading the row item / mixed state+item', () => {
  // The lance sidebar shape: each row is a stable <li>; an item-cond show splits
  // folder vs file; the file arm nests a derived(state, item) show for inline
  // rename. Exercises bugs 1 (cond root) and 2 (reactivity to nested cond state).
  const SIDEBAR = `
    import { component } from '@llui/dom'
    import { text, ul, li, span, input, each, show, derived } from '@llui/dom'
    export const App = component({
      init: () => [{
        items: [
          { id: 1, kind: 'folder', name: 'docs' },
          { id: 2, kind: 'file', name: 'a.md' },
          { id: 3, kind: 'file', name: 'b.md' },
        ],
        editingId: null,
      }, []],
      update: (s, m) => {
        if (m.type === 'edit') return [{ ...s, editingId: m.id }, []]
        if (m.type === 'stop') return [{ ...s, editingId: null }, []]
        if (m.type === 'reorder') return [{ ...s, items: [s.items[2], s.items[0], s.items[1]] }, []]
        return [s, []]
      },
      view: ({ state }) => [
        ul({}, [
          each(state.map((s) => s.items), {
            key: (i) => i.id,
            render: (item) => [
              li({ class: item.map((i) => 'row-' + i.kind) }, [
                show(item.map((i) => i.kind === 'folder'),
                  () => [span({ class: 'folder' }, [text(item.map((i) => i.name))])],
                  () => [
                    show(derived([state, item], (s, i) => s.editingId === i.id),
                      () => [input({ class: 'edit', value: item.map((i) => i.name) })],
                      () => [span({ class: 'file' }, [text(item.map((i) => i.name))])])
                  ])
              ])
            ],
          }),
        ]),
      ],
    })
  `

  it('mounts: item cond splits folder/file (bug 1)', () => {
    const App = compileAndLoad(SIDEBAR, 'App')
    const c = document.createElement('div')
    mountSignalComponent(c, App)
    expect(c.querySelector('.folder')?.textContent).toBe('docs')
    expect(Array.from(c.querySelectorAll('.file')).map((n) => n.textContent)).toEqual([
      'a.md',
      'b.md',
    ])
    expect(c.querySelector('input.edit')).toBeNull()
    expect(c.querySelector('li.row-folder')).not.toBeNull()
  })

  it('reacts to the derived(state, item) cond when component state changes (bug 2)', () => {
    const App = compileAndLoad(SIDEBAR, 'App')
    const c = document.createElement('div')
    const h = mountSignalComponent(c, App)
    h.send({ type: 'edit', id: 2 } as never)
    // exactly the matching file row swaps to the input; folder + other file stay
    const inputs = c.querySelectorAll('input.edit')
    expect(inputs.length).toBe(1)
    expect((inputs[0] as HTMLInputElement).value).toBe('a.md')
    expect(Array.from(c.querySelectorAll('.file')).map((n) => n.textContent)).toEqual(['b.md'])
  })

  it('moves the edit-arm between rows and reverts (no leak, no dupes)', () => {
    const App = compileAndLoad(SIDEBAR, 'App')
    const c = document.createElement('div')
    const h = mountSignalComponent(c, App)
    h.send({ type: 'edit', id: 2 } as never)
    h.send({ type: 'edit', id: 3 } as never)
    expect(c.querySelectorAll('input.edit').length).toBe(1)
    expect((c.querySelector('input.edit') as HTMLInputElement).value).toBe('b.md')
    h.send({ type: 'stop' } as never)
    expect(c.querySelector('input.edit')).toBeNull()
    expect(Array.from(c.querySelectorAll('.file')).map((n) => n.textContent)).toEqual([
      'a.md',
      'b.md',
    ])
  })

  it('a folder row cannot enter rename (item cond keeps it on the folder arm)', () => {
    const App = compileAndLoad(SIDEBAR, 'App')
    const c = document.createElement('div')
    const h = mountSignalComponent(c, App)
    h.send({ type: 'edit', id: 1 } as never) // id 1 is the folder
    expect(c.querySelector('input.edit')).toBeNull()
    expect(c.querySelector('.folder')?.textContent).toBe('docs')
  })
})

describe('authoring: structural condition reading the row item inside an each row', () => {
  interface Item {
    id: number
    kind: 'folder' | 'file'
    name: string
  }
  interface S {
    items: Item[]
  }
  const mount = (view: (s: Signal<S>) => Node[]) => {
    const c = document.createElement('div')
    const h = mountSignalComponent<S, never>(c, {
      init: () => ({
        items: [
          { id: 1, kind: 'folder', name: 'docs' },
          { id: 2, kind: 'file', name: 'a.md' },
        ],
      }),
      update: (s) => s,
      view: ({ state }) => view(state),
    })
    return { h, c }
  }

  it('show(item.map(...)) cond — wrapped row — splits arms by item', () => {
    const { c } = mount((state) => [
      each(
        state.map((s) => s.items),
        {
          key: (i) => i.id,
          render: (item) => [
            li({}, [
              show(
                item.map((i) => i.kind === 'folder'),
                () => [span({ class: 'folder' }, [text(item.map((i) => i.name))])],
                () => [span({ class: 'file' }, [text(item.map((i) => i.name))])],
              ),
            ]),
          ],
        },
      ),
    ])
    expect(c.querySelector('.folder')?.textContent).toBe('docs')
    expect(c.querySelector('.file')?.textContent).toBe('a.md')
  })
})

describe('a bare structural primitive as a row root is a clear authoring error', () => {
  interface S {
    items: { id: number; name: string }[]
    on: boolean
  }
  it('throws a guiding error instead of corrupting the DOM', () => {
    const c = document.createElement('div')
    expect(() =>
      mountSignalComponent<S, never>(c, {
        init: () => ({ items: [{ id: 1, name: 'a' }], on: false }),
        update: (s) => s,
        view: ({ state }) => [
          each(
            state.map((s) => s.items),
            {
              key: (i) => i.id,
              // show as the bare row root — no wrapping element
              render: (item) => [
                show(
                  state.map((s) => s.on),
                  () => [span({}, [text('on')])],
                  () => [span({}, [text(item.map((i) => i.name))])],
                ),
              ],
            },
          ),
        ],
      }),
    ).toThrow(/wrap the conditional body in an element/)
  })

  it('the same content wrapped in an element mounts fine', () => {
    const c = document.createElement('div')
    const h = mountSignalComponent<S, { type: 'flip' }>(c, {
      init: () => ({ items: [{ id: 1, name: 'a' }], on: false }),
      update: (s, m) => (m.type === 'flip' ? { ...s, on: !s.on } : s),
      view: ({ state }) => [
        each(
          state.map((s) => s.items),
          {
            key: (i) => i.id,
            render: (item) => [
              div([
                show(
                  state.map((s) => s.on),
                  () => [span({}, [text('on')])],
                  () => [span({}, [text(item.map((i) => i.name))])],
                ),
              ]),
            ],
          },
        ),
      ],
    })
    expect(c.textContent).toBe('a')
    h.send({ type: 'flip' })
    expect(c.textContent).toBe('on')
  })
})
