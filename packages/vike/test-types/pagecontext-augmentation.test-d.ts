// Type-level regression test: `Vike.PageContext` augmentations must flow
// into `@llui/vike`'s server and client hook pageContext types.
//
// Lives in `test-types/` (checked via `tsconfig.test-types.json`) rather
// than `test/` because it uses `declare global { namespace Vike { ... } }`
// — global augmentations leak across an entire tsc compile unit, so
// mixing this file with `vike.test.ts` (which passes `data: { name: ... }`)
// would poison every sibling test's `data` type. Isolating in a tsconfig
// that only sees `src/` + this file keeps the augmentation scoped.
//
// No runtime; the compile pass is the assertion. Included in CI via
// `pnpm --filter @llui/vike check:types`.

import type { createOnRenderHtml } from '../src/on-render-html.js'
import type { createOnRenderClient } from '../src/on-render-client.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Vike {
    interface PageContext {
      data?: { userTitle: string }
    }
  }
}

type ServerCtx = Parameters<ReturnType<typeof createOnRenderHtml>>[0]
type ClientCtx = Parameters<ReturnType<typeof createOnRenderClient>>[0]

// These assignments fail to compile if `data` is `unknown` instead of
// the augmented `{ userTitle: string } | undefined`.
export const _serverDataCheck = (ctx: ServerCtx): { userTitle: string } | undefined => ctx.data
export const _clientDataCheck = (ctx: ClientCtx): { userTitle: string } | undefined => ctx.data

// The `document` callback receives a `DocumentContext` whose `pageContext`
// carries the same augmentation. Using the optional chain against the
// augmented shape is the narrow check the bug report described.
export const _documentCallback: Parameters<typeof createOnRenderHtml>[0]['document'] = ({
  pageContext,
}) => `<title>${pageContext.data?.userTitle ?? 'fallback'}</title>`
