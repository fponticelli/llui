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
 * A dispatch function that MAY carry the `__lluiVariants` tag — the compiler
 * writes it onto a lowered handler, and {@link tagSend} writes it onto a
 * library one.
 *
 * This is what `tagSend`'s first parameter takes instead of `unknown`
 * (issue #118): the old signature had to CAST to read the tag, and — worse —
 * left `libraryVariants` a bare `readonly string[]` with no relationship to the
 * Msg being dispatched, so a misspelt variant compiled fine. Binding `M` here
 * makes `readonly M['type'][]` reject a name that is not a Msg variant at all.
 *
 * It does NOT make the tag correct: `'touch'` and `'blur'` are both valid
 * `M['type']`, so a tag naming the WRONG variant still type-checks. Only
 * reading the handler can tell those apart, which is what the compiler's
 * `tag-send-drift` rule does.
 */
export type VariantTaggable<M> = ((msg: M) => void) & {
  readonly __lluiVariants?: readonly string[]
}

// Formatting note for maintainers, kept OUT of the JSDoc below so it does not
// ship onto the generated API page: several notes in that comment are prose
// written as LIST ITEMS. That is a workaround for issue #148 —
// `site/src/generate-api.ts` erases JSDoc paragraph breaks on the way into
// `site/content/api/dom.md`, so a paragraph following a list gets swallowed
// into the last bullet. When #148 lands, they can go back to plain paragraphs.
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
 * `libraryVariants` and the `type` the handler dispatches are two
 * statements of ONE fact, and they used to be unchecked against each
 * other — a drifted tag lies to the agent about what a control does,
 * silently (issue #118). Two guards now cover it, and neither is
 * sufficient alone:
 *
 * - the TYPE `readonly M['type'][]` (this signature) rejects a name
 *   that is not a Msg variant at all, including where the handler is
 *   a named function the compiler cannot read; and
 * - the compiler's `tag-send-drift` rule reads the handler and
 *   rejects a tag that names the WRONG variant — which type-checks,
 *   since `'touch'` and `'blur'` are equally valid `M['type']`.
 * - that rule BAILS rather than guess, so it is a backstop and not a
 *   proof: it recognizes `tagSend` only when imported from the
 *   `@llui/dom` specifier (a barrel re-export or a relative import is
 *   invisible — issue #146), reads only a literal variant list
 *   (`as const` and `satisfies` are read through; a hoisted
 *   `VARIANTS` identifier is not) with an inline handler, and reports
 *   an over-declaration only when nothing in the handler body could
 *   dispatch unseen.
 * - **Library authors, one quiet consequence of that last bail.**
 *   The over-declaration half survives exactly one kind of call on a
 *   handler parameter: a zero-argument `preventDefault` /
 *   `stopPropagation` / `stopImmediatePropagation`. Any OTHER event
 *   method — `e.persist()`, `e.composedPath()`,
 *   `e.dataTransfer.setData(…)` — is a call this analysis cannot see
 *   into, so it forfeits completeness and silently switches the
 *   "declares a variant it never dispatches" check off for that call
 *   site. The failure is SILENCE, not a broken build: the
 *   dispatched-but-undeclared direction still runs and nothing stops
 *   working. But do not read a clean build of such a handler as
 *   confirmation that its variant list is exhaustive.
 * - `send` is REQUIRED and non-nullable. Before #118 it was typed
 *   `unknown` and read through `?.`, so a nullish first argument
 *   returned a tagged `fn`; it now throws a `TypeError`. That is
 *   deliberate — the `?.` existed only to satisfy the cast the
 *   `unknown` parameter forced, and it disappeared with the cast. A
 *   nullish dispatcher is now a type error, so only untyped or
 *   casting callers can reach the throw, and failing at BIND time is
 *   earlier and closer to the mistake than failing on the first
 *   click. (It is NOT an argument about the published variants: the
 *   first parameter is only a tag SOURCE, and a handler need not
 *   dispatch through it.)
 *
 * @example
 * ```ts
 * import { tagSend } from '@llui/dom'
 *
 * export function connect<S>(get, send, opts) {
 *   return {
 *     trigger: {
 *       onClick: tagSend(send, ['open'], () => send({ type: 'open' })),
 *     },
 *   }
 * }
 * ```
 */
export function tagSend<M extends { type: string }, F extends (...args: never[]) => unknown>(
  send: VariantTaggable<M>,
  libraryVariants: readonly M['type'][],
  fn: F,
): F {
  const sendVariants = send.__lluiVariants
  const variants = sendVariants && sendVariants.length > 0 ? sendVariants : libraryVariants
  if (variants.length > 0) {
    Object.assign(fn, { __lluiVariants: variants })
  }
  return fn
}
