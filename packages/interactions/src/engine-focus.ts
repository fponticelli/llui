/**
 * Engine-initiated focus moves.
 *
 * The overlay machinery moves focus as part of its own bookkeeping: it focuses
 * an element when a layer opens, restores focus to the trigger when a layer is
 * dismissed, and hands focus back to the previously-focused element when a focus
 * trap is released. NONE of those is a user interaction.
 *
 * They used to be indistinguishable from one, and that cost a real defect
 * (#155). Two sibling popovers, both open at the production default
 * `restoreFocus: true`. A pointerdown inside the LOWER one is an outside
 * interaction for the upper one, which dismisses — correct. Dismissing it
 * focuses its trigger; that trigger is outside the lower popover, so the lower
 * popover's `focusin` watcher read the engine's own restore as an outside
 * interaction and dismissed too. Net effect: clicking a button INSIDE a popover
 * closed that popover.
 *
 * The guard is a DEPTH COUNTER held across the synchronous `.focus()` call and
 * consulted by `watchInteractOutside`'s `focusin` path (only that path — see
 * below). Three properties make it safe rather than a blunt mute:
 *
 * 1. **The window is one synchronous turn, and no user event can be delivered
 *    into it.** `HTMLElement.focus()` dispatches `focus`/`focusin`
 *    synchronously, so the counter is raised and lowered with no `await`, timer
 *    or microtask in between; the event loop is never free to run, so a genuine
 *    user interaction cannot land inside it.
 *
 *    Be precise about what that window CONTAINS, though: it is the whole
 *    synchronous TRANSITIVE CLOSURE of the `.focus()` call, not just the call
 *    itself. Every `focusin` listener the move triggers runs inside it —
 *    including arbitrary CONSUMER code and the full TEA `send`/reduce/commit
 *    cycles it drives. The consequence is real and accepted: an app `focusin`
 *    listener that itself moves focus somewhere else during an engine restore
 *    has its OWN (non-engine) move swallowed too, so a popover can be left open
 *    with focus resting outside it. The state is recoverable — the guard is
 *    released the moment the outermost engine call returns, and the next
 *    genuine focus move dismisses as usual — and no user event was suppressed,
 *    because none could be delivered. Narrowing the window to literally the
 *    `.focus()` call is not available: `focusin` is dispatched from inside it.
 * 2. **Only the FOCUS path is suppressed.** `pointerdown` dispatch is untouched,
 *    so a real click that lands during a teardown still dismisses every layer it
 *    is outside of. Suppressing outside-interaction dispatch wholesale would
 *    over-suppress exactly there.
 * 3. **It is depth-counted, not a boolean.** A restore nested inside another
 *    restore (a focus trap releasing while the overlay engine restores its
 *    anchor) must not clear the guard early for the outer one.
 *
 * What deliberately does NOT go through here: focus moves a USER drove, even
 * when the engine picks the destination — the focus trap's Tab/Shift+Tab wrap,
 * and the roving/list-navigation focus in `roving.ts`, `table.ts`, `pagination.ts`
 * and `tags-input.ts`. Those are the user moving focus, and a layer they move
 * focus out of must still dismiss.
 */
let depth = 0

// Vite/Rollup substitute `import.meta.env.DEV` at build time; bundlers without
// the substitution (raw tsc / a plain script tag) see it as undefined, so the
// dev path stays off. Declared here rather than pulling in `vite/client`, the
// same way `@llui/dom` does it — and with the SAME member shape, or the two
// augmentations of the one global interface conflict (TS2717).
declare global {
  interface ImportMeta {
    env?: { DEV?: boolean; MODE?: string }
  }
}

declare const SYNC_BODY_REQUIRED: unique symbol

/**
 * The type an ASYNC body collapses to in {@link runEngineFocus}'s parameter
 * position. Nothing is assignable to it, so `runEngineFocus(async () => …)` is a
 * compile error naming the contract rather than a silently inert call.
 */
export type SyncEngineFocusBodyRequired = {
  readonly [SYNC_BODY_REQUIRED]: 'runEngineFocus requires a SYNCHRONOUS body — the guard is released the moment body returns'
}

/** `T`, unless `T` is a promise — see {@link SyncEngineFocusBodyRequired}. */
type SyncEngineFocusBody<T> = T extends PromiseLike<unknown> ? SyncEngineFocusBodyRequired : T

/**
 * Run `body` with engine-focus suppression active. Any `focusin` raised inside
 * it is invisible to `watchInteractOutside` — including one raised by a focus
 * move that re-entrant consumer code makes from a `focusin` listener (see the
 * module comment: the window is the synchronous transitive closure, not just
 * the `.focus()` call).
 *
 * SYNCHRONOUS BY CONTRACT, AND THE CONTRACT IS ENFORCED (#172). The suppression
 * is released when `body` RETURNS. An `async` body returns its promise at the
 * first `await`, so the depth counter drops immediately and the focus move that
 * eventually happens gets NO protection at all — a call that looks correct,
 * compiles, and does nothing. The failure is safe (no protection, never a stuck
 * guard: the decrement is in a `finally`), which is exactly why it is invisible,
 * and this is a PUBLIC export documented as the thing a custom overlay "must"
 * route its engine-initiated focus moves through. A consumer following that
 * advice with an async body would reintroduce #155 in their app while believing
 * they had prevented it.
 *
 * Two guards, because neither covers the other's case:
 *
 *  - The SIGNATURE rejects a promise-returning body at compile time. It is the
 *    real guard — it fires before the code ever runs. Its one blind spot is a
 *    body whose return type is an unresolved type parameter (a generic
 *    pass-through wrapper): the conditional is deferred, so such a wrapper is
 *    rejected too and must carry its own constraint. No caller does.
 *  - A DEV-MODE warning catches what the type system cannot see: a JavaScript
 *    consumer, an `any`-typed body, or a body that returns a thenable without
 *    being declared as returning one. It cannot restore the protection — by the
 *    time a thenable is in hand the guard is already released — so it only
 *    reports.
 *
 * Deliberately NOT offered: an async-aware variant that holds the guard across
 * an `await`. The guard is safe *because* no user event can be delivered inside
 * its window (see the module comment); holding it across a suspension point
 * hands the event loop back and would start swallowing genuine interactions.
 */
export function runEngineFocus<T>(body: () => SyncEngineFocusBody<T>): T {
  depth++
  try {
    const result = body() as T
    if (import.meta.env?.DEV === true && isThenable(result)) {
      console.warn(
        '[llui/interactions] runEngineFocus was given an ASYNC body. The suppression is ' +
          'released when the body RETURNS, so the focus move it makes later is NOT ' +
          'protected and every other open layer will read it as an outside interaction ' +
          '(#155/#172). Move the focus call into a synchronous body.',
      )
    }
    return result
  } finally {
    depth--
  }
}

function isThenable(value: unknown): boolean {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

/** Focus `el` as an engine-initiated move (see `runEngineFocus`). */
export function engineFocus(el: HTMLElement, options?: FocusOptions): void {
  runEngineFocus(() => {
    el.focus(options)
  })
}

/**
 * Whether an engine-initiated focus move is in flight. Consulted by
 * `watchInteractOutside` to gate its `focusin` path.
 */
export function isEngineFocusInProgress(): boolean {
  return depth > 0
}
