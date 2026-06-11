// Type-level regression test (issue #33): the `Layout` resolver receives a
// pageContext that exposes Vike's route fields — `urlPathname` and
// `routeParams` — so a route-scoped layout chain can branch on the current
// route WITHOUT an `as unknown as { ... }` cast. Before this, the resolver
// pageContext only typed `Page` / `data` / `lluiLayoutData`, so the documented
// `pageContext.urlPathname.startsWith('/docs')` pattern failed to compile and
// every consumer had to cast.
//
// No runtime; the compile pass is the assertion. Checked via
// `tsconfig.test-types.json` (sees `src/` + this file only).

import type { createOnRenderHtml } from '../src/on-render-html.js'
import type { createOnRenderClient } from '../src/on-render-client.js'
import type { AnyLayer } from '../src/on-render-client.js'

declare const AppLayout: AnyLayer
declare const DocsLayout: AnyLayer

type ServerLayoutOption = Parameters<typeof createOnRenderHtml>[0]['Layout']
type ClientLayoutOption = Parameters<typeof createOnRenderClient>[0]['Layout']

// A resolver branching on `urlPathname` — the docs-section pattern from the
// issue — must assign into the `Layout` option on BOTH the server and client
// without any cast. `urlPathname` is a plain `string`, so `.startsWith(...)`
// is available directly.
export const _serverResolver: ServerLayoutOption = (pageContext) =>
  pageContext.urlPathname.startsWith('/docs') ? [AppLayout, DocsLayout] : [AppLayout]

export const _clientResolver: ClientLayoutOption = (pageContext) =>
  pageContext.urlPathname.startsWith('/docs') ? [AppLayout, DocsLayout] : [AppLayout]

// `routeParams` is a `Record<string, string>`, so indexing yields `string`.
export const _serverRouteParams: ServerLayoutOption = (pageContext) =>
  pageContext.routeParams['section'] === 'docs' ? [AppLayout, DocsLayout] : [AppLayout]

export const _clientRouteParams: ClientLayoutOption = (pageContext) =>
  pageContext.routeParams['section'] === 'docs' ? [AppLayout, DocsLayout] : [AppLayout]
