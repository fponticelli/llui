import { RuleTester } from '@typescript-eslint/rule-tester'
import { noEagerItemAccessorRule } from '../../src/rules/no-eager-item-accessor.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

ruleTester.run('no-eager-item-accessor', noEagerItemAccessorRule, {
  valid: [
    // Reactive: pass the accessor function itself. Runtime detects
    // zero-arg and re-reads on every commit.
    { code: `text(item.title)` },
    { code: `h.text(item.title)` },
    { code: `unsafeHtml(item.html)` },
    // Static-string form is fine — not an accessor at all.
    { code: `text('hello')` },
    // State accessor is fine — reactive via mask.
    { code: `text((s) => s.title)` },
    // Item accessor wrapped in a zero-arg lambda — also reactive
    // (the runtime calls the outer function, which calls the
    // accessor). Some authors prefer this form to make the read
    // explicit.
    { code: `text(() => item.title())` },
    // `item.X()` invoked at positions that DO expect a () => V
    // accessor body — `show.when`, event handlers, etc. — are fine.
    // The rule only fires on accessor-taking primitives.
    { code: `show({ when: () => item.banned() })` },
    { code: `button({ onClick: () => send({ type: 'pick', id: item.id() }) })` },
    // Calling something other than an item accessor is fine — `text`
    // accepts strings, and `getTitle()` returning a string at view
    // construction is legitimate static text.
    { code: `text(getTitle())` },
    // Chained property access doesn't match — `item.foo.bar()` isn't
    // the eager-ItemAccessor pattern (item doesn't expose nested
    // fields). Rule conservatively skips.
    { code: `text(item.foo.bar())` },
  ],
  invalid: [
    {
      // The motivating case: eager invocation of an item field at
      // text(). The cell never updates when item state changes.
      code: `text(item.title())`,
      errors: [
        {
          messageId: 'eager',
          data: { callee: 'text', accessor: 'item.title' },
        },
      ],
    },
    {
      // Same antipattern via the bag form `h.text(...)`.
      code: `h.text(item.title())`,
      errors: [
        {
          messageId: 'eager',
          data: { callee: 'text', accessor: 'item.title' },
        },
      ],
    },
    {
      // unsafeHtml has the same accessor contract.
      code: `unsafeHtml(item.html())`,
      errors: [
        {
          messageId: 'eager',
          data: { callee: 'unsafeHtml', accessor: 'item.html' },
        },
      ],
    },
  ],
})
