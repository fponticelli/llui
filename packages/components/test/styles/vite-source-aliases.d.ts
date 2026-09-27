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

// Ambient types for `scripts/lib/oklch.mjs` (#264 review item 5's shared
// pixel-contrast math), for the same reason as above: this package's
// tsconfig has no `allowJs`/`checkJs`, unlike the root `tsconfig.scripts.json`
// that already type-checks that file via its own JSDoc.
declare module '*/scripts/lib/oklch.mjs' {
  export function contrast(
    linA: readonly [number, number, number],
    linB: readonly [number, number, number],
  ): number
  export function srgb8ToLinear(rgb: readonly [number, number, number]): [number, number, number]
}

// Ambient types for `scripts/lib/registry-classes.mjs`'s shared
// module-const resolution (#264 item F3: `density-source-audit.ts` follows a
// `createVariants({ variants })` SHORTHAND to its module-level const exactly
// like the Tailwind class extractor already does, rather than reimplementing
// the lookup), for the same reason as above.
declare module '*/scripts/lib/registry-classes.mjs' {
  import type ts from 'typescript'

  export function indexObjectConsts(sf: ts.SourceFile): Map<string, ts.ObjectLiteralExpression>
  export function asObjectLiteral(
    node: ts.Node | undefined,
    objectConsts: Map<string, ts.ObjectLiteralExpression>,
  ): ts.ObjectLiteralExpression | undefined
}
