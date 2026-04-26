import { RuleTester } from '@typescript-eslint/rule-tester'
import * as tseslintParser from '@typescript-eslint/parser'
import rule from '../../src/rules/spread-in-children.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
  },
})

ruleTester.run('spread-in-children', rule, {
  valid: [
    // Structural primitives — bounded function-call results.
    { code: `div({}, [...each({ items: () => [], render: () => [] })])` },
    { code: `div({}, [...provideValue(Ctx, val, () => [])])` },
    // Identifier resolves to a locally-bounded array literal — child
    // count is statically determinable, no `each()` opportunity.
    {
      code: `
        const items = [1, 2, 3]
        div([...items.map((x) => text(x))])
      `,
    },
    // Identifier resolves to a function-call result (presumed structural).
    {
      code: `
        const cells = renderCells()
        div([...cells])
      `,
    },
    // Identifier resolves to a method call on a bounded receiver.
    {
      code: `
        const base = [1, 2, 3]
        const items = base.map((x) => x * 2)
        div([...items])
      `,
    },
  ],
  invalid: [
    // Unresolved identifier — could be anything dynamic.
    {
      code: `div({}, [...arr.map(x => x)])`,
      errors: [{ messageId: 'noSpread', data: { name: 'div' } }],
    },
    // Inline literal `.map(...)` — author should see canonical pattern.
    {
      code: `div([...[1,2,3].map((x) => text(x))])`,
      errors: [{ messageId: 'noSpread', data: { name: 'div' } }],
    },
  ],
})
