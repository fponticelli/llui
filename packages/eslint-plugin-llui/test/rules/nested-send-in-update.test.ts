import { RuleTester } from '@typescript-eslint/rule-tester'
import * as tseslintParser from '@typescript-eslint/parser'
import rule from '../../src/rules/nested-send-in-update'

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
  },
})

ruleTester.run('nested-send-in-update', rule, {
  valid: [
    {
      code: `
        component({
          update: (state, msg, { send }) => {
            // using effects is fine
            return [state, [{ type: 'fetch' }]];
          }
        })
      `,
    },
    {
      code: `
        component({
          update: (state, msg) => {
            const doSomething = () => { send(); }; // nested functions are fine since they aren't executed immediately
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
          update: (state, msg, { send }) => {
            send({ type: 'other' });
            return [state, []];
          }
        })
      `,
      errors: [{ messageId: 'nestedSend' }],
    },
  ],
})
