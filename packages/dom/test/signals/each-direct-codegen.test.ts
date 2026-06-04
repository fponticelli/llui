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
  const wrapped = `(function(signalText, staticText, el, react, signalShow, signalEach, signalEachDirect, signalBranch, derived, component){
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

  it('falls back to signalEach when a row has a reactive attribute', () => {
    const REACTIVE_ATTR = `
      import { component, ul, li, text, each } from '@llui/dom'
      export const App = component({
        init: () => [{ rows: [{ id: 1, label: 'a', cls: 'x' }] }, []],
        update: (s) => [s, []],
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
    const out = transformSignalComponentSource(REACTIVE_ATTR)
    expect(out).toContain('signalEach(')
    expect(out).not.toContain('signalEachDirect(')
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
