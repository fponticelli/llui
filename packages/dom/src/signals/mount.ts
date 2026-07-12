// Mount targets + the shared render/mount core.
//
// `renderSignalTree` runs a view build against a `doc` and wires the chunked-mask
// reconciler scope WITHOUT attaching to the DOM; `mountSignal` layers attachment
// (container append/replace, or anchor-bracketed sibling insertion) and the
// update/dispose loop on top. Callers insert nodes FIRST, then `mount`, so onMount
// / portal / focus work see attached nodes (except SSR, which mounts detached
// purely to bake initial values into the serialized HTML).

import { runBuild, runMounts, type SignalDoc } from './build-context.js'
import type { SignalScope } from './runtime.js'
import type { Renderable } from './element.js'
import { buildAndPublishScope } from './scope-build.js'

export interface SignalMount {
  /** apply a new state; only bindings whose deps changed re-run and commit. */
  update(next: unknown): void
  /** run teardowns (foreign unmount, subscriptions). */
  dispose(): void
  /** live agent-affordance variants (tagged-send handlers currently mounted). */
  getDescriptors(): Array<{ variant: string }>
}

/** Where a `mountSignal` call attaches its built nodes. A `container` element
 * (the common case — append, or replace its children on hydration) OR an
 * `anchor` comment, for adapters like `@llui/vike` that mount a nested layer as
 * siblings of a slot anchor without owning the parent element. The owned region
 * is bracketed by the anchor and a synthesized end sentinel; `dispose()` removes
 * exactly that region (leaving the anchor + outer siblings intact). */
export type MountTarget =
  | { container: Element; mode?: 'append' | 'replace' }
  // `mode: 'replace'` (hydration) first removes any existing server region
  // between the anchor and the next `llui-mount-end` sentinel, then mounts fresh
  // — mirroring container hydration's atomic swap (no claim of server nodes).
  | { anchor: Comment; mode?: 'append' | 'replace' }

/**
 * Mount a signal view: build the nodes (collecting bindings), attach them at the
 * target, and wire a chunked-mask reconciler over the collected bindings.
 *
 * For a `container` target, 'append' (fresh mount) leaves existing children and
 * 'replace' swaps server HTML out atomically (hydration). For an `anchor` target,
 * the nodes are inserted immediately after the anchor comment and bracketed by a
 * synthesized end sentinel — `dispose()` removes that bracketed region.
 *
 * `seedContexts` seeds the build's root context values (see `runBuild`); used by
 * adapters mounting a nested build whose providers live in a different pass.
 */
