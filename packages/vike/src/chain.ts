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

// ──── Hydration manifest (integrity only) ────

/** Current hydration-envelope version. Bump on any breaking envelope change so a
 * stale server/client pairing fails loud instead of mis-binding. */
export const HYDRATION_MANIFEST_VERSION = 2

/**
 * The tiny integrity manifest embedded in `window.__LLUI_STATE__`. It carries
 * only the layer NAMES (outermost → page), NOT per-layer state: the server runs
 * no effects, so every layer's seed is `data ?? init()`, both already available
 * client-side (see {@link seedStateFor}). The manifest exists purely so a
 * server/client chain mismatch — wrong length, wrong layer at an index, version
 * skew — throws clearly instead of hydrating the wrong state into the wrong tree.
 */
export interface HydrationManifest {
  v: typeof HYDRATION_MANIFEST_VERSION
  layers: string[]
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

/** Build the integrity manifest for a full chain (`[...layouts, page]`). */
export function buildManifest(chain: LayoutChain): HydrationManifest {
  return {
    v: HYDRATION_MANIFEST_VERSION,
    layers: chain.map((def, i) => layerKey(def, i)),
  }
}

/**
 * Verify the server-emitted manifest against the chain the client is about to
 * hydrate. Throws on any mismatch — missing manifest, version skew, wrong layer
 * count, or a divergent layer at a given index — so server/client drift fails
 * loud rather than silently binding mismatched state.
 */
export function verifyManifest(envelope: unknown, chain: LayoutChain): void {
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
  }
}
