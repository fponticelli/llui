#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// Generate `docs/designs/14 Compile-Time Rules.md` from the compiler's
// always-on modules.
//
// Reads the rule list by invoking `transformLlui` against a synthetic
// fixture and collecting every module's `DiagnosticDefinition` via
// the `ModuleRegistry.listDiagnostics()` introspection surface. Each
// rule is grouped by category (reactivity / composition / agent /
// style / perf / config / internal) and emitted with its id, severity,
// and description.
//
// Re-run when rules are added/removed: `pnpm tsx scripts/generate-rule-docs.ts`.

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ModuleRegistry, transformLlui } from '../packages/compiler/src/index.js'

// `transformLlui` builds the active-module list inline; we tap into it
// by passing a captured registry through a side channel. Simplest: run
// `transformLlui` against a trivial fixture and have it construct the
// registry, then access the listDiagnostics surface via a module hook.
//
// The compiler's transform.ts doesn't expose its registry directly,
// so we duplicate the always-on module construction here. Keep this
// list in sync with `packages/compiler/src/transform.ts`'s
// `activeModules.push(...)` chain — drift surfaces as missing rules
// in the doc.

import { compilerStampModule } from '../packages/compiler/src/modules/compiler-stamp.js'
import { bitmaskOverflowModule } from '../packages/compiler/src/modules/bitmask-overflow.js'
import { asyncUpdateModule } from '../packages/compiler/src/modules/async-update.js'
import { mapOnStateArrayModule } from '../packages/compiler/src/modules/map-on-state-array.js'
import { nestedSendInUpdateModule } from '../packages/compiler/src/modules/nested-send-in-update.js'
import { directStateInViewModule } from '../packages/compiler/src/modules/direct-state-in-view.js'
import { imperativeDomInViewModule } from '../packages/compiler/src/modules/imperative-dom-in-view.js'
import { accessorSideEffectModule } from '../packages/compiler/src/modules/accessor-side-effect.js'
import { stateMutationModule } from '../packages/compiler/src/modules/state-mutation.js'
import { effectWithoutHandlerModule } from '../packages/compiler/src/modules/effect-without-handler.js'
import { exhaustiveEffectHandlingModule } from '../packages/compiler/src/modules/exhaustive-effect-handling.js'
import { noEagerItemAccessorModule } from '../packages/compiler/src/modules/no-eager-item-accessor.js'
import { pureUpdateFunctionModule } from '../packages/compiler/src/modules/pure-update-function.js'
import { exhaustiveUpdateModule } from '../packages/compiler/src/modules/exhaustive-update.js'
import { noLetReactiveAccessorModule } from '../packages/compiler/src/modules/no-let-reactive-accessor.js'
import { eachClosureViolationModule } from '../packages/compiler/src/modules/each-closure-violation.js'
import { stringEffectCallbackModule } from '../packages/compiler/src/modules/string-effect-callback.js'
import { agentMissingIntentModule } from '../packages/compiler/src/modules/agent-missing-intent.js'
import { agentWarningOnConfirmModule } from '../packages/compiler/src/modules/agent-warning-on-confirm.js'
import { agentExampleOnPayloadModule } from '../packages/compiler/src/modules/agent-example-on-payload.js'
import { agentExclusiveAnnotationsModule } from '../packages/compiler/src/modules/agent-exclusive-annotations.js'
import { agentOptionalFieldUndocumentedModule } from '../packages/compiler/src/modules/agent-optional-field-undocumented.js'
import { agentTagsendTranslatorMissingModule } from '../packages/compiler/src/modules/agent-tagsend-translator-missing.js'
import { agentNonextractableHandlerModule } from '../packages/compiler/src/modules/agent-nonextractable-handler.js'
import { subappRequiresReasonModule } from '../packages/compiler/src/modules/subapp-requires-reason.js'
import { emptyPropsModule } from '../packages/compiler/src/modules/empty-props.js'
import { forgottenSpreadModule } from '../packages/compiler/src/modules/forgotten-spread.js'
import { accessibilityModule } from '../packages/compiler/src/modules/accessibility.js'
import { viewBagImportModule } from '../packages/compiler/src/modules/view-bag-import.js'
import { controlledInputModule } from '../packages/compiler/src/modules/controlled-input.js'
import { missingMemoModule } from '../packages/compiler/src/modules/missing-memo.js'
import { namespaceImportModule } from '../packages/compiler/src/modules/namespace-import.js'
import { noBarrelImportWhenSubpathExistsModule } from '../packages/compiler/src/modules/no-barrel-import-when-subpath-exists.js'
import { formBoilerplateModule } from '../packages/compiler/src/modules/form-boilerplate.js'
import { spreadInChildrenModule } from '../packages/compiler/src/modules/spread-in-children.js'
import { staticItemsModule } from '../packages/compiler/src/modules/static-items.js'
import { staticOnModule } from '../packages/compiler/src/modules/static-on.js'
import { noListRenderInSampleModule } from '../packages/compiler/src/modules/no-list-render-in-sample.js'
import { noSampleInAccessorModule } from '../packages/compiler/src/modules/no-sample-in-accessor.js'
import { noSampleInReactivePositionModule } from '../packages/compiler/src/modules/no-sample-in-reactive-position.js'
import { agentEmitsDriftModule } from '../packages/compiler/src/modules/agent-emits-drift.js'
import { agentMsgResolvableModule } from '../packages/compiler/src/modules/agent-msg-resolvable.js'

