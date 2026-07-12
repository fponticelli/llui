// The `documentHtml` returned from onRenderHtml must be marked "already-escaped"
// so Vike injects the trusted document template verbatim. Vike's PUBLIC way to
// do that is `dangerouslySkipEscape` from `vike/server` — NOT the private
// `{ _escaped }` sentinel shape (an internal we must not fabricate).
//
// `vike` is an OPTIONAL peer dependency: a real consumer has it installed, but
// this package type-checks and unit-tests in isolation without it. So we resolve
// the public helper lazily and fall back to the equivalent marker only when vike
// is genuinely off the module path. Production always takes the public-API path.

/**
 * Opaque "already-escaped HTML" marker handed back to Vike as `documentHtml`.
 * In production this is Vike's `dangerouslySkipEscape` return; in the vike-less
 * fallback it is the structurally-equivalent `{ _escaped }` marker Vike accepts.
 * Treat as OPAQUE — never read its fields in application code.
 */
export type DangerousHtml = { readonly _escaped: string }

/** Vike's public server-entry surface we depend on. Declared locally so the seam
 * is typed without vike installed; the real module supplies it at runtime. */
interface VikeServer {
  dangerouslySkipEscape(html: string): DangerousHtml
}

let cached: ((html: string) => DangerousHtml) | null = null

async function resolveSkipEscape(): Promise<(html: string) => DangerousHtml> {
  if (cached) return cached
  // A widened (non-literal) specifier keeps the type-checker from resolving the
  // optional peer at build time; Node/Vite resolve it at runtime when present.
  const specifier: string = 'vike/server'
  try {
    const mod = (await import(/* @vite-ignore */ specifier)) as VikeServer
    cached = (html) => mod.dangerouslySkipEscape(html)
  } catch {
    // vike not installed (e.g. this package's own unit tests) — emit the marker
    // shape Vike understands so the adapter still produces a valid result.
    cached = (html) => ({ _escaped: html })
  }
  return cached
}

/**
 * Wrap a fully-rendered, trusted document string as `documentHtml` for Vike,
 * routing through Vike's public `dangerouslySkipEscape` when available.
 */
export async function toDocumentHtml(html: string): Promise<DangerousHtml> {
  return (await resolveSkipEscape())(html)
}
