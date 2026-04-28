import { RuleTester } from '@typescript-eslint/rule-tester'
import { noSampleInReactivePositionRule } from '../../src/rules/no-sample-in-reactive-position.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

ruleTester.run('no-sample-in-reactive-position', noSampleInReactivePositionRule, {
  valid: [
    // Reactive accessor — proper form.
    { code: `text((s) => s.title)` },
    { code: `unsafeHtml((s) => s.markdown)` },
    // Static string — fine.
    { code: `text('hello')` },
    // ItemAccessor reactive — covered by no-eager-item-accessor for the
    // wrong form; this rule doesn't object.
    { code: `text(item.title)` },
    // `sample` invoked inside the reactive accessor body — re-runs on
    // every commit, equivalent to `(s) => s.title`. Not the antipattern.
    { code: `text((s) => sample((s) => s.title))` },
    // `sample` used outside any reactive position — passed to a
    // logging function, used in a calculation. Not flagged.
    { code: `console.log(sample((s) => s.id))` },
    { code: `const x = sample((s) => s.count) + 1` },
    // `sample` passed to a non-text/unsafeHtml function (presumed
    // imperative renderer). Not flagged.
    { code: `renderImperative(sample((s) => s.config))` },
  ],
  invalid: [
    {
      // The motivating case: text(sample(...)) — string is captured
      // once at view-construction; cell never updates.
      code: `text(sample((s) => s.title))`,
      errors: [{ messageId: 'sampleInReactive', data: { callee: 'text' } }],
    },
    {
      // Same antipattern via `h.text(...)`.
      code: `h.text(sample((s) => s.title))`,
      errors: [{ messageId: 'sampleInReactive', data: { callee: 'text' } }],
    },
    {
      // unsafeHtml has the same accessor contract.
      code: `unsafeHtml(sample((s) => s.html))`,
      errors: [{ messageId: 'sampleInReactive', data: { callee: 'unsafeHtml' } }],
    },
    {
      // Bag form for unsafeHtml.
      code: `h.unsafeHtml(sample((s) => s.html))`,
      errors: [{ messageId: 'sampleInReactive', data: { callee: 'unsafeHtml' } }],
    },
    {
      // `h.sample(...)` (the bag form of sample) — same antipattern.
      code: `text(h.sample((s) => s.title))`,
      errors: [{ messageId: 'sampleInReactive', data: { callee: 'text' } }],
    },
  ],
})
