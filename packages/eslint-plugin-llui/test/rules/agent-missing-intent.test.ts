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

// Typed-lint hint suffix — appended to every error message when
// parserOptions.projectService isn't configured. These tests run
// without typed-lint, so the hint always fires.
const HINT =
  ' Tip: enable `parserOptions.projectService: true` (or `parserOptions.project`) so this rule and `agent-missing-intent` can resolve Msg unions across files.'

// Detection requires an in-file `component<S, M, E>()` call (the
// untyped-fallback path) or typed lint configured (the cross-file
// path). Tests use the in-file path, which is what most LLui projects
// look like in practice — the Msg union and the component() call live
// in the same file or are imported with typed-lint enabled.
//
// The plugin's *runtime* path follows imports cross-file regardless;
// lint coverage of the same case requires typed-lint.

ruleTester.run('agent-missing-intent', agentMissingIntentRule, {
  valid: [
    {
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /** @intent("Increment the counter") */
        | { type: 'increment' }
        /** @humanOnly */
        | { type: 'internalTick' }
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
        | { type: 'increment' }
        /** @intent("Decrement") */
        | { type: 'decrement' }
      const App = component<State, Msg, never>({} as any)
      `,
      errors: [{ messageId: 'missing', data: { variant: 'increment', typedLintHint: HINT } }],
    },
    // @agentOnly does NOT exempt — the agent IS the dispatcher and still
    // needs the intent label. Otherwise Claude sees a synthesized name.
    {
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Msg =
        /** @agentOnly */
        | { type: 'bulkImport' }
      const App = component<State, Msg, never>({} as any)
      `,
      errors: [{ messageId: 'missing', data: { variant: 'bulkImport', typedLintHint: HINT } }],
    },
    // Non-conventional name (`Action`) detected because it's used as
    // the M arg of an in-file component<>() call. The dropped name
    // heuristics ('Msg' / '*Msg' suffix) had this exact failure mode
    // backwards — they fired on `*Msg` even when no component() ever
    // referenced the alias.
    {
      code: `
      import { component } from '@llui/dom'
      type State = { x: number }
      type Action =
        | { type: 'untagged' }
        /** @intent("Tagged") */
        | { type: 'ok' }
      const App = component<State, Action, never>({} as any)
      `,
      errors: [{ messageId: 'missing', data: { variant: 'untagged', typedLintHint: HINT } }],
    },
  ],
})
