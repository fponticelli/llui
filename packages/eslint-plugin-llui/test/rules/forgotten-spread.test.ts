import { RuleTester } from '@typescript-eslint/rule-tester'
import * as tseslintParser from '@typescript-eslint/parser'
import rule from '../../src/rules/forgotten-spread'

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
  },
})

ruleTester.run('forgotten-spread', rule, {
  valid: [
    {
      code: `
        div({}, [...show(true, () => [])])
      `,
    },
    {
      code: `
        div({}, [...each({ items: () => [], render: () => [] })])
      `,
    },
    {
      code: `
        div({}, [text('hello')])
      `,
    },
  ],
  invalid: [
    {
      code: `
        div({}, [show(true, () => [])])
      `,
      errors: [{ messageId: 'forgottenSpread' }],
    },
    {
      code: `
        div({}, [each({ items: () => [], render: () => [] })])
      `,
      errors: [{ messageId: 'forgottenSpread' }],
    },
  ],
})
