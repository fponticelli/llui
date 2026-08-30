import { describe, it, expect } from 'vitest'
import { transformSignalComponentSource } from '../parsed.js'

// #247 — an `each` row rebased the bare name `state` onto the COMPONENT state
// unconditionally.
//
// A row's `ctx.state` is `RowCtx.state`, i.e. the mounted component's whole
// state object. `eachRoots` (and `handlerRoots`) keyed that root on the literal
// spelling `'state'`, with no check that anything in scope actually denoted it —
// so a view HELPER's parameter of that name, which is the composition pattern
// CLAUDE.md recommends, was silently rebased onto the app root:
//
//   plot(state: Signal<ChartState>, …)   called as plot(state.at('share'), …)
//   →  const _bd0 = ['state.activeIndex']; const _bp0 = (ctx) => ctx.state.activeIndex
//
// It compiles, type-checks and renders — against a different object. Found twice
// independently: once by reading emitted code, once from a rendered page, where a
// pie chart's tooltip swatch was orange for every slice while the label beside it
// named the right browser. The verdict turned purely on the SPELLING: renaming
// the parameter to `slice` made the tier decline and emit a correct arm.
//
// The fix prunes the root with `scopeIntroduces` — the repo's shared shadowing
// predicate — against the enclosing chain up to the component `view` that binds
// the state, and against the row render callback's whole subtree. The name also
// comes from the view's LOCAL alias rather than the spelling `state`, so an
// aliased bag (`view: ({ state: st }) => …`) rebases `st` and leaves a bare
// `state` alone.
//
// Pruning is the safe direction: a name absent from the roots is not a signal
// expression, so the direct tier declines (`row-prop-reads-nonroot-signal` /
// `row-slot-free-identifier`) and the row lowers as an ARM where `el`/`text`
// consume the real handle.

const HEAD = [
  "import { each, ul, li, text, show, component } from '@llui/dom'",
  "import type { Renderable, Signal } from '@llui/dom'",
].join('\n')

const tx = (src: string): string => transformSignalComponentSource(src)

