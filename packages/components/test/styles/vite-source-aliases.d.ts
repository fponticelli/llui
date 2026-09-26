// Ambient types for `scripts/lib/vite-source-aliases.mjs`, consumed here
// (`navigation-data-live-render.browser.test.ts`) but not type-checked in
// place: this package's tsconfig has no `allowJs`/`checkJs`, unlike the root
// `tsconfig.scripts.json` that already type-checks that file via its own
// JSDoc. This is the first `packages/*` test to import a root `scripts/lib`
// helper directly, so nothing existing covered this boundary.
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
