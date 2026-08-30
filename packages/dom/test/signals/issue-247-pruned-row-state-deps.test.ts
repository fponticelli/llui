import { describe, it, expect } from 'vitest'
import { mountSignalComponent } from '../../src/signals/component'
import {
  signalText,
  staticText,
  el,
  react,
  signalShow,
  signalBranch,
  signalEach,
  signalEachDirect,
  applyAttr,
} from '../../src/signals/dom'
import { rowHandle, derived } from '../../src/signals/handle'
import { compileAndLoad, identityComponent } from './compile-and-load'
import { div, ul, li, span, text, each, show, branch } from '../../src/signals/authoring'

// #247, second half — the `each`'s own dependency MASK.
//
// The #247 fix prunes the row's `state` root whenever something in scope shadows
// the name, which is correct: the reads then stay VERBATIM and the runtime
// re-roots the handle at `ctx.state`. But in PASS 1 the row's component-state
// reads are what fills `renderDeps`, and `renderDeps` is what becomes the
// structural binding's `deps`. Pruned reads are invisible to it, so the each was
// emitted as
//
//   signalEach({ items: (s) => s.rows, deps: ['rows'] }, key, () => [text(state.at('tag'))])
//
// — a mask that never intersects a `tag` change, so the row's own binding is
// never re-run and the DOM FREEZES AT MOUNT. The row is correct; the gate above
// it is not. The residue escape hatch next to it does not cover this: it fires on
// a leaked ROW PARAM (`leaked.size > 0`), not on a pruned state root.
//
// The runtime states the contract the compiler has to meet, on `eachArm`
// (`authoring.ts`): "Default to whole-state: this tier exists FOR rows with
// verbatim residue … whose state reads are unknowable." `each`/`eachArm` pass
// `WHOLE_STATE_DEPS`; the pass-1 `signalEach` is emitted with three arguments and
// so gets whatever `deps` the source spec carries.
//
// Every fixture below carries an INERT shadow — a handler parameter named
// `state`, which changes no semantics — purely to force the prune, and then
// changes ONLY a state field, never the items array reference. Anything that
// renders the mount-time value afterwards is stale.
//
// NOTE this suite exists at all because nothing else can see it: vitest runs
// authored source through esbuild, with no vite plugin, so the whole test tree is
// blind to what the compiler emits. Only a fixture put through
// `transformSignalComponentSource` and then MOUNTED observes this.

const RUNTIME = {
  signalText,
  staticText,
  el,
  react,
  signalShow,
  signalBranch,
  signalEach,
  signalEachDirect,
  applyAttr,
  rowHandle,
  derived,
  div,
  ul,
  li,
  span,
  text,
  each,
  show,
  branch,
  component: identityComponent,
}

interface Row {
  id: number
  label: string
}
interface S {
  rows: Row[]
  tag: string
  flag: boolean
  kind: 'a' | 'b'
  obj: { v: string }
  sub: string[]
}
type M = { type: 'bump' }

/** An authored component whose row body is `rowBody`. The `onClick` handler's
 * parameter is named `state`: inert at runtime, and the whole point — it shadows
 * the bag's `state` inside the row, which is what makes the compiler prune the
 * row's state root. */
const app = (rowBody: string): string => `
  import { component } from '@llui/dom'
  import { text, div, ul, li, span, each, show, branch, derived } from '@llui/dom'
  export const App = component({
    init: () => [{
      rows: [{ id: 1, label: 'a' }, { id: 2, label: 'b' }],
      tag: 'T0', flag: false, kind: 'a', obj: { v: 'V0' }, sub: ['s0'],
    }, []],
    update: (s, m) => m.type === 'bump'
      ? [{ ...s, tag: 'T1', flag: !s.flag, kind: s.kind === 'a' ? 'b' : 'a', obj: { v: 'V1' }, sub: ['s1'] }, []]
      : [s, []],
    view: ({ state }) => [
      ul([
        each(state.at('rows'), {
          key: (r) => r.id,
          render: (item) => [
            li({ onClick: (state) => { void state } }, ${rowBody}),
          ],
        }),
      ]),
    ],
  })
`

/** Mount, read the probe, send `bump`, read again. */
const runShape = (rowBody: string, read: (c: Element) => string): [string, string] => {
  const App = compileAndLoad<S, M>(app(rowBody), 'App', RUNTIME)
  const c = document.createElement('div')
  const h = mountSignalComponent(c, App)
  const before = read(c)
  h.send({ type: 'bump' })
  return [before, read(c)]
}

const firstText = (sel: string) => (c: Element) => c.querySelector(sel)?.textContent ?? '<none>'
const firstAttr = (sel: string, attr: string) => (c: Element) =>
  c.querySelector(sel)?.getAttribute(attr) ?? '<none>'

