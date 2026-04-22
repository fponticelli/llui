import { RuleTester } from '@typescript-eslint/rule-tester'
import * as tseslintParser from '@typescript-eslint/parser'
import rule from '../../src/rules/async-update'

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
  },
})

ruleTester.run('async-update', rule, {
  valid: [
    {
      code: `
        component({
          update: (state) => {
            return [state, []];
          }
        })
      `,
    },
    {
      code: `
        component({
          update: (state) => {
            const doAsync = async () => { await Promise.resolve(); };
            return [state, []];
          }
        })
      `,
    },
  ],
  invalid: [
    {
      code: `
        component({
          update: async (state) => {
            return [state, []];
          }
        })
      `,
      errors: [{ messageId: 'asyncUpdate' }],
    },
    {
      code: `
        component({
          update: (state) => {
            await Promise.resolve();
            return [state, []];
          }
        })
      `,
      errors: [{ messageId: 'asyncUpdate' }],
    },
  ],
})
