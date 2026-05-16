import accessorSideEffectRule from './rules/accessor-side-effect.js'
import asyncUpdateRule from './rules/async-update.js'
import directStateInViewRule from './rules/direct-state-in-view.js'
import effectWithoutHandlerRule from './rules/effect-without-handler.js'
import exhaustiveEffectHandlingRule from './rules/exhaustive-effect-handling.js'
import forgottenSpreadRule from './rules/forgotten-spread.js'
import imperativeDomInViewRule from './rules/imperative-dom-in-view.js'
import nestedSendInUpdateRule from './rules/nested-send-in-update.js'
import spreadInChildrenRule from './rules/spread-in-children.js'
import stringEffectCallbackRule from './rules/string-effect-callback.js'
import viewBagImportRule from './rules/view-bag-import.js'
import { stateMutationRule } from './rules/state-mutation.js'
import { missingMemoRule } from './rules/missing-memo.js'
import { eachClosureViolationRule } from './rules/each-closure-violation.js'
import { mapOnStateArrayRule } from './rules/map-on-state-array.js'
import { unnecessaryChildRule } from './rules/unnecessary-child.js'
import { formBoilerplateRule } from './rules/form-boilerplate.js'
import { agentMissingIntentRule } from './rules/agent-missing-intent.js'
import { agentExclusiveAnnotationsRule } from './rules/agent-exclusive-annotations.js'
import { agentNonextractableHandlerRule } from './rules/agent-nonextractable-handler.js'
import { agentMsgResolvableRule } from './rules/agent-msg-resolvable.js'
import { agentWarningOnConfirmRule } from './rules/agent-warning-on-confirm.js'
import { agentExampleOnPayloadRule } from './rules/agent-example-on-payload.js'
import { agentEmitsDriftRule } from './rules/agent-emits-drift.js'
import { agentOptionalFieldUndocumentedRule } from './rules/agent-optional-field-undocumented.js'
import { pureUpdateFunctionRule } from './rules/pure-update-function.js'
import { emptyPropsRule } from './rules/empty-props.js'
import { namespaceImportRule } from './rules/namespace-import.js'
import { accessibilityRule } from './rules/accessibility.js'
import { controlledInputRule } from './rules/controlled-input.js'
import { childStaticPropsRule } from './rules/child-static-props.js'
import { staticOnRule } from './rules/static-on.js'
import { exhaustiveUpdateRule } from './rules/exhaustive-update.js'
import { bitmaskOverflowRule } from './rules/bitmask-overflow.js'
import { noEagerItemAccessorRule } from './rules/no-eager-item-accessor.js'
import { noListRenderInSampleRule } from './rules/no-list-render-in-sample.js'
import { noBarrelImportWhenSubpathExistsRule } from './rules/no-barrel-import-when-subpath-exists.js'
import { noLetReactiveAccessorRule } from './rules/no-let-reactive-accessor.js'
import { noSampleInAccessorRule } from './rules/no-sample-in-accessor.js'
import { noSampleInReactivePositionRule } from './rules/no-sample-in-reactive-position.js'
import { staticItemsRule } from './rules/static-items.js'
import { agentTagsendTranslatorMissingRule } from './rules/agent-tagsend-translator-missing.js'
import { subappRequiresReasonRule } from './rules/subapp-requires-reason.js'

