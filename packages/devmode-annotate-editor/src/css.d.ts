// Vite's `?raw` query has no exports map entry to carry a `types` condition, so
// the raw-text form of a CSS import still needs an ambient declaration here.
//
// The BARE form deliberately does NOT get one: `@llui/markdown-editor` now
// declares a `types` condition on its `./styles/*.css` subpaths (#257), so
// `import '@llui/markdown-editor/styles/editor.css'` resolves for real. Keeping
// a `declare module '*.css'` here would shadow that and hide a regression —
// this package emits that very import into its published `dist/index.d.ts`,
// where a consumer has no ambient declaration to fall back on.
declare module '*.css?raw' {
  const css: string
  export default css
}
