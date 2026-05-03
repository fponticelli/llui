import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform'

function t(source: string): string {
  const result = transformLlui(source, 'test.ts')
  return result?.output ?? source
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

describe('Pass 1 — element helper → elSplit', () => {
  it('transforms fully static div() to template clone', () => {
    const src = `
      import { div } from '@llui/dom'
      const el = div({ class: 'foo', id: 'bar' })
    `
    const out = t(src)
    // Fully static — should emit __cloneStaticTemplate(html). The helper
    // lives in @llui/dom and threads through ctx.dom for SSR correctness.
    expect(out).toContain('__cloneStaticTemplate')
    expect(out).toContain('foo')
  })

  it('transforms div() with reactive props to elSplit', () => {
    const src = `
      import { component, div } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ title: '' }, []],
        update: (s, m) => [s, []],
        view: () => [div({ title: s => s.title, class: 'static' })],
      })
    `
    const out = t(src)
    expect(out).toContain('elSplit')
  })

  it('transforms event handlers into events array', () => {
    const src = `
      import { button } from '@llui/dom'
      const el = button({ onClick: handler })
    `
    const out = t(src)
    expect(out).toContain('elSplit')
    expect(out).toMatch(/["']click["']/)
    expect(out).toContain('handler')
  })

  it('transforms reactive props into bindings array with masks', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ title: '' }, []],
        update: (s, m) => [s, []],
        view: (send) => [
          div({ title: s => s.title }),
        ],
      })
    `
    const out = t(src)
    expect(out).toContain('elSplit')
    // Should have a binding tuple with mask
    expect(out).toMatch(/\[\s*1\s*,/) // mask = 1 (first path)
  })

  it('passes children through', () => {
    const src = `
      import { div, text } from '@llui/dom'
      const el = div({ class: 'box' }, [text(s => s.label)])
    `
    const out = t(src)
    expect(out).toContain('elSplit')
    expect(out).toContain('text')
  })

  it('bails out on non-literal props (variable)', () => {
    const src = `
      import { div } from '@llui/dom'
      const props = { class: 'foo' }
      const el = div(props)
    `
    const out = t(src)
    // Should NOT transform to elSplit — bail out
    expect(out).toContain('div(props)')
  })
})

describe('reactive prop value resolution — non-arrow Identifier/CallExpression', () => {
  // Bug repro for: "disabled attribute binding never re-evaluates when
  // accessor is a named-function reference (or memo() result)".
  //
  // Universal contract for prop values at reactive positions:
  //   The compiler MUST NOT silently downgrade a function-typed value
  //   into a static prop assignment (`__e.disabled = identifier`) or,
  //   worse, drop it via the static-template-clone path
  //   (`__cloneStaticTemplate("<button></button>")`).
  //
  // Either of those produces a button whose `disabled` property is
  // bound once at mount and never re-evaluates — even though the
  // runtime helper handles function-typed values correctly when no
  // compiler is involved (verified by the runtime-only test in
  // packages/dom/test/runtime-disabled-binding.test.ts).
  //
  // The compiler can either:
  //   (a) Emit it as a binding entry, OR
  //   (b) Bail the element back to the runtime helper.
  // Both preserve correctness; static assignment / template drop do not.

  function asserts(out: string, identifier: string) {
    // Forbid the buggy shapes regardless of which fix path is taken.
    expect(out).not.toMatch(new RegExp(`__e\\.disabled\\s*=\\s*${identifier}`))
    // Forbid the catastrophic "prop dropped via static template" shape:
    // a button template with no disabled attribute (we used disabled,
    // and the only other content is empty).
    expect(out).not.toMatch(/__cloneStaticTemplate\("<button><\/button>"\)/)
  }

  it('module-scope const-bound arrow → emits a reactive binding (works today)', () => {
    const src = `
      import { component, button } from '@llui/dom'
      type State = { gated: boolean }
      const isGated = (s: State): boolean => s.gated
      export const C = component({
        name: 'C',
        init: () => [{ gated: true }, []],
        update: (s, _m) => [s, []],
        view: () => [button({ disabled: isGated })],
      })
    `
    const out = t(src)
    expect(out).toContain('elSplit')
    asserts(out, 'isGated')
    expect(out).toMatch(/['"]prop['"]\s*,\s*['"]disabled['"]/)
  })

  it('view-scope const-bound arrow → emits a reactive binding (works today)', () => {
    const src = `
      import { component, button } from '@llui/dom'
      type State = { gated: boolean }
      export const C = component({
        name: 'C',
        init: () => [{ gated: true }, []],
        update: (s, _m) => [s, []],
        view: () => {
          const isGated = (s: State): boolean => s.gated
          return [button({ disabled: isGated })]
        },
      })
    `
    const out = t(src)
    expect(out).toContain('elSplit')
    asserts(out, 'isGated')
    expect(out).toMatch(/['"]prop['"]\s*,\s*['"]disabled['"]/)
  })

  it('memo()-wrapped accessor (alone on element) → must not be silently dropped', () => {
    // BUG: today the compiler emits `__cloneStaticTemplate("<button></button>")`,
    // dropping the prop entirely.
    const src = `
      import { component, button } from '@llui/dom'
      type State = { gated: boolean }
      export const C = component({
        name: 'C',
        init: () => [{ gated: true }, []],
        update: (s, _m) => [s, []],
        view: ({ memo }) => {
          const isGatedMemo = memo((s: State) => s.gated)
          return [button({ disabled: isGatedMemo })]
        },
      })
    `
    const out = t(src)
    asserts(out, 'isGatedMemo')
  })

  it('memo()-wrapped accessor + sibling reactive arrow → must not become a static assignment', () => {
    // BUG: today the compiler emits
    //   elSplit("button", __e => { __e.disabled = isGatedMemo; }, ...)
    // which writes the function object onto the boolean property at mount,
    // and never re-evaluates.
    const src = `
      import { component, button } from '@llui/dom'
      type State = { gated: boolean }
      export const C = component({
        name: 'C',
        init: () => [{ gated: true }, []],
        update: (s, _m) => [s, []],
        view: ({ memo }) => {
          const isGatedMemo = memo((s: State) => s.gated)
          return [
            button({
              disabled: isGatedMemo,
              title: (s: State) => (s.gated ? 'gated' : 'open'),
            }),
          ]
        },
      })
    `
    const out = t(src)
    expect(out).toContain('elSplit')
    expect(out).toMatch(/['"]attr['"]\s*,\s*['"]title['"]/)
    asserts(out, 'isGatedMemo')
  })

  it('module-scope function declaration (alone on element) → must not be silently dropped', () => {
    // BUG: today the compiler emits __cloneStaticTemplate("<button></button>"),
    // dropping the prop entirely. resolveLocalConstInitializer only
    // handles `const` declarations, not `function` declarations.
    const src = `
      import { component, button } from '@llui/dom'
      type State = { gated: boolean }
      function isGated(s: State): boolean { return s.gated }
      export const C = component({
        name: 'C',
        init: () => [{ gated: true }, []],
        update: (s, _m) => [s, []],
        view: () => [button({ disabled: isGated })],
      })
    `
    const out = t(src)
    asserts(out, 'isGated')
  })

  it('imported named function (alone on element) → must not be silently dropped', () => {
    // BUG: today the compiler emits __cloneStaticTemplate("<button></button>"),
    // dropping the prop entirely. Imported identifiers cannot be
    // resolved by the file-local resolver and so fall through to the
    // static path.
    const src = `
      import { component, button } from '@llui/dom'
      import { isGated } from './guards'
      type State = { gated: boolean }
      export const C = component({
        name: 'C',
        init: () => [{ gated: true }, []],
        update: (s, _m) => [s, []],
        view: () => [button({ disabled: isGated })],
      })
    `
    const out = t(src)
    asserts(out, 'isGated')
  })

  // ── Pass 2 mask injection: same value-shape contract for the driver
  // accessor of text() / show() / branch() / each(). Without identifier
  // resolution, the perf optimization (precise mask) is silently lost
  // when an author refactors a literal arrow into a named function.
  // Runtime stays correct (FULL_MASK fallback) — these tests guard the
  // optimization, not correctness.

  it('Pass 2 injects mask for text() with const-bound arrow ref', () => {
    // Sibling inline arrow in the file seeds fieldBits with `count`.
    const src = `
      import { component, div, text } from '@llui/dom'
      type State = { count: number; label: string }
      const getLabel = (s: State) => s.label
      export const C = component({
        name: 'C',
        init: () => [{ count: 0, label: '' }, []],
        update: (s, _m) => [s, []],
        view: () => [div([
          text((s: State) => String(s.count)),
          text(getLabel),
        ])],
      })
    `
    const out = t(src)
    // text(getLabel) must end up with a numeric second arg — even if it's
    // FULL_MASK (collectDeps doesn't visit module-scope const arrows, so
    // `label` may not be in the bit table; the runtime falls back safely).
    expect(out).toMatch(/text\(getLabel,\s*[\d|\s|0xff]+\)/)
  })

  it('Pass 2 injects __mask for show() driver when fieldBits already contains the path', () => {
    // Sibling inline arrow ALSO reads `gated`, so `gated` is in fieldBits.
    // The fn-decl-referenced `whenGated` then gets its precise mask injected.
    const src = `
      import { component, div, text } from '@llui/dom'
      type State = { gated: boolean; label: string }
      function whenGated(s: State): boolean { return s.gated }
      export const C = component({
        name: 'C',
        init: () => [{ gated: true, label: '' }, []],
        update: (s, _m) => [s, []],
        view: ({ show }) => [div([
          text((s: State) => s.label + (s.gated ? '!' : '')),
          show({ when: whenGated, render: () => [text('x')] }),
        ])],
      })
    `
    const out = t(src)
    // show() must end up with __mask injected — the driver's fn-decl body
    // reads `gated`, which is already in fieldBits (the inline arrow reads
    // it too).
    expect(out).toMatch(/show\(\{[\s\S]*?__mask:\s*\d/)
  })

  // ── collect-deps follow: named-function bodies seed fieldBits.
  // Without this, files where every accessor is a named ref produce
  // empty fieldBits → mask injection resolves to FULL_MASK → runtime is
  // correct but bitmask gating is a no-op. These tests guard the
  // identifier-following extension to `collectStatePathsFromSource`.

  it('collectDeps sees paths from a function declaration referenced as text() arg', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      type State = { label: string }
      function getLabel(s: State): string { return s.label }
      export const C = component({
        name: 'C',
        init: () => [{ label: '' }, []],
        update: (s, _m) => [s, []],
        view: () => [div([text(getLabel)])],
      })
    `
    const out = t(src)
    // Precise mask: `label` got bit 1 because the fn-decl body was
    // followed and its `s.label` read counted.
    expect(out).toMatch(/text\(getLabel,\s*1\)/)
    expect(out).toContain('__maskLegend')
    expect(out).toMatch(/"label":\s*1/)
  })

  it('collectDeps sees paths from a function declaration referenced as element prop', () => {
    const src = `
      import { component, button } from '@llui/dom'
      type State = { gated: boolean }
      function isGated(s: State): boolean { return s.gated }
      export const C = component({
        name: 'C',
        init: () => [{ gated: true }, []],
        update: (s, _m) => [s, []],
        view: () => [button({ disabled: isGated })],
      })
    `
    const out = t(src)
    // Precise mask in the binding tuple: `[1, "prop", "disabled", isGated]`
    expect(out).toMatch(/\[1,\s*['"]prop['"],\s*['"]disabled['"],\s*isGated\]/)
    expect(out).toMatch(/"gated":\s*1/)
  })

  it('collectDeps sees paths from a const-bound arrow referenced at a reactive position', () => {
    // The const-bound arrow's parent is VariableDeclaration — the arrow
    // walker alone wouldn't extract its paths, even though the identifier
    // is used reactively.
    const src = `
      import { component, button } from '@llui/dom'
      type State = { gated: boolean }
      const isGated = (s: State): boolean => s.gated
      export const C = component({
        name: 'C',
        init: () => [{ gated: true }, []],
        update: (s, _m) => [s, []],
        view: () => [button({ disabled: isGated })],
      })
    `
    const out = t(src)
    // Precise mask: `gated` got bit 1.
    // Note: the existing inliner replaces the Identifier with the arrow,
    // so the binding tuple value is the arrow itself, not the identifier.
    expect(out).toMatch(/\[1,\s*['"]prop['"],\s*['"]disabled['"]/)
    expect(out).toMatch(/"gated":\s*1/)
  })

  it('collectDeps sees paths from `const x = memo(arrow)` at a reactive position when used by identifier', () => {
    const src = `
      import { component, button } from '@llui/dom'
      type State = { count: number; gated: boolean }
      export const C = component({
        name: 'C',
        init: () => [{ count: 0, gated: true }, []],
        update: (s, _m) => [s, []],
        view: ({ memo }) => {
          const isGatedMemo = memo((s: State) => s.gated)
          return [button({ disabled: isGatedMemo })]
        },
      })
    `
    const out = t(src)
    // The inner arrow inside memo() is already walked by the arrow visitor
    // (its parent is the memo() call) — but THIS test confirms the
    // identifier-at-reactive-position path also doesn't pollute the
    // fieldBits with stray bits (e.g. it doesn't add `count`, only `gated`).
    expect(out).toMatch(/\[1,\s*['"]prop['"],\s*['"]disabled['"],\s*isGatedMemo\]/)
    expect(out).toMatch(/"gated":\s*1/)
    expect(out).not.toMatch(/"count"/)
  })

  it('does not pollute fieldBits when an identifier resolves to a non-callable (sample/imported/etc.)', () => {
    // Defensive: identifiers at reactive positions whose resolution
    // doesn't produce a callable (or doesn't resolve at all) must not
    // contribute paths.
    const src = `
      import { component, button, sample } from '@llui/dom'
      import { externalGuard } from './guards'
      type State = { count: number }
      const sampled = sample((s: State) => s.count)
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, _m) => [s, []],
        view: () => [
          button({ disabled: externalGuard }, [text((s: State) => String(s.count))]),
        ],
      })
    `
    const out = t(src)
    // Even though we can't resolve `externalGuard`, the inline `text`
    // arrow's `count` path must still be extracted and bit-numbered.
    expect(out).toMatch(/"count":\s*1/)
  })

  // ── Delegating accessor regression: a resolved accessor whose body
  // delegates to ANOTHER local helper must contribute the helper's
  // state-path reads to fieldBits — otherwise the precise mask
  // under-counts and a sibling reactive accessor that reads only the
  // missing fields drives a non-zero `dirty` that AND'd with the
  // narrow each.__mask is zero, silently skipping the reconcile.

  it('follows local-helper CallExpression to extract the helper body’s state paths', () => {
    // The dicerun2 pattern. `visibleItems` reads `rev` directly and
    // delegates to `innerFilter` for `items` and `filter`. Sibling
    // text() accessors read `filter` (and `rev`) directly, so a state
    // change to `filter` produces dirty=bit-for-filter. Without the
    // recursive walk, each.__mask only contains bit-for-rev and the
    // each block silently skips reconciliation.
    const src = `
      import { component, div, text, ul, li } from '@llui/dom'
      type State = { items: string[]; filter: string; rev: number }
      const innerFilter = (s: State): string[] =>
        s.items.filter((i) => i.includes(s.filter))
      const visibleItems = (s: State): string[] => {
        void s.rev
        return innerFilter(s)
      }
      export const C = component({
        name: 'C',
        init: () => [{ items: [], filter: '', rev: 0 }, []],
        update: (s, _m) => [s, []],
        view: ({ each }) => [
          div([
            ul([
              each<string>({
                items: visibleItems,
                key: (item) => item,
                render: ({ item }) => [li([text(item)])],
              }),
            ]),
            text((s: State) => 'rev=' + s.rev),
            text((s: State) => 'filter=' + s.filter),
          ]),
        ],
      })
    `
    const out = t(src)
    // All three transitively-read fields must be in the legend.
    expect(out).toMatch(/"rev":\s*1/)
    expect(out).toMatch(/"items":\s*2/)
    expect(out).toMatch(/"filter":\s*4/)
    // each() must have __mask = 1|2|4 = 7 — the OR of every bit
    // visibleItems can transitively trigger on. A weaker mask (just 1
    // for rev) would silently skip reconcile when only `filter` flips.
    expect(out).toMatch(/each<string>\(\{[\s\S]*?__mask:\s*7/)
  })

  it('follows pure-delegation accessor (outer body is just `inner(s)`) to extract paths', () => {
    // Even when the outer body has no direct MemberExpression, the
    // delegated helper's reads must still seed fieldBits.
    const src = `
      import { component, div, text, ul, li } from '@llui/dom'
      type State = { items: string[]; filter: string }
      const innerFilter = (s: State): string[] =>
        s.items.filter((i) => i.includes(s.filter))
      const visibleItems = (s: State): string[] => innerFilter(s)
      export const C = component({
        name: 'C',
        init: () => [{ items: [], filter: '' }, []],
        update: (s, _m) => [s, []],
        view: ({ each }) => [
          div([
            ul([
              each<string>({
                items: visibleItems,
                key: (item) => item,
                render: ({ item }) => [li([text(item)])],
              }),
            ]),
            text((s: State) => 'filter=' + s.filter),
          ]),
        ],
      })
    `
    const out = t(src)
    // `items` and `filter` (read inside innerFilter, not in
    // visibleItems' outer body) must still be tracked.
    expect(out).toMatch(/"items":\s*\d/)
    expect(out).toMatch(/"filter":\s*\d/)
  })

  it('handles indirection through a function declaration helper', () => {
    // Same delegation pattern but the helper is a hoisted fn-decl.
    const src = `
      import { component, div, text, ul, li } from '@llui/dom'
      type State = { items: string[]; filter: string }
      function innerFilter(s: State): string[] {
        return s.items.filter((i) => i.includes(s.filter))
      }
      const visibleItems = (s: State): string[] => innerFilter(s)
      export const C = component({
        name: 'C',
        init: () => [{ items: [], filter: '' }, []],
        update: (s, _m) => [s, []],
        view: ({ each }) => [
          div([
            ul([
              each<string>({
                items: visibleItems,
                key: (item) => item,
                render: ({ item }) => [li([text(item)])],
              }),
            ]),
            text((s: State) => 'filter=' + s.filter),
          ]),
        ],
      })
    `
    const out = t(src)
    expect(out).toMatch(/"items":\s*\d/)
    expect(out).toMatch(/"filter":\s*\d/)
  })

  it('does not loop on a cycle between two local helpers', () => {
    // Pathological but legal: two helpers that mutually recurse.
    // The walk must terminate; we don't care what paths are extracted
    // (any subset is fine — the runtime fallback handles missing bits).
    const src = `
      import { component, div, text } from '@llui/dom'
      type State = { a: string; b: string }
      const evenStep = (s: State): string => oddStep(s) + s.a
      const oddStep = (s: State): string => evenStep(s) + s.b
      export const C = component({
        name: 'C',
        init: () => [{ a: '', b: '' }, []],
        update: (s, _m) => [s, []],
        view: () => [div([text(evenStep)])],
      })
    `
    // Should not hang or throw.
    expect(() => t(src)).not.toThrow()
  })

  it('does not follow non-state CallExpressions (s.items.filter, externalHelper(s.x))', () => {
    // When the call target isn't a local function (or isn't called
    // with the state param verbatim), don't recurse — the called
    // function's body isn't reading our state.
    const src = `
      import { component, div, text } from '@llui/dom'
      import { external } from './lib'
      type State = { items: string[] }
      const visibleItems = (s: State): string[] => external(s.items)
      export const C = component({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, _m) => [s, []],
        view: ({ each }) => [
          div([
            text((s: State) => 'count=' + String(s.items.length)),
          ]),
        ],
      })
    `
    // `items` IS in fieldBits because the outer text() arrow reads it.
    // The fact that we don't recurse into `external` is fine — it's
    // imported and unresolvable.
    const out = t(src)
    expect(out).toMatch(/"items":\s*\d/)
  })
})

describe('Pass 2 — mask injection + __dirty', () => {
  it('injects mask into text() calls', () => {
    const src = `
      import { component, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: (send) => [text(s => String(s.count))],
      })
    `
    const out = t(src)
    // text(s => String(s.count)) should get a mask as second arg
    expect(out).toMatch(/text\(s\s*=>\s*String\(s\.count\)\s*,\s*1\)/)
  })

  it('injects mask into h.text() calls via view-helpers binding', () => {
    const src = `
      import { component } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: (h) => [h.text(s => String(s.count))],
      })
    `
    const out = t(src)
    expect(out).toMatch(/h\.text\(s\s*=>\s*String\(s\.count\)\s*,\s*1\)/)
  })

  it('injects mask into destructured text() calls from view helpers', () => {
    const src = `
      import { component } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: ({ text }) => [text(s => String(s.count))],
      })
    `
    const out = t(src)
    expect(out).toMatch(/text\(s\s*=>\s*String\(s\.count\)\s*,\s*1\)/)
  })

  it('injects mask in extracted helper with View<S,M> parameter', () => {
    const src = `
      import { component } from '@llui/dom'
      import type { View } from '@llui/dom'
      type S = { count: number }
      function row(h: View<S, never>) { return [h.text(s => String(s.count))] }
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: (h) => row(h),
      })
    `
    const out = t(src)
    expect(out).toMatch(/h\.text\(s\s*=>\s*String\(s\.count\)\s*,\s*1\)/)
  })

  it('injects mask through `const { text } = h` destructuring', () => {
    const src = `
      import { component } from '@llui/dom'
      import type { View } from '@llui/dom'
      type S = { count: number }
      function row(h: View<S, never>) {
        const { text } = h
        return [text(s => String(s.count))]
      }
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: (h) => row(h),
      })
    `
    const out = t(src)
    expect(out).toMatch(/text\(s\s*=>\s*String\(s\.count\)\s*,\s*1\)/)
  })

  it('injects mask into renamed destructured text alias', () => {
    const src = `
      import { component } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: ({ text: t }) => [t(s => String(s.count))],
      })
    `
    const out = t(src)
    expect(out).toMatch(/t\(s\s*=>\s*String\(s\.count\)\s*,\s*1\)/)
  })

  it('does NOT rewrite a user-defined text() that shadows the primitive', () => {
    // User has their own `text` function in scope and is NOT importing text
    // from @llui/dom. The compiler must not inject a mask into these calls.
    const src = `
      import { component } from '@llui/dom'
      function text(x: string): string { return x.toUpperCase() }
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: (send) => {
          const label = text('hello')
          return [label as unknown as Node]
        },
      })
    `
    const out = t(src)
    // The call site 'text(...)' should remain as-is — no ,1 appended.
    expect(out).not.toMatch(/text\('hello'\s*,\s*1\)/)
    expect(out).toMatch(/text\('hello'\)/)
  })

  it('single-param view (no h) still works unchanged', () => {
    // Backwards compat: omitting the second parameter to `view` still
    // compiles and mask injection still fires for bare imports.
    const src = `
      import { component, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: (send) => [text(s => String(s.count))],
      })
    `
    const out = t(src)
    expect(out).toMatch(/text\(s\s*=>\s*String\(s\.count\)\s*,\s*1\)/)
  })

  it('synthesizes __dirty function', () => {
    const src = `
      import { component, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ count: 0, label: '' }, []],
        update: (s, m) => [s, []],
        view: (send) => [
          text(s => String(s.count)),
          text(s => s.label),
        ],
      })
    `
    const out = t(src)
    expect(out).toContain('__dirty')
    expect(out).toContain('Object.is')
    // Should compare count and label
    expect(out).toMatch(/o\.count.*n\.count/)
    expect(out).toMatch(/o\.label.*n\.label/)
  })

  it('does not overwrite existing __dirty', () => {
    const src = `
      import { component, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s, m) => [s, []],
        view: (send) => [text(s => String(s.count))],
        __dirty: (o, n) => o.count !== n.count ? 1 : 0,
      })
    `
    const out = t(src)
    // Should preserve the hand-written __dirty
    expect(out).toContain('o.count !== n.count')
  })
})

describe('Pass 3 — import cleanup', () => {
  it('removes compiled element helpers from imports', () => {
    const src = `
      import { div, span, text, component } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [div({}, [span({}, [text('hi')])])],
      })
    `
    const out = t(src)
    // div and span should be removed from import
    expect(out).not.toMatch(/import\s*\{[^}]*\bdiv\b/)
    expect(out).not.toMatch(/import\s*\{[^}]*\bspan\b/)
    // text and component should remain
    expect(out).toMatch(/import\s*\{[^}]*\btext\b/)
    expect(out).toMatch(/import\s*\{[^}]*\bcomponent\b/)
    // elTemplate or elSplit should be added
    expect(out).toMatch(/import\s*\{[^}]*\b(elSplit|elTemplate)\b/)
  })

  it('keeps element helpers that bailed out (non-literal props)', () => {
    const src = `
      import { div } from '@llui/dom'
      const props = { class: 'foo' }
      const el = div(props)
    `
    const out = t(src)
    // div should remain in imports since it wasn't compiled
    expect(out).toMatch(/import\s*\{[^}]*\bdiv\b/)
    expect(out).not.toMatch(/elSplit/)
  })
})

describe('per-item accessor calls', () => {
  it('compiles item() calls as perItem bindings instead of bailing out', () => {
    const src = `
      import { component, input, each } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: () => each({
          items: s => s.items,
          key: t => t.id,
          render: ({ item }) => [
            input({ checked: item(t => t.done), class: item(t => t.active ? 'on' : '') }),
          ],
        }),
      })
    `
    const out = t(src)
    // Should compile to elSplit, not bail out to uncompiled input()
    expect(out).toContain('elSplit')
    // input should be removed from imports (fully compiled)
    expect(out).not.toMatch(/import\s*\{[^}]*\binput\b/)
  })

  it('emits item() call expression in the binding tuple', () => {
    const src = `
      import { component, div, each } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: () => each({
          items: s => s.items,
          key: t => t.id,
          render: ({ item }) => [
            div({ class: item(t => t.active ? 'on' : '') }),
          ],
        }),
      })
    `
    const out = t(src)
    expect(out).toContain('elSplit')
    // The binding should contain the item() call
    expect(out).toContain('item(')
  })

  it('compiles item.field property access as a perItem binding', () => {
    const src = `
      import { component, div, each, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: () => each({
          items: s => s.items,
          key: t => t.id,
          render: ({ item }) => [
            div({ 'data-id': item.id }, [text(item.label)]),
          ],
        }),
      })
    `
    const out = t(src)
    expect(out).toContain('elSplit')
    // item.id gets hoisted to __a0 = acc(t => t.id) — Proxy-free compiled code
    expect(out).toMatch(/__a\d+/)
    expect(out).toContain('acc(')
    expect(out).toMatch(/"attr",\s*"data-id"/)
  })

  it('auto-wraps each.items in memo() when accessor allocates (filter/map/etc.)', () => {
    const src = `
      import { component, each, div, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ todos: [], filter: 'all' }, []],
        update: (s, m) => [s, []],
        view: () => each({
          items: s => s.todos.filter(t => !t.done),
          key: t => t.id,
          render: ({ item }) => [div([text(item.text)])],
        }),
      })
    `
    const out = t(src)
    // Should wrap items with memo(...)
    expect(out).toMatch(/items:\s*memo\(/)
    // And add memo to imports
    expect(out).toMatch(/import\s*\{[^}]*\bmemo\b/)
  })

  it('does NOT wrap each.items when accessor is a plain state read', () => {
    const src = `
      import { component, each, div, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: () => each({
          items: s => s.items,
          key: t => t.id,
          render: ({ item }) => [div([text(item.text)])],
        }),
      })
    `
    const out = t(src)
    // Plain accessor — each's same-ref fast path handles it; memo not needed
    expect(out).not.toMatch(/items:\s*memo\(/)
  })

  it('dedups repeated item.field across call and property access forms', () => {
    const src = `
      import { component, div, each, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: (send) => each({
          items: s => s.items,
          key: t => t.id,
          render: ({ item }) => [
            div({
              class: item.label,
              onClick: () => send({ type: 'click', id: item(t => t.id)() }),
              'data-label': item(t => t.label),
              'data-id': item.id,
            }, [text(item.label)]),
          ],
        }),
      })
    `
    const out = t(src)
    // item.label and item(t=>t.label) should share a hoisted __a* var
    expect(out).toMatch(/__a\d+/)
    // item.id and item(t=>t.id) should also dedup together
    const matches = out.match(/const __a(\d+)/g) || []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })
})

describe('static subtree prerendering', () => {
  it('emits template clone for fully static subtree', () => {
    const src = `
      import { component, div, span, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({ class: 'header' }, [
            span({}, [text('Hello')]),
          ]),
        ],
      })
    `
    const out = t(src)
    // Fully static subtree with nested elements → elTemplate
    expect(out).toContain('elTemplate')
    expect(out).toContain('header')
    expect(out).toContain('Hello')
  })

  it('does not use template for subtrees with reactive bindings', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ label: '' }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({ class: 'header' }, [
            text(s => s.label),
          ]),
        ],
      })
    `
    const out = t(src)
    expect(out).not.toContain('__cloneStaticTemplate')
  })

  it('does not use template for subtrees with event handlers', () => {
    const src = `
      import { component, button, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: (send) => [
          button({ onClick: () => send({ type: 'click' }) }, [text('Go')]),
        ],
      })
    `
    const out = t(src)
    expect(out).not.toContain('__cloneStaticTemplate')
  })
})

describe('zero-mask constant folding', () => {
  it('folds accessor that does not read state into staticFn', () => {
    const src = `
      import { component, div } from '@llui/dom'
      const THEME = 'dark'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({ class: s => THEME }),
        ],
      })
    `
    const out = t(src)
    // The accessor reads no state — should be folded to static
    // Should NOT have a binding tuple for this prop
    expect(out).not.toMatch(/\[\s*-?\d+.*class.*THEME/)
    expect(out).not.toContain('__bind')
  })
})

describe('subtree collapse — nested elements → elTemplate', () => {
  it('collapses nested static elements into a single elTemplate call', () => {
    const src = `
      import { component, div, span, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({ class: 'container' }, [
            span({ class: 'label' }, [text('Hello')]),
            span({ class: 'value' }),
          ]),
        ],
      })
    `
    const out = t(src)
    // Should collapse into elTemplate, not nested elSplit calls
    expect(out).toContain('elTemplate')
    // HTML should include both spans
    expect(out).toContain('container')
    expect(out).toContain('label')
    expect(out).toContain('Hello')
    expect(out).toContain('<span')
    // Should NOT have elSplit (everything is in the template)
    expect(out).not.toContain('elSplit')
  })

  it('collapses elements with events into elTemplate with patch function', () => {
    const src = `
      import { component, div, button, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: (send) => [
          div({ class: 'row' }, [
            button({ onClick: () => send({ type: 'click' }) }, [text('Go')]),
          ]),
        ],
      })
    `
    const out = t(src)
    // Should use elTemplate since there are nested elements
    expect(out).toContain('elTemplate')
    expect(out).toMatch(/<div[^>]*row[^>]*><button>Go<\/button><\/div>/)
    // Patch function should set up click event
    expect(out).toContain('addEventListener')
    expect(out).toContain('"click"')
  })

  it('collapses elements with reactive bindings into elTemplate with bind calls', () => {
    const src = `
      import { component, div, span, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ label: 'hi', active: false }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({ class: 'wrapper' }, [
            span({ class: s => s.active ? 'on' : 'off' }, [text('x')]),
          ]),
        ],
      })
    `
    const out = t(src)
    expect(out).toContain('elTemplate')
    // HTML should have the static structure
    expect(out).toMatch(/<div[^>]*wrapper[^>]*><span>x<\/span><\/div>/)
    // Patch function should call __bind for the reactive class
    expect(out).toContain('__bind')
    expect(out).toContain('"class"')
  })

  it('collapses elements with reactive text children', () => {
    const src = `
      import { component, div, span, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ label: 'hi' }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({}, [
            span({}, [text(s => s.label)]),
          ]),
        ],
      })
    `
    const out = t(src)
    expect(out).toContain('elTemplate')
    // Sole-child reactive text uses inline text placeholder (space)
    // instead of comment — no createTextNode + replaceChild needed.
    expect(out).toContain('<div><span> </span></div>')
    expect(out).toContain('firstChild')
    expect(out).toContain('__bind')
    expect(out).toContain('"text"')
    // Inline path should NOT create a text node — reuses the cloned one
    expect(out).not.toContain('createTextNode')
  })

  it('handles per-item accessors in collapsed templates', () => {
    const src = `
      import { component, tr, td, text, each } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: () => each({
          items: s => s.items,
          key: t => t.id,
          render: ({ item }) => [
            tr({}, [
              td({ class: 'id' }, [text(item(t => String(t.id)))]),
              td({ class: 'label' }, [text(item(t => t.label))]),
            ]),
          ],
        }),
      })
    `
    const out = t(src)
    expect(out).toContain('elTemplate')
    // Each td has a sole reactive text child — uses inline text placeholder
    expect(out).toMatch(/<tr><td[^>]*id[^>]*> <\/td><td[^>]*label[^>]*> <\/td><\/tr>/)
    expect(out).toContain('__bind')
    // Inline path reuses cloned text node — no createTextNode needed
    expect(out).not.toContain('createTextNode')
  })

  it('supports interleaved static + reactive text in same parent', () => {
    const src = `
      import { component, div, span, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ name: 'world' }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({}, [
            text('Hello, '),
            text((s: { name: string }) => s.name),
            text('!'),
            span({ class: 'dot' }, []),
          ]),
        ],
      })
    `
    const out = t(src)
    expect(out).toContain('elTemplate')
    // Template: static "Hello, ", comment placeholder, static "!"
    expect(out).toContain('>Hello, <!--$-->!<')
    // Should replace comment with text node at clone time
    expect(out).toContain('createTextNode')
    expect(out).toContain('replaceChild')
  })

  it('does not collapse when children include structural primitives', () => {
    const src = `
      import { component, div, each, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({}, each({
            items: s => s.items,
            key: t => t.id,
            render: ({ item }) => [text('x')],
          })),
        ],
      })
    `
    const out = t(src)
    // Should NOT collapse — each() is a structural primitive, not an element
    expect(out).toContain('elSplit')
    expect(out).not.toContain('elTemplate')
  })

  it('does not collapse single elements without nested children', () => {
    const src = `
      import { component, div, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({ class: 'single' }, [text('hi')]),
        ],
      })
    `
    const out = t(src)
    // Single element with only text children — no benefit from template collapse
    // Should use the existing static subtree template or elSplit
    expect(out).not.toContain('__bind')
  })

  it('adds elTemplate to imports when used', () => {
    const src = `
      import { component, div, span, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({ class: 'c' }, [
            span({}, [text('a')]),
          ]),
        ],
      })
    `
    const out = t(src)
    expect(out).toMatch(/import\s*\{[^}]*\belTemplate\b/)
  })

  it('handles void elements (br, hr, img, input) in templates', () => {
    const src = `
      import { component, div, br, hr } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({}, [
            br({}),
            hr({ class: 'sep' }),
          ]),
        ],
      })
    `
    const out = t(src)
    expect(out).toContain('elTemplate')
    expect(out).toContain('<br>')
    expect(out).toMatch(/<hr[^>]*sep[^>]*>/)
  })

  it('marks all descendant helpers as compiled for import cleanup', () => {
    const src = `
      import { component, div, span, p, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ x: 0 }, []],
        update: (s, m) => [s, []],
        view: () => [
          div({}, [
            span({}, [text('a')]),
            p({}, [text('b')]),
          ]),
        ],
      })
    `
    const out = t(src)
    expect(out).toContain('elTemplate')
    // div, span, p should all be removed from imports
    expect(out).not.toMatch(/import\s*\{[^}]*\bdiv\b/)
    expect(out).not.toMatch(/import\s*\{[^}]*\bspan\b/)
    expect(out).not.toMatch(/import\s*\{[^}]*\bp\b/)
  })
})

describe('spread props bail to runtime', () => {
  it('preserves spread props on div instead of stripping them', () => {
    const src = `
      import { div } from '@llui/dom'
      const parts = { root: { 'data-scope': 'x', role: 'button' } }
      const el = div({ ...parts.root, class: 'foo' })
    `
    const out = t(src)
    // Must NOT transform to elSplit — that would drop the spread silently.
    // The runtime div() helper handles spreads natively.
    expect(clean(out)).toContain('div({ ...parts.root')
    expect(clean(out)).not.toContain('elSplit("div"')
  })

  it('preserves spread props with reactive accessors in the spread source', () => {
    const src = `
      import { button } from '@llui/dom'
      const parts = { trigger: { 'aria-expanded': (s) => s.open } }
      const el = button({ ...parts.trigger, class: 'btn' })
    `
    const out = t(src)
    expect(clean(out)).toContain('button({ ...parts.trigger')
    expect(clean(out)).not.toContain('elSplit("button"')
  })

  it('still compiles other elements in the same file', () => {
    const src = `
      import { div, span } from '@llui/dom'
      const parts = { root: { 'data-x': '1' } }
      const a = div({ ...parts.root })
      const b = span({ class: 'plain' })
    `
    const out = t(src)
    // span() is fully static — should still be template-cloned
    expect(clean(out)).toContain('__cloneStaticTemplate')
    // div() with spread stays at runtime
    expect(clean(out)).toContain('div({ ...parts.root')
  })
})

describe('__handlers per-message optimization', () => {
  it('unions modified fields across multiple return paths in a single case', () => {
    // Regression: the compiler used to only analyze the first return
    // statement in a case, missing conditional returns inside if-blocks.
    // This caused drag-and-drop in the dashboard example to silently fail
    // because the 'sort' handler's dirty mask only included 'sort' (16)
    // but not 'priorities' (8) which is set in the drop branch.
    const src = `
      import { component, div } from '@llui/dom'
      type State = { a: string; b: string; c: string }
      type Msg = { type: 'multi' } | { type: 'single' }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ a: '', b: '', c: '' }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'multi': {
              if (state.a === 'x') {
                return [{ ...state, a: 'y', b: 'z', c: 'w' }, []]
              }
              return [{ ...state, a: 'fallback' }, []]
            }
            case 'single':
              return [{ ...state, b: 'only' }, []]
          }
        },
        view: ({ text }) => [div([text((s) => s.a + s.b + s.c)])],
      })
    `
    const out = t(src)
    // The 'multi' handler must have a mask covering a|b|c, not just a.
    // Masks: a=1, b=2, c=4, so multi = 1|2|4 = 7
    const multiHandlerMatch = out.match(/"multi"[\s\S]*?__handleMsg\([^,]+,\s*[^,]+,\s*(\d+)/)
    expect(multiHandlerMatch).not.toBeNull()
    const multiMask = Number(multiHandlerMatch![1])
    // Must include bits for a, b, and c (at least 3 bits set)
    expect(multiMask.toString(2).split('1').length - 1).toBeGreaterThanOrEqual(3)
  })

  it('handles a case with only a single return path correctly', () => {
    const src = `
      import { component, div } from '@llui/dom'
      type State = { a: string; b: string }
      type Msg = { type: 'x' }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ a: '', b: '' }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'x':
              return [{ ...state, a: 'new' }, []]
          }
        },
        view: ({ text }) => [div([text((s) => s.a + s.b)])],
      })
    `
    const out = t(src)
    // Only 'a' modified — mask should be 1
    const handlerMatch = out.match(/"x"[\s\S]*?__handleMsg\([^,]+,\s*[^,]+,\s*(\d+)/)
    expect(handlerMatch).not.toBeNull()
    expect(Number(handlerMatch![1])).toBe(1)
  })

  it('ignores returns inside nested functions', () => {
    const src = `
      import { component, div } from '@llui/dom'
      type State = { a: number; b: number }
      type Msg = { type: 'go' }
      export const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ a: 0, b: 0 }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'go': {
              // A nested function with its own return — must NOT be counted
              const helper = () => [{ ...state, b: 999 }, []] as [State, never[]]
              helper() // swallowed
              return [{ ...state, a: state.a + 1 }, []]
            }
          }
        },
        view: ({ text }) => [div([text((s) => String(s.a + s.b))])],
      })
    `
    const out = t(src)
    const handlerMatch = out.match(/"go"[\s\S]*?__handleMsg\([^,]+,\s*[^,]+,\s*(\d+)/)
    expect(handlerMatch).not.toBeNull()
    // Only 'a' should be modified — nested function's return is ignored
    expect(Number(handlerMatch![1])).toBe(1)
  })

  it('does not emit a narrow per-case handler when the return spreads a non-state value', () => {
    // Regression: `return [{ ...state, ...msg.props, extra: x }, []]` was
    // analyzed as modifying ONLY `extra` — the `...msg.props` spread was
    // silently ignored as if it were `...state`. That produced a narrow
    // `caseDirty` that excluded every field coming in through the props
    // spread, so text()/attr() bindings reading those fields in Phase 2
    // were skipped and the DOM retained stale values after a props/set.
    //
    // Correct behaviour: when a spread's source is anything other than
    // the state parameter, bail out of the per-case optimization so the
    // generic Phase 2 path runs and `__dirty` computes an honest mask.
    const src = `
      import { component, div, span, text } from '@llui/dom'
      type Props = { name: string | null; other: number }
      type State = Props & { tgState: number }
      type Msg = { type: 'props/set'; props: Props }
      export const C = component<State, Msg, never, Props>({
        name: 'C',
        init: (p) => [{ ...(p ?? { name: null, other: 0 }), tgState: 0 }, []],
        propsMsg: (p) => ({ type: 'props/set', props: p }),
        update: (state, msg) => {
          switch (msg.type) {
            case 'props/set': {
              const tgNext = state.tgState + 1
              return [{ ...state, ...msg.props, tgState: tgNext }, []]
            }
          }
        },
        view: ({ text }) => [
          div([
            span([text((s) => s.name === null ? 'NULL' : s.name)]),
            span([text((s) => String(s.tgState))]),
          ]),
        ],
      })
    `
    const out = t(src)
    // Two acceptable outcomes: (a) no per-case handler for 'props/set'
    // (bail-out, preferred — generic __dirty path runs), or (b) the handler
    // emits with caseDirty === FULL_MASK (-1 as a 32-bit signed int).
    const handlerMatch = out.match(/"props\/set"[\s\S]*?__handleMsg\([^,]+,\s*[^,]+,\s*(-?\d+)/)
    if (handlerMatch) {
      const mask = Number(handlerMatch[1]) | 0
      expect(mask).toBe(-1)
    } else {
      expect(out).not.toMatch(/"props\/set"/)
    }
  })
})

describe('returns null for non-llui files', () => {
  it('returns null when no @llui/dom import', () => {
    const src = `export const x = 42`
    expect(transformLlui(src, 'test.ts')).toBeNull()
  })
})

describe('dev code injection — MCP HMR auto-connect', () => {
  const componentSource = `
    import { component } from '@llui/dom'
    type State = { count: number }
    type Msg = { type: 'inc' }
    export const C = component<State, Msg, never>({
      name: 'C',
      init: () => [{ count: 0 }, []],
      update: (s, m) => [s, []],
      view: () => [],
    })
  `

  it('emits __startRelay and the llui:mcp-ready HMR listener in dev mode', () => {
    const result = transformLlui(
      componentSource,
      'app.ts',
      /* devMode */ true,
      /* emitAgentMetadata */ false,
      5200,
    )
    const out = result?.output ?? ''

    // Imports the relay starter
    expect(out).toContain('startRelay as __startRelay')
    // Calls it on load with the configured port
    expect(out).toContain('__startRelay(5200)')
    // Wires the HMR custom event to __lluiConnect
    expect(out).toContain("import.meta.hot.on('llui:mcp-ready'")
    expect(out).toContain('__lluiConnect')
  })

  it('uses a custom port when provided', () => {
    const result = transformLlui(componentSource, 'app.ts', true, false, 5300)
    const out = result?.output ?? ''
    expect(out).toContain('__startRelay(5300)')
  })

  it('omits the relay and HMR listener when mcpPort is null', () => {
    const result = transformLlui(componentSource, 'app.ts', true, false, null)
    const out = result?.output ?? ''
    expect(out).not.toContain('startRelay')
    expect(out).not.toContain('llui:mcp-ready')
    expect(out).not.toContain('__lluiConnect')
  })

  it('omits all dev injection in production mode', () => {
    const result = transformLlui(
      componentSource,
      'app.ts',
      /* devMode */ false,
      /* emitAgentMetadata */ false,
      5200,
    )
    const out = result?.output ?? ''
    expect(out).not.toContain('startRelay')
    expect(out).not.toContain('enableDevTools')
    expect(out).not.toContain('llui:mcp-ready')
  })
})

describe('Pass 2 — __msgAnnotations emission', () => {
  function tDev(source: string): string {
    return transformLlui(source, 'test.ts', /* devMode */ true)?.output ?? source
  }

  it('emits __msgAnnotations alongside __msgSchema for annotated Msg variants', () => {
    const source = `
