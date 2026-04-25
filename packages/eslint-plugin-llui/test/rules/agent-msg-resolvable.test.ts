import { RuleTester } from '@typescript-eslint/rule-tester'
import { agentMsgResolvableRule } from '../../src/rules/agent-msg-resolvable.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
})

// The rule appends a "Tip: enable parserOptions.projectService" hint
// to every error when typed-lint isn't configured. These tests run
// without typed-lint, so the hint always fires.
const HINT =
  ' Tip: enable `parserOptions.projectService: true` (or `parserOptions.project`) so this rule and `agent-missing-intent` can resolve Msg unions across files.'

ruleTester.run('agent-msg-resolvable', agentMsgResolvableRule, {
  valid: [
    // Locally declared Msg — passes.
    {
      code: `
        import { component } from '@llui/dom'
        type State = { x: number }
        type Msg = { type: 'inc' }
        export const App = component<State, Msg, never>({} as any)
      `,
    },
    // Locally declared Msg with renamed type alias — passes (rule
    // checks declaration presence, not the conventional 'Msg' name).
    {
      code: `
        import { component } from '@llui/dom'
        type AppState = { x: number }
        type AppMsg = { type: 'inc' }
        export const App = component<AppState, AppMsg, never>({} as any)
      `,
    },
    // Locally declared via interface (not type alias) — also valid;
    // the cross-file resolver looks for both forms.
    {
      code: `
        import { component } from '@llui/dom'
        interface State { x: number }
        type Msg = { type: 'inc' }
        export const App = component<State, Msg, never>({} as any)
      `,
    },
    // Imported with a *named* import — passes. The plugin's resolver
    // chases this.
    {
      code: `
        import { component } from '@llui/dom'
        import type { Msg } from './msg'
        type State = { x: number }
        export const App = component<State, Msg, never>({} as any)
      `,
    },
    // Imported with an aliased named import — also valid.
    {
      code: `
        import { component } from '@llui/dom'
        import type { Msg as M } from './msg'
        type State = { x: number }
        export const App = component<State, M, never>({} as any)
      `,
    },
    // Re-exported through a barrel — locally the import is `{ Msg }`
    // which the resolver handles.
    {
      code: `
        import { component } from '@llui/dom'
        import { Msg } from './state'
        type S = { x: number }
        export const App = component<S, Msg, never>({} as any)
      `,
    },
    // No component() call at all — rule is silent on unrelated code.
    {
      code: `
        const x = 1
        function foo<T>(): T { return 0 as T }
      `,
    },
  ],
  invalid: [
    // Msg referenced but neither declared locally nor imported.
    {
      code: `
        import { component } from '@llui/dom'
        type State = { x: number }
        export const App = component<State, MissingMsg, never>({} as any)
      `,
      errors: [
        {
          messageId: 'unresolvable',
          data: {
            state: 'State',
            msg: 'MissingMsg',
            effect: 'never',
            importBraceOpen: '{',
            importBraceClose: '}',
            typedLintHint: HINT,
          },
        },
      ],
    },
    // Imported via namespace (`import * as ...`) — the cross-file
    // resolver doesn't follow namespaces, so the plugin would emit no
    // annotations even though TypeScript itself accepts the type.
    {
      code: `
        import { component } from '@llui/dom'
        import * as msgs from './msgs'
        type State = { x: number }
        export const App = component<State, msgs, never>({} as any)
      `,
      errors: [
        {
          messageId: 'namespaceImport',
          data: {
            state: 'State',
            msg: 'msgs',
            effect: 'never',
            importBraceOpen: '{',
            importBraceClose: '}',
            typedLintHint: HINT,
          },
        },
      ],
    },
    // Generic (`Msg<T>`) — not a plain identifier, plugin can't follow.
    {
      code: `
        import { component } from '@llui/dom'
        type State = { x: number }
        type Box<T> = { type: 'box'; payload: T }
        export const App = component<State, Box<number>, never>({} as any)
      `,
      errors: [
        {
          messageId: 'complexTypeArg',
          data: {
            state: 'State',
            msgText: 'Box<number>',
            effect: 'never',
            typedLintHint: HINT,
          },
        },
      ],
    },
    // Inline literal type — same issue; not a named identifier.
    {
      code: `
        import { component } from '@llui/dom'
        type State = { x: number }
        export const App = component<State, { type: 'inline' }, never>({} as any)
      `,
      errors: [
        {
          // Inline object types aren't TSTypeReference — they're
          // TSTypeLiteral. The rule classifies these as complex type
          // args since the plugin has no name to chase.
          messageId: 'complexTypeArg',
          data: {
            state: 'State',
            msgText: "{ type: 'inline' }",
            effect: 'never',
            typedLintHint: HINT,
          },
        },
      ],
    },
  ],
})
