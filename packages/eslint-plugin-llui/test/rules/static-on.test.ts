import { RuleTester } from '@typescript-eslint/rule-tester'
import { staticOnRule } from '../../src/rules/static-on.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

ruleTester.run('static-on', staticOnRule, {
  valid: [
    // `on` reads a state path — the discriminant is reactive.
    { code: `scope({ on: (s) => s.tab, cases: {} })` },
    { code: `branch({ on: (s) => s.route.page, cases: {} })` },
    // Block body that returns a state-derived value.
    { code: `scope({ on: (s) => { return s.mode }, cases: {} })` },
    // Zero-arg with an item-accessor call — legitimate inside an
    // `each.render` callback. The CallExpression in the body signals
    // "reading something potentially state-derived."
    { code: `branch({ on: () => item.kind(), cases: {} })` },
    // Zero-arg with a member expression read — also legitimate
    // (memo accessor, closure-captured selector, etc.).
    { code: `scope({ on: () => state.section, cases: {} })` },
    // No `on` prop — out of scope (other rules handle missing required fields).
    { code: `scope({ cases: {} })` },
    // Non-scope/branch call — ignored.
    { code: `myFn({ on: () => 'x' })` },
  ],
  invalid: [
    {
      // Zero-param arrow with a bare-literal body — definitionally
      // reads nothing and the key never changes.
      code: `scope({ on: () => 'tab', cases: {} })`,
      errors: [{ messageId: 'static', data: { name: 'scope' } }],
    },
    {
      // One-param arrow but the body ignores it.
      code: `branch({ on: (s) => 'fixed', cases: {} })`,
      errors: [{ messageId: 'static', data: { name: 'branch' } }],
    },
    {
      // Block body that returns a constant.
      code: `scope({ on: (s) => { return 'k' }, cases: {} })`,
      errors: [{ messageId: 'static', data: { name: 'scope' } }],
    },
  ],
})
