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

// Each fixture includes an in-file `component<S, M, E>()` call so the
// rule's same-file detection path picks up the Msg alias. The dropped
// name heuristics would have detected isolated `type Msg = ...` even
// without a usage — but a Msg with no consumer is dead code, and the
// rule no longer fires on it. Real codebases always have the call.

ruleTester.run('agent-exclusive-annotations', agentExclusiveAnnotationsRule, {
  valid: [
    {
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /**
         * @intent("Increment the counter")
         * @requiresConfirm
         */
        | { type: 'increment' }
        /** @humanOnly */
        | { type: 'internalTick' }
      const App = component<State, Msg, never>({} as any)
      `,
    },
    // @agentOnly + @intent + @requiresConfirm is fine — agent-only just
    // means no UI binding, the agent still dispatches it (possibly with
    // user confirmation gating).
    {
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /**
         * @intent("Run the bulk import")
         * @agentOnly
         * @requiresConfirm
         */
        | { type: 'bulkImport' }
      const App = component<State, Msg, never>({} as any)
      `,
    },
  ],
  invalid: [
    {
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /**
         * @humanOnly
         * @requiresConfirm
         */
        | { type: 'increment' }
      const App = component<State, Msg, never>({} as any)
      `,
      errors: [
        {
          messageId: 'redundant',
          data: { variant: 'increment', conflictList: '@requiresConfirm' },
        },
      ],
    },
    // Both @humanOnly and @agentOnly is incoherent — opposite audiences.
    {
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /**
         * @humanOnly
         * @agentOnly
         */
        | { type: 'confused' }
      const App = component<State, Msg, never>({} as any)
      `,
      errors: [
        {
          messageId: 'modeConflict',
          data: { variant: 'confused' },
        },
      ],
    },
  ],
})
