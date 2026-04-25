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
import { pureUpdateFunctionRule } from './rules/pure-update-function.js'

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
  'pure-update-function': pureUpdateFunctionRule,
}

// Severity rationale:
// - `error`  = correctness bug or LAP-protocol-breaking issue. CI must reject.
// - `warn`   = stylistic / nudge. Project may legitimately deviate.
//
// All `agent-*` rules ship as `error` because they affect what Claude (or
// any LLM client) actually sees over the LAP wire. A missing `@intent` makes
// Claude reason about a synthesized label instead of the developer's
// intended verb; a non-extractable handler crashes the action; exclusive
// annotations conflicting silently misroute. None of these are stylistic.
// Projects that don't ship `@llui/agent` won't have `Msg` variants tagged
// for the agent surface — the rule's `@humanOnly` exemption silences the
// signal on purely-internal variants.
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
      'llui/missing-memo': 'warn',
      'llui/each-closure-violation': 'error',
      'llui/map-on-state-array': 'warn',
      'llui/unnecessary-child': 'warn',
      'llui/form-boilerplate': 'warn',
      'llui/agent-missing-intent': 'error',
      'llui/agent-exclusive-annotations': 'error',
      'llui/agent-nonextractable-handler': 'error',
      'llui/pure-update-function': 'error',
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
    },
  },
}
