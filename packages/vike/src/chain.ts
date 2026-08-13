// Shared layout-chain vocabulary for the vike adapter. Both entry points
// (`@llui/vike/server` = on-render-html, `@llui/vike/client` = on-render-client)
// resolve the SAME chain shape and stamp / verify the SAME hydration manifest,
// so the two sides can never drift into two subtly-different definitions of a
// layer, a seed, or an envelope. Import from here; do not re-declare.

import { normalizeUpdateResult } from '@llui/dom'
import type { Renderable } from '@llui/dom'

/**
 * True in a development build — the ONE place the substituted expression is
 * written, so a production bundler folds it to `false` here and every guard
 * below reads a constant.
 *
 * Read this constant DIRECTLY as the first gate of any dev-only body (see
 * {@link checkInitDeterminism} / {@link buildChainData}), and keep the explicit
 * `dev` parameter only as the second gate / test override. A parameter alone
 * cannot fold: the bundler must assume a caller may pass `true`, so the whole
 * body — including its multi-hundred-byte warning strings — is retained in the
 * production client chunk even though it can never run there. The constant gate
 * makes the rest of the body statically unreachable and it is dropped.
 *
 * `import.meta.env` is typed by `@llui/dom`'s global `ImportMeta` augmentation
 * (a required peer, imported for a value just above) — this file used to carry
 * a byte-identical copy of that `declare global` block. The `?.` is not
 * decoration: raw tsc/Node sees no `env` at all, and the dev checks then stay
 * off, which is the correct answer outside a bundler.
 */
const DEV_BUILD = import.meta.env?.DEV === true

/** @see {@link DEV_BUILD} */
export function isDevBuild(): boolean {
  return DEV_BUILD
}

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
  /**
   * MUST BE DETERMINISTIC. The hydration envelope ships no state, so a layer
   * without a data slice is re-seeded on the client by calling this again —
   * `Date.now()`, `Math.random()`, `crypto.randomUUID()` or a module-level
   * counter here renders one state on the server and hydrates another. Emit the
   * varying value from an effect after mount, or resolve it server-side and pass
   * it in through the layer's data slice. Dev builds check and warn (see
   * {@link buildManifest} / {@link checkInitDeterminism}) — but only as far as
   * the JSON-serializable-State invariant holds: the check compares JSON
   * fingerprints, so variation the runtime's own State contract already forbids
   * (a `Set`/`Map`/function/`undefined` property, anything `JSON.stringify`
   * drops or flattens) can differ on the two sides and still fingerprint alike.
   * Deterministic `init()` and JSON-serializable state are one precondition,
   * not two.
   */
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

  /**
   * DEV BUILDS ONLY — a {@link stateFingerprint} of each init()-seeded layer's
   * server state (`null` for a data-seeded layer, absent entirely in production).
   *
   * Re-seeding a layer by calling its `init()` again on the client is only sound
   * if `init()` is DETERMINISTIC. Nothing enforces that, and a violation is
   * invisible: `init: () => ({ id: Date.now() })` renders one state server-side
   * and hydrates another, with the manifest, the chain and the DOM structure all
   * perfectly in agreement. The fingerprint spans the one boundary the
   * divergence actually lives on, so the client can compare and warn (see
   * {@link checkInitDeterminism}). It is a hash, never the state, and it is not
   * emitted at all in production.
   */
  initFingerprints?: (string | null)[]
}

/**
 * Stable content hash of a layer's seed state — 32-bit FNV-1a over its JSON, hex.
 *
 * Comparable across the server→client boundary because State is JSON-serializable
 * by contract and one `init()` body always builds its object in the same key
 * order. Returns `null` for a state JSON cannot express (a cycle, a `BigInt`),
 * which is a State-shape violation of its own and not this check's business to
 * report — declining is what keeps a dev-only probe from throwing.
 */
