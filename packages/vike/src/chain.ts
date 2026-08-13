// Shared layout-chain vocabulary for the vike adapter. Both entry points
// (`@llui/vike/server` = on-render-html, `@llui/vike/client` = on-render-client)
// resolve the SAME chain shape and stamp / verify the SAME hydration manifest,
// so the two sides can never drift into two subtly-different definitions of a
// layer, a seed, or an envelope. Import from here; do not re-declare.

import { normalizeUpdateResult } from '@llui/dom'
import type { Renderable } from '@llui/dom'

/**
 * A type-erased signal component as the adapter handles it. Layouts and pages are
 * `SignalComponentDef<S, M, E>` for concrete S/M/E; the adapter treats them
 * uniformly with the type params erased — the runtime doesn't use them.
 *
 * Declared with METHOD syntax and a single `unknown` view-bag param so a concrete
 * `SignalComponentDef<S,M,E>` assigns in for ANY S/M/E — `SignalComponentDef<
 * unknown,unknown,unknown>` can't be that erasure, because `view(bag:
 * ComponentBag<S,M>)` couples covariant `state` with contravariant `send` and
 * neither variance direction admits a heterogeneous chain. This interface is
 * itself assignable to `SignalComponentDef<unknown,unknown,unknown>`, so
 * `renderNodes(layer)` / `mountSignalComponent(layer)` type-check.
 */
export interface AnyLayer {
  readonly name?: string
  init(): unknown
  update(state: unknown, msg: unknown): unknown
  view(bag: unknown): Renderable
  onEffect?(effect: unknown, api: unknown): void | (() => void)
}

/** The persistent layout chain, outermost first, innermost last. Excludes the
 * page (the page is appended by each entry point to form the FULL chain). */
export type LayoutChain = ReadonlyArray<AnyLayer>

/**
 * The `Layout` option shape, generic over the resolver's pageContext. One of:
 *
 * - a single `AnyLayer` — a one-layout chain,
 * - an array of `AnyLayer`s — outermost first,
 * - a function that returns a chain from the current pageContext (per-route
 *   chains, e.g. reading Vike's `urlPathname`).
 */
export type LayoutOption<Ctx> = AnyLayer | LayoutChain | ((pageContext: Ctx) => LayoutChain)

/**
 * Resolve the layout chain for a pageContext. A single layout becomes a
 * one-element chain; a function resolver gets full control to return different
 * chains for different routes. The caller narrows `pageContext` to `Ctx` (the
 * resolver's required-fields view) at the boundary — the resolver only ever runs
 * against a live render, which always populates Vike's routing fields.
 */
export function resolveLayoutChain<Ctx>(
  layoutOption: LayoutOption<Ctx> | undefined,
  pageContext: Ctx,
): LayoutChain {
  if (!layoutOption) return []
  if (typeof layoutOption === 'function') {
    return (layoutOption as (c: Ctx) => LayoutChain)(pageContext) ?? []
  }
  if (Array.isArray(layoutOption)) return layoutOption
  return [layoutOption as AnyLayer]
}

/**
 * Resolve a layer's seed-STATE OVERRIDE. In the signal runtime `init()` takes no
 * data, so a PRESENT data slice IS the seed state; an ABSENT slice (`undefined`)
 * falls back to the layer's own `init()`.
 *
 * Presence is `=== undefined`, NOT `??`: a `+data` returning `null`/`0`/`''` is a
 * legitimate seed that a nullish-coalesce would silently discard in favour of
 * `init()`. Every seed-override resolution — server render, client mount, client
 * hydrate — routes through this ONE presence check so the three paths agree.
 */
export function seedFor(data: unknown): unknown | undefined {
  return data === undefined ? undefined : data
}

/**
 * Resolve a layer's concrete seed STATE (never `undefined`): the data slice when
 * present, otherwise the state `init()` produces. Used by the client hydrate path
 * — `hydrateSignalApp` needs an explicit `serverState`, and since the server ran
 * NO effects, that state was always exactly `data ?? init()`, which both server
 * and client can compute locally (no need to ship it in the envelope).
 */
