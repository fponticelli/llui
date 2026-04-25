import type { Send } from '@llui/dom'

/**
 * Presence — track mount/unmount lifecycle with exit-delay support.
 *
 * In many components (dialogs, tooltips, menus) the consumer wants to:
 *   1. close the overlay (fire exit animation)
 *   2. keep it mounted long enough for the animation to finish
 *   3. unmount it
 *
 * LLui already provides `@llui/transitions` for most of this, but a
 * presence machine is useful when you want to coordinate multiple
 * elements or expose state outside the transition primitive.
 *
 * State flow:
 *   closed → (open) → opening → open
 *   open   → (close) → closing → closed
 *
 * The consumer fires `animationEnd` to advance past opening/closing.
 * If `unmountOnExit` is true, `closed` means "safe to remove from DOM";
 * otherwise the element stays mounted even when closed (display:none).
 */

export type PresenceStatus = 'closed' | 'opening' | 'open' | 'closing'

export interface PresenceState {
  status: PresenceStatus
  unmountOnExit: boolean
}

export type PresenceMsg =
  /** @intent("Open") */
  | { type: 'open' }
  /** @intent("Close") */
  | { type: 'close' }
  /** @intent("Toggle") */
  | { type: 'toggle' }
  /** @intent("Animation End") */
  | { type: 'animationEnd' }
  /** @intent("Set Present") */
  | { type: 'setPresent'; present: boolean }

export interface PresenceInit {
  /** Initial presence — true starts in 'open', false starts in 'closed'. */
  present?: boolean
  /** Whether 'closed' means "unmount" (true) or "hidden but mounted" (false). Default: true. */
  unmountOnExit?: boolean
}

export function init(opts: PresenceInit = {}): PresenceState {
  return {
    status: opts.present ? 'open' : 'closed',
    unmountOnExit: opts.unmountOnExit ?? true,
  }
}

export function update(state: PresenceState, msg: PresenceMsg): [PresenceState, never[]] {
  switch (msg.type) {
    case 'open':
      if (state.status === 'open' || state.status === 'opening') return [state, []]
      return [{ ...state, status: 'opening' }, []]
    case 'close':
      if (state.status === 'closed' || state.status === 'closing') return [state, []]
      return [{ ...state, status: 'closing' }, []]
    case 'toggle': {
      const present = state.status === 'open' || state.status === 'opening'
      return update(state, { type: present ? 'close' : 'open' })
    }
    case 'animationEnd':
      if (state.status === 'opening') return [{ ...state, status: 'open' }, []]
      if (state.status === 'closing') return [{ ...state, status: 'closed' }, []]
      return [state, []]
    case 'setPresent':
      return [{ ...state, status: msg.present ? 'open' : 'closed' }, []]
  }
}

/** Whether the element should be in the DOM (mounted). */
export function isMounted(state: PresenceState): boolean {
  if (!state.unmountOnExit) return true
  return state.status !== 'closed'
}

/** Whether the element is visible (not running an exit animation). */
export function isVisible(state: PresenceState): boolean {
  return state.status === 'open' || state.status === 'opening'
}

export function isAnimating(state: PresenceState): boolean {
  return state.status === 'opening' || state.status === 'closing'
}

export interface PresenceParts<S> {
  root: {
    'data-scope': 'presence'
    'data-part': 'root'
    'data-state': (s: S) => PresenceStatus
    hidden: (s: S) => boolean
    onAnimationEnd: (e: AnimationEvent) => void
    onTransitionEnd: (e: TransitionEvent) => void
  }
}

export function connect<S>(
  get: (s: S) => PresenceState,
  send: Send<PresenceMsg>,
): PresenceParts<S> {
  const onEnd = (): void => send({ type: 'animationEnd' })
  return {
    root: {
      'data-scope': 'presence',
      'data-part': 'root',
      'data-state': (s) => get(s).status,
      hidden: (s) => (get(s).status === 'closed' && !get(s).unmountOnExit ? true : false),
      onAnimationEnd: onEnd,
      onTransitionEnd: onEnd,
    },
  }
}

export const presence = { init, update, connect, isMounted, isVisible, isAnimating }
