/**
 * `@llui/dom/ssr` — the generic SSR env entry.
 *
 * Exports the `DomEnv` contract + a `browserEnv()` helper. Does NOT
 * import jsdom, linkedom, or any DOM implementation. Consumers pick
 * their DOM via a sub-entry (`@llui/dom/ssr/jsdom` or
 * `@llui/dom/ssr/linkedom`) and pass the resulting env to the signal
 * SSR renderer (`renderToString` / `renderNodes` from
 * `@llui/dom`) explicitly.
 *
 * The legacy `renderToString` / `initSsrDom()` shim that used to live
 * here was removed with the legacy runtime; signal SSR ships from
 * `@llui/dom`.
 */

export type { DomEnv } from './dom-env.js'
export { browserEnv } from './dom-env.js'
