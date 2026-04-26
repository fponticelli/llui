import { RuleTester } from '@typescript-eslint/rule-tester'
import { emptyPropsRule } from '../../src/rules/empty-props.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

ruleTester.run('empty-props', emptyPropsRule, {
  valid: [
    // Children-only form — canonical when no props are needed.
    { code: `div([text('hi')])` },
    // Non-empty props — clearly intentional.
    { code: `div({ class: 'x' }, [text('hi')])` },
    // Spread-only props — author may rely on dynamic key set; not empty
    // syntactically, leave alone.
    { code: `div({ ...rest }, [text('hi')])` },
    // Empty object on a non-helper call — out of scope.
    { code: `someOther({}, [])` },
  ],
  invalid: [
    {
      code: `div({}, [text('hi')])`,
      errors: [{ messageId: 'empty', data: { name: 'div' } }],
    },
    {
      code: `h1({}, [text('Title')])`,
      errors: [{ messageId: 'empty', data: { name: 'h1' } }],
    },
    {
      code: `button({}, [text('click')])`,
      errors: [{ messageId: 'empty', data: { name: 'button' } }],
    },
  ],
})
