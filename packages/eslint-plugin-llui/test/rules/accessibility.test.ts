import { RuleTester } from '@typescript-eslint/rule-tester'
import { accessibilityRule } from '../../src/rules/accessibility.js'

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
})

ruleTester.run('accessibility', accessibilityRule, {
  valid: [
    // <img> with alt — accessible.
    { code: `img({ src: '/x.png', alt: 'description' })` },
    // <img> with empty alt — explicit decorative; passes.
    { code: `img({ src: '/x.png', alt: '' })` },
    // onClick on a button — interactive by default.
    { code: `button({ onClick: () => {} }, [text('hi')])` },
    // onClick on <a> — interactive when href is present, but the rule
    // skips all elements in INTERACTIVE_ELEMENTS unconditionally.
    { code: `a({ onClick: () => {}, href: '#' }, [text('link')])` },
    // onClick on a div with role — author opted in.
    { code: `div({ onClick: () => {}, role: 'button' }, [text('act')])` },
    // div without onClick — fine.
    { code: `div({ class: 'x' }, [text('x')])` },
  ],
  invalid: [
    {
      code: `img({ src: '/x.png' })`,
      errors: [{ messageId: 'missingAlt' }],
    },
    {
      code: `div({ onClick: () => {} }, [text('hi')])`,
      errors: [{ messageId: 'clickWithoutRole', data: { tag: 'div' } }],
    },
    {
      code: `span({ onClick: () => {} }, [text('hi')])`,
      errors: [{ messageId: 'clickWithoutRole', data: { tag: 'span' } }],
    },
  ],
})