export function seedStateFor(def: AnyLayer, data: unknown): unknown {
  if (data !== undefined) return data
  return normalizeUpdateResult(def.init() as [unknown, unknown[]] | unknown)[0]
}

/**
 * Compose the per-layer data array for a FULL chain (`[...layouts, page]`) so
 * every slice lands on the layer it belongs to.
 *
 * The page's slice must sit at the page's index. A plain
 * `[...lluiLayoutData, pageContext.data]` only does that when `lluiLayoutData`
 * has exactly one entry per layout — and it usually does not: Vike forwards
 * `lluiLayoutData` to the client only when the app lists it in `passToClient`,
 * so the client array is routinely EMPTY. `[…[], pageData]` then seeds the
 * OUTERMOST LAYOUT with the PAGE's data and leaves the page on `init()`, with
 * every index after it off by one — silently, since both sides still agree on
 * the layer names. Padding to the layout count keeps the indices meaningful; the
 * manifest's `seeded` flags (see {@link buildManifest}) then catch the missing
 * slices themselves.
 */
export function buildChainData(
  layoutCount: number,
  layoutData: readonly unknown[],
  pageData: unknown,
): readonly unknown[] {
  const out: unknown[] = []
  for (let i = 0; i < layoutCount; i++) out.push(layoutData[i])
  out.push(pageData)
  return out
}

// ──── Hydration manifest (integrity only) ────

/** Current hydration-envelope version. Bump on any breaking envelope change so a
 * stale server/client pairing fails loud instead of mis-binding. */
export const HYDRATION_MANIFEST_VERSION = 3

/**
 * The tiny integrity manifest embedded in `window.__LLUI_STATE__`. It carries no
 * per-layer state: the server runs no effects, so every layer's seed is
 * `data ?? init()`, both already available client-side (see
 * {@link seedStateFor}). The manifest exists purely so a server/client chain
 * mismatch — wrong length, wrong layer at an index, version skew, a seed that
 * reached the server but not the client — throws clearly instead of hydrating
 * the wrong state into the wrong tree.
 */
export interface HydrationManifest {
  v: typeof HYDRATION_MANIFEST_VERSION
  /** Layer keys, outermost → page (see {@link layerKey}). */
  layers: string[]
  /**
   * Per layer: did the SERVER seed it from a `+data` slice (`true`) or from its
   * own `init()` (`false`)?
   *
   * Names alone cannot detect the commonest hydration divergence there is. Vike
   * forwards a `pageContext` key to the client ONLY when the app lists it in
   * `passToClient`, so `lluiLayoutData` — populated server-side by the layout's
   * data hook — arrives on the client as `undefined` unless the app opted in.
   * The layer names still match, so the integrity check passed while every
   * layout silently re-seeded from `init()`: a shell that server-rendered the
   * logged-in user hydrated to `anonymous`, with no error anywhere. Comparing
   * the seed's ORIGIN per layer makes that a loud failure (see
   * {@link verifyManifest}).
   */
  seeded: boolean[]
}

/**
 * Normalize a layer to its manifest key. IDENTICAL on server and client so the
 * integrity check compares like with like. `name` is optional on a signal
 * component, so an unnamed layer falls back to a stable per-index key — an
 * unnamed page/layout therefore hydrates cleanly instead of colliding on a shared
 * literal (`'Page'`/`'Layout'`) that never matched `def.name === undefined`.
 */
export function layerKey(def: AnyLayer, index: number): string {
  return def.name ?? `layer:${index}`
}

/**
 * Build the integrity manifest for a full chain (`[...layouts, page]`).
 * `chainData` is that chain's index-aligned data array (see
 * {@link buildChainData}); only the PRESENCE of each slice is recorded, never
 * its value — the manifest ships inside the HTML document.
 */
