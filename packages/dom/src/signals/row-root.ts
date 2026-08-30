// Row-root stability marker (#239).
//
// A keyed `each` row must be one or more STABLE nodes: the reconciler moves and
// removes a row by the node list the row build returned, so every node the row
// OWNS has to be in that list. Two shapes break that, and only one of them is
// visible from the node itself:
//
//   1. A `DocumentFragment` — what `show`/`branch`/`each` (and an `island`'s SSR
//      body) return. It EMPTIES on insertion, so the row's node list ends up
//      holding a husk. `each` detects this by `nodeType`, no marker needed.
//
//   2. An ANCHOR COMMENT whose real body is mounted as its SIBLINGS — what
//      `island()` returns on the client, and `lazy()` on the server. The comment
//      itself is a perfectly stable node, so nothing about it says "there is more
//      of me next door". As a row root the reorder then migrates the ANCHORS and
//      leaves the mounted bodies where they were:
//
//        <!--each--><!--island--><!--island--><div class=leaf>…</div>…<!--/each-->
//
// This module is the marker for case 2 — a WeakSet, so it costs nothing per node
// and cannot leak. It is deliberately NOT re-exported from `dom.ts`: it is an
// agreement between the primitives that mount an isolated instance and the one
// reconciler that has to reject them, not a public affordance.
//
// `virtualEach` is NOT a consumer and that is not an oversight: it appends every
// row into its OWN absolutely-positioned wrapper element and reorders by moving
// wrappers, so an anchor and the body beside it travel together. That is also why
// it never needed the fragment check either.
//
// THE SET IS MODULE-SCOPED, so this check FAILS OPEN across two physical copies of
// `@llui/dom`: an anchor marked by copy A is invisible to `each` in copy B, and the
// row silently corrupts on reorder as it did before #239. That is the same failure
// mode `provide()`'s module-scoped context already has (see the peer-dependency
// landmine in CLAUDE.md — `@llui/dom` must be a peerDependency, never a dependency),
// it is identical to pre-change behaviour rather than a regression, and the fix is
// the packaging rule. Do not read the guarantee as unconditional; case 1's
// `nodeType` check is structural and holds in either arrangement.

const unstableRowRoots = new WeakSet<Node>()

/** Mark `node` as an anchor whose real content lives beside it, so `each` can
 * reject it as a row's top-level node. Returns the node for call-site brevity. */
export function markUnstableRowRoot<N extends Node>(node: N): N {
  unstableRowRoots.add(node)
  return node
}

/** True when `node` was marked by {@link markUnstableRowRoot}. */
export function isUnstableRowRoot(node: Node): boolean {
  return unstableRowRoots.has(node)
}