describe('#247 — the each row `state` root is pruned by lexical shadowing', () => {
  describe('a view helper is never the component state', () => {
    it('a helper PARAMETER named `state` is left verbatim in an attribute slot', () => {
      const out = tx(`${HEAD}
export function rows(items: Signal<string[]>, state: Signal<string>): Renderable {
  return [each(items, {
    key: (i: string) => i,
    render: (item) => [li({ 'data-s': state }, [text(item)])],
  })]
}
`)
      expect(out).not.toContain('ctx.state')
      expect(out).not.toContain("'state'")
      expect(out).toContain("'data-s': state")
      expect(out).toContain('eachArm(')
    })

    it('a helper PARAMETER named `state` keeps its own `.at()` path (no rebase)', () => {
      const out = tx(`${HEAD}
export function rows(items: Signal<string[]>, state: Signal<{ label: string }>): Renderable {
  return [each(items, {
    key: (i: string) => i,
    render: (item) => [li({}, [text(state.at('label')), text(item)])],
  })]
}
`)
      expect(out).not.toContain('ctx.state')
      expect(out).not.toContain("'state.label'")
      expect(out).toContain("text(state.at('label'))")
    })

    it('a helper parameter named `state` read via .peek() in a HANDLER is not rewritten to getCtx().state', () => {
      const out = tx(`${HEAD}
export function rows(items: Signal<string[]>, state: Signal<{ mode: string }>, send: (m: unknown) => void): Renderable {
  return [each(items, {
    key: (i: string) => i,
    render: (item) => [li({ onClick: () => send({ type: 'x', m: state.at('mode').peek() }) }, [text(item)])],
  })]
}
`)
      expect(out).not.toContain('getCtx().state')
      expect(out).toContain("state.at('mode').peek()")
    })

    it('an enclosing BLOCK `const state` shadows the name too', () => {
      const out = tx(`${HEAD}
export function rows(items: Signal<string[]>, other: Signal<string>): Renderable {
  const state = other
  return [each(items, {
    key: (i: string) => i,
    render: (item) => [li({ 'data-s': state }, [text(item)])],
  })]
}
`)
      expect(out).not.toContain('ctx.state')
      expect(out).toContain("'data-s': state")
    })

    it('a MODULE-scope `state` in a helper is not the component state either', () => {
      const out = tx(`${HEAD}
declare const state: Signal<{ mode: string }>
export function rows(items: Signal<string[]>): Renderable {
  return [each(items, {
    key: (i: string) => i,
    render: (item) => [li({ 'data-m': state.at('mode') }, [text(item)])],
  })]
}
`)
      expect(out).not.toContain('ctx.state')
      expect(out).toContain("'data-m': state.at('mode')")
    })
  })

  describe('a genuine component-state read still rebases', () => {
    const view = (bag: string, read: string): string => `${HEAD}
type State = { rows: string[]; mode: string }
type Msg = { type: 'x' }
export const C = component<State, Msg, never>({
  name: 'C',
  init: () => ({ rows: [], mode: 'a' }),
  update: (s: State) => [s, []],
  view: (${bag}) => [each(${read}.at('rows'), {
    key: (i: string) => i,
    render: (item) => [li({ 'data-m': ${read}.at('mode') }, [text(item)])],
  })],
})
`

    it('the bag `state` rebases onto ctx.state with a precise dep', () => {
      const out = tx(view('{ state }', 'state'))
      expect(out).toContain('(ctx) => ctx.state.mode')
      expect(out).toContain("['state.mode']")
      // and the each's own mask stays PRECISE — this is the control for the
      // whole-state widening the pruned case takes below.
      expect(out).toContain("deps: ['rows', 'mode']")
    })

    it('an ALIASED bag rebases the alias — the local name is what counts', () => {
      const out = tx(view('{ state: st }', 'st'))
      expect(out).toContain('(ctx) => ctx.state.mode')
      expect(out).toContain("['state.mode']")
    })

    it('under an aliased bag a bare `state` is NOT the component state', () => {
      const out = tx(`${HEAD}
declare const state: Signal<{ mode: string }>
type State = { rows: string[]; mode: string }
type Msg = { type: 'x' }
export const C = component<State, Msg, never>({
  name: 'C',
  init: () => ({ rows: [], mode: 'a' }),
  update: (s: State) => [s, []],
  view: ({ state: st }) => [each(st.at('rows'), {
    key: (i: string) => i,
    render: (item) => [li({ 'data-m': state.at('mode') }, [text(item)])],
  })],
})
`)
      expect(out).not.toContain('ctx.state')
      expect(out).toContain("'data-m': state.at('mode')")
    })

    it('a NESTED each still sees the component state in its inner row', () => {
      const out = tx(`${HEAD}
type State = { groups: { rows: string[] }[]; mode: string }
type Msg = { type: 'x' }
export const C = component<State, Msg, never>({
  name: 'C',
  init: () => ({ groups: [], mode: 'a' }),
  update: (s: State) => [s, []],
  view: ({ state }) => [each(state.at('groups'), {
    key: (g: { rows: string[] }) => g.rows.length,
    render: (group) => [ul({}, [each(group.at('rows'), {
      key: (i: string) => i,
      render: (item) => [li({ 'data-m': state.at('mode') }, [text(item)])],
    })])],
  })],
})
`)
      expect(out).toContain('(ctx) => ctx.state.mode')
    })
  })

  describe('the row itself shadows the name', () => {
    // Be exact about what the pre-fix render looked like, because the two
    // spellings fail differently and "it rendered the state object" is only true
    // of one: `text(state)` emitted `produce: (ctx) => ctx.state`, so the row
    // stringified the whole state OBJECT, while `text(state.at('label'))`
    // emitted `ctx.state.label` — a field the component state does not have —
    // and rendered EMPTY. Same defect, and the empty one is the quieter half.
    it('a row PARAM named `state` is the ITEM, not the component state', () => {
      const out = tx(`${HEAD}
type State = { rows: string[]; mode: string }
type Msg = { type: 'x' }
export const C = component<State, Msg, never>({
  name: 'C',
  init: () => ({ rows: [], mode: 'a' }),
  update: (s: State) => [s, []],
  view: ({ state }) => [each(state.at('rows'), {
    key: (i: string) => i,
    render: (state) => [li({}, [text(state)])],
  })],
})
`)
      expect(out).toContain('(ctx) => ctx.item')
      expect(out).not.toContain('ctx.state')
    })

    // Only a HANDLE-valued local is a manifestation. A VALUE-valued one
    // (`const state = item.peek()`) is byte-identical on both compilers —
    // `state.label` is a plain property read, never a signal expression, so no
    // root was ever consulted. Do not cite it as a fourth broken shape.
    it('a row BLOCK-BODY local named `state` shadows it', () => {
      const out = tx(`${HEAD}
type State = { rows: string[]; mode: string }
type Msg = { type: 'x' }
export const C = component<State, Msg, never>({
  name: 'C',
  init: () => ({ rows: [], mode: 'a' }),
  update: (s: State) => [s, []],
  view: ({ state }) => [each(state.at('rows'), {
    key: (i: string) => i,
    render: (item) => { const state = item; return [li({}, [text(state)])] },
  })],
})
`)
      expect(out).not.toContain('ctx.state')
      expect(out).toContain('const state = item')
      expect(out).toContain('text(state)')
    })

    // The ENCLOSING-CHAIN half, positive form: an OUTER each's row param named
    // `state` re-binds the name for everything inside its row, so the INNER each
    // must read the outer ITEM, not the component state. Both eaches lower here,
    // so the assertion is on real emitted output rather than on a bail.
    it('an OUTER row param named `state` shadows it for the INNER each', () => {
      const out = tx(`${HEAD}
type State = { groups: { rows: string[]; title: string }[] }
type Msg = { type: 'x' }
export const C = component<State, Msg, never>({
  name: 'C',
  init: () => ({ groups: [] }),
  update: (s: State) => [s, []],
  view: ({ state }) => [each(state.at('groups'), {
    key: (g: { title: string }) => g.title,
    render: (state) => [ul({}, [each(state.at('rows'), {
      key: (i: string) => i,
      render: (item) => [li({ 'data-t': state.at('title') }, [text(item)])],
    })])],
  })],
})
`)
      // the outer row's own reads rebase onto the outer ITEM…
      expect(out).toContain('ctx.item.rows')
      // …and the inner row never reaches the component state.
      expect(out).not.toContain('ctx.state')
    })

    // The ENCLOSING-CHAIN half again, through a `show` arm's NARROWED param. The
    // fixed compiler leaves this whole tree verbatim (the arm bails on the param
    // leak, and pass 2 then declines the each because `state` is shadowed); the
    // point of the assertion is that no path reaches `ctx.state`, which pass 2
    // does take without the enclosing walk.
    it('a `show` arm param named `state` shadows it between the each and the view', () => {
      const out = tx(`${HEAD}
type State = { panel: { rows: string[]; title: string } | null }
type Msg = { type: 'x' }
export const C = component<State, Msg, never>({
  name: 'C',
  init: () => ({ panel: null }),
  update: (s: State) => [s, []],
  view: ({ state }) => [show(state.at('panel'), (state) => [
    ul({}, [each(state.at('rows'), {
      key: (i: string) => i,
      render: (item) => [li({ 'data-t': state.at('title') }, [text(item)])],
    })]),
  ])],
})
`)
      expect(out).not.toContain('ctx.state')
      expect(out).toContain("'data-t': state.at('title')")
    })

    // The POST-INLINING half: the call site can only see the DELEGATING render
    // (`(item) => [rowHelper(item)]`), which binds nothing. The helper's body is
    // then relocated INTO the row, bringing its own `const state` with it.
    //
    // State the coverage honestly: TODAY this row is already declined for an
    // unrelated reason (`each-direct: row-local-signal-alias` — a handle-valued
    // block-body local is opaque to the static tracer), so `lowerRowFactory`'s
    // post-inlining re-check is not what makes it pass, and a mutation of that
    // line survives. The property is still the one worth pinning: inlining is a
    // RELOCATION the call-site check cannot see.
    it('a `state` bound inside an INLINED row helper shadows it', () => {
      const out = tx(`${HEAD}
type State = { rows: { l: string }[]; mode: string }
type Msg = { type: 'x' }
function rowHelper(row: Signal<{ l: string }>): Renderable {
  const state = row
  return [li({}, [text(state.at('l'))])]
}
export const C = component<State, Msg, never>({
  name: 'C',
  init: () => ({ rows: [], mode: 'a' }),
  update: (s: State) => [s, []],
  view: ({ state }) => [each(state.at('rows'), {
    key: (r: { l: string }) => r.l,
    render: (item) => [rowHelper(item)],
  })],
})
`)
      expect(out).not.toContain('ctx.state')
    })

    it('a nested handler PARAM named `state` shadows it (subtree, not just the row params)', () => {
      const out = tx(`${HEAD}
type State = { rows: string[]; mode: string }
type Msg = { type: 'x' }
export const C = component<State, Msg, never>({
  name: 'C',
  init: () => ({ rows: [], mode: 'a' }),
  update: (s: State) => [s, []],
  view: ({ state, send }) => [each(state.at('rows'), {
    key: (i: string) => i,
    render: (item) => [li({ onClick: (state: MouseEvent) => send({ type: 'x', m: String(state) }) }, [text(item)])],
  })],
})
`)
      expect(out).not.toContain('ctx.state')
      expect(out).not.toContain('getCtx().state')
    })
  })

  // Pruning is only half the fix. In PASS 1 the row's component-state reads are
  // what fill `renderDeps`, and `renderDeps` becomes the structural binding's
  // `deps` — so a pruned read is invisible to the gate ABOVE the row, the mask
  // never intersects the path the row actually reads, and the row FREEZES AT
  // MOUNT. Correct row, wrong gate; `emitSource`'s residue flag therefore takes
  // `rowStateName === null` as well as a leaked row param.
  //
  // This is the emitted-shape guard. The behavioural one — mount, change only
  // component state, read the DOM back — is
  // `packages/dom/test/signals/issue-247-pruned-row-state-deps.test.ts`, and it
  // is the only place the staleness is actually observable: nothing in a vitest
  // run puts a test file through the vite plugin.
  describe('a pruned row keeps the each reconciling (the dependency MASK)', () => {
    const shadowed = (rowBody: string): string =>
      tx(`${HEAD}
type State = { rows: string[]; tag: string }
type Msg = { type: 'x' }
export const C = component<State, Msg, never>({
  name: 'C',
  init: () => ({ rows: [], tag: 'T' }),
  update: (s: State) => [s, []],
  view: ({ state, send }) => [each(state.at('rows'), {
    key: (i: string) => i,
    render: (item) => [li({ onClick: (state: MouseEvent) => { void state; void send } }, ${rowBody})],
  })],
})
`)

    it('widens the each source deps to whole-state when the root is pruned', () => {
      const out = shadowed(`[text(state.at('tag'))]`)
      // the read itself stays verbatim (that half is correct on its own)…
      expect(out).toContain("text(state.at('tag'))")
      // …and the each's mask degrades to whole-state so the row still reconciles
      expect(out).toContain("deps: ['rows', '']")
    })

    it('a pruned row that reads NO component state keeps its PRECISE deps', () => {
      // The widening rides on the ARM path only, and a row with nothing to read
      // verbatim still reaches the DIRECT tier, whose deps come from the
      // bindings it actually emitted. That is what bounds the cost: a pruned
      // root does not widen every list, only the ones that fell to an arm.
      // (A pruned row CANNOT reach the direct tier with a reactive state read —
      // such a slot declines it as `row-prop/text-reads-nonroot-signal` — so the
      // direct tier's precise deps are still complete.)
      const out = shadowed(`[text(item)]`)
      expect(out).toContain('signalEachDirect(')
      expect(out).toContain("deps: ['rows']")
      expect(out).not.toContain("deps: ['rows', '']")
    })
  })

  // The one shape where the item root and the state root can want the SAME name:
  // the render takes no identifier param (so `itemParam` is the default `'item'`)
  // and the view aliased its bag as `({ state: item })`. Nothing in the row binds
  // `item`, so it resolves OUTWARD — to the state. This is why `eachRoots` writes
  // the state root LAST.
  it('a bag aliased to `item` beside a param-less render still means the STATE', () => {
    const out = tx(`${HEAD}
type State = { rows: string[]; mode: string }
type Msg = { type: 'x' }
export const C = component<State, Msg, never>({
  name: 'C',
  init: () => ({ rows: [], mode: 'a' }),
  update: (s: State) => [s, []],
  view: ({ state: item }) => [each(item.at('rows'), {
    key: (i: string) => i,
    render: () => [li({ 'data-m': item.at('mode') }, [])],
  })],
})
`)
    expect(out).toContain('ctx.state.mode')
    expect(out).not.toContain('ctx.item.mode')
  })

  // The view is recognized by IMPORT PROVENANCE, like every other helper in this
  // file — a `component()` that is not `@llui/dom`'s binds no component state, so
  // its bag's `state` must not be rebased onto a row ctx.
  it('a NON-framework `component()` config is not a signal view', () => {
    const out = tx(`${HEAD}
import { component as component2 } from './not-llui'
type Row = { rows: string[]; mode: string }
export const C = component2({
  view: ({ state }: { state: Signal<Row> }) => [each(state.at('rows'), {
    key: (i: string) => i,
    render: (item) => [li({ 'data-m': state.at('mode') }, [text(item)])],
  })],
})
`)
    expect(out).not.toContain('ctx.state')
    expect(out).toContain("'data-m': state.at('mode')")
  })

  // The issue's own open question, re-measured: `item`/`index` do NOT share the
  // exposure, because `eachRoots(itemParam)` keys the item root on the ACTUAL row
  // parameter name while `'state'` was hardcoded. This is the non-regression half
  // — the fix must not start rebasing them either.
  describe('item / index parity (they never had the exposure)', () => {
    const helperWithParam = (name: string): string =>
      tx(`${HEAD}
export function rows(items: Signal<string[]>, ${name}: Signal<string>): Renderable {
  return [each(items, {
    key: (i: string) => i,
    render: (row) => [li({}, [text(${name}), text(row)])],
  })]
}
`)

    it('a helper parameter named `item` stays verbatim while the ROW param still lowers', () => {
      const out = helperWithParam('item')
      // the helper's own handle survives as written…
      expect(out).toContain('text(item)')
      // …and the row's read still lowers, keyed on the ACTUAL row param (`row`).
      expect(out).toContain("signalText((ctx) => ctx.item, ['item'])")
    })

    it('a helper parameter named `index` stays verbatim and never reaches ctx.index', () => {
      const out = helperWithParam('index')
      expect(out).toContain('text(index)')
      expect(out).not.toContain('ctx.index')
    })
  })
})
