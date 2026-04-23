import { RuleTester } from '@typescript-eslint/rule-tester'
import { agentNonextractableHandlerRule } from '../../src/rules/agent-nonextractable-handler.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
})

ruleTester.run('agent-nonextractable-handler', agentNonextractableHandlerRule, {
  valid: [
    {
      filename: 'test.ts',
      code: `
      const c = component({
        view: () => [
          button({ onClick: () => send({ type: 'literalMsg' }) }, [])
        ]
      })
      `,
    },
    {
      // dynamic send outside view
      filename: 'test.ts',
      code: `
      const c = component({
        update: (state, [msg]) => {
          send(msg)
          return [state, []]
        }
      })
      `,
    },
  ],
  invalid: [
    {
      filename: 'test.ts',
      code: `
      const c = component({
        view: () => {
          const myMsg = { type: 'dynamic' }
          return [
            button({ onClick: () => send(myMsg) }, [])
          ]
        }
      })
      `,
      errors: [{ messageId: 'nonextractable' }],
    },
    {
      filename: 'test.ts',
      code: `
      const c = component({
        view: () => [
          button({ onClick: () => send({ type: dynamicType }) }, [])
        ]
      })
      `,
      errors: [{ messageId: 'nonextractable' }],
    },
  ],
})
