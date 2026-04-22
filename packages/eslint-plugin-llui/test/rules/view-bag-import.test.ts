import { RuleTester } from '@typescript-eslint/rule-tester'
import * as tseslintParser from '@typescript-eslint/parser'
import rule from '../../src/rules/view-bag-import'

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslintParser,
  },
})

ruleTester.run('view-bag-import', rule, {
  valid: [
    {
      code: `
        import { component } from '@llui/dom';
        export const MyComp = component({
          view: ({ text }) => [text('hello')]
        });
      `,
    },
    {
      code: `
        // Not a component, so importing text is allowed
        import { text } from '@llui/dom';
        export const helper = () => text('helper');
      `,
    },
  ],
  invalid: [
    {
      code: `
        import { component, text } from '@llui/dom';
        export const MyComp = component({
          view: () => [text('hello')]
        });
      `,
      errors: [{ messageId: 'noViewBagImport' }],
    },
  ],
})
