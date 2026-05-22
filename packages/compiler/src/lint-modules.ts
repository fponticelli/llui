// Always-on lint modules.
//
// Every entry here is a zero-arg `CompilerModule` factory whose output
// is registered unconditionally on every `transformLlui` invocation.
// The function is the single source of truth — `transform.ts`'s active-
// module list spreads it, and `scripts/generate-rule-docs.ts` calls it
// to enumerate diagnostic IDs for the rule reference. Adding or removing
// a rule in one place propagates everywhere.
//
// Note: this does NOT include modules with per-file options (e.g.
// `maskLegendModule({ fieldBits, fieldBitsHi })`, `coreSynthesisModule`,
// etc.) — those stay constructed inline in `transform.ts` because they
// take per-file context. The `compilerStampModule` is unconditional but
// it's an instance-not-factory; appended separately by callers.

import type { CompilerModule } from './module.js'
import { bitmaskOverflowModule } from './modules/bitmask-overflow.js'
import { asyncUpdateModule } from './modules/async-update.js'
import { mapOnStateArrayModule } from './modules/map-on-state-array.js'
import { nestedSendInUpdateModule } from './modules/nested-send-in-update.js'
import { directStateInViewModule } from './modules/direct-state-in-view.js'
import { imperativeDomInViewModule } from './modules/imperative-dom-in-view.js'
import { accessorSideEffectModule } from './modules/accessor-side-effect.js'
import { stateMutationModule } from './modules/state-mutation.js'
import { effectWithoutHandlerModule } from './modules/effect-without-handler.js'
import { exhaustiveEffectHandlingModule } from './modules/exhaustive-effect-handling.js'
import { noEagerItemAccessorModule } from './modules/no-eager-item-accessor.js'
import { pureUpdateFunctionModule } from './modules/pure-update-function.js'
import { exhaustiveUpdateModule } from './modules/exhaustive-update.js'
import { noLetReactiveAccessorModule } from './modules/no-let-reactive-accessor.js'
import { eachClosureViolationModule } from './modules/each-closure-violation.js'
import { stringEffectCallbackModule } from './modules/string-effect-callback.js'
import { agentMissingIntentModule } from './modules/agent-missing-intent.js'
import { agentWarningOnConfirmModule } from './modules/agent-warning-on-confirm.js'
import { agentExampleOnPayloadModule } from './modules/agent-example-on-payload.js'
import { agentExclusiveAnnotationsModule } from './modules/agent-exclusive-annotations.js'
import { agentOptionalFieldUndocumentedModule } from './modules/agent-optional-field-undocumented.js'
import { agentTagsendTranslatorMissingModule } from './modules/agent-tagsend-translator-missing.js'
import { agentNonextractableHandlerModule } from './modules/agent-nonextractable-handler.js'
import { subappRequiresReasonModule } from './modules/subapp-requires-reason.js'
import { emptyPropsModule } from './modules/empty-props.js'
import { forgottenSpreadModule } from './modules/forgotten-spread.js'
import { accessibilityModule } from './modules/accessibility.js'
import { viewBagImportModule } from './modules/view-bag-import.js'
import { controlledInputModule } from './modules/controlled-input.js'
import { missingMemoModule } from './modules/missing-memo.js'
import { namespaceImportModule } from './modules/namespace-import.js'
import { noBarrelImportWhenSubpathExistsModule } from './modules/no-barrel-import-when-subpath-exists.js'
import { formBoilerplateModule } from './modules/form-boilerplate.js'
import { spreadInChildrenModule } from './modules/spread-in-children.js'
import { staticItemsModule } from './modules/static-items.js'
import { staticOnModule } from './modules/static-on.js'
import { noListRenderInSampleModule } from './modules/no-list-render-in-sample.js'
import { noSampleInAccessorModule } from './modules/no-sample-in-accessor.js'
import { noSampleInReactivePositionModule } from './modules/no-sample-in-reactive-position.js'
import { noSampleInEventHandlerModule } from './modules/no-sample-in-event-handler.js'
import { noRepeatedItemCurrentModule } from './modules/no-repeated-item-current.js'
import { agentEmitsDriftModule } from './modules/agent-emits-drift.js'
import { agentMsgResolvableModule } from './modules/agent-msg-resolvable.js'

/**
 * Construct fresh instances of every always-on lint module.
 *
 * Returns a new array per call. Modules are stateful within a single
 * `ModuleRegistry.run()` (slot accumulators), so reusing instances
 * across files would leak state — always call this once per file.
 */
export function createLintModules(): CompilerModule[] {
  return [
    bitmaskOverflowModule(),
    asyncUpdateModule(),
    mapOnStateArrayModule(),
    nestedSendInUpdateModule(),
    directStateInViewModule(),
    imperativeDomInViewModule(),
    accessorSideEffectModule(),
    stateMutationModule(),
    effectWithoutHandlerModule(),
    exhaustiveEffectHandlingModule(),
    noEagerItemAccessorModule(),
    pureUpdateFunctionModule(),
    exhaustiveUpdateModule(),
    noLetReactiveAccessorModule(),
    eachClosureViolationModule(),
    stringEffectCallbackModule(),
    agentMissingIntentModule(),
    agentWarningOnConfirmModule(),
    agentExampleOnPayloadModule(),
    agentExclusiveAnnotationsModule(),
    agentOptionalFieldUndocumentedModule(),
    agentTagsendTranslatorMissingModule(),
    agentNonextractableHandlerModule(),
    subappRequiresReasonModule(),
    emptyPropsModule(),
    forgottenSpreadModule(),
    accessibilityModule(),
    viewBagImportModule(),
    controlledInputModule(),
    missingMemoModule(),
    namespaceImportModule(),
    noBarrelImportWhenSubpathExistsModule(),
    formBoilerplateModule(),
    spreadInChildrenModule(),
    staticItemsModule(),
    staticOnModule(),
    noListRenderInSampleModule(),
    noSampleInAccessorModule(),
    noSampleInReactivePositionModule(),
    noSampleInEventHandlerModule(),
    noRepeatedItemCurrentModule(),
    agentEmitsDriftModule(),
    agentMsgResolvableModule(),
  ]
}
