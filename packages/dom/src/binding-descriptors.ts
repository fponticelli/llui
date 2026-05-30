/**
 * A single agent-dispatchable variant tied to currently-rendered UI.
 *
 * The agent layer's `list_actions` reads the live binding-descriptor
 * registry to surface which Msg variants the LLM can usefully send right
 * now — not just which the app *could* accept in principle, but which
 * have a live UI binding the human user could also click. Each entry
 * maps to one variant string the compiler discovered as a literal
 * `send({ type: '<variant>' })` call inside an event-handler arrow.
 *
 * The signal runtime owns the live registry (see `signals/dom.ts` and
 * `signals/component.ts`, which read the `__lluiVariants` tag this
 * module attaches via `tagSend`). This file carries only the
 * runtime-agnostic surface: the descriptor shape and the `tagSend`
 * tagger that library `*.connect` implementations call.
 */
export interface BindingDescriptor {
  variant: string
}

/**
 * Library helper for `*.connect` implementations: tags an event
 * handler with the variants it dispatches at runtime, so the binding
 * registers them when the user spreads the bag onto an element.
 *
 * Resolution rules — choose whichever is defined and non-empty:
 *
 * 1. **`send.__lluiVariants`** (translator pattern). When the user
 *    passed a compiler-tagged dispatch translator like
 *    `(m) => dispatch({type: 'Auth/UserMenu'})`, `send` itself
 *    carries the user-side variants the translator forwards. We
 *    surface those — the agent should see what `update()` actually
 *    receives, not the library's internal Msg shape.
 *
 * 2. **`libraryVariants`** fallback. When `send` is the user's raw
 *    component send (no translator), the library's internal Msgs flow
 *    directly into `update()`, so the library's own variants ARE the
 *    user variants. Library author hand-lists them once per handler.
 *
 * Returns `fn` mutated (via `Object.assign`) so the same reference
 * remains identity-equal — important for downstream code that diffs
 * handlers across re-bindings.
 *
 * @example
 * ```ts
 * import { tagSend } from '@llui/dom'
 *
 * export function connect<S>(get, send, opts) {
 *   return {
 *     trigger: {
 *       onClick: tagSend(send, ['Open'], () => send({ type: 'open' })),
 *     },
 *   }
 * }
 * ```
 */
export function tagSend<F extends (...args: never[]) => unknown>(
  send: unknown,
  libraryVariants: readonly string[],
  fn: F,
): F {
  const sendVariants = (send as { __lluiVariants?: readonly string[] } | null | undefined)
    ?.__lluiVariants
  const variants = sendVariants && sendVariants.length > 0 ? sendVariants : libraryVariants
  if (variants.length > 0) {
    Object.assign(fn, { __lluiVariants: variants })
  }
  return fn
}
