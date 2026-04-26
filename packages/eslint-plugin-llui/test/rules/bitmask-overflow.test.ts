import { RuleTester } from '@typescript-eslint/rule-tester'
import { bitmaskOverflowRule } from '../../src/rules/bitmask-overflow.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

// Generate a body that reads N distinct state paths via `text()` calls.
function manyPaths(n: number): string {
  const calls: string[] = []
  for (let i = 0; i < n; i++) calls.push(`text((s) => s.f${i})`)
  return calls.join(', ')
}

ruleTester.run('bitmask-overflow', bitmaskOverflowRule, {
  valid: [
    // 31 paths — exactly at the limit, no warning.
    {
      code: `
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          view: () => [div([${manyPaths(31)}])],
        })
      `,
    },
    // No component() call — the rule is silent on plain analysis files.
    {
      code: `
        export function utility() {
          return text((s) => s.a)
        }
      `,
    },
  ],
  invalid: [
    // 32 paths — over by 1.
    {
      code: `
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          view: () => [div([${manyPaths(32)}])],
        })
      `,
      errors: [{ messageId: 'overflow' }],
    },
    // 50 paths.
    {
      code: `
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          view: () => [div([${manyPaths(50)}])],
        })
      `,
      errors: [{ messageId: 'overflow' }],
    },
  ],
})
