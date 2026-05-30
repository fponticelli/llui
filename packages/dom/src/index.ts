// `@llui/dom` — the signal runtime is the framework's default surface.
//
// Authoring (component, mountApp, element helpers, each/show/branch, …)
// and the compiler-emitted runtime (signalText, el, react, …) all live
// in `./signals`. This barrel re-exports that surface so `@llui/dom` and
// `@llui/dom` are interchangeable; the compiler still emits
// `@llui/dom` imports (see @llui/compiler signals transform).
//
// The legacy (non-signal) runtime — two-phase update loop, arrow-accessor
// bindings, the `View` bag, structural primitives, el-split/el-template,
// HMR, the escape hatch, the legacy SSR renderer — was removed in the
// signal-runtime migration. Nothing here is re-exported from it.

// Re-exports the signal authoring + runtime surface, plus the
// runtime-agnostic TransitionOptions / LifetimeNode types.
export * from './signals/index.js'

// SSR env contract (no DOM implementation pulled in). Pick a backing DOM
// via `@llui/dom/ssr/jsdom` or `@llui/dom/ssr/linkedom`.
export { browserEnv, type DomEnv } from './dom-env.js'

// installSignalDebug / startRelay are NOT re-exported here to keep the
// relay + WebSocket machinery out of production bundles. Import directly:
//   import { installSignalDebug } from '@llui/dom/devtools'
