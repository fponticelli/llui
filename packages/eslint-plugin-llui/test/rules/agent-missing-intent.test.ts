import { RuleTester } from '@typescript-eslint/rule-tester'
import { agentMissingIntentRule } from '../../src/rules/agent-missing-intent.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
})

ruleTester.run('agent-missing-intent', agentMissingIntentRule, {
  valid: [
    {
      code: `
      export type Msg = 
        /** @intent("Increment the counter") */
        | { type: 'increment' }
        /**
         * @humanOnly
         */
        | { type: 'internalTick' }
      `,
    },
  ],
  invalid: [
    {
      code: `
      export type Msg = 
        | { type: 'increment' }
        /** @intent("Decrement") */
        | { type: 'decrement' }
      `,
      errors: [{ messageId: 'missing', data: { variant: 'increment' } }],
    },
  ],
})
