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

/**
 * Run `body` with engine-focus suppression active. Any `focusin` raised inside
 * it is invisible to `watchInteractOutside` — including one raised by a focus
 * move that re-entrant consumer code makes from a `focusin` listener (see the
 * module comment: the window is the synchronous transitive closure, not just
 * the `.focus()` call).
 *
 * Synchronous by contract: the suppression is released when `body` RETURNS, so
 * a body that schedules a focus move for later gets no protection (and must not
 * — by then the move is indistinguishable from a user's).
 */
export function runEngineFocus<T>(body: () => T): T {
  depth++
  try {
    return body()
  } finally {
    depth--
  }
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
