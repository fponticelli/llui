// A brand separating the framework's own "this authoring cannot work" errors from
// everything else that can throw out of a binding.
//
// `SignalScopeImpl.mount` contains a throwing binding so one bad fragment cannot
// abandon the whole document half-drawn (#165). That containment is right for a
// DATA surprise — an accessor that dereferenced something absent, a commit handed a
// value it did not expect — because the rest of the page is still correct and the
// throw is reported.
//
// It is WRONG for an authoring invariant. `each: a row cannot have a show as its
// top-level node` is not a bad frame, it is a tree that cannot be reconciled: swallow
// it and the row mounts with a fragment root, then a reorder three interactions later
// fails with a `NotFoundError` naming nothing the author wrote. Displacing an error
// from its cause is the exact complaint #165 is filed about, so these stay FATAL.
//
// Detection is by BRAND, not `instanceof`. Two physical `@llui/dom` installs is
// already a documented outage-level packaging bug, but a cross-realm `instanceof`
// failing OPEN here would silently downgrade a fatal invariant to a console line,
// which is the failure direction that is expensive to notice.

/**
 * An error raised by the framework about the AUTHORING — a shape that cannot be
 * mounted, a helper reached outside a build, a lowering that did not happen.
 * Distinct from any throw originating in user accessor/commit code.
 *
 * Never contained by the mount error boundary; see {@link isFrameworkError}.
 */
export class LluiFrameworkError extends Error {
  /** the brand {@link isFrameworkError} reads */
  readonly __lluiFrameworkError = true as const

  constructor(message: string) {
    super(message)
    this.name = 'LluiFrameworkError'
  }
}

/**
 * Is this throw a framework authoring invariant (so: fatal), rather than a data
 * surprise the mount boundary should contain and report?
 *
 * Brand check — see this module's header for why it is not `instanceof`.
 */
export function isFrameworkError(err: unknown): boolean {
  return (
    (err as { __lluiFrameworkError?: unknown } | null | undefined)?.__lluiFrameworkError === true
  )
}