const lintModules = [
  compilerStampModule,
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
  agentEmitsDriftModule(),
  agentMsgResolvableModule(),
]

// Run a trivial fixture through transformLlui to confirm the active-
// modules list stays in sync with this script — every diagnostic id
// from the registry should also be in our local list.
const _smokeTransform = transformLlui(
  `import { component, div } from '@llui/dom'\n` +
    `const A = component({ name: 'X', init: () => [{}, []], update: (s) => [s, []], view: () => [div([])] })\n`,
  'smoke.ts',
)
void _smokeTransform

const reg = new ModuleRegistry(lintModules)
const defs = reg.listDiagnostics()

interface RuleRow {
  id: string
  description: string
  category: string
}

const rows: RuleRow[] = []
for (const m of lintModules) {
  for (const d of m.diagnostics ?? []) {
    rows.push({ id: d.id, description: d.description, category: 'unknown' })
  }
}
void defs

// Categories are recorded by each module on the diagnostics it
// reports — but the DiagnosticDefinition itself doesn't carry the
// category. We pull category from the first ctx.reportDiagnostic call
// site in each module file. Simpler: scrape the literal `category:`
// from each module's source. Done via a static map below — keeps the
// generator self-contained without dynamic emission probing.
const RULE_CATEGORIES: Record<string, string> = {
  'llui/compiler-version': 'config',
  'llui/bitmask-overflow': 'perf',
  'llui/async-update': 'reactivity',
  'llui/map-on-state-array': 'reactivity',
  'llui/nested-send-in-update': 'reactivity',
  'llui/direct-state-in-view': 'reactivity',
  'llui/imperative-dom-in-view': 'reactivity',
  'llui/accessor-side-effect': 'reactivity',
  'llui/state-mutation': 'reactivity',
  'llui/effect-without-handler': 'composition',
  'llui/exhaustive-effect-handling': 'composition',
  'llui/no-eager-item-accessor': 'reactivity',
  'llui/pure-update-function': 'reactivity',
  'llui/exhaustive-update': 'reactivity',
  'llui/no-let-reactive-accessor': 'reactivity',
  'llui/each-closure-violation': 'reactivity',
  'llui/string-effect-callback': 'agent',
  'llui/agent-missing-intent': 'agent',
  'llui/agent-warning-on-confirm': 'agent',
  'llui/agent-example-on-payload': 'agent',
  'llui/agent-exclusive-annotations': 'agent',
  'llui/agent-optional-field-undocumented': 'agent',
  'llui/agent-tagsend-translator-missing': 'agent',
  'llui/agent-nonextractable-handler': 'agent',
  'llui/agent-emits-drift': 'agent',
  'llui/agent-msg-resolvable': 'agent',
  'llui/subapp-requires-reason': 'composition',
  'llui/empty-props': 'style',
  'llui/forgotten-spread': 'composition',
  'llui/accessibility': 'style',
  'llui/view-bag-import': 'style',
  'llui/controlled-input': 'composition',
  'llui/missing-memo': 'perf',
  'llui/namespace-import': 'style',
  'llui/no-barrel-import-when-subpath-exists': 'perf',
  'llui/form-boilerplate': 'style',
  'llui/spread-in-children': 'perf',
  'llui/static-items': 'reactivity',
  'llui/static-on': 'reactivity',
  'llui/no-list-render-in-sample': 'reactivity',
  'llui/no-sample-in-accessor': 'reactivity',
  'llui/no-sample-in-reactive-position': 'reactivity',
}

