import { RuleTester } from '@typescript-eslint/rule-tester'
import { eachClosureViolationRule } from '../../src/rules/each-closure-violation.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
})

ruleTester.run('each-closure-violation', eachClosureViolationRule, {
  valid: [
    {
      code: `
      import { someHelper } from './utils'
      const GLOBAL_CONST = 1
      
      const app = component({
        view: ({ each, send }) => {
          return [
            each({
              items: (s) => s.items,
              key: (i) => i.id,
              render: ({ item }) => {
                const local = item()
                return [
                  div({ class: () => \`item \${GLOBAL_CONST}\` }, [
                    text(() => someHelper(local.name)),
                    button({ onClick: () => send({ type: 'x' }) }, [])
                  ])
                ]
              }
            })
          ]
        }
      })
      `,
    },
  ],
  invalid: [
    {
      code: `
      const app = component({
        view: ({ each }) => {
          const outerVar = 123
          return [
            each({
              items: (s) => s.items,
              key: (i) => i.id,
              render: ({ item }) => {
                return [
                  div({ class: () => \`item \${outerVar}\` }, [])
                ]
              }
            })
          ]
        }
      })
      `,
      errors: [{ messageId: 'capture', data: { name: 'outerVar' } }],
    },
  ],
})
