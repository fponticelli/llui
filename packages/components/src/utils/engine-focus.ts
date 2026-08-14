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
 * 1. **The window is exactly the engine's own call stack.** `HTMLElement.focus()`
 *    dispatches `focus`/`focusin` synchronously, so the counter is raised and
 *    lowered inside one turn with no `await`, timer or microtask in between. A
 *    genuine user interaction cannot be delivered into that window: the event
 *    loop is not free to run.
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
 * Run `body` with engine-focus suppression active. Any `focusin` raised by focus
 * moves inside it is invisible to `watchInteractOutside`.
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
