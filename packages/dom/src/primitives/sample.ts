import { getRenderContext } from '../render-context.js'

/**
 * Read current state inside a render context and return the result of
 * `selector(state)`. No binding is created, no mask is assigned — this
 * is a one-shot imperative read.
 *
 * Use when a builder needs the current state snapshot (e.g. to pass
 * an object to an imperative renderer), and a reactive binding would
 * be wrong semantically.
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
