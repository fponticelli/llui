import { RuleTester } from '@typescript-eslint/rule-tester'
import * as tseslintParser from '@typescript-eslint/parser'
import rule from '../../src/rules/spread-in-children'

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
  },
})

ruleTester.run('spread-in-children', rule, {
  valid: [
    {
      code: `
        div({}, [...each({ items: () => [], render: () => [] })])
      `,
    },
    {
      code: `
        div({}, [...provideValue(Ctx, val, () => [])])
      `,
    },
  ],
  invalid: [
    {
      code: `
        div({}, [...arr.map(x => x)])
      `,
      errors: [{ messageId: 'noSpreadInChildren' }],
    },
  ],
})
