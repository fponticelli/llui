import { RuleTester } from '@typescript-eslint/rule-tester'
import { unnecessaryChildRule } from '../../src/rules/unnecessary-child.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
})

ruleTester.run('unnecessary-child', unnecessaryChildRule, {
  valid: [
    {
      code: `
      const Header = component({
        receives: (msg) => true,
        view: () => [div({}, [])]
      })

      const app = component({
        view: () => [
          child({ component: Header, id: 'h' })
        ]
      })
      `,
    },
    {
      code: `
      const ComplexComp = component({
        view: (s) => [
          text(() => s.a), text(() => s.b), text(() => s.c), text(() => s.d), text(() => s.e),
          text(() => s.f), text(() => s.g), text(() => s.h), text(() => s.i), text(() => s.j),
          text(() => s.k)
        ]
      })

      const app = component({
        view: () => [
          child({ component: ComplexComp, id: 'c' })
        ]
      })
      `,
    },
  ],
  invalid: [
    {
      code: `
      const SimpleHeader = component({
        view: (s) => [
          h1({}, [text(() => s.title)])
        ]
      })

      const app = component({
        view: () => [
          child({ component: SimpleHeader, id: 'h' })
        ]
      })
      `,
      errors: [{ messageId: 'unnecessary', data: { compName: 'SimpleHeader' } }],
    },
  ],
})
