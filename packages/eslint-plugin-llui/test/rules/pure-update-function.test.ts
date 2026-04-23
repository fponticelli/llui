import { RuleTester } from '@typescript-eslint/rule-tester'
import { pureUpdateFunctionRule } from '../../src/rules/pure-update-function.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
})

ruleTester.run('pure-update-function', pureUpdateFunctionRule, {
  valid: [
    {
      code: `
      const c = component({
        update: (state, msg) => {
          return [{ ...state }, [http('GET', '/api')]]
        }
      })
      `,
    },
    {
      // Using Math.max is fine, Math.random is bad
      code: `
      const c = component({
        update: (state, msg) => {
          return [{ ...state, val: Math.max(0, state.val) }, []]
        }
      })
      `,
    },
    {
      // Using global things outside of update
      code: `
      const now = Date.now()
      const c = component({
        init: () => {
          setTimeout(() => {}, 100)
          return [{ val: 0 }, []]
        },
        view: () => {
          Math.random()
          return [div({})]
        }
      })
      `,
    },
    {
      // If there's a local variable shadowing it, it's technically still flagged but we just look at property name.
      // But standard effects don't use these direct names.
      code: `
      const c = component({
        update: (state, msg) => {
          const timeout = 500
          return [state, []]
        }
      })
      `,
    },
  ],
  invalid: [
    {
      code: `
      const c = component({
        update: (state, msg) => {
          fetch('/api')
          return [state, []]
        }
      })
      `,
      errors: [{ messageId: 'impureCall', data: { name: 'fetch' } }],
    },
    {
      code: `
      const c = component({
        update: (state, msg) => {
          setTimeout(() => {}, 1000)
          return [state, []]
        }
      })
      `,
      errors: [{ messageId: 'impureCall', data: { name: 'setTimeout' } }],
    },
    {
      code: `
      const c = component({
        update: (state, msg) => {
          const val = Math.random()
          return [{ ...state, val }, []]
        }
      })
      `,
      errors: [{ messageId: 'impureCall', data: { name: 'Math.random' } }],
    },
    {
      code: `
      const c = component({
        update: (state, msg) => {
          const t = Date.now()
          return [{ ...state, t }, []]
        }
      })
      `,
      errors: [{ messageId: 'impureCall', data: { name: 'Date.now' } }],
    },
    {
      code: `
      const c = component({
        update: (state, msg) => {
          const t = new Date()
          return [{ ...state, t }, []]
        }
      })
      `,
      errors: [{ messageId: 'impureCall', data: { name: 'new Date()' } }],
    },
    {
      code: `
      const c = component({
        update: (state, msg) => {
          document.title = "Hello"
          return [state, []]
        }
      })
      `,
      errors: [{ messageId: 'impureCall', data: { name: 'document' } }],
    },
    {
      code: `
      const c = component({
        update: (state, msg) => {
          window.localStorage.setItem('foo', 'bar')
          return [state, []]
        }
      })
      `,
      errors: [{ messageId: 'impureCall', data: { name: 'window' } }],
    },
  ],
})
