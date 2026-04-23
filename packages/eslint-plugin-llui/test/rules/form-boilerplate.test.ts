import { RuleTester } from '@typescript-eslint/rule-tester'
import { formBoilerplateRule } from '../../src/rules/form-boilerplate.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
})

ruleTester.run('form-boilerplate', formBoilerplateRule, {
  valid: [
    {
      code: `
      export type Msg = 
        | { type: 'setField', field: string, value: string }
        | { type: 'submit' }
      `,
    },
    {
      code: `
      export type Msg = 
        | { type: 'apiError', value: string }
        | { type: 'readmeError', value: string }
        | { type: 'userOk', value: string }
      `,
    },
    {
      code: `
      export type Msg = 
        | { type: 'setName', val: string }
        | { type: 'setEmail', val: string }
        | { type: 'setAge', val: string }
      `,
    },
  ],
  invalid: [
    {
      code: `
      export type Msg = 
        | { type: 'setName', value: string }
        | { type: 'setEmail', value: string }
        | { type: 'setAge', value: string }
        | { type: 'submit' }
      `,
      errors: [
        {
          messageId: 'boilerplate',
          data: { count: 3, variants: "'setName', 'setEmail', 'setAge'" },
        },
      ],
    },
    {
      code: `
      export type Msg = 
        | { type: 'updateA', value: string, isValid: boolean }
        | { type: 'updateB', value: string, isValid: boolean }
        | { type: 'updateC', value: string, isValid: boolean }
        | { type: 'updateD', value: string, isValid: boolean }
      `,
      errors: [
        {
          messageId: 'boilerplate',
          data: { count: 4, variants: "'updateA', 'updateB', 'updateC', ..." },
        },
      ],
    },
  ],
})
