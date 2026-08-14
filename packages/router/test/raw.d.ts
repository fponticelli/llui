// Vite's `?raw` suffix imports a module's source text as a string. Used by
// `router-env.test.ts` to assert a structural invariant about `connect.ts`.
// Declared here rather than pulling in `@types/node` and `node:fs`: this is a
// browser package that deliberately carries neither.
declare module '*?raw' {
  const content: string
  export default content
}
