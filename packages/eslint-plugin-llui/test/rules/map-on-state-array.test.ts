import { RuleTester } from '@typescript-eslint/rule-tester'
import { mapOnStateArrayRule } from '../../src/rules/map-on-state-array.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
})

ruleTester.run('map-on-state-array', mapOnStateArrayRule, {
  valid: [
    {
      code: `
      const app = component({
        view: ({ each }) => {
          return [
            each({
              items: (s) => s.items,
              key: (i) => i.id,
              render: ({ item }) => [div({}, [])]
            })
          ]
        }
      })
      `,
    },
    {
      // using map on a non-state array is valid
      code: `
      const app = component({
        view: () => {
          const arr = [1, 2, 3]
          return arr.map(n => div({}, []))
        }
      })
      `,
    },
    {
      // using map on state in update is valid
      code: `
      const app = component({
        update: (state) => {
          return [{ ...state, items: state.items.map(x => x + 1) }, []]
        }
      })
      `,
    },
  ],
  invalid: [
    {
      code: `
      const app = component({
        view: () => {
          return [
            div({}, [
              (s) => s.items.map(i => text(() => i.name))
            ])
          ]
        }
      })
      `,
      errors: [{ messageId: 'useEach' }],
    },
  ],
})
