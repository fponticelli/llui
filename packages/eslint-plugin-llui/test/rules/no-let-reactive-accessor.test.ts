import { RuleTester } from '@typescript-eslint/rule-tester'
import { noLetReactiveAccessorRule } from '../../src/rules/no-let-reactive-accessor.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

ruleTester.run('no-let-reactive-accessor', noLetReactiveAccessorRule, {
  valid: [
    // `const` accessors — the canonical shape, never flagged.
    { code: `const isGated = (s) => s.gated; button({ disabled: isGated })` },
    { code: `const getLabel = (s) => s.label; text(getLabel)` },
    { code: `const memoFn = memo((s) => s.gated); button({ disabled: memoFn })` },

    // `let` for non-callable values — unrelated to the rule.
    { code: `let label = 'hi'; div({ class: label })` },
    { code: `let count = 0; count = count + 1` },

    // `let` callable that's NEVER used at a reactive position — fine.
    { code: `let greet = () => 'hi'; console.log(greet())` },
    { code: `let handler = (e) => e.preventDefault(); button({ onClick: handler })` },

    // `let` callable used at an event-handler position — not reactive.
    { code: `let onTap = () => doIt(); button({ onClick: onTap })` },

    // `let` in `each.key` — `key` is excluded (per-row, not state-reactive).
    { code: `let k = (it) => it.id; each({ items: i, key: k, render: r })` },

    // Multi-declarator `let` — out of scope; user can split themselves.
    { code: `let a = (s) => s.a, b = (s) => s.b; text(a); text(b)` },
  ],
  invalid: [
    // Element-prop reactive position — autofixable when never reassigned.
    {
      code: `let isGated = (s) => s.gated\nbutton({ disabled: isGated })`,
      errors: [
        {
          messageId: 'letAccessor',
          data: { name: 'isGated', kind: 'let', context: 'button({ disabled: … })' },
        },
      ],
      output: `const isGated = (s) => s.gated\nbutton({ disabled: isGated })`,
    },

    // var — same fallback behavior at the compiler.
    {
      code: `var isGated = (s) => s.gated\nbutton({ disabled: isGated })`,
      errors: [
        {
          messageId: 'letAccessor',
          data: { name: 'isGated', kind: 'var', context: 'button({ disabled: … })' },
        },
      ],
      output: `const isGated = (s) => s.gated\nbutton({ disabled: isGated })`,
    },

    // text() first arg.
    {
      code: `let getLabel = (s) => s.label\ntext(getLabel)`,
      errors: [
        { messageId: 'letAccessor', data: { name: 'getLabel', kind: 'let', context: 'text(…)' } },
      ],
      output: `const getLabel = (s) => s.label\ntext(getLabel)`,
    },

    // Structural primitive driver: show.when.
    {
      code: `let when = (s) => s.gated\nshow({ when, render: r })`,
      errors: [
        {
          messageId: 'letAccessor',
          data: { name: 'when', kind: 'let', context: 'show({ when: … })' },
        },
      ],
      output: `const when = (s) => s.gated\nshow({ when, render: r })`,
    },

    // each.items — driver position.
    {
      code: `let items = (s) => s.rows\neach({ items, key: (it) => it.id, render: r })`,
      errors: [
        {
          messageId: 'letAccessor',
          data: { name: 'items', kind: 'let', context: 'each({ items: … })' },
        },
      ],
      output: `const items = (s) => s.rows\neach({ items, key: (it) => it.id, render: r })`,
    },

    // branch.on.
    {
      code: `let on = (s) => s.tab\nbranch({ on, cases: {} })`,
      errors: [
        {
          messageId: 'letAccessor',
          data: { name: 'on', kind: 'let', context: 'branch({ on: … })' },
        },
      ],
      output: `const on = (s) => s.tab\nbranch({ on, cases: {} })`,
    },

    // memo(arrow) initializer — the same shape the compiler resolves
    // for `const`, deserves the same autofix.
    {
      code: `let isGatedMemo = memo((s) => s.gated)\nbutton({ disabled: isGatedMemo })`,
      errors: [{ messageId: 'letAccessor' }],
      output: `const isGatedMemo = memo((s) => s.gated)\nbutton({ disabled: isGatedMemo })`,
    },

    // FunctionExpression initializer.
    {
      code: `let isGated = function (s) { return s.gated }\nbutton({ disabled: isGated })`,
      errors: [{ messageId: 'letAccessor' }],
      output: `const isGated = function (s) { return s.gated }\nbutton({ disabled: isGated })`,
    },

    // Reassigned later → no autofix; user must split the binding.
    {
      code: `let isGated = (s) => s.gated\nbutton({ disabled: isGated })\nisGated = (s) => !s.gated`,
      errors: [{ messageId: 'letAccessorReassigned' }],
      // No `output` — fix is intentionally suppressed.
      output: null,
    },

    // Used at multiple reactive positions — still reports once on the
    // declaration (we report on the `let` keyword, not per-use).
    {
      code: `let isGated = (s) => s.gated\nbutton({ disabled: isGated }, [text(isGated)])`,
      errors: [{ messageId: 'letAccessor' }],
      output: `const isGated = (s) => s.gated\nbutton({ disabled: isGated }, [text(isGated)])`,
    },
  ],
})
