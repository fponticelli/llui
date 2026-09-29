// Ambient types for `scripts/lib/prebuilt-fixture.mjs` (build a browser-test
// fixture once and serve it static), consumed by `same-fragment.browser.test.ts`.
// This package's tsconfig has no `allowJs`/`checkJs`, so the helper's own JSDoc
// is not visible across the import. Keep in step with that file's JSDoc
// `PrebuildOptions` / `PrebuiltFixture` and with the identical declaration in
// `packages/components/test/styles/vite-source-aliases.d.ts`; `pnpm
// check:scripts` checks the helper from the inside.
declare module '*/scripts/lib/prebuilt-fixture.mjs' {
  import type { AliasOptions } from 'vite'

  export interface PrebuildOptions {
    readonly root: string
    readonly inputs: readonly string[]
    readonly alias?: AliasOptions
    readonly define?: Record<string, string>
  }

  export interface PrebuiltFixture {
    readonly origin: string
    readonly dir: string
    url(path: string): string
    close(): Promise<void>
  }

  export function prebuildFixture(options: PrebuildOptions): Promise<PrebuiltFixture>
  export function resolveServedFile(dir: string, rawUrl: string): string | null
}