export function stateFingerprint(state: unknown): string | null {
  let json: string
  try {
    json = JSON.stringify(state) ?? 'undefined'
  } catch {
    return null
  }
  let h = 0x811c9dc5
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
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
 * its value — the manifest ships inside the HTML document. `seedStates` is the
 * state each layer actually rendered against.
 *
 * When `dev` is set this also runs the SAME-TICK half of the init()-determinism
 * check: every init()-seeded layer's `init()` is called a second time and
 * compared against what was rendered, which catches a counter, a `Math.random()`
 * or a mutable module binding right where it happens. The time-dependent cases
 * survive a same-tick double call — those are left to the client-side
 * fingerprint comparison in {@link checkInitDeterminism}. With `dev` off, no
 * extra `init()` runs and no fingerprints are emitted.
 */
export function buildManifest(
  chain: LayoutChain,
  chainData: readonly unknown[],
  seedStates: readonly unknown[],
  dev: boolean,
): HydrationManifest {
  const manifest: HydrationManifest = {
    v: HYDRATION_MANIFEST_VERSION,
    layers: chain.map((def, i) => layerKey(def, i)),
    seeded: chain.map((_def, i) => seedFor(chainData[i]) !== undefined),
  }
  // Constant gate first (see {@link DEV_BUILD}), explicit parameter second.
  if (!DEV_BUILD) return manifest
  if (!dev) return manifest

  manifest.initFingerprints = chain.map((def, i) => {
    // A data-seeded layer never calls init() on either side — nothing to check.
    if (seedFor(chainData[i]) !== undefined) return null
    const rendered = stateFingerprint(seedStates[i])
    const second = stateFingerprint(seedStateFor(def, undefined))
    if (rendered !== null && second !== null && rendered !== second) {
      console.warn(
        `[llui/vike] <${layerKey(def, i)}> (chain layer ${i}) has a NON-DETERMINISTIC ` +
          `init(): two calls in the same server render produced different state. This ` +
          `layer ships no state to the client — it is re-seeded by calling init() again ` +
          `during hydration — so the browser will render something other than the HTML ` +
          `you just sent. Move the varying value (a counter, Math.random(), ` +
          `crypto.randomUUID(), Date.now()) out of init(): emit it from an effect, or ` +
          `resolve it server-side and pass it in through the layer's data slice. ` +
          `(dev-only check; not run in production builds)`,
      )
    }
    return rendered
  })
  return manifest
}

/**
 * Client half of the init()-determinism check: compare the state this layer just
 * re-seeded itself with against the fingerprint the server recorded, and warn
 * when they differ. Dev-only, and a no-op against a production server envelope
 * (which carries no fingerprints) so a dev client never fails on a prod server.
 *
 * This is a WARNING, not a throw: the state divergence is already committed by
 * the time it is observable, the app is running, and the fix is in the author's
 * `init()` — turning a working-but-wrong page into a blank one helps nobody.
 * The seed-ORIGIN mismatch in {@link verifyManifest} throws instead, because
 * there the adapter can still refuse before binding anything.
 *
 * The `DEV_BUILD` gate comes FIRST and reads the substituted constant directly,
 * so a production client bundle drops this entire body (see {@link DEV_BUILD});
 * `dev` stays as the explicit second gate and test override.
 */
export function checkInitDeterminism(
  manifest: HydrationManifest,
  index: number,
  def: AnyLayer,
  data: unknown,
  state: unknown,
  dev: boolean,
): void {
  if (!DEV_BUILD) return
  if (!dev) return
  if (seedFor(data) !== undefined) return
  const expected = manifest.initFingerprints?.[index]
  if (expected === undefined || expected === null) return
  const actual = stateFingerprint(state)
  if (actual === null || actual === expected) return
  console.warn(
    `[llui/vike] <${layerKey(def, index)}> (chain layer ${index}) has a NON-DETERMINISTIC ` +
      `init(): it produced different state on the client than on the server, so the ` +
      `hydrated DOM no longer matches the HTML that was sent. A layer with no data ` +
      `slice is re-seeded by calling init() again in the browser, which requires it to ` +
      `return the same value on both sides. Move the varying value (Date.now(), ` +
      `Math.random(), crypto.randomUUID(), a counter) out of init(): emit it from an ` +
      `effect after mount, or resolve it server-side and pass it in through the layer's ` +
      `data slice. (dev-only check; not run in production builds)`,
  )
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
  // `initFingerprints` is dev-only and therefore absent from a production
  // server's envelope — carried through when present, never required.
  const fingerprints = manifest.initFingerprints
  return {
    v: HYDRATION_MANIFEST_VERSION,
    layers,
    seeded,
    initFingerprints: Array.isArray(fingerprints) ? fingerprints : undefined,
  }
}
