// Registry hook for the introspection module set (msg/state schemas,
// schema hash, binding descriptors).
//
// The introspection modules live in `@llui/compiler-introspection`,
// an opt-in sibling package. To keep `@llui/compiler` free of any
// dependency on its opt-in siblings (which would create a workspace
// cycle), the orchestrator calls this registry rather than importing
// the modules directly. The actual factory implementation registers
// itself when `@llui/compiler-introspection` is imported by the host
// (test setup, Vite plugin, MCP, etc.).
//
// When no factory is registered, transformLlui simply doesn't
// activate introspection modules — no schemas, hashes, or descriptors
// get emitted. That's the intended "production build with introspection
// disabled" path.

import type ts from 'typescript'
import type { CompilerModule } from './module.js'

/**
 * Slot key the binding-descriptors module sets to signal whether it
 * inserted `__registerScopeVariants` calls. Lives here (not in
 * `@llui/compiler-introspection`) so the orchestrator can read the
 * slot without static-importing the sibling package. The CONSTANT
 * is the contract; both sides must agree on the literal string.
 */
export const BINDING_DESCRIPTORS_SLOT = 'binding-descriptors:state'

export interface BindingDescriptorsSlot {
  scopeRegistrationsInjected: boolean
}

/**
 * Inputs the orchestrator hands to the introspection factory. These
 * are the file-level extractions the orchestrator already performs
 * (the extractors `extractMsgSchema`, `extractStateSchema`, etc.
 * remain in `@llui/compiler` because the orchestrator uses their
 * output for the compiler cache too).
 */
export interface IntrospectionFactoryInput {
  /** Source file the modules will walk. */
  sourceFile: ts.SourceFile
  /** Pre-extracted Msg schema (or null when extraction failed / not present). */
  msgSchema: unknown
  /** Pre-extracted Effect schema. */
  effectSchema: unknown
  /** Pre-extracted State schema. */
  stateSchema: unknown
  /** Pre-extracted message annotations (or null when extraction failed). */
  msgAnnotations: Record<string, unknown> | null
  /** Whether agent-metadata emission is requested (devMode || emitAgentMetadata). */
  shouldEmitAgentMetadata: boolean
}

export type IntrospectionFactory = (input: IntrospectionFactoryInput) => CompilerModule[]

let registered: IntrospectionFactory | null = null

/**
 * Register the introspection module factory. Called once per process
 * by `@llui/compiler-introspection`'s init code (or by test setup /
 * vite-plugin's import side-effect). Subsequent registrations replace
 * the previous; that's intentional for test isolation.
 */
export function registerIntrospectionFactory(factory: IntrospectionFactory | null): void {
  registered = factory
}

/** Used by transformLlui to retrieve the registered factory. Returns
 *  `null` when no factory is registered (introspection disabled). */
export function getIntrospectionFactory(): IntrospectionFactory | null {
  return registered
}

// ── Devtools factory ──────────────────────────────────────────────
//
// Same registry pattern as introspection: `@llui/compiler-devtools`
// provides the implementation; hosts call `registerDevtoolsFactory`
// at module-import time. When no factory is registered (production
// build with devtools disabled), no devtools modules activate and
// no `__componentMeta` / future trace instrumentation ships.

export interface DevtoolsFactoryInput {
  sourceFile: ts.SourceFile
  /** Whether dev-mode emission is requested (controls componentMeta). */
  devMode: boolean
}

export type DevtoolsFactory = (input: DevtoolsFactoryInput) => CompilerModule[]

let registeredDevtools: DevtoolsFactory | null = null

export function registerDevtoolsFactory(factory: DevtoolsFactory | null): void {
  registeredDevtools = factory
}

export function getDevtoolsFactory(): DevtoolsFactory | null {
  return registeredDevtools
}
