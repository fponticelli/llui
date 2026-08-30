// The `types` condition for this package's `./styles/*.css` subpath exports.
//
// A CSS entry point is imported for its SIDE EFFECT and exports nothing, but
// TypeScript still has to resolve the specifier: without a `types` condition,
// `import '@llui/markdown-editor/styles/editor.css'` is TS2882 ("cannot find
// module or type declarations for side-effect import") for every consumer that
// does not carry a global `declare module '*.css'`. That is not hypothetical —
// `@llui/devmode-annotate-editor` emits exactly that import into its PUBLISHED
// `dist/index.d.ts`, so the error reached anyone type-checking our own
// artifacts with `skipLibCheck: false` (#257).
//
// A sidecar `editor.css.d.ts` beside the CSS does NOT work and was measured:
// under `moduleResolution: bundler` the specifier resolves through the exports
// map, and with no `types` condition there TypeScript never looks for a
// declaration file at all. The `types` condition is what it reads.
//
// Deliberately NOT a wildcard `declare module '*.css'`: that is a global
// augmentation, so shipping it would silently type every CSS import in every
// consuming project. This declares one thing — these subpaths are modules with
// no exports — which is the truth.
export {}
