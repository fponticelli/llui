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
    // 62 paths — exactly at the two-word limit, no warning.
    {
      code: `
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          view: () => [div([${manyPaths(62)}])],
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
    // 63 paths — over by 1 (past the high-word bit 30).
    {
      code: `
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          view: () => [div([${manyPaths(63)}])],
        })
      `,
      errors: [{ messageId: 'overflow' }],
    },
    // 80 paths.
    {
      code: `
        const App = component({
          name: 'X',
          init: () => [{}, []],
          update: (s) => [s, []],
          view: () => [div([${manyPaths(80)}])],
        })
      `,
      errors: [{ messageId: 'overflow' }],
    },
  ],
})
