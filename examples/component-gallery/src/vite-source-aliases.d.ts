// Ambient types for `scripts/lib/vite-source-aliases.mjs` (JSDoc-typed, but
// this package's tsconfig has no `allowJs`). Mirrors the shim in
// `packages/components/test/styles/vite-source-aliases.d.ts`.
declare module '*/scripts/lib/vite-source-aliases.mjs' {
  interface ViteSourceAlias {
    readonly find: string | RegExp
    readonly replacement: string
  }

  export function sourceAliasesFromExports(opts: {
    packageName: string
    packageJsonPath: string
    srcDir: string
  }): ViteSourceAlias[]
}
