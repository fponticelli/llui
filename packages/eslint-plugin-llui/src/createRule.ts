import { ESLintUtils } from '@typescript-eslint/utils'

export const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/fponticelli/llui/tree/main/packages/eslint-plugin-llui/docs/rules/${name}.md`,
)