import { component } from '@llui/dom'

type State = { count: number }
type Msg =
  /** @intent("Increment the counter") */
  | { type: 'inc' }
  /** @intent("Delete item") @requiresConfirm */
  | { type: 'delete', id: string }

export const App = component<State, Msg, never>({
  name: 'App',
  init: () => [{ count: 0 }, []],
  update: (s, m) => {
    switch (m.type) {
      case 'inc': return [{ ...s, count: s.count + 1 }, []]
      case 'delete': return [s, []]
    }
  },
  view: ({ send, text }) => [text((s) => String(s.count))],
})
`
    const out = tDev(source)
    expect(out).toContain('__msgAnnotations:')
    // After the createStringLiteral codegen fix, variant keys are
    // emitted as string literals (`"inc": …`). Tolerate both forms in
    // case future tweaks change quoting back — what matters is the
    // structural presence of intent text and requiresConfirm.
    expect(out).toMatch(/["']?inc["']?:\s*\{\s*intent:\s*["']Increment the counter["']/)
    expect(out).toMatch(
      /["']?delete["']?:\s*\{\s*intent:\s*["']Delete item["'][\s\S]*requiresConfirm:\s*true/,
    )
  })

  it('omits __msgAnnotations when no variants carry annotations', () => {
    const source = `
