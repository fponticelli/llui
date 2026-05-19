// Build-time feature flags consumed by the runtime.
//
// `@llui/vite-plugin`'s `define` config substitutes these literals at
// build time. When a flag is set to `false`, the bundler's dead-code
// eliminator drops every `if (FLAG)` branch — and any module that's
// only reachable through those branches tree-shakes out entirely.
//
// Consumers that don't go through `@llui/vite-plugin` (raw tsc/vitest,
// other bundlers without a `define` for these) see the flags as
// undefined at runtime — JavaScript `if (undefined)` is falsy, so the
// gated agent path simply stays off. This matches the safe default
// (no agent runtime active).

declare global {
  /**
   * True when the host adapter (vite-plugin) enables the agent
   * surface. Gates the binding-descriptors registry and related
   * agent-only runtime so non-agent consumers don't ship the code.
   *
   * @see packages/vite-plugin/src/index.ts — sets this via Vite `define`.
   * @see packages/dom/src/binding-descriptors.ts — agent-only module
   *   that becomes unreachable when this flag is false.
   */
  const __LLUI_AGENT__: boolean
}

// `globalThis` fallback for environments that don't process the
// `define` substitution (raw tsc test runs, third-party tooling).
// The runtime check is `typeof __LLUI_AGENT__ !== 'undefined' && __LLUI_AGENT__`.
// Exporting nothing — this is a declaration-only module.
export {}
