import { RuleTester } from '@typescript-eslint/rule-tester'
import { agentWarningOnConfirmRule } from '../../src/rules/agent-warning-on-confirm.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
})

const HINT =
  ' Tip: enable `parserOptions.projectService: true` (or `parserOptions.project`) so this rule and `agent-missing-intent` can resolve Msg unions across files.'

ruleTester.run('agent-warning-on-confirm', agentWarningOnConfirmRule, {
  valid: [
    {
      // @requiresConfirm + @warning — the documented pair.
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /**
         * @intent("Delete the matrix")
         * @requiresConfirm
         * @warning("Permanent — there is no undo")
         */
        | { type: 'Delete'; id: string }
      const App = component<State, Msg, never>({} as any)
      `,
    },
    {
      // No @requiresConfirm, so no @warning needed.
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /** @intent("Increment") */
        | { type: 'inc' }
      const App = component<State, Msg, never>({} as any)
      `,
    },
  ],
  invalid: [
    {
      // @requiresConfirm without @warning — should fire.
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /** @intent("Delete the matrix") @requiresConfirm */
        | { type: 'Delete'; id: string }
      const App = component<State, Msg, never>({} as any)
      `,
      errors: [
        {
          messageId: 'missing',
          data: { variant: 'Delete', typedLintHint: HINT },
        },
      ],
    },
  ],
})
