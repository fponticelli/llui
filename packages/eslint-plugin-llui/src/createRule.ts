import { ESLintUtils } from '@typescript-eslint/utils'

/**
 * Per-rule documentation URL. Points at the rule's source file in the
 * monorepo so consumers (and Claude, when surfacing lint errors) get
 * to the implementation + JSDoc header without a 404. Earlier this
 * pointed at `docs/rules/${name}.md`, but that directory doesn't
 * exist; clicking a lint message landed on a GitHub 404 page.
 *
 * When per-rule markdown docs eventually land under `docs/rules/`,
 * flip back to that path. The TypeScript file URL works as a stop-gap
 * because every rule's header JSDoc explains its purpose.
 */
export const createRule = ESLintUtils.RuleCreator(
  (name) =>
    `https://github.com/fponticelli/llui/tree/main/packages/eslint-plugin-llui/src/rules/${name}.ts`,
)
