import { RuleTester } from '@typescript-eslint/rule-tester'
import * as tseslintParser from '@typescript-eslint/parser'
import rule from '../../src/rules/string-effect-callback'

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
  },
})

ruleTester.run('string-effect-callback', rule, {
  valid: [
    {
      code: `
        http({ onSuccess: (data) => ({ type: 'loaded', payload: data }) })
      `,
    },
    {
      code: `
        // other string properties are fine
        input({ type: 'text' })
      `,
    },
  ],
  invalid: [
    {
      code: `
        http({ onSuccess: 'loaded' })
      `,
      errors: [{ messageId: 'stringEffectCallback' }],
    },
    {
      code: `
        http({ onError: 'failed' })
      `,
      errors: [{ messageId: 'stringEffectCallback' }],
    },
  ],
})
