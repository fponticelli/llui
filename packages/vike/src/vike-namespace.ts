// Ambient stub for Vike's global namespace.
//
// `@llui/vike` adapts to Vike but doesn't declare `vike` as a runtime
// dependency — the consuming app installs both. Vike itself ships a
// `VikeNamespace.d.ts` that declares `namespace Vike { interface PageContext { ... } }`
// globally. When an app also augments the namespace (recommended pattern
// for typing `pageContext.data`) TypeScript merges every declaration it
// sees into one interface.
//
// This stub lets `@llui/vike` type-check in isolation (without vike
// installed) AND participates in the same merge when vike IS installed
// alongside it in a consumer's project. Empty interfaces merge cleanly
// with anything; the user's augmentation propagates through.
//
// The file has no runtime side effects — TypeScript picks up the
// `declare global` from its inclusion in the source graph.

export {}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Vike {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface PageContext {}
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface PageContextServer {}
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface PageContextClient {}
  }
}

/**
 * Extracts the user-augmented `data` type from `Vike.PageContext` with a
 * safe fallback via conditional inference. `extends { data?: infer T }`
 * works for every case:
 *
 * - Not augmented (`interface PageContext {}`): `{}` matches the optional
 *   shape vacuously ⇒ `T` is inferred as `unknown` (the default).
 * - Augmented with `data?: PageData`: resolves to `PageData | undefined`.
 * - Augmented with `data: PageData` (non-optional): resolves to `PageData`.
 *
 * Using `keyof` + indexed access (`Vike.PageContext['data']`) doesn't work
 * here — TypeScript refuses to index when the key isn't in the interface.
 */
export type VikePageContextData = Vike.PageContext extends { data?: infer T } ? T : unknown
