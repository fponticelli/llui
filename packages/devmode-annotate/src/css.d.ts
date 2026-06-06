// Side-effect CSS imports (e.g. `@llui/markdown-editor/styles/editor.css`).
// tsc has no loader for `.css`; this ambient declaration lets the import
// type-check and survive into the emitted JS so the consumer's bundler
// (Vite) injects the stylesheet.
declare module '*.css'
