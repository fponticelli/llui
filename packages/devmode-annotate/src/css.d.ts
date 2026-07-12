// Side-effect CSS imports (e.g. `@llui/markdown-editor/styles/editor.css`).
// tsc has no loader for `.css`; this ambient declaration lets the import
// type-check and survive into the emitted JS so the consumer's bundler
// (Vite) injects the stylesheet.
declare module '*.css'

// Raw CSS text imports (e.g. `@llui/markdown-editor/styles/editor.css?raw`).
// The `?raw` query yields the stylesheet as a string so the HUD can adopt it
// into its shadow root (Vite/vitest resolve the query; tsc uses this decl).
declare module '*.css?raw' {
  const css: string
  export default css
}
