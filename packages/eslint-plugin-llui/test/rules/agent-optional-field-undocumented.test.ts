import { RuleTester } from '@typescript-eslint/rule-tester'
import { agentOptionalFieldUndocumentedRule } from '../../src/rules/agent-optional-field-undocumented.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
})

ruleTester.run('agent-optional-field-undocumented', agentOptionalFieldUndocumentedRule, {
  valid: [
    {
      // Optional field with @should — the documented LLM-friendly form.
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /** @intent("Save the matrix as a new copy") */
        | {
            type: 'SaveAs'
            title: string
            /** @should("Brief description shown in the matrix list") */
            description?: string
          }
      const App = component<State, Msg, never>({} as any)
      `,
    },
    {
      // Optional field with any plain JSDoc — author marked the
      // intent explicitly, even if not @should. Rule passes; the
      // author chose the form.
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /** @intent("Open dialog") */
        | {
            type: 'Open'
            id: string
            /** Internal flag — toggled by the parent component, not the agent. */
            silent?: boolean
          }
      const App = component<State, Msg, never>({} as any)
      `,
    },
    {
      // No optional fields — nothing to nag about.
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /** @intent("Increment") */
        | { type: 'inc'; by: number }
      const App = component<State, Msg, never>({} as any)
      `,
    },
    {
      // @humanOnly variants are skipped — fields the LLM never sees.
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /** @humanOnly */
        | { type: 'InternalSync'; payload?: string }
      const App = component<State, Msg, never>({} as any)
      `,
    },
  ],
  invalid: [
    {
      // Optional field with no JSDoc above it — the motivating case.
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /** @intent("Save") */
        | { type: 'Save'; title: string; description?: string }
      const App = component<State, Msg, never>({} as any)
      `,
      errors: [
        {
          messageId: 'missing',
          data: { variant: 'Save', field: 'description' },
        },
      ],
    },
    {
      // Multiple optional fields, one annotated and one not — only
      // the unannotated one fires.
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /** @intent("SaveAs") */
        | {
            type: 'SaveAs'
            title: string
            /** @should("Brief description") */
            description?: string
            tags?: string[]
          }
      const App = component<State, Msg, never>({} as any)
      `,
      errors: [
        {
          messageId: 'missing',
          data: { variant: 'SaveAs', field: 'tags' },
        },
      ],
    },
  ],
})
