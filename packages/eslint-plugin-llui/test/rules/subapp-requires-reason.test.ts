import { RuleTester } from '@typescript-eslint/rule-tester'
import { subappRequiresReasonRule } from '../../src/rules/subapp-requires-reason.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

ruleTester.run('subapp-requires-reason', subappRequiresReasonRule, {
  valid: [
    // Canonical: non-empty literal reason.
    {
      code: `subApp({ reason: 'Monaco owns its own DOM lifecycle', def: Editor })`,
    },
    // Template literal without interpolations is still a literal.
    {
      code: 'subApp({ reason: `60fps drag layer`, def: Drag })',
    },
    // Reason hoisted as a module-scoped const string — common shared-constant pattern.
    {
      code: `
        const REASON = 'Lazy admin tools chunk; state sealed from main app'
        subApp({ reason: REASON, def: AdminPanel })
      `,
    },
    // Other calls named `subApp` from unrelated libraries shouldn't be touched
    // by this rule's structural matcher — but if they DO match, requiring a
    // non-empty literal reason is harmless. We test the canonical positive.
    {
      code: `notSubApp({ def: X })`,
    },
    // Member-access subApp call (e.g., `escape.subApp(...)`) — also enforced.
    {
      code: `escape.subApp({ reason: 'foreign-DOM library wrapper', def: Foo })`,
    },
  ],
  invalid: [
    // Missing reason entirely.
    {
      code: `subApp({ def: Foo })`,
      errors: [{ messageId: 'missing' }],
    },
    // Empty string.
    {
      code: `subApp({ reason: '', def: Foo })`,
      errors: [{ messageId: 'empty' }],
    },
    // Whitespace-only string.
    {
      code: `subApp({ reason: '   ', def: Foo })`,
      errors: [{ messageId: 'empty' }],
    },
    // Computed string (function call).
    {
      code: `subApp({ reason: getReason(), def: Foo })`,
      errors: [{ messageId: 'notLiteral' }],
    },
    // Template literal with interpolation — also computed.
    {
      code: 'subApp({ reason: `dynamic ${reason}`, def: Foo })',
      errors: [{ messageId: 'notLiteral' }],
    },
    // Identifier that doesn't resolve to a local string constant.
    {
      code: `
        import { REASON } from 'somewhere'
        subApp({ reason: REASON, def: Foo })
      `,
      errors: [{ messageId: 'notLiteral' }],
    },
    // Bad reason — "code organization" excuse.
    {
      code: `subApp({ reason: 'code organization', def: Foo })`,
      errors: [{ messageId: 'organizationOnly' }],
    },
    // Bad reason — "break this up".
    {
      code: `subApp({ reason: 'to break this up', def: Foo })`,
      errors: [{ messageId: 'organizationOnly' }],
    },
    // Bad reason — "subcomponent" usage.
    {
      code: `subApp({ reason: 'this subcomponent should be its own thing', def: Foo })`,
      errors: [{ messageId: 'organizationOnly' }],
    },
    // Member-access subApp call with empty reason.
    {
      code: `escape.subApp({ reason: '', def: Foo })`,
      errors: [{ messageId: 'empty' }],
    },
  ],
})
