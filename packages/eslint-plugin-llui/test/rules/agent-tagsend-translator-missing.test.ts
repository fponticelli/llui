import { RuleTester } from '@typescript-eslint/rule-tester'
import { agentTagsendTranslatorMissingRule } from '../../src/rules/agent-tagsend-translator-missing.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

ruleTester.run('agent-tagsend-translator-missing', agentTagsendTranslatorMissingRule, {
  valid: [
    // Translator wrapper — library Msgs route through to a domain Msg.
    {
      code: `sortable.connect((s) => s.sort, (libMsg) => send({ type: 'Sort/Update', msg: libMsg }))`,
    },
    {
      code: `sortable.connect((s) => s.sort, (m) => send({ type: 'Sort/Update', msg: m }))`,
    },
    // Named const that's a translator (the rule heuristic accepts any
    // bare identifier name OTHER than literal 'send').
    {
      code: `sortable.connect(state, translatedSend)`,
    },
    // Connect call with only one argument (no send) — out of scope.
    {
      code: `sortable.connect((s) => s.sort)`,
    },
    // Non-connect call — ignored.
    {
      code: `connect(state, send)`, // bare 'connect' callee, not a member expression
    },
    // The send shape mapped to a sub-msg via a function call — the
    // 2nd arg is a function call, not a bare identifier.
    {
      code: `sortable.connect((s) => s.sort, makeTranslator(send))`,
    },
  ],
  invalid: [
    {
      // The motivating case: raw `send` passed as the 2nd argument.
      // Library internals will leak into agent affordances.
      code: `sortable.connect((s) => s.sort, send)`,
      errors: [{ messageId: 'missing', data: { callee: 'sortable' } }],
    },
    {
      // Same antipattern with a different library.
      code: `dialog.connect((s) => s.dlg, send)`,
      errors: [{ messageId: 'missing', data: { callee: 'dialog' } }],
    },
    {
      // No `get` argument — connect(send) — uncommon but shape still
      // wrong if the lib expects (get, send). The rule fires on the
      // 2nd-arg position regardless, since that's where the leak path
      // lives.
      code: `lib.connect(stateAccessor, send)`,
      errors: [{ messageId: 'missing', data: { callee: 'lib' } }],
    },
  ],
})
