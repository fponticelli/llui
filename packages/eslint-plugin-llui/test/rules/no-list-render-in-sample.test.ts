import { RuleTester } from '@typescript-eslint/rule-tester'
import { noListRenderInSampleRule } from '../../src/rules/no-list-render-in-sample.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

ruleTester.run('no-list-render-in-sample', noListRenderInSampleRule, {
  valid: [
    // Legitimate sample uses — passing a state snapshot to imperative
    // code, computing a static value.
    { code: `sample((s) => s.user.id)` },
    { code: `sample((s) => buildChartConfig(s.metrics))` },
    { code: `h.sample((s) => s.session.token)` },
    // .map() over a literal array — not state-derived.
    { code: `sample((s) => [1, 2, 3].map(x => x * 2))` },
    // .map() over a call result — also fine, the result was computed
    // fresh and isn't a captured state reference.
    { code: `sample((s) => buildList().map(rowFn))` },
    // Non-sample call — ignored.
    { code: `myFn((s) => s.list.items.map(rowFn))` },
    // `each` is the right tool — and explicitly not flagged here
    // (other rules cover its semantics).
    { code: `each({ items: (s) => s.list.items, key: (r) => r.id, render: rowFn })` },
  ],
  invalid: [
    {
      // The motivating case: `.map()` over `s.list.items` inside
      // sample's callback. Captures the rows once at construction;
      // cells go stale on in-place updates.
      code: `sample((s) => s.list.items.map(rowFn))`,
      errors: [{ messageId: 'mapInSample' }],
    },
    {
      // Same antipattern via the bag form `h.sample(...)`.
      code: `h.sample((s) => s.list.items.map(rowFn))`,
      errors: [{ messageId: 'mapInSample' }],
    },
    {
      // Wrapped in a ternary (the agent's actual shape — empty-state
      // branch + items branch in the same closure).
      code: `sample((s) => s.list.items.length === 0 ? [emptyState] : [table(s.list.items.map(rowFn))])`,
      errors: [{ messageId: 'mapInSample' }],
    },
    {
      // Block body — same antipattern, different syntax.
      code: `sample((s) => { return s.list.items.map(rowFn) })`,
      errors: [{ messageId: 'mapInSample' }],
    },
    {
      // `props` parameter (the convention for view functions reading
      // `Props<T, S>`) — also state-derived in practice.
      code: `sample((props) => props.items.map(rowFn))`,
      errors: [{ messageId: 'mapInSample' }],
    },
    {
      // Nested member access — `state.list.items.map(...)` should
      // also fire (the chain bottoms out at `state`).
      code: `sample((state) => state.list.items.map(rowFn))`,
      errors: [{ messageId: 'mapInSample' }],
    },
  ],
})
