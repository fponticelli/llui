import { RuleTester } from '@typescript-eslint/rule-tester'
import {
  noBarrelImportWhenSubpathExistsRule,
  __seedSubpaths,
} from '../../src/rules/no-barrel-import-when-subpath-exists.js'

// Seed the in-memory sub-path cache so the rule sees a deterministic
// inventory for `@llui/components` without depending on `node_modules`
// resolution from this package. The RuleTester runs with the current
// working directory; that's the cache key on the rule side. Match it.
__seedSubpaths('@llui/components', process.cwd(), ['dialog', 'tabs', 'accordion', 'utils'])

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

ruleTester.run('no-barrel-import-when-subpath-exists', noBarrelImportWhenSubpathExistsRule, {
  valid: [
    // Sub-path imports — already in the recommended form.
    { code: `import { dialog } from '@llui/components/dialog'` },
    { code: `import { tabs } from '@llui/components/tabs'` },

    // Named imports from the barrel for names that DON'T have a
    // sub-path (typed re-export, fallback, etc.). Pre-1.0, the
    // components barrel re-exports a few helpers without a corresponding
    // sub-path; those imports stay legitimate.
    { code: `import { en, LocaleContext } from '@llui/components'` },

    // Named imports from packages NOT in TARGETS — out of scope.
    { code: `import { div } from '@llui/dom'` },
    { code: `import { something } from 'react'` },

    // Default and namespace imports — handled by other rules
    // (`llui/namespace-import`) or out of scope.
    { code: `import L from '@llui/components'` },
    { code: `import * as C from '@llui/components'` },
  ],
  invalid: [
    // Single splittable name — recommend the sub-path.
    {
      code: `import { dialog } from '@llui/components'`,
      errors: [
        {
          messageId: 'preferSubpath',
          data: { name: 'dialog', source: '@llui/components' },
        },
      ],
      output: `import { dialog } from '@llui/components/dialog'`,
    },

    // Multiple splittable names — emit one report per name; autofix
    // emits one sub-path import per.
    {
      code: `import { dialog, tabs } from '@llui/components'`,
      errors: [
        {
          messageId: 'preferSubpath',
          data: { name: 'dialog', source: '@llui/components' },
        },
        {
          messageId: 'preferSubpath',
          data: { name: 'tabs', source: '@llui/components' },
        },
      ],
      output: `import { dialog } from '@llui/components/dialog'
import { tabs } from '@llui/components/tabs'`,
    },

    // Mixed: some names have sub-paths, some don't. Keep the non-
    // splittable ones in a barrel import; split the rest.
    {
      code: `import { dialog, en } from '@llui/components'`,
      errors: [
        {
          messageId: 'preferSubpath',
          data: { name: 'dialog', source: '@llui/components' },
        },
      ],
      output: `import { en } from '@llui/components'
import { dialog } from '@llui/components/dialog'`,
    },

    // Aliased import — keep the alias.
    {
      code: `import { dialog as d } from '@llui/components'`,
      errors: [
        {
          messageId: 'preferSubpath',
          data: { name: 'dialog', source: '@llui/components' },
        },
      ],
      output: `import { dialog as d } from '@llui/components/dialog'`,
    },
  ],
})
