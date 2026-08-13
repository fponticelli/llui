// Vite's `?raw` import suffix — the file's text as a default-exported string.
//
// Declared here rather than by pulling in `vite/client`'s ambient types: this
// package ships a browser runtime with NO `@types/node` and a deliberately small
// ambient surface, and `vite/client` would drag in a great deal more than the one
// suffix a single test needs. Used by `test/signals/element-helper-parity.test.ts`
// to read `src/signals/authoring.ts` as source text without `node:fs`.
declare module '*?raw' {
  const src: string
  export default src
}