describe('#247 — a row whose `state` root was pruned still reacts to component state', () => {
  // The eight shapes the review measured as regressing, plus the attribute slot.
  // Each pins BOTH endpoints: the mount value proves the probe reads the right
  // node (a probe that finds nothing reports `<none>` in both slots and would
  // otherwise "pass" a stale render).
  const shapes: ReadonlyArray<
    readonly [name: string, rowBody: string, read: (c: Element) => string, t0: string, t1: string]
  > = [
    ['text at', `[span({ class: 'p' }, [text(state.at('tag'))])]`, firstText('.p'), 'T0', 'T1'],
    [
      'at.map',
      `[span({ class: 'p' }, [text(state.at('obj').map((o) => o.v))])]`,
      firstText('.p'),
      'V0',
      'V1',
    ],
    [
      'state.map',
      `[span({ class: 'p' }, [text(state.map((s) => s.tag))])]`,
      firstText('.p'),
      'T0',
      'T1',
    ],
    [
      'nested at',
      `[span({ class: 'p' }, [text(state.at('obj').at('v'))])]`,
      firstText('.p'),
      'V0',
      'V1',
    ],
    [
      'mixed item + state',
      `[span({ class: 'p' }, [text(derived([state, item], (s, i) => s.tag + ':' + i.label))])]`,
      firstText('.p'),
      'T0:a',
      'T1:a',
    ],
    [
      'show on state',
      `[show(state.at('flag'), () => [span({ class: 'p' }, [text('ON')])], () => [span({ class: 'p' }, [text('OFF')])])]`,
      firstText('.p'),
      'OFF',
      'ON',
    ],
    [
      'nested each on state',
      `[ul([each(state.at('sub'), { key: (x) => x, render: (sub) => [li({ class: 'p' }, [text(sub)])] })])]`,
      firstText('.p'),
      's0',
      's1',
    ],
    [
      'branch on state',
      `[branch(state.at('kind'), { a: () => [span({ class: 'p' }, [text('A')])], b: () => [span({ class: 'p' }, [text('B')])] })]`,
      firstText('.p'),
      'A',
      'B',
    ],
    [
      'attribute slot',
      `[span({ class: 'p', 'data-t': state.at('tag') }, [text('x')])]`,
      firstAttr('.p', 'data-t'),
      'T0',
      'T1',
    ],
  ]

  for (const [name, rowBody, read, t0, t1] of shapes) {
    it(`${name}: the row updates when only component state changes`, () => {
      expect(runShape(rowBody, read)).toEqual([t0, t1])
    })
  }

  // The control: with NO shadow the state root survives, the deps are PRECISE
  // (`['rows','tag']`, not whole-state), and the row still reacts. This is what
  // keeps the repair from being "push `''` on every each".
  it('no shadow: the root survives, deps stay precise, and the row still reacts', () => {
    const AUTHORED = `
      import { component } from '@llui/dom'
      import { text, ul, li, span, each } from '@llui/dom'
      export const App = component({
        init: () => [{ rows: [{ id: 1, label: 'a' }], tag: 'T0', flag: false, kind: 'a', obj: { v: 'V0' }, sub: [] }, []],
        update: (s, m) => m.type === 'bump' ? [{ ...s, tag: 'T1' }, []] : [s, []],
        view: ({ state }) => [
          ul([
            each(state.at('rows'), {
              key: (r) => r.id,
              render: (item) => [li([span({ class: 'p' }, [text(state.at('tag'))])])],
            }),
          ]),
        ],
      })
    `
    const App = compileAndLoad<S, M>(AUTHORED, 'App', RUNTIME)
    const c = document.createElement('div')
    const h = mountSignalComponent(c, App)
    expect(firstText('.p')(c)).toBe('T0')
    h.send({ type: 'bump' })
    expect(firstText('.p')(c)).toBe('T1')
  })

  // A row that reads NO component state must not be widened to whole-state by the
  // repair — that would sweep every row on every unrelated change.
  it('a row reading no component state keeps its items-only deps', () => {
    const AUTHORED = `
      import { component } from '@llui/dom'
      import { text, ul, li, span, each } from '@llui/dom'
      export const App = component({
        init: () => [{ rows: [{ id: 1, label: 'a' }], tag: 'T0' }, []],
        update: (s, m) => [s, []],
        view: ({ state }) => [
          ul([
            each(state.at('rows'), {
              key: (r) => r.id,
              render: (item) => [li({ onClick: (state) => { void state } }, [span({ class: 'p' }, [text(item.at('label'))])])],
            }),
          ]),
        ],
      })
    `
    const App = compileAndLoad<S, M>(AUTHORED, 'App', RUNTIME)
    const c = document.createElement('div')
    mountSignalComponent(c, App)
    expect(firstText('.p')(c)).toBe('a')
  })
})
