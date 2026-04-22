import { RuleTester } from '@typescript-eslint/rule-tester'
import * as tseslintParser from '@typescript-eslint/parser'
import rule from '../../src/rules/direct-state-in-view'

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
  },
})

ruleTester.run('direct-state-in-view', rule, {
  valid: [
    {
      code: `
        component({
          view: () => [
            button({
              onClick: () => { send({ type: 'click' }); } // no state access
            })
          ]
        })
      `,
    },
    {
      code: `
        component({
          view: () => [
            text(state => state.name) // accessor
          ]
        })
      `,
    },
  ],
  invalid: [
    {
      code: `
        component({
          view: () => [
            button({
              onClick: () => { send({ type: 'click', value: state.name }); }
            })
          ]
        })
      `,
      errors: [{ messageId: 'directState' }],
    },
  ],
})
