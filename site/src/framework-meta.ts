/**
 * One shared source of truth for the framework's one-line description, reused
 * by the llms.txt generator (and available to any other surface that needs the
 * canonical tagline) so the pitch can never drift between places.
 */
export const FRAMEWORK_TAGLINE =
  'A compile-time-optimized web framework built on The Elm Architecture (TEA), designed for LLM-first authoring. No virtual DOM — view() runs once at mount, building real DOM nodes with reactive bindings. State changes drive a chunked-mask reconciler: each binding carries a sparse mask of the dependency-path chunks it reads, and only the bindings whose paths actually changed re-commit.'
