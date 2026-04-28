import { getRenderContext } from '../render-context.js'

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
 * Throws if called outside a render context.
 */
export function sample<S, R>(selector: (s: S) => R): R {
  const ctx = getRenderContext('sample')
  return selector(ctx.state as S)
}