export function buildManifest(
  chain: LayoutChain,
  chainData: readonly unknown[],
): HydrationManifest {
  return {
    v: HYDRATION_MANIFEST_VERSION,
    layers: chain.map((def, i) => layerKey(def, i)),
    seeded: chain.map((_def, i) => seedFor(chainData[i]) !== undefined),
  }
}

/**
 * Verify the server-emitted manifest against the chain the client is about to
 * hydrate. Throws on any mismatch — missing manifest, version skew, wrong layer
 * count, a divergent layer at a given index, or a layer whose seed ORIGIN
 * differs between the two sides — so server/client drift fails loud rather than
 * silently binding mismatched state. Returns the validated manifest.
 */
export function verifyManifest(
  envelope: unknown,
  chain: LayoutChain,
  chainData: readonly unknown[],
): HydrationManifest {
  if (envelope === null || typeof envelope !== 'object') {
    throw new Error(
      `[llui/vike] Hydration manifest is missing. Server-side onRenderHtml must ` +
        `populate window.__LLUI_STATE__ with the chain manifest before client hydration.`,
    )
  }
  const manifest = envelope as Partial<HydrationManifest>
  if (manifest.v !== HYDRATION_MANIFEST_VERSION) {
    throw new Error(
      `[llui/vike] Hydration manifest version mismatch: got ${String(manifest.v)}, ` +
        `expected ${HYDRATION_MANIFEST_VERSION}. The server and client are running ` +
        `different @llui/vike builds — redeploy both from the same version.`,
    )
  }
  const layers = manifest.layers
  if (!Array.isArray(layers) || layers.length !== chain.length) {
    throw new Error(
      `[llui/vike] Hydration manifest layer count (${
        Array.isArray(layers) ? layers.length : 'n/a'
      }) does not match the client chain length (${chain.length}). The layout ` +
        `chain resolver returns different chains on the server and client for this route.`,
    )
  }
  const seeded = manifest.seeded
  if (!Array.isArray(seeded) || seeded.length !== chain.length) {
    throw new Error(
      `[llui/vike] Hydration manifest is missing its per-layer seed flags. The ` +
        `server and client are running different @llui/vike builds — redeploy both ` +
        `from the same version.`,
    )
  }
  for (let i = 0; i < chain.length; i++) {
    const expected = layerKey(chain[i]!, i)
    if (layers[i] !== expected) {
      throw new Error(
        `[llui/vike] Hydration mismatch at chain layer ${i}: server rendered ` +
          `<${String(layers[i])}> but client is trying to hydrate <${expected}>. This ` +
          `usually means the layout chain resolver returns different layouts on the ` +
          `server and the client for the same route.`,
      )
    }
    // The seed's ORIGIN must match, or the two sides render different state from
    // the same tree. Reported per layer, both directions, with the fix named:
    // the overwhelmingly common cause is a pageContext key the app never listed
    // in Vike's `passToClient`, so it exists server-side and vanishes client-side.
    const clientSeeded = seedFor(chainData[i]) !== undefined
    if (seeded[i] === clientSeeded) continue
    const where = `chain layer ${i} (<${expected}>)`
    throw new Error(
      seeded[i]
        ? `[llui/vike] Hydration seed missing at ${where}: the server seeded this ` +
            `layer from its data slice, but the client pageContext has none — it would ` +
            `fall back to init() and render different state than the server HTML. Vike ` +
            `only forwards pageContext keys listed in \`passToClient\`; add ` +
            `\`passToClient: ['lluiLayoutData']\` (plus any custom keys your layers read) ` +
            `to your +config.ts. If the layer is genuinely init()-seeded, stop populating ` +
            `its slice on the server.`
        : `[llui/vike] Hydration seed unexpected at ${where}: the server seeded this ` +
            `layer from init(), but the client pageContext carries a data slice for it — ` +
            `hydrating it would render different state than the server HTML. The data ` +
            `hook that fills this slice must run on the server render too (a client-only ` +
            `\`passToClient\`/onBeforeRender split produces exactly this).`,
    )
  }
  return { v: HYDRATION_MANIFEST_VERSION, layers, seeded }
}