export function mountSignal(
  target: Element | MountTarget,
  initial: unknown,
  build: () => Renderable,
  modeOrSeed?: 'append' | 'replace' | ReadonlyMap<symbol, unknown>,
  seedContexts?: ReadonlyMap<symbol, unknown>,
  // Live component-state getter (see `BuildCtx.getState`). Passed by
  // `mountSignalComponent` so async-mounting primitives (signalLazy's error arm)
  // can snapshot current state; absent for raw `mountSignal` fragment mounts.
  getState?: () => unknown,
): SignalMount {
  // Back-compat positional form: mountSignal(container, initial, build, mode).
  const t: MountTarget =
    target instanceof Object && 'container' in target
      ? target
      : target instanceof Object && 'anchor' in target
        ? target
        : { container: target as Element, mode: (modeOrSeed as 'append' | 'replace') ?? 'append' }
  const seed = modeOrSeed instanceof Map ? modeOrSeed : seedContexts

  if ('anchor' in t) {
    const anchor = t.anchor
    const doc = anchor.ownerDocument as unknown as SignalDoc
    const built = renderSignalTree(doc, build, seed, false, getState)
    const parent = anchor.parentNode
    if (!parent) throw new Error('mountSignal: anchor comment is not attached to a parent')
    // Hydration: drop the server-rendered region (anchor → existing end sentinel)
    // before inserting the fresh client tree — same no-claim swap as containers.
    if (t.mode === 'replace') {
      let n = anchor.nextSibling
      while (n && !(n.nodeType === 8 && (n as Comment).data === 'llui-mount-end')) {
        const next = n.nextSibling
        parent.removeChild(n)
        n = next
      }
      if (n) parent.removeChild(n) // the stale end sentinel
    }
    const end = doc.createComment('llui-mount-end')
    const insertPoint = anchor.nextSibling
    for (const n of built.nodes) parent.insertBefore(n, insertPoint)
    parent.insertBefore(end, insertPoint)
    // Insert FIRST, then mount (structural reconcile + binding commits) so onMount
    // / portal / focus work see attached nodes; then run onMount callbacks.
    built.mount(initial)
    runMounts(built.mounts, parent as Element, built.teardowns)
    let cur = initial
    return {
      update(next: unknown): void {
        built.scope.update(cur, next)
        cur = next
      },
      dispose(): void {
        for (const tdn of built.teardowns.splice(0)) tdn()
        // remove the owned region: every node between anchor and end (exclusive).
        let n = anchor.nextSibling
        while (n && n !== end) {
          const next = n.nextSibling
          parent.removeChild(n)
          n = next
        }
        if (end.parentNode === parent) parent.removeChild(end)
      },
      getDescriptors: built.getDescriptors,
    }
  }

  const container = t.container
  const built = renderSignalTree(container.ownerDocument, build, seed, false, getState)
  if (t.mode === 'replace') container.replaceChildren(...built.nodes)
  else for (const n of built.nodes) container.appendChild(n)

  // Insert FIRST, then mount (binding commits + first structural reconcile) so
  // show/each content + onMount focus/portal see attached nodes; then onMount.
  built.mount(initial)
  runMounts(built.mounts, container, built.teardowns) // onMount(root) after insert
  let cur = initial
  return {
    update(next: unknown): void {
      built.scope.update(cur, next)
      cur = next
    },
    dispose(): void {
      for (const tdn of built.teardowns.splice(0)) tdn()
      // Remove the mounted tree so `dispose()` means the same for both target kinds
      // (the anchor path removes its bracketed region). Otherwise a container mount
      // left the nodes + their dead listeners attached. Guard by the node's CURRENT
      // parent — a node may have been reparented (portal) or already detached.
      for (const n of built.nodes) n.parentNode?.removeChild(n)
    },
    getDescriptors: built.getDescriptors,
  }
}

/** The shared build core: run the view build against `doc` and wire the scope —
 * WITHOUT attaching to any container or applying the initial state. The returned
 * `mount(state)` runs the binding commits (and the first structural reconcile,
 * which inserts `show`/`each` content and registers onMount work); callers MUST
 * insert `nodes` into the live document BEFORE calling `mount` so onMount focus /
 * portal / dismissable behavior sees attached nodes — except SSR, which mounts a
 * detached tree purely to bake initial values into the serialized HTML. */
export function renderSignalTree(
  doc: SignalDoc,
  build: () => Renderable,
  // Adapter seed (see `runBuild`): context values to expose at the root of this
  // build when no surrounding build provides them (`@llui/vike` slot replay).
  seedContexts?: ReadonlyMap<symbol, unknown>,
  // Server render: marks the build (and every nested arm/row) as SSR so the mount
  // lifecycle is skipped (see `BuildCtx.ssr` / `onMount`). The client mount and
  // hydrate paths leave this false — they own the real DOM and run onMount.
  ssr = false,
  // Live component-state getter (see `BuildCtx.getState`), threaded to the root build.
  getState?: () => unknown,
): {
  nodes: readonly Node[]
  scope: SignalScope
  mount: (state: unknown) => void
  teardowns: Array<() => void>
  mounts: Array<(root: Element) => void | (() => void)>
  getDescriptors: () => Array<{ variant: string }>
} {
  const built = runBuild(doc, build, undefined, seedContexts, false, ssr, getState)
  const scope = buildAndPublishScope(built)
  return {
    nodes: built.nodes,
    scope,
    mount: (state: unknown) => scope.mount(state),
    teardowns: built.teardowns,
    mounts: built.mounts,
    getDescriptors: () => {
      const out: Array<{ variant: string }> = []
      for (const variant of built.descriptors.keys()) out.push({ variant })
      return out
    },
  }
}
