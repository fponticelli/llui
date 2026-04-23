import { RuleTester } from '@typescript-eslint/rule-tester'
import { missingMemoRule } from '../../src/rules/missing-memo.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
})

ruleTester.run('missing-memo', missingMemoRule, {
  valid: [
    {
      code: `
      const app = component({
        view: ({ text }) => {
          return [
            div({ class: (s) => s.isActive ? 'active' : '' }, [
              text((s) => s.name)
            ])
          ]
        }
      })
      `,
    },
    {
      code: `
      const app = component({
        view: ({ text, memo }) => {
          const isActive = memo((s) => s.isActive)
          return [
            div({ class: isActive }, [
              span({ class: isActive }, [])
            ])
          ]
        }
      })
      `,
    },
    {
      code: `
      const app = component({
        view: ({ text }) => {
          // Zero arg arrows are ignored
          return [
            div({ class: () => 'active' }, [
              span({ class: () => 'active' }, [])
            ])
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
        view: ({ text }) => {
          return [
            div({ class: (s) => s.isActive ? 'active' : '' }, [
              span({ class: (s) => s.isActive ? 'active' : '' }, [])
            ])
          ]
        }
      })
      `,
      errors: [{ messageId: 'missing' }],
    },
    {
      code: `
      const app = component({
        view: ({ text }) => {
          return [
            div({}, [
              text((s) => s.user.name),
              text((s) => s.user.name)
            ])
          ]
        }
      })
      `,
      errors: [{ messageId: 'missing' }],
    },
  ],
})
