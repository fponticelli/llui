import { RuleTester } from '@typescript-eslint/rule-tester'
import * as tseslintParser from '@typescript-eslint/parser'
import rule from '../../src/rules/imperative-dom-in-view'

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
  },
})

ruleTester.run('imperative-dom-in-view', rule, {
  valid: [
    {
      code: `
        component({
          view: () => [
            onMount(() => {
              document.getElementById('app');
            })
          ]
        })
      `,
    },
    {
      code: `
        component({
          view: () => [
            button({
              onClick: () => {
                document.getElementById('app');
              }
            })
          ]
        })
      `,
    },
  ],
  invalid: [
    {
      code: `
        component({
          view: () => {
            const el = document.getElementById('app');
            return [];
          }
        })
      `,
      errors: [{ messageId: 'imperativeDom' }],
    },
  ],
})
