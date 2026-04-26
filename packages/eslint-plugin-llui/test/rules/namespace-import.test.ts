import { RuleTester } from '@typescript-eslint/rule-tester'
import { namespaceImportRule } from '../../src/rules/namespace-import.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

ruleTester.run('namespace-import', namespaceImportRule, {
  valid: [
    // Named import — the compiler-recognised form.
    { code: `import { div, text } from '@llui/dom'` },
    // Named imports from @llui/components — also recognised.
    { code: `import { dialog } from '@llui/components'` },
    // Namespace import from an unrelated source — out of scope.
    { code: `import * as fs from 'node:fs'` },
    // Default import — not a namespace; leave alone.
    { code: `import L from 'some-pkg'` },
  ],
  invalid: [
    {
      code: `import * as L from '@llui/dom'`,
      errors: [
        {
          messageId: 'namespace',
          data: { local: 'L', source: '@llui/dom', braceOpen: '{', braceClose: '}' },
        },
      ],
    },
    {
      code: `import * as C from '@llui/components'`,
      errors: [
        {
          messageId: 'namespace',
          data: { local: 'C', source: '@llui/components', braceOpen: '{', braceClose: '}' },
        },
      ],
    },
  ],
})
