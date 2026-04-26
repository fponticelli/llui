import { RuleTester } from '@typescript-eslint/rule-tester'
import { controlledInputRule } from '../../src/rules/controlled-input.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

ruleTester.run('controlled-input', controlledInputRule, {
  valid: [
    // Reactive value with onInput — properly controlled.
    {
      code: `input({ value: (s) => s.name, onInput: (e) => send({ type: 'set', v: e.target.value }) })`,
    },
    // Reactive value with onChange — also fine.
    { code: `input({ value: (s) => s.name, onChange: (e) => {} })` },
    // Constant value — no reactive binding to overwrite user input.
    { code: `input({ value: 'static' })` },
    // textarea variant.
    { code: `textarea({ value: (s) => s.body, onInput: (e) => {} })` },
    // No value prop at all — uncontrolled, no risk.
    { code: `input({ type: 'text', placeholder: 'name' })` },
    // Different element — out of scope.
    { code: `div({ value: (s) => s.x }, [])` },
  ],
  invalid: [
    {
      code: `input({ value: (s) => s.name })`,
      errors: [{ messageId: 'missingHandler', data: { tag: 'input' } }],
    },
    {
      code: `textarea({ value: (s) => s.body })`,
      errors: [{ messageId: 'missingHandler', data: { tag: 'textarea' } }],
    },
  ],
})
