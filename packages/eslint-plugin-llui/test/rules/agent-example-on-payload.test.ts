import { RuleTester } from '@typescript-eslint/rule-tester'
import { agentExampleOnPayloadRule } from '../../src/rules/agent-example-on-payload.js'

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

ruleTester.run('agent-example-on-payload', agentExampleOnPayloadRule, {
  valid: [
    {
      // Payload + @intent + @example — the documented combination.
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /**
         * @intent("Set a cell value")
         * @example("typical: dispatch from inline cell editor")
         */
        | { type: 'SetCell'; criterionId: string; value: number }
      const App = component<State, Msg, never>({} as any)
      `,
    },
    {
      // No payload (just discriminator) — example not required.
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /** @intent("Reset") */
        | { type: 'Reset' }
      const App = component<State, Msg, never>({} as any)
      `,
    },
    {
      // @humanOnly variants are skipped — the LLM never sees them.
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /** @intent("Internal handoff") @humanOnly */
        | { type: 'InternalHandoff'; payload: string }
      const App = component<State, Msg, never>({} as any)
      `,
    },
    {
      // No @intent — the missing-intent rule fires instead. Don't
      // double-nag.
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg = | { type: 'Bare'; data: number }
      const App = component<State, Msg, never>({} as any)
      `,
    },
  ],
  invalid: [
    {
      // Payload + @intent but no @example — should fire.
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /** @intent("Save") */
        | { type: 'Save'; title: string; description: string }
      const App = component<State, Msg, never>({} as any)
      `,
      errors: [
        {
          messageId: 'missing',
          data: { variant: 'Save', typedLintHint: HINT },
        },
      ],
    },
  ],
})
