/**
 * `@llui/dom/ssr` — the generic SSR entry.
 *
 * Exports the render API + the `DomEnv` contract + a `browserEnv()`
 * helper. Does NOT import jsdom, linkedom, or any DOM implementation.
 * Consumers pick their DOM via a sub-entry (`@llui/dom/ssr/jsdom` or
 * `@llui/dom/ssr/linkedom`) and pass the resulting env to
 * `renderToString` / `renderNodes` explicitly.
 *
 * The deprecated `initSsrDom()` shim lives in `@llui/dom/ssr/legacy`
 * so bundles that don't import it don't pay jsdom's bundle cost.
 */

export type { DomEnv } from './dom-env.js'
export { browserEnv } from './dom-env.js'

export { renderToString, renderNodes, serializeNodes } from './ssr.js'
