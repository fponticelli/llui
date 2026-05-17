import { RuleTester } from '@typescript-eslint/rule-tester'
import { staticItemsRule } from '../../src/rules/static-items.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

ruleTester.run('static-items', staticItemsRule, {
  valid: [
    // Standard reactive items factory.
    {
      code: `each({ items: (s) => s.list, key: (i) => i.id, render: () => [] })`,
    },
    {
      code: `h.each({ items: (s) => s.users, key: (u) => u.id, render: () => [] })`,
    },
    // Block body with state read.
    {
      code: `each({ items: (s) => { return s.things }, key: (t) => t.id, render: () => [] })`,
    },
    // Zero-arg with a CallExpression body — could be reading from a
    // memo, closure-captured state, or anything else state-derived.
    {
      code: `each({ items: () => myMemo(), key: (i) => i.id, render: () => [] })`,
    },
    // Zero-arg with a MemberExpression body — closure-captured state.
    {
      code: `each({ items: () => state.items, key: (i) => i.id, render: () => [] })`,
    },
    // `items` is a passed-in accessor (not a literal function) — we
    // can't tell statically; don't fire.
    {
      code: `each({ items: props.items, key: (i) => i.id, render: () => [] })`,
    },
    // Generic slice helper: state read goes through an `opts.getProps(s)`
    // call. `s` is passed as a call argument, not directly dereferenced —
    // the rule must still recognize this as a state read.
    {
      code: `each({ items: (s) => opts.getProps(s).selected.slice(), key: (t) => t, render: () => [] })`,
    },
    // Same shape via a bag-form call.
    {
      code: `h.each({ items: (s) => getRows(s, ctx), key: (r) => r.id, render: () => [] })`,
    },
    // No items prop — out of scope (other rules handle missing required fields).
    { code: `each({ key: (i) => i.id, render: () => [] })` },
    // Non-each call — ignored.
    { code: `myFn({ items: () => [] })` },
  ],
  invalid: [
    {
      // Bare-literal zero-arg body — list never changes.
      code: `each({ items: () => [1, 2, 3], key: (i) => i, render: () => [] })`,
      errors: [{ messageId: 'static' }],
    },
    {
      // One-param arrow that ignores the param.
      code: `each({ items: (s) => CONSTANT_LIST, key: (i) => i.id, render: () => [] })`,
      errors: [{ messageId: 'static' }],
    },
    {
      // Block body returning a literal.
      code: `each({ items: (s) => { return [{a:1}, {a:2}] }, key: (i) => i.a, render: () => [] })`,
      errors: [{ messageId: 'static' }],
    },
    {
      // Same antipattern via the bag form.
      code: `h.each({ items: () => [], key: (i) => i.id, render: () => [] })`,
      errors: [{ messageId: 'static' }],
    },
  ],
})
