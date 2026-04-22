import { RuleTester } from '@typescript-eslint/rule-tester'
import * as tseslintParser from '@typescript-eslint/parser'
import rule from '../../src/rules/exhaustive-effect-handling'

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
  },
})

ruleTester.run('exhaustive-effect-handling', rule, {
  valid: [
    {
      code: `
        match(effect)
          .with({ type: 'fetch' }, () => {})
          .else(() => { console.warn('unhandled'); })
      `,
    },
    {
      code: `
        match(effect)
          .with({ type: 'fetch' }, () => {})
          .else(() => undefined) // intentional discard via expression
      `,
    },
  ],
  invalid: [
    {
      code: `
        match(effect)
          .with({ type: 'fetch' }, () => {})
          .else(() => {})
      `,
      errors: [{ messageId: 'emptyElse' }],
    },
    {
      code: `
        match(effect)
          .with({ type: 'fetch' }, () => {})
          .else(function() {})
      `,
      errors: [{ messageId: 'emptyElse' }],
    },
  ],
})
