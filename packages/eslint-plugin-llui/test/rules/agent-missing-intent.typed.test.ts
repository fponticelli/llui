import { RuleTester } from '@typescript-eslint/rule-tester'
import { agentMissingIntentRule } from '../../src/rules/agent-missing-intent.js'
import path from 'node:path'

const fixtureDir = path.join(__dirname, '..', 'typed-fixtures')

// Typed-lint integration: verifies the cross-file detection path. A
// Msg union (`Action`) declared in one file with an unconventional
// name, and used as the M argument of `component<S, Cmd, E>()` in
// another file (with an import rename), is recognised as a Msg union
// when typed lint is configured. Without the typed-lint path the
// rule would silently skip the variants because none of the dropped
// name heuristics would match.
const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      projectService: {
        defaultProject: 'tsconfig.json',
      },
      tsconfigRootDir: fixtureDir,
    },
  },
})

ruleTester.run('agent-missing-intent (typed-lint cross-file)', agentMissingIntentRule, {
  valid: [],
  invalid: [
    {
      // The fixture file `external-msg.ts` has `Action` with one
      // untagged variant. Without typed lint, no heuristic would fire
      // on this file (no `component()` call here, name isn't `Msg` or
      // `*Msg`). With typed lint, the rule resolves the symbol and
      // matches it against the project-wide M-arg symbol set
      // populated from `app.ts`'s `component<S, Cmd, E>` call.
      code: `// Re-read the fixture — RuleTester doesn't load file contents on its own,
// the code string is what gets linted, but typed-lint resolves cross-file
// imports against the actual files on disk.
export type Action =
  | { type: 'untaggedFromExternalFile' }
  /** @intent("Has tag") */
  | { type: 'taggedFromExternalFile' }
`,
      filename: path.join(fixtureDir, 'external-msg.ts'),
      // typedLintHint is empty when typed-lint is configured.
      errors: [
        { messageId: 'missing', data: { variant: 'untaggedFromExternalFile', typedLintHint: '' } },
      ],
    },
  ],
})
