import { tagSend } from '@llui/dom'

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

/** The pair of end handlers a presence-bearing part spreads. */
export interface PresenceEndProps {
  onAnimationEnd: (e: AnimationEvent) => void
  onTransitionEnd: (e: TransitionEvent) => void
}

/**
 * Build BOTH end handlers for a part, guarded and `tagSend`-tagged.
 *
 * Wiring them one at a time is how four surfaces ended up guarded and five did
 * not (#126) — dialog/popover/menu/toast remembered the guard while
 * drawer/hover-card/tooltip/context-menu and `presence` itself forgot it, and a
 * descendant animation ending mid-exit unmounted those overlays early. Taking
 * the pair from one factory makes "guarded" the only thing a caller can build.
 *
 * `transitionMsg` defaults to `animationMsg` for the components that treat the
 * two events as one message.
 */
export function presenceEndProps<M extends { type: string }>(
  send: (msg: M) => void,
  animationMsg: M,
  transitionMsg: M = animationMsg,
): PresenceEndProps {
  return {
    onAnimationEnd: tagSend(
      send,
      [animationMsg.type],
      presenceEndHandler<AnimationEvent>(() => send(animationMsg)),
    ),
    onTransitionEnd: tagSend(
      send,
      [transitionMsg.type],
      presenceEndHandler<TransitionEvent>(() => send(transitionMsg)),
    ),
  }
}
