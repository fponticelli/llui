// Internal surface — compiler-emitted imports only.
//
// `@llui/compiler-ssr` rewrites a `'use client'` module into a server
// stub that imports `__clientOnlyStub` from here (NOT the root barrel)
// so the vite-plugin's post-bundle rename pass can't rewrite the
// identifier across a module-external import boundary. See
// `@llui/compiler/emit-names.ts` § COMPILER_DOM_INTERNAL_IMPORTS.
//
// The legacy runtime's internal helpers (__bindUncertain,
// __cloneStaticTemplate, __runPhase2, __handleMsg) were removed with the
// legacy runtime; the signal transform emits no internal helpers, and
// `__registerScopeVariants` ships from `@llui/dom`.

import type { SignalComponentDef } from './signals/component.js'

/**
 * Server-side stub for a `'use client'` component. Compiler-ssr emits
 * `export const Foo = __clientOnlyStub("Foo")` for each named export of
 * a client-only module so SSR never imports the client's browser-only
 * dependencies. The stub renders nothing on the server; the real module
 * loads and hydrates on the client.
 */
export function __clientOnlyStub(name: string): SignalComponentDef<object, never, never> {
  return {
    name,
    init: () => ({}),
    update: (s) => s,
    view: () => [],
  }
}
