import type { Send, Signal } from '@llui/dom'
import { presenceEndProps } from '../utils/presence-end.js'

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
  /** @intent("Begin opening the element (closed → opening, plays enter animation)") */
  | { type: 'open' }
  /** @intent("Begin closing the element (open → closing, plays exit animation)") */
  | { type: 'close' }
  /** @intent("Toggle between open and closed states") */
  | { type: 'toggle' }
  /** @humanOnly */
  | { type: 'animationEnd' }
  /** @intent("Set the desired presence directly (true = open, false = closed)") */
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

/**
 * The presence slice an OVERLAY carries alongside its own state: the logical
 * `open` flag plus the animation phase layered over it.
 *
 * Dialog, drawer, popover, hover-card and tooltip each had a byte-identical
 * private copy of the three transitions below (#126). The machines agreed —
 * their HANDLERS did not — but five copies is five chances to drift, so the
 * transitions live here and every overlay reduces through them.
 */
export interface PresenceOverlay {
  open: boolean
  /** Optional because a partial `{ open }` bridge slice may omit it; an absent
   * status is neither opening nor closing, so it only ever gets WRITTEN. */
  status?: PresenceStatus
}

/**
 * Move toward open. `skipAnimations` lands on 'open' immediately; otherwise the
 * overlay sits in 'opening' until an end event calls {@link presenceEnd}.
 * Already-open state comes back by REFERENCE so a redundant open is a no-op for
 * the reference-equality reconciler.
 */
export function presenceOpen<S extends PresenceOverlay>(state: S, skipAnimations: boolean): S {
  if (state.open && (state.status === 'open' || state.status === 'opening')) return state
  return { ...state, open: true, status: skipAnimations ? 'open' : 'opening' }
}

/** Move toward closed — the mirror of {@link presenceOpen}. */
export function presenceClose<S extends PresenceOverlay>(state: S, skipAnimations: boolean): S {
  if (!state.open && (state.status === 'closed' || state.status === 'closing')) return state
  return { ...state, open: false, status: skipAnimations ? 'closed' : 'closing' }
}

/**
 * Advance past the enter/exit animation. Only 'opening'/'closing' move; any
 * other status is returned unchanged, so a stray end event cannot reopen or
 * unmount anything.
 *
 * SEMANTIC ADDITION over the four private copies this collapsed (#126): the
 * closing->closed transition also writes `open: false`. It is unreachable
 * today — `'closing'` is only ever written together with `open: false`, by
 * `presenceClose` — so it changes no behaviour, and it is kept because
 * "finished closing" implying "not open" is the invariant a caller reducing
 * through this function is entitled to, and a future writer of `'closing'`
 * should not be able to leave the pair inconsistent.
 */
export function presenceEnd<S extends PresenceOverlay>(state: S): S {
  if (state.status === 'opening') return { ...state, status: 'open' }
  if (state.status === 'closing') return { ...state, status: 'closed', open: false }
  return state
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

export interface PresenceParts {
  root: {
    'data-scope': 'presence'
    'data-part': 'root'
    'data-state': Signal<PresenceStatus>
    hidden: Signal<boolean>
    onAnimationEnd: (e: AnimationEvent) => void
    onTransitionEnd: (e: TransitionEvent) => void
  }
}

/** Signal-surface connect: takes the component's `presence` state slice as a
 * Signal and returns reactive (handle-based) props for spreading into a view. */
export function connect(state: Signal<PresenceState>, send: Send<PresenceMsg>): PresenceParts {
  return {
    root: {
      'data-scope': 'presence',
      'data-part': 'root',
      'data-state': state.map((s) => s.status),
      hidden: state.map((s) => s.status === 'closed' && !s.unmountOnExit),
      ...presenceEndProps(send, { type: 'animationEnd' }),
    },
  }
}

export const presence = { init, update, connect, isMounted, isVisible, isAnimating }