import { component } from '@llui/dom'

type State = { n: number }
type Msg = { type: 'x' }

export const App = component<State, Msg, never>({
  name: 'App',
  init: () => [{ n: 0 }, []],
  update: (s, _m) => [s, []],
  view: ({ text }) => [text((s) => String(s.n))],
})
`
    const out = tDev(source)
    expect(out).not.toContain('__msgAnnotations:')
  })

  // Regression: a composed Msg union — `type Msg = ImportedFoo | { type: 'extra' }` —
  // pre-extracted via the plugin's cross-file path produces all variants
  // (the imported half + the inline half). Feeding `transformLlui` the
  // pre-extracted result simulates what the plugin's async hook does in
  // production.
  it('emits annotations for a composed Msg via preExtracted (plugin-path simulation)', () => {
    const componentSource = `
import { component } from '@llui/dom'
import type { Msg } from './msg'

type State = { count: number }

export const App = component<State, Msg, never>({
  name: 'App',
  init: () => [{ count: 0 }, []],
  update: (s, _m) => [s, []],
  view: ({ text }) => [text((s) => String(s.count))],
})
`
    const result = transformLlui(
      componentSource,
      'app.ts',
      /* devMode */ true,
      false,
      null,
      false,
      undefined, // typeSources unused — preExtracted takes priority
      {
        msgAnnotations: {
          inc: {
            intent: 'Increment',
            alwaysAffordable: false,
            requiresConfirm: false,
            dispatchMode: 'shared',
            examples: [],
            warning: null,
            emits: [],
            routeGate: null,
          },
          dec: {
            intent: 'Decrement',
            alwaysAffordable: false,
            requiresConfirm: false,
            dispatchMode: 'shared',
            examples: [],
            warning: null,
            emits: [],
            routeGate: null,
          },
          reset: {
            intent: 'Reset',
            alwaysAffordable: false,
            requiresConfirm: true,
            dispatchMode: 'shared',
            examples: [],
            warning: null,
            emits: [],
            routeGate: null,
          },
        },
      },
    )
    const out = result?.output ?? componentSource
    expect(out).toContain('__msgAnnotations:')
    // All three variants — inc + dec from the imported half, reset
    // from the inline half — appear together in the emitted object.
    expect(out).toMatch(/["']?inc["']?:\s*\{/)
    expect(out).toMatch(/["']?dec["']?:\s*\{/)
    expect(out).toMatch(/["']?reset["']?:[\s\S]*requiresConfirm:\s*true/)
  })

  // Regression: when Msg lives in a separate file and is imported into
  // the file containing `component()`, the plugin's pre-resolution
  // step follows the import and the extractors find the alias in the
  // declaring file. Without cross-file resolution, the local extractor
  // sees no `type Msg = ...` and returns null, silently disabling LAP
  // annotation emission.
  //
  // We can't run the full plugin from a unit test (it needs a Rollup
  // context with `this.resolve`), so we feed `transformLlui` an
  // explicit `typeSources` payload that mimics what the plugin
  // produces after pre-resolution. The expectation is that annotations
  // get emitted against the imported source.
  it('emits annotations from an imported Msg via typeSources param', () => {
    const componentSource = `
