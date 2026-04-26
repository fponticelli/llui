import { RuleTester } from '@typescript-eslint/rule-tester'
import { agentEmitsDriftRule } from '../../src/rules/agent-emits-drift.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
})

ruleTester.run('agent-emits-drift', agentEmitsDriftRule, {
  valid: [
    {
      // Literal effect emission matches @emits exactly.
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /**
         * @intent("Save the matrix")
         * @emits("cloud/save")
         */
        | { type: 'Save' }
      const update = (s: State, m: Msg): [State, unknown[]] => {
        switch (m.type) {
          case 'Save': return [s, [{ kind: 'cloud/save' }]]
        }
      }
      const App = component<State, Msg, never>({} as any)
      `,
    },
    {
      // Helper call (track) — opaque, no orphaned-emit warning.
      // The case has track('foo') instead of a literal {kind: ...}.
      // Rule can't verify, so it stays silent.
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /**
         * @intent("Save")
         * @emits("analytics/track")
         */
        | { type: 'Save' }
      const track = (event: string) => ({ kind: 'analytics/track', event })
      const update = (s: State, m: Msg): [State, unknown[]] => {
        switch (m.type) {
          case 'Save': return [s, [track('save')]]
        }
      }
      const App = component<State, Msg, never>({} as any)
      `,
    },
    {
      // No @emits, no literal effects. Nothing to check.
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /** @intent("Increment") */
        | { type: 'inc' }
      const update = (s: State, m: Msg): [State, unknown[]] => {
        switch (m.type) {
          case 'inc': return [{ x: s.x + 1 }, []]
        }
      }
      const App = component<State, Msg, never>({} as any)
      `,
    },
    {
      // Mixed: literal AND helper. Helper makes the orphaned check
      // skip; the literal kind matches @emits, so no undeclared
      // warning either.
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /**
         * @intent("Save")
         * @emits("cloud/save", "analytics/track")
         */
        | { type: 'Save' }
      const track = (event: string) => ({ kind: 'analytics/track', event })
      const update = (s: State, m: Msg): [State, unknown[]] => {
        switch (m.type) {
          case 'Save': return [s, [{ kind: 'cloud/save' }, track('save')]]
        }
      }
      const App = component<State, Msg, never>({} as any)
      `,
    },
  ],
  invalid: [
    {
      // Effect emitted in update() but not declared — undeclared.
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /**
         * @intent("Save")
         * @emits("cloud/save")
         */
        | { type: 'Save' }
      const update = (s: State, m: Msg): [State, unknown[]] => {
        switch (m.type) {
          case 'Save':
            return [s, [{ kind: 'cloud/save' }, { kind: 'analytics/track' }]]
        }
      }
      const App = component<State, Msg, never>({} as any)
      `,
      errors: [
        {
          messageId: 'undeclared',
          data: { variant: 'Save', kind: 'analytics/track' },
        },
      ],
    },
    {
      // Declared in @emits but no literal emission and no opaque
      // helper — orphaned. The case is fully visible and doesn't
      // emit the declared kind.
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /**
         * @intent("Save")
         * @emits("cloud/save", "analytics/track")
         */
        | { type: 'Save' }
      const update = (s: State, m: Msg): [State, unknown[]] => {
        switch (m.type) {
          case 'Save': return [s, [{ kind: 'cloud/save' }]]
        }
      }
      const App = component<State, Msg, never>({} as any)
      `,
      errors: [
        {
          messageId: 'orphaned',
          data: { variant: 'Save', kind: 'analytics/track' },
        },
      ],
    },
  ],
})
