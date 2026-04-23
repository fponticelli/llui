import { RuleTester } from '@typescript-eslint/rule-tester'
import { agentExclusiveAnnotationsRule } from '../../src/rules/agent-exclusive-annotations.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
})

ruleTester.run('agent-exclusive-annotations', agentExclusiveAnnotationsRule, {
  valid: [
    {
      code: `
      export type Msg = 
        /**
         * @intent("Increment the counter")
         * @requiresConfirm
         */
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
        /**
         * @humanOnly
         * @requiresConfirm
         */
        | { type: 'increment' }
      `,
      errors: [
        {
          messageId: 'redundant',
          data: { variant: 'increment', conflictList: '@requiresConfirm' },
        },
      ],
    },
  ],
})
