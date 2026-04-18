# Proposal: True DOM-reuse hydration

**Status:** Deferred follow-up. Noted during the 2026-04-17 anchor-mount spec (`docs/superpowers/specs/YYYY-MM-DD-anchor-mount-design.md`).
**Impact:** Medium — removes the hydration flash and cuts time-to-interactive on pages with heavy SSR content.

Today `hydrateApp` (in `packages/dom/src/mount.ts`) is atomic-swap hydration: it ignores the server-rendered DOM and calls `container.replaceChildren(...clientNodes)` with freshly-constructed client DOM. The user-visible cost is that every element between first paint and hydration blinks — the server's HTML is discarded the instant JS runs, even if it was identical to what the client would render. For large layouts this produces a visible reshuffle and forces the browser to re-do layout twice.

The planned `hydrateAtAnchor` (anchor-mount spec) inherits the same semantics: swap everything between the sentinel pair with freshly-built client nodes.

**What to build:**

- A DOM walker that pairs server-emitted elements with the client `view()` output one-for-one, reusing server nodes and attaching reactive bindings in place.
- Use the `data-llui-hydrate` markers that `serializeNodes` already emits to identify binding sites — they're currently written but never read.
- Fall back to atomic-swap when the walk detects a structural mismatch (tag/text mismatch, missing marker, extra node) so developers don't get silent corruption from a bad SSR config.

**Why it matters:**

- Eliminates the hydration flash — server HTML stays on screen through hydration.
- Cuts time-to-interactive: no second layout pass, no wasted allocation of DOM nodes that get thrown away.
- Enables progressive-enhancement stories that today are foreclosed — e.g., SSR form submits that should survive hydration with their state intact.

**Scope signals:**

- Modify both `hydrateApp` (container-based) and `hydrateAtAnchor` (sentinel-based) to use the walker.
- Extend `@llui/vike`'s hydration path to trust the reused DOM rather than replacing it.
- Test matrix: shape-matching server/client output, various kinds of structural mismatch, `each` keyed reconciliation against server-emitted keys, `show` branches, nested components, `child()` boundaries, bindings of every kind.

**Estimated scope:** ~400-600 LOC across `@llui/dom` + tests; possibly 200 LOC more for `@llui/vike` verification. Non-trivial but bounded — the SSR side already emits the metadata, the walk is the missing piece.

**Prerequisite:** the anchor-mount work itself must land first so sentinels exist as a stable boundary for the walker.
