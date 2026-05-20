// Vike-SSR smoke fixture (issue #5 follow-up).
//
// `prerender: false` is load-bearing: it forces Vike to emit a real
// `dist/server/` bundle that externalizes `@llui/dom`, instead of
// pre-rendering everything to static HTML at build time. The
// externalized server bundle is the codepath that surfaced the
// MISSING_EXPORT bug — every `from "@llui/dom"` import in that
// bundle has to resolve against the real package exports.
//
// The fixture's only job is to keep that build path alive in CI.
// `scripts/smoke-examples.ts` then walks the emitted `dist/server/`
// JS files and asserts every imported name is a real export of the
// referenced subpath.
export default {
  clientRouting: true,
  prerender: false,
}