import { component } from '@llui/dom'
import type { Msg } from './msg'

type State = { count: number }

export const App = component<State, Msg, never>({
  name: 'App',
  init: () => [{ count: 0 }, []],
  update: (s, _m) => [s, []],
  view: ({ text }) => [text((s) => String(s.count))],
})
`
    const externalMsgSource = `
export type Msg =
  /** @intent("Increment the counter") */
  | { type: 'inc' }
  /** @intent("Decrement") @requiresConfirm */
  | { type: 'dec' }
`
    const result = transformLlui(
      componentSource,
      'app.ts',
      /* devMode */ true,
      false,
      null,
      false,
      {
        msg: { source: externalMsgSource, typeName: 'Msg' },
      },
    )
    const out = result?.output ?? componentSource
    expect(out).toContain('__msgAnnotations:')
    expect(out).toMatch(/["']?inc["']?:\s*\{\s*intent:\s*["']Increment the counter["']/)
    expect(out).toMatch(
      /["']?dec["']?:\s*\{\s*intent:\s*["']Decrement["'][\s\S]*requiresConfirm:\s*true/,
    )
  })

  // Regression: discriminants containing characters invalid in JS
  // identifiers ('/', '-', reserved words) must serialize as quoted
  // string keys, not bare identifiers. Earlier emission passed `variant`
  // as a string to ts.factory.createPropertyAssignment, which the
  // printer treats as an identifier and produces invalid JS like
  // `Router/RouteChanged: { ... }` rather than `"Router/RouteChanged":
  // { ... }`. The fix wraps with createStringLiteral.
  it('quotes Msg variant keys when the discriminant has non-identifier characters', () => {
    const source = `
import { component } from '@llui/dom'

type State = { current: string }
type Msg =
  /** @intent("Route changed") */
  | { type: 'Router/RouteChanged', to: string }
  /** @intent("Cancel order") @requiresConfirm */
  | { type: 'order-cancel' }
  /** @intent("Reset") */
  | { type: 'delete' }

export const App = component<State, Msg, never>({
  name: 'App',
  init: () => [{ current: '/' }, []],
  update: (s, m) => {
    switch (m.type) {
      case 'Router/RouteChanged': return [{ ...s, current: m.to }, []]
      case 'order-cancel': return [s, []]
      case 'delete': return [s, []]
    }
  },
  view: ({ text }) => [text((s) => s.current)],
})
`
    const out = tDev(source)
    expect(out).toContain('__msgAnnotations:')
    // Each variant key must be a string literal in the emitted JS
    // (printer puts it in quotes), not a bare identifier.
    expect(out).toMatch(/["']Router\/RouteChanged["']:\s*\{/)
    expect(out).toMatch(/["']order-cancel["']:\s*\{/)
    expect(out).toMatch(/["']delete["']:\s*\{/)
    // Sanity — the bug would emit an unquoted Router/RouteChanged
    // identifier; if that ever appeared the file would not even parse,
    // but assert directly so the regression has a legible failure msg.
    expect(out).not.toMatch(/\n\s+Router\/RouteChanged:/)
  })
})

describe('Pass 1 — event-handler send tagging (runtime binding descriptors)', () => {
  function tDev(source: string): string {
    return transformLlui(source, 'test.ts', /* devMode */ true)?.output ?? source
  }

  it('wraps event-handler arrows that contain literal sends with __lluiVariants metadata', () => {
    const source = `
import { component, button } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' }

export const App = component<State, Msg, never>({
  name: 'App',
  init: () => [{ count: 0 }, []],
  update: (s, m) => {
    switch (m.type) {
      case 'inc': return [{ ...s, count: s.count + 1 }, []]
      case 'dec': return [{ ...s, count: s.count - 1 }, []]
    }
  },
  view: ({ send, text }) => [
    button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
    button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
  ],
})
`
    const out = tDev(source)
    // Compiler emits Object.assign(handler, { __lluiVariants: ['…'] }).
    // The runtime (in @llui/dom elements.ts) reads the metadata and
    // registers the variants on the active component instance for
    // the lifetime of the binding's scope.
    expect(out).toContain('__lluiVariants:')
    expect(out).toMatch(/__lluiVariants:\s*\[\s*["']inc["']\s*\]/)
    expect(out).toMatch(/__lluiVariants:\s*\[\s*["']dec["']\s*\]/)
    // Static def-level emission is gone — descriptors are now
    // collected at runtime from compiler-tagged handlers.
    expect(out).not.toContain('__bindingDescriptors:')
  })

  it('does not tag handlers when the view has no literal sends', () => {
    const source = `
import { component, text } from '@llui/dom'
type State = { n: number }; type Msg = { type: 'noop' }
export const App = component<State, Msg, never>({
  name: 'X', init: () => [{ n: 0 }, []], update: (s, _m) => [s, []],
  view: ({ text }) => [text((s) => String(s.n))],
})
`
    const out = tDev(source)
    expect(out).not.toContain('__lluiVariants')
    expect(out).not.toContain('__bindingDescriptors:')
  })
})

describe('Pass 2 — __schemaHash emission', () => {
  function tDev(source: string): string {
    return transformLlui(source, 'test.ts', /* devMode */ true)?.output ?? source
  }

  it('emits __schemaHash alongside __msgSchema', () => {
    const source = `
import { component } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' }

export const App = component<State, Msg, never>({
  name: 'App',
  init: () => [{ count: 0 }, []],
  update: (s, m) => {
    switch (m.type) {
      case 'inc': return [{ ...s, count: s.count + 1 }, []]
      case 'dec': return [{ ...s, count: s.count - 1 }, []]
    }
  },
  view: ({ text }) => [text((s) => String(s.count))],
})
`
    const out = tDev(source)
    expect(out).toMatch(/__schemaHash:\s*["'][0-9a-f]{32}["']/)
  })

  it('__schemaHash changes when msgSchema changes', () => {
    const a = tDev(`
import { component } from '@llui/dom'
type State = { n: number }
type Msg = { type: 'a' }
export const X = component<State, Msg, never>({
  name: 'X', init: () => [{ n: 0 }, []], update: (s, _m) => [s, []],
  view: ({ text }) => [text((s) => String(s.n))],
})
`)
    const b = tDev(`
import { component } from '@llui/dom'
type State = { n: number }
type Msg = { type: 'a' } | { type: 'b' }
export const X = component<State, Msg, never>({
  name: 'X', init: () => [{ n: 0 }, []], update: (s, _m) => [s, []],
  view: ({ text }) => [text((s) => String(s.n))],
})
`)
    const aHash = a.match(/__schemaHash:\s*["']([0-9a-f]{32})["']/)?.[1]
    const bHash = b.match(/__schemaHash:\s*["']([0-9a-f]{32})["']/)?.[1]
    expect(aHash).toBeDefined()
    expect(bHash).toBeDefined()
    expect(aHash).not.toBe(bHash)
  })
})

describe('transformLlui — agent-mode metadata emission', () => {
  const tProd = (src: string, emitAgentMetadata: boolean) =>
    transformLlui(src, 'test.ts', /* devMode */ false, /* emitAgentMetadata */ emitAgentMetadata)
      ?.output ?? src

  const sample = `
import { component, button } from '@llui/dom'
type State = { n: number }
type Msg =
  /** @intent("Increment") */
  | { type: 'inc' }
export const App = component<State, Msg, never>({
  name: 'App', init: () => [{ n: 0 }, []],
  update: (s, _m) => [s, []],
  view: ({ send, text }) => [
    button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
  ],
})
`

  it('omits schemas and tagged handlers in prod mode with agent: false (baseline)', () => {
    const out = tProd(sample, false)
    expect(out).not.toContain('__msgSchema:')
    expect(out).not.toContain('__stateSchema:')
    expect(out).not.toContain('__msgAnnotations:')
    // No def-level descriptor array (gone since runtime collection)
    // and no per-handler tagger output without agent: true either.
    expect(out).not.toContain('__bindingDescriptors:')
    expect(out).not.toContain('__lluiVariants')
    // __schemaHash is already always-emitted:
    expect(out).toMatch(/__schemaHash:/)
  })

  it('emits schemas + tags event-handler sends in prod mode with agent: true', () => {
    const out = tProd(sample, true)
    expect(out).toContain('__msgSchema:')
    expect(out).toContain('__stateSchema:')
    expect(out).toContain('__msgAnnotations:')
    // Runtime descriptors live on tagged handlers, not on the def.
    expect(out).not.toContain('__bindingDescriptors:')
    expect(out).toMatch(/__lluiVariants:\s*\[\s*["']inc["']\s*\]/)
    expect(out).toMatch(/__schemaHash:/)
  })

  it('omits __componentMeta (file/line) even with agent: true in prod', () => {
    const out = tProd(sample, true)
    expect(out).not.toContain('__componentMeta:')
  })
})
