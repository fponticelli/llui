import { RuleTester } from '@typescript-eslint/rule-tester'
import { stateMutationRule } from '../../src/rules/state-mutation.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
})

ruleTester.run('state-mutation', stateMutationRule, {
  valid: [
    {
      code: `
      const app = component({
        update: (state, msg) => {
          return [{ ...state, count: state.count + 1 }, []]
        }
      })
      `,
    },
    {
      code: `
      const app = component({
        update: (state, msg) => {
          const next = state.count + 1
          return [{ ...state, count: next }, []]
        }
      })
      `,
    },
    {
      code: `
      const app = component({
        update: (state, msg) => {
          return [{ ...state, items: [...state.items, newItem] }, []]
        }
      })
      `,
    },
    {
      // Using unary ops that don't mutate
      code: `
      const app = component({
        update: (state, msg) => {
          return [{ ...state, flag: !state.flag, val: -state.val }, []]
        }
      })
      `,
    },
    {
      // Mutating a local variable that is NOT state
      code: `
      const app = component({
        update: (state, msg) => {
          const arr = []
          arr.push(1)
          return [{ ...state, arr }, []]
        }
      })
      `,
    },
  ],
  invalid: [
    {
      code: `
      const app = component({
        update: (state, msg) => {
          state.count = state.count + 1
          return [state, []]
        }
      })
      `,
      errors: [{ messageId: 'assignment' }],
    },
    {
      code: `
      const app = component({
        update: (state, msg) => {
          state.count += 1
          return [state, []]
        }
      })
      `,
      errors: [{ messageId: 'compound' }],
    },
    {
      code: `
      const app = component({
        update: (state, msg) => {
          state.count++
          return [state, []]
        }
      })
      `,
      errors: [{ messageId: 'increment' }],
    },
    {
      code: `
      const app = component({
        update: (state, msg) => {
          ++state.count
          return [state, []]
        }
      })
      `,
      errors: [{ messageId: 'increment' }],
    },
    {
      code: `
      const app = component({
        update: (state, msg) => {
          state.items.push(msg.item)
          return [state, []]
        }
      })
      `,
      errors: [{ messageId: 'method', data: { methodName: 'push' } }],
    },
  ],
})
