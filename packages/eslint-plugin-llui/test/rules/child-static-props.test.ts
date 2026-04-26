import { RuleTester } from '@typescript-eslint/rule-tester'
import { childStaticPropsRule } from '../../src/rules/child-static-props.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

ruleTester.run('child-static-props', childStaticPropsRule, {
  valid: [
    // Reactive accessor returning state-derived primitive — fine.
    { code: `child({ component: SomeChild, props: (s) => ({ count: s.count }) })` },
    // Accessor that returns a nested object via a stable state ref —
    // shape from state is not freshly allocated here, so no warning.
    { code: `child({ component: SomeChild, props: (s) => ({ user: s.user }) })` },
    // No props at all — out of scope.
    { code: `child({ component: SomeChild })` },
    // child() with explicit block body and stable return.
    {
      code: `child({ component: SomeChild, props: (s) => { return { id: s.id } } })`,
    },
  ],
  invalid: [
    {
      // Static object literal — never updates with parent state.
      code: `child({ component: SomeChild, props: { count: 0 } })`,
      errors: [{ messageId: 'staticLiteral' }],
    },
    {
      // Accessor returning a fresh nested object literal for one key.
      code: `child({ component: SomeChild, props: (s) => ({ config: { x: s.x } }) })`,
      errors: [{ messageId: 'freshNested', data: { kind: 'object', key: 'config' } }],
    },
    {
      // Accessor returning a fresh array literal.
      code: `child({ component: SomeChild, props: (s) => ({ items: [1, 2, 3] }) })`,
      errors: [{ messageId: 'freshNested', data: { kind: 'array', key: 'items' } }],
    },
    {
      // Block-body accessor with fresh nested literal in return.
      code: `child({ component: SomeChild, props: (s) => { return { config: { x: s.x } } } })`,
      errors: [{ messageId: 'freshNested', data: { kind: 'object', key: 'config' } }],
    },
  ],
})