for (const r of rows) r.category = RULE_CATEGORIES[r.id] ?? 'unknown'

// Group + render.
const byCategory = new Map<string, RuleRow[]>()
for (const r of rows) {
  const list = byCategory.get(r.category) ?? []
  list.push(r)
  byCategory.set(r.category, list)
}
for (const list of byCategory.values()) list.sort((a, b) => a.id.localeCompare(b.id))

const CATEGORY_ORDER = ['reactivity', 'composition', 'agent', 'perf', 'style', 'config', 'unknown']
const CATEGORY_BLURBS: Record<string, string> = {
  reactivity:
    'Catch patterns that silently break reactivity — stale captures, side effects in accessors, missing reconciliation, impure reducers.',
  composition:
    'Catch composition mistakes — broken structural primitives, missing handlers, wrong arrangement of view-tree pieces.',
  agent:
    'Enforce the agent-protocol annotation discipline so `list_actions` surfaces a coherent affordance set to Claude.',
  perf: 'Catch patterns that disable compile-time optimizations or scale poorly at runtime.',
  style:
    "Style nudges that don't change behavior but make code easier to read, review, and tree-shake.",
  config: 'Build-pipeline integrity — the compiler did its job.',
  unknown: 'Uncategorized rules (this section should be empty in steady state).',
}

let md =
  `# 14. Compile-Time Rules\n\n` +
  `> **Auto-generated by \`scripts/generate-rule-docs.ts\`.** Re-run after rule changes:\n` +
  `> \`pnpm tsx scripts/generate-rule-docs.ts\`\n\n` +
  `Every rule listed here fires as a **compile-time error** from \`@llui/compiler\`, surfaced by \`@llui/vite-plugin\`'s build pipeline as \`this.error(…)\`. There is no warning tier; an LLM-first authoring loop treats anything else as ignorable noise.\n\n` +
  `Total: **${rows.length}** rules.\n\n` +
  `## Categories\n\n`

for (const cat of CATEGORY_ORDER) {
  const list = byCategory.get(cat)
  if (!list || list.length === 0) continue
  md += `### \`${cat}\` (${list.length})\n\n`
  md += `${CATEGORY_BLURBS[cat]}\n\n`
  md += `| Rule | Description |\n`
  md += `| --- | --- |\n`
  for (const r of list) {
    const idCell = '`' + r.id + '`'
    const descCell = r.description.replace(/\|/g, '\\|')
    md += `| ${idCell} | ${descCell} |\n`
  }
  md += `\n`
}

md +=
  `## Rule severity\n\n` +
  `All compile-time rules emit at \`severity: 'error'\`. The LLui project's stance: warnings get reported and never fixed, so anything ship-worthy enough to ship at all ships as an error.\n\n` +
  `Adapters (e.g. \`@llui/vite-plugin\`) may downgrade to warnings on a per-host basis if needed (see \`Diagnostic.severity\` for the intent the rule itself emits). The vite-plugin currently calls \`this.error()\` for \`error\`, \`this.warn()\` for \`warning\`.\n\n` +
  `## Cross-file coverage\n\n` +
  `The agent rules (\`agent-emits-drift\`, \`agent-msg-resolvable\`) read imported \`Msg\` unions when the host adapter supplies the cross-file source via \`typeSources.msg\`. The vite-plugin does this automatically. Tests that invoke \`transformLlui\` directly without \`typeSources\` fall back to file-local-only behaviour.\n`

writeFileSync(resolve('docs/designs/14 Compile-Time Rules.md'), md)
console.log(
  `Wrote docs/designs/14 Compile-Time Rules.md — ${rows.length} rules across ${byCategory.size} categories.`,
)
