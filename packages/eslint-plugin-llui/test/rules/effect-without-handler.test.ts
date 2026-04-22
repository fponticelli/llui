import { RuleTester } from '@typescript-eslint/rule-tester'
import * as tseslintParser from '@typescript-eslint/parser'
import rule from '../../src/rules/effect-without-handler'

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
  },
})

ruleTester.run('effect-without-handler', rule, {
  valid: [
    {
      code: `
        component({
          update: (state) => {
            return [state, [{ type: 'fetch' }]];
          },
          onEffect: (effect) => {}
        })
      `,
    },
    {
      code: `
        component({
          update: (state) => {
            return [state, []]; // empty effects
          }
        })
      `,
    },
  ],
  invalid: [
    {
      code: `
        component({
          update: (state) => {
            return [state, [{ type: 'fetch' }]];
          }
        })
      `,
      errors: [{ messageId: 'missingHandler' }],
    },
  ],
})
