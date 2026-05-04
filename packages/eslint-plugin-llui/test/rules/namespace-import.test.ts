import { RuleTester } from '@typescript-eslint/rule-tester'
import { namespaceImportRule } from '../../src/rules/namespace-import.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

ruleTester.run('namespace-import', namespaceImportRule, {
  valid: [
    // Named imports — the compiler-recognised, tree-shake-friendly form.
    { code: `import { div, text } from '@llui/dom'` },
    { code: `import { dialog } from '@llui/components'` },
    { code: `import { useRouter } from '@llui/router'` },
    { code: `import { transitionIn } from '@llui/transitions'` },
    { code: `import { http } from '@llui/effects'` },
    { code: `import { agentLog } from '@llui/agent'` },
    // Namespace import from an unrelated source — out of scope.
    { code: `import * as fs from 'node:fs'` },
    // Default import — not a namespace; leave alone.
    { code: `import L from 'some-pkg'` },
  ],
  invalid: [
    // ── Each TARGETS package gets reported. ───────────────────────────
    {
      code: `import * as L from '@llui/dom'\nL.div({}, [L.text('hi')])`,
      errors: [
        {
          messageId: 'namespace',
          data: { local: 'L', source: '@llui/dom', braceOpen: '{', braceClose: '}' },
        },
      ],
      output: `import { div, text } from '@llui/dom'\ndiv({}, [text('hi')])`,
    },
    {
      code: `import * as C from '@llui/components'\nC.dialog()`,
      errors: [
        {
          messageId: 'namespace',
          data: { local: 'C', source: '@llui/components', braceOpen: '{', braceClose: '}' },
        },
      ],
      output: `import { dialog } from '@llui/components'\ndialog()`,
    },
    {
      code: `import * as R from '@llui/router'\nR.useRouter()`,
      errors: [
        {
          messageId: 'namespace',
          data: { local: 'R', source: '@llui/router', braceOpen: '{', braceClose: '}' },
        },
      ],
      output: `import { useRouter } from '@llui/router'\nuseRouter()`,
    },
    {
      code: `import * as T from '@llui/transitions'\nT.fade()`,
      errors: [
        {
          messageId: 'namespace',
          data: { local: 'T', source: '@llui/transitions', braceOpen: '{', braceClose: '}' },
        },
      ],
      output: `import { fade } from '@llui/transitions'\nfade()`,
    },
    {
      code: `import * as E from '@llui/effects'\nE.http({})`,
      errors: [
        {
          messageId: 'namespace',
          data: { local: 'E', source: '@llui/effects', braceOpen: '{', braceClose: '}' },
        },
      ],
      output: `import { http } from '@llui/effects'\nhttp({})`,
    },
    {
      code: `import * as A from '@llui/agent'\nA.agentLog()`,
      errors: [
        {
          messageId: 'namespace',
          data: { local: 'A', source: '@llui/agent', braceOpen: '{', braceClose: '}' },
        },
      ],
      output: `import { agentLog } from '@llui/agent'\nagentLog()`,
    },
    // ── Autofix de-duplicates and sorts. ─────────────────────────────
    {
      code: `import * as L from '@llui/dom'\nL.div(); L.text('a'); L.div(); L.span()`,
      errors: [{ messageId: 'namespace' }],
      output: `import { div, span, text } from '@llui/dom'\ndiv(); text('a'); div(); span()`,
    },
    // ── No autofix when ANY reference is non-member-access. ──────────
    {
      code: `import * as L from '@llui/dom'\nconsole.log(L)\nL.div()`,
      errors: [{ messageId: 'namespace' }],
      // No output — bare `L` reference (passed to console.log) defeats
      // the rewrite. User has to fix it by hand.
      output: null,
    },
    // ── No autofix when the local is computed-accessed (`L['div']`). ──
    {
      code: `import * as L from '@llui/dom'\nL['div']()`,
      errors: [{ messageId: 'namespace' }],
      output: null,
    },
    // ── No usage at all — nothing to fix to (named-imports list would
    //    be empty), but the diagnostic still fires.
    {
      code: `import * as L from '@llui/dom'`,
      errors: [{ messageId: 'namespace' }],
      output: null,
    },
  ],
})
