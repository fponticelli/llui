import { RuleTester } from '@typescript-eslint/rule-tester'
import { exhaustiveUpdateRule } from '../../src/rules/exhaustive-update.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

ruleTester.run('exhaustive-update', exhaustiveUpdateRule, {
  valid: [
    // All variants handled.
    {
      code: `
        type Msg = { type: 'inc' } | { type: 'dec' }
        const App = component({
          update: (s, m) => {
            switch (m.type) {
              case 'inc': return [s, []]
              case 'dec': return [s, []]
            }
          },
        })
      `,
    },
    // Default clause silences the rule (author opted into fall-through).
    {
      code: `
        type Msg = { type: 'inc' } | { type: 'dec' }
        const App = component({
          update: (s, m) => {
            switch (m.type) {
              case 'inc': return [s, []]
              default: return [s, []]
            }
          },
        })
      `,
    },
    // No Msg type — rule has nothing to compare against.
    {
      code: `
        const App = component({
          update: (s, m) => [s, []],
        })
      `,
    },
    // Exported Msg — rule still finds it.
    {
      code: `
        export type Msg = { type: 'a' }
        const App = component({
          update: (s, m) => {
            switch (m.type) {
              case 'a': return [s, []]
            }
          },
        })
      `,
    },
  ],
  invalid: [
    {
      // One missing variant.
      code: `
        type Msg = { type: 'inc' } | { type: 'dec' } | { type: 'reset' }
        const App = component({
          update: (s, m) => {
            switch (m.type) {
              case 'inc': return [s, []]
              case 'dec': return [s, []]
            }
          },
        })
      `,
      errors: [
        {
          messageId: 'missing',
          data: { plural: '', names: "'reset'" },
        },
      ],
    },
    {
      // Multiple missing — plural form.
      code: `
        type Msg = { type: 'a' } | { type: 'b' } | { type: 'c' }
        const App = component({
          update: (s, m) => {
            switch (m.type) {
              case 'a': return [s, []]
            }
          },
        })
      `,
      errors: [
        {
          messageId: 'missing',
          data: { plural: 's', names: "'b', 'c'" },
        },
      ],
    },
  ],
})
