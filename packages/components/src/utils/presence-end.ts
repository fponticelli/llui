/**
 * Guard a presence "animation/transition ended" handler so it only advances the
 * presence machine when the event fired on the element the listener is bound to
 * (`e.target === e.currentTarget`) — never on a bubbling descendant.
 *
 * Overlay content (dialog, popover, menu, toast) reflects its exit phase via
 * `data-state="closing"` and stays mounted until an `animationend`/`transitionend`
 * dispatches `animationEnd`/`transitionEnd`. Without this guard, ANY descendant
 * animation or transition ending during the exit — a spinner, a ripple, a child
 * fade — bubbles up and prematurely unmounts the overlay before its own exit
 * animation completes.
 *
 * Mirrors the `e.target === el` guard the transitions runtime applies in
 * `waitForEnd` (`@llui/transitions`).
 */
export function presenceEndHandler<E extends AnimationEvent | TransitionEvent>(
  handler: (e: E) => void,
): (e: E) => void {
  return (e) => {
    if (e.target === e.currentTarget) handler(e)
  }
}
