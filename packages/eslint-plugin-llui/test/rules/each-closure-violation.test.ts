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
    // Generic slice helper captures `opts` (a function param of the
    // enclosing helper) inside an event handler. Event handlers run at
    // user-interaction time, not during reconciliation — captures here
    // don't have the staleness pitfall a reactive binding would.
    {
      code: `
      function tagSelectorView(h, opts) {
        return [
          each({
            items: (s) => opts.getProps(s).selected,
            key: (t) => t,
            render: ({ item }) => [
              button({
                onClick: () => opts.send(opts.wrapMsg({ type: 'remove', tag: item() })),
                onKeyDown: (e) => opts.handleKey(e, item()),
              }, [])
            ]
          })
        ]
      }
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