export const rules = {
  'accessor-side-effect': accessorSideEffectRule,
  'async-update': asyncUpdateRule,
  'direct-state-in-view': directStateInViewRule,
  'effect-without-handler': effectWithoutHandlerRule,
  'exhaustive-effect-handling': exhaustiveEffectHandlingRule,
  'forgotten-spread': forgottenSpreadRule,
  'imperative-dom-in-view': imperativeDomInViewRule,
  'nested-send-in-update': nestedSendInUpdateRule,
  'spread-in-children': spreadInChildrenRule,
  'string-effect-callback': stringEffectCallbackRule,
  'view-bag-import': viewBagImportRule,
  'state-mutation': stateMutationRule,
  'missing-memo': missingMemoRule,
  'each-closure-violation': eachClosureViolationRule,
  'map-on-state-array': mapOnStateArrayRule,
  'unnecessary-child': unnecessaryChildRule,
  'form-boilerplate': formBoilerplateRule,
  'agent-missing-intent': agentMissingIntentRule,
  'agent-exclusive-annotations': agentExclusiveAnnotationsRule,
  'agent-nonextractable-handler': agentNonextractableHandlerRule,
  'agent-msg-resolvable': agentMsgResolvableRule,
  'agent-warning-on-confirm': agentWarningOnConfirmRule,
  'agent-example-on-payload': agentExampleOnPayloadRule,
  'agent-emits-drift': agentEmitsDriftRule,
  'agent-optional-field-undocumented': agentOptionalFieldUndocumentedRule,
  'pure-update-function': pureUpdateFunctionRule,
  'empty-props': emptyPropsRule,
  'namespace-import': namespaceImportRule,
  accessibility: accessibilityRule,
  'controlled-input': controlledInputRule,
  'child-static-props': childStaticPropsRule,
  'static-on': staticOnRule,
  'exhaustive-update': exhaustiveUpdateRule,
  'bitmask-overflow': bitmaskOverflowRule,
  'no-barrel-import-when-subpath-exists': noBarrelImportWhenSubpathExistsRule,
  'no-eager-item-accessor': noEagerItemAccessorRule,
  'no-let-reactive-accessor': noLetReactiveAccessorRule,
  'no-list-render-in-sample': noListRenderInSampleRule,
  'no-sample-in-accessor': noSampleInAccessorRule,
  'no-sample-in-reactive-position': noSampleInReactivePositionRule,
  'static-items': staticItemsRule,
  'agent-tagsend-translator-missing': agentTagsendTranslatorMissingRule,
  'subapp-requires-reason': subappRequiresReasonRule,
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
      'llui/string-effect-callback': 'error',
      'llui/imperative-dom-in-view': 'error',
      'llui/nested-send-in-update': 'error',
      'llui/accessor-side-effect': 'error',
      'llui/async-update': 'error',
      'llui/effect-without-handler': 'error',
      'llui/exhaustive-effect-handling': 'error',
      'llui/direct-state-in-view': 'error',
      'llui/state-mutation': 'error',
      'llui/missing-memo': 'error',
      'llui/each-closure-violation': 'error',
      'llui/map-on-state-array': 'error',
      'llui/unnecessary-child': 'error',
      'llui/form-boilerplate': 'error',
      'llui/agent-missing-intent': 'error',
      'llui/agent-exclusive-annotations': 'error',
      'llui/agent-nonextractable-handler': 'error',
      'llui/agent-msg-resolvable': 'error',
      'llui/agent-warning-on-confirm': 'error',
      'llui/agent-example-on-payload': 'error',
      'llui/agent-emits-drift': 'error',
      'llui/agent-optional-field-undocumented': 'error',
      'llui/pure-update-function': 'error',
      // Rules ported from the Vite plugin's compile-time diagnostics.
      // The Vite plugin no longer emits these; the lint pipeline is
      // the single source of truth, surfacing them as editor squiggles
      // rather than build-only console output.
      'llui/empty-props': 'error',
      'llui/namespace-import': 'error',
      'llui/accessibility': 'error',
      'llui/controlled-input': 'error',
      'llui/child-static-props': 'error',
      'llui/static-on': 'error',
      'llui/exhaustive-update': 'error',
      'llui/bitmask-overflow': 'error',
      'llui/no-barrel-import-when-subpath-exists': 'error',
      'llui/no-eager-item-accessor': 'error',
      'llui/no-let-reactive-accessor': 'error',
      'llui/no-list-render-in-sample': 'error',
      'llui/no-sample-in-accessor': 'error',
      'llui/no-sample-in-reactive-position': 'error',
      'llui/static-items': 'error',
      'llui/agent-tagsend-translator-missing': 'error',
      'llui/subapp-requires-reason': 'error',
    },
  },
  // Standalone overlay that errors on the `agent-*` rules. Useful for
  // projects that don't extend `recommended` but ship `@llui/agent` and
  // want LAP-correctness gates without the rest of the recommended set.
  agent: {
    plugins: ['llui'],
    rules: {
      'llui/agent-missing-intent': 'error',
      'llui/agent-exclusive-annotations': 'error',
      'llui/agent-nonextractable-handler': 'error',
      'llui/agent-msg-resolvable': 'error',
      'llui/agent-warning-on-confirm': 'error',
      'llui/agent-example-on-payload': 'error',
      'llui/agent-emits-drift': 'error',
      'llui/agent-optional-field-undocumented': 'error',
      'llui/agent-tagsend-translator-missing': 'error',
    },
  },
}
