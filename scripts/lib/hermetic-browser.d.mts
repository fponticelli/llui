// The type surface of `hermetic-browser.mjs`, for the packages whose test
// suites import it: their tsconfigs have no `allowJs` (and several pin
// `rootDir` to the package), so without a declaration beside the module the
// import is an implicit `any` there. ONE declaration, picked up by TypeScript
// for every importer, instead of an ambient `declare module` copied into each
// package. The implementation is annotated AGAINST these types
// (`typeof import('./hermetic-browser.mjs').…`), so `pnpm check:scripts`
// fails if the two drift, and `scripts/test/hermetic-browser.test.ts` pins the
// resolved types with `expectTypeOf` so a broken import here cannot degrade
// them to `any` unnoticed (this file is under `skipLibCheck`).
import type { Browser, LaunchOptions } from 'playwright'

export interface HermeticBrowser {
  /** Launch Chromium with every context routed through the network policy. */
  launch(options?: LaunchOptions): Promise<Browser>
}

/** Route every context `browser` creates from now on. */
export declare function guardBrowser(
  browser: Browser,
  onUnexpected: (message: string) => void,
): Browser

/** Throw, once, for every refused request recorded since the last check. */
export declare function assertNoUnexpectedRequests(pending: string[]): void

/**
 * Register the per-test and per-file checks and return a launcher whose
 * browsers are hermetic. Call at collection time, never inside a hook or test.
 */
export declare function useHermeticBrowser(): HermeticBrowser
