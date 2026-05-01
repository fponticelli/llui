import { RuleTester } from '@typescript-eslint/rule-tester'
import { noSampleInAccessorRule } from '../../src/rules/no-sample-in-accessor.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

ruleTester.run('no-sample-in-accessor', noSampleInAccessorRule, {
  valid: [
    // Pure accessors — the supported pattern.
    { code: `each({ items: (s) => s.rows, key: (it) => it.id, render: rowFn })` },
    { code: `branch({ on: (s) => s.tab, cases: { a: A, b: B } })` },
    { code: `show({ when: (s) => s.visible, render: R })` },
    { code: `child({ def: D, key: 'c', props: (s) => ({ x: s.x }) })` },
    { code: `foreign({ mount: M, props: (s) => ({ x: s.x }), sync: S, destroy: D })` },
    { code: `text((s) => s.title)` },
    { code: `unsafeHtml((s) => s.html)` },

    // sample() at view scope — outside any accessor — is the legitimate use.
    {
      code: `const snap = sample((s) => s.user); foreign({ mount: M, props: () => snap, sync: S, destroy: D })`,
    },

    // sample() inside a non-accessor callback that nests inside an accessor
    // (e.g. an event handler attached during render — which doesn't exist
    // here but a similar shape: a click handler returned via render). The
    // rule intentionally does not descend into nested function bodies.
    {
      code: `each({ items: (s) => s.rows, key: (it) => it.id, render: ({item}) => [div({onClick: () => sample((s) => s.x)}, [])] })`,
    },

    // sample() inside a different (non-tracked) function call — not flagged.
    { code: `myCustomFn((s) => sample((s2) => s2.x))` },
  ],
  invalid: [
    // The motivating bug — sample() in each.key.
    {
      code: `each({ items: (s) => s.rows, key: (it) => \`\${it.id}|\${sample((s) => s.rev)}\`, render: R })`,
      errors: [{ messageId: 'sampleInAccessor', data: { primitive: 'each', prop: 'key' } }],
    },
    // sample() in each.items.
    {
      code: `each({ items: (_s) => sample((s) => s.rows), key: (it) => it.id, render: R })`,
      errors: [{ messageId: 'sampleInAccessor', data: { primitive: 'each', prop: 'items' } }],
    },
    // sample() in branch.on.
    {
      code: `branch({ on: (_s) => sample((s) => s.tab), cases: {} })`,
      errors: [{ messageId: 'sampleInAccessor', data: { primitive: 'branch', prop: 'on' } }],
    },
    // sample() in show.when.
    {
      code: `show({ when: (_s) => sample((s) => s.visible), render: R })`,
      errors: [{ messageId: 'sampleInAccessor', data: { primitive: 'show', prop: 'when' } }],
    },
    // sample() in scope.on.
    {
      code: `scope({ on: (_s) => sample((s) => s.k), default: D })`,
      errors: [{ messageId: 'sampleInAccessor', data: { primitive: 'scope', prop: 'on' } }],
    },
    // sample() in child.props.
    {
      code: `child({ def: D, key: 'c', props: (_s) => ({ x: sample((s) => s.x) }) })`,
      errors: [{ messageId: 'sampleInAccessor', data: { primitive: 'child', prop: 'props' } }],
    },
    // sample() in foreign.props.
    {
      code: `foreign({ mount: M, props: (_s) => ({ x: sample((s) => s.x) }), sync: S, destroy: D })`,
      errors: [{ messageId: 'sampleInAccessor', data: { primitive: 'foreign', prop: 'props' } }],
    },
    // sample() in a binding accessor — text((s) => sample(…)).
    {
      code: `text((s) => sample((s2) => s2.title))`,
      errors: [{ messageId: 'sampleInBinding', data: { primitive: 'text' } }],
    },
    // sample() in unsafeHtml — same antipattern.
    {
      code: `unsafeHtml((_s) => sample((s) => s.html))`,
      errors: [{ messageId: 'sampleInBinding', data: { primitive: 'unsafeHtml' } }],
    },
    // h.sample (the View-bag form) — also flagged.
    {
      code: `each({ items: (s) => s.rows, key: (it) => \`\${it.id}|\${h.sample((s) => s.rev)}\`, render: R })`,
      errors: [{ messageId: 'sampleInAccessor', data: { primitive: 'each', prop: 'key' } }],
    },
    // h.each(...) — member-call form.
    {
      code: `h.each({ items: (s) => s.rows, key: (it) => \`\${sample((s) => s.x)}-\${it.id}\`, render: R })`,
      errors: [{ messageId: 'sampleInAccessor', data: { primitive: 'each', prop: 'key' } }],
    },
  ],
})
