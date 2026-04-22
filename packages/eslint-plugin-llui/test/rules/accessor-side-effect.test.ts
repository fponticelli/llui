import { RuleTester } from '@typescript-eslint/rule-tester'
import * as tseslintParser from '@typescript-eslint/parser'
import rule from '../../src/rules/accessor-side-effect'

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
  },
})

ruleTester.run('accessor-side-effect', rule, {
  valid: [
    {
      code: `
        component({
          view: () => [
            button({
              onClick: () => { console.log('clicked'); } // inside event handler, ok
            })
          ]
        })
      `,
    },
    {
      code: `
        component({
          update: (state) => {
            console.log('updated'); // in update, ok
            return [state, []];
          },
          view: () => []
        })
      `,
    },
  ],
  invalid: [
    {
      code: `
        component({
          view: () => [
            text(s => {
              console.log(s);
              return s.name;
            })
          ]
        })
      `,
      errors: [{ messageId: 'accessorSideEffect' }],
    },
    {
      code: `
        component({
          view: () => [
            div({
              class: s => {
                fetch('/api');
                return s.isActive ? 'active' : '';
              }
            })
          ]
        })
      `,
      errors: [{ messageId: 'accessorSideEffect' }],
    },
  ],
})
