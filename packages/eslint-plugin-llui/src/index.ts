import forgottenSpreadRule from './rules/forgotten-spread.js'
import spreadInChildrenRule from './rules/spread-in-children.js'
import viewBagImportRule from './rules/view-bag-import.js'
import { missingMemoRule } from './rules/missing-memo.js'
import { formBoilerplateRule } from './rules/form-boilerplate.js'
import { agentMsgResolvableRule } from './rules/agent-msg-resolvable.js'
import { agentEmitsDriftRule } from './rules/agent-emits-drift.js'
import { emptyPropsRule } from './rules/empty-props.js'
import { namespaceImportRule } from './rules/namespace-import.js'
import { accessibilityRule } from './rules/accessibility.js'
import { controlledInputRule } from './rules/controlled-input.js'
import { staticOnRule } from './rules/static-on.js'
import { noListRenderInSampleRule } from './rules/no-list-render-in-sample.js'
import { noBarrelImportWhenSubpathExistsRule } from './rules/no-barrel-import-when-subpath-exists.js'
import { noSampleInAccessorRule } from './rules/no-sample-in-accessor.js'
import { noSampleInReactivePositionRule } from './rules/no-sample-in-reactive-position.js'
import { staticItemsRule } from './rules/static-items.js'

export const rules = {
  'forgotten-spread': forgottenSpreadRule,
  'spread-in-children': spreadInChildrenRule,
  'view-bag-import': viewBagImportRule,
  'missing-memo': missingMemoRule,
  'form-boilerplate': formBoilerplateRule,
  'agent-msg-resolvable': agentMsgResolvableRule,
  'agent-emits-drift': agentEmitsDriftRule,
  'empty-props': emptyPropsRule,
  'namespace-import': namespaceImportRule,
  accessibility: accessibilityRule,
  'controlled-input': controlledInputRule,
  'static-on': staticOnRule,
  'no-barrel-import-when-subpath-exists': noBarrelImportWhenSubpathExistsRule,
  'no-list-render-in-sample': noListRenderInSampleRule,
  'no-sample-in-accessor': noSampleInAccessorRule,
  'no-sample-in-reactive-position': noSampleInReactivePositionRule,
  'static-items': staticItemsRule,
}

// Severity rationale:
//
// All rules in `recommended` ship at `error`. The reason isn't strictly
// LAP-correctness — it's audience. LLMs (Claude in the editor, IDE
// agents driving the codebase, CI bots running a test loop) overwhelmingly
// only act on `error`-level diagnostics. Warnings get reported but not
// fixed, so anything we ship as `warn` effectively never improves on its
// own — it just accumulates. Erroring is the only way to make the
// signal stick.
//
// Where a rule has known false-positive scenarios (e.g.
// `agent-emits-drift`'s "orphaned emit" half can't see helper-emit
// patterns like `track('foo')`), the rule itself documents the
// limitation and projects can downgrade per-package. Defaulting to
// `error` is the right policy; per-rule escape hatches handle edge
// cases.
export const configs = {
  recommended: {
    plugins: ['llui'],
    rules: {
      'llui/spread-in-children': 'error',
      'llui/view-bag-import': 'error',
      'llui/forgotten-spread': 'error',
      'llui/missing-memo': 'error',
      'llui/form-boilerplate': 'error',
      'llui/agent-msg-resolvable': 'error',
      'llui/agent-emits-drift': 'error',
      // Rules ported from the Vite plugin's compile-time diagnostics.
      // The Vite plugin no longer emits these; the lint pipeline is
      // the single source of truth, surfacing them as editor squiggles
      // rather than build-only console output.
      'llui/empty-props': 'error',
      'llui/namespace-import': 'error',
      'llui/accessibility': 'error',
      'llui/controlled-input': 'error',
      'llui/static-on': 'error',
      'llui/no-barrel-import-when-subpath-exists': 'error',
      'llui/no-list-render-in-sample': 'error',
      'llui/no-sample-in-accessor': 'error',
      'llui/no-sample-in-reactive-position': 'error',
      'llui/static-items': 'error',
    },
  },
  // Standalone overlay that errors on the `agent-*` rules. Useful for
  // projects that don't extend `recommended` but ship `@llui/agent` and
  // want LAP-correctness gates without the rest of the recommended set.
  agent: {
    plugins: ['llui'],
    rules: {
      'llui/agent-msg-resolvable': 'error',
      'llui/agent-emits-drift': 'error',
    },
  },
}
