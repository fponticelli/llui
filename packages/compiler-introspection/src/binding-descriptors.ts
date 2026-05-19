// `binding-descriptors` — agent-runtime hook tagging. Pre-transform
// CompilerModule wrapping `tagDispatchHandlers` + `injectScopeVariantRegistrations`.
//
// Both functions mutate the AST in ways the visitor model can't
// cleanly express:
//   - `tagDispatchHandlers`: walks every arrow/fn expression, wraps
//     those whose body contains `send({type:'X'})` with
//     `Object.assign(arrow, {__lluiVariants: ['X']})`. The visitor
//     pattern records findings but doesn't rewrite; rewriting is what
//     this pass does.
//   - `injectScopeVariantRegistrations`: walks for `*.connect(get,
//     send, ...)` call sites and inserts `__registerScopeVariants([...])`
//     adjacent statements. The visitor pattern can't insert siblings
//     into the source file at arbitrary positions.
//
// Both are pre-passes — they produce a rewritten SourceFile that the
// main visitor walks. v2c §2.1's "walker runs once per file" invariant
// is preserved: the VISITOR walk runs once. preTransform passes are
// additional but typically cheap and targeted.
//
// The `injected` flag from `injectScopeVariantRegistrations` is
// surfaced via a shared analysis slot — the umbrella's
// `cleanupImports` reads it to know whether to add the
// `__registerScopeVariants` runtime helper to the @llui/dom imports.

import {
  tagDispatchHandlers,
  injectScopeVariantRegistrations,
  BINDING_DESCRIPTORS_SLOT,
  type BindingDescriptorsSlot,
} from '@llui/compiler'
import type { CompilerModule } from '@llui/compiler'

export { BINDING_DESCRIPTORS_SLOT }

export const bindingDescriptorsModule: CompilerModule = {
  name: 'binding-descriptors',
  compilerVersion: '^0.3.0',
  diagnostics: [],
  visitors: {},

  preTransform(ctx, sf) {
    // injectScopeVariantRegistrations runs FIRST so its
    // `collectLocalFns` resolver still sees raw arrow initializers in
    // const declarations (the universal tagger below replaces those
    // initializers with `Object.assign(...)` wrappers).
    const injection = injectScopeVariantRegistrations(sf, ctx.factory)
    const tagged = tagDispatchHandlers(injection.sf, ctx.factory)

    // Surface the injected flag for the umbrella's cleanupImports
    // pass. The umbrella reads this from `analysis.perModule` after
    // `registry.run()` returns.
    ctx.analysis.perModule.set(BINDING_DESCRIPTORS_SLOT, {
      scopeRegistrationsInjected: injection.injected,
    } as BindingDescriptorsSlot)

    return tagged
  },
}
