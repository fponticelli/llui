import type { Send } from '@llui/dom'

/**
 * Marquee — continuously-scrolling content. The state machine tracks
 * play/pause + direction + speed; the scrolling itself is driven by CSS
 * animations or JS requestAnimationFrame (the consumer owns that).
 *
 * Expose the active state via CSS custom properties the consumer reads
 * in their stylesheet:
 *   --marquee-duration: {N}s
 *   --marquee-direction: 'normal' | 'reverse'
 *   --marquee-playstate: 'running' | 'paused'
 */

export type MarqueeDirection = 'left' | 'right' | 'up' | 'down'

export interface MarqueeState {
  /** User-intended running state (what play/pause/toggle set). The actual
   *  effective state is derived via `isRunning()` — it combines this with
   *  `hovered` + `pauseOnHover`. */
  running: boolean
  direction: MarqueeDirection
  /** Duration of one full loop in seconds. Larger = slower. */
  durationSec: number
  pauseOnHover: boolean
  hovered: boolean
  disabled: boolean
}

export type MarqueeMsg =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle' }
  | { type: 'hoverPause' }
  | { type: 'hoverResume' }
  | { type: 'setDirection'; direction: MarqueeDirection }
  | { type: 'setDuration'; durationSec: number }

export interface MarqueeInit {
  running?: boolean
  direction?: MarqueeDirection
  durationSec?: number
  pauseOnHover?: boolean
  disabled?: boolean
}

export function init(opts: MarqueeInit = {}): MarqueeState {
  return {
    running: opts.running ?? true,
    direction: opts.direction ?? 'left',
    durationSec: opts.durationSec ?? 20,
    pauseOnHover: opts.pauseOnHover ?? false,
    hovered: false,
    disabled: opts.disabled ?? false,
  }
}

/** Derived: whether the marquee is currently animating. */
export function isRunning(state: MarqueeState): boolean {
  if (!state.running || state.disabled) return false
  if (state.pauseOnHover && state.hovered) return false
  return true
}

export function update(state: MarqueeState, msg: MarqueeMsg): [MarqueeState, never[]] {
  if (state.disabled) return [state, []]
  switch (msg.type) {
    case 'play':
      return [{ ...state, running: true }, []]
    case 'pause':
      return [{ ...state, running: false }, []]
    case 'toggle':
      return [{ ...state, running: !state.running }, []]
    case 'hoverPause':
      return [{ ...state, hovered: true }, []]
    case 'hoverResume':
      return [{ ...state, hovered: false }, []]
    case 'setDirection':
      return [{ ...state, direction: msg.direction }, []]
    case 'setDuration':
      return [{ ...state, durationSec: Math.max(0, msg.durationSec) }, []]
  }
}

/** Returns 'normal' (left/up) or 'reverse' (right/down) for CSS animation-direction. */
export function cssAnimationDirection(direction: MarqueeDirection): 'normal' | 'reverse' {
  return direction === 'right' || direction === 'down' ? 'reverse' : 'normal'
}

/** Returns 'horizontal' or 'vertical' based on direction. */
export function axis(direction: MarqueeDirection): 'horizontal' | 'vertical' {
  return direction === 'up' || direction === 'down' ? 'vertical' : 'horizontal'
}

export interface MarqueeParts<S> {
  root: {
    'data-scope': 'marquee'
    'data-part': 'root'
    'data-running': (s: S) => '' | undefined
    'data-direction': (s: S) => MarqueeDirection
    'data-axis': (s: S) => 'horizontal' | 'vertical'
    'data-disabled': (s: S) => '' | undefined
    style: (s: S) => string
    onMouseEnter: (e: MouseEvent) => void
    onMouseLeave: (e: MouseEvent) => void
  }
  content: {
    'data-scope': 'marquee'
    'data-part': 'content'
  }
}

export function connect<S>(get: (s: S) => MarqueeState, send: Send<MarqueeMsg>): MarqueeParts<S> {
  return {
    root: {
      'data-scope': 'marquee',
      'data-part': 'root',
      'data-running': (s) => (isRunning(get(s)) ? '' : undefined),
      'data-direction': (s) => get(s).direction,
      'data-axis': (s) => axis(get(s).direction),
      'data-disabled': (s) => (get(s).disabled ? '' : undefined),
      style: (s) => {
        const st = get(s)
        return (
          `--marquee-duration:${st.durationSec}s;` +
          `--marquee-direction:${cssAnimationDirection(st.direction)};` +
          `--marquee-playstate:${isRunning(st) ? 'running' : 'paused'};`
        )
      },
      // Always fire hover messages; the reducer no-ops unless
      // state.pauseOnHover is true.
      onMouseEnter: () => send({ type: 'hoverPause' }),
      onMouseLeave: () => send({ type: 'hoverResume' }),
    },
    content: {
      'data-scope': 'marquee',
      'data-part': 'content',
    },
  }
}

export const marquee = { init, update, connect, isRunning, cssAnimationDirection, axis }
