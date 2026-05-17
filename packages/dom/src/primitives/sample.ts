import { getRenderContext, currentAccessor } from '../render-context.js'

/**
 * Read current state inside a render context and return the result of
 * `selector(state)`. No binding is created, no mask is assigned — this
 * is a one-shot imperative read at view-construction time.
 *
 * **Don't use for variable-length lists.** Wrapping a list-render in
 * `sample` looks idiomatic but silently breaks reactivity: the
 * `.map(...)` runs once at construction, captures the row objects in
 * closure, and never re-runs when state updates in place. The cells
 * inside the captured rows show stale data; only a full structural
 * rebuild (e.g. a parent `branch` swapping arms) will refresh them.
 * Use `each` + `ItemAccessor` instead — see the "List of editable
 * rows" recipe in the cookbook.
 *
 * **Don't use inside an accessor** (`each().key`, `each().items`,
 * `branch().on`, `show().when`, `scope().on`, `foreign().props`, or a
 * binding accessor like `text(s => …)`).
 * Accessors must be pure functions of their parameter — the compiler's
 * mask analysis only sees reads of the parameter, so a `sample()` read
 * is invisible. The result is a hidden dependency that breaks
 * reconciliation: structural blocks gate out updates that should fire,
 * binding accessors miss state changes, and `key` callbacks create
 * keys that don't track outer state correctly.
 *
 * To depend on outer state inside an accessor, **lift it into the
 * accessor's parameter**. For `each().key` reading a sibling field
 * `rev`:
 *
 * ```ts
 * // ❌ wrong — sample() in key is invisible to mask gating
 * each({
 *   items: (s) => s.items,
 *   key: (it) => `${it.id}|${sample(s => s.rev)}`,
 *   render: …,
 * })
 *
 * // ✅ right — bake outer state into items, key is pure of T
 * each({
 *   items: (s) => s.items.map((it) => ({ it, rev: s.rev })),
 *   key: (r) => `${r.it.id}|${r.rev}`,
 *   render: …,
 * })
 * ```
 *
 * **Use for** passing a state snapshot to an imperative renderer
 * (foreign libraries, third-party canvas/svg builders), reading a
 * value to compute a static piece of structure that doesn't need to
 * react, or any case where a reactive binding would be semantically
 * wrong (e.g. capturing a value at *this exact moment* for a
 * one-shot side effect).
 *
 * Also exposed as `h.sample` on the View bag for destructure-from-`h`
 * ergonomics. The top-level import form works everywhere a render
 * context is live — including `each.render`, whose bag intentionally
 * does not carry View methods.
 *
 * Throws if called outside a render context, or from inside an
 * accessor.
 */
export function sample<S, R>(selector: (s: S) => R): R {
  const accessor = currentAccessor()
  if (accessor !== null) {
    throw new Error(
      `[LLui] sample() must not be called from inside ${accessor}. ` +
        `Accessors must be pure functions of their parameter — sample() reads ` +
        `state outside the parameter, which is invisible to the compiler's mask ` +
        `analysis and breaks reconciliation.\n\n` +
        `To depend on outer state, lift it into the accessor's parameter. For ` +
        `each().key reading a sibling field, bake it into the items map:\n` +
        `  // ❌ wrong\n` +
        `  each({\n` +
        `    items: (s) => s.rows,\n` +
        `    key: (it) => \`\${it.id}|\${sample(s => s.rev)}\`,\n` +
        `  })\n` +
        `  // ✅ right\n` +
        `  each({\n` +
        `    items: (s) => s.rows.map((it) => ({ it, rev: s.rev })),\n` +
        `    key: (r) => \`\${r.it.id}|\${r.rev}\`,\n` +
        `  })`,
    )
  }
  const ctx = getRenderContext('sample')
  return selector(ctx.state as S)
}
