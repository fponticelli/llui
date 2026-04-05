import type { Send } from '@llui/dom'

/**
 * Timer — counts elapsed time up from zero, or down from a configured
 * target. The machine is pure: it doesn't own the ticking interval.
 * The consumer runs `setInterval(() => send({type:'tick', now: Date.now()}), 100)`
 * (or whatever granularity) while the timer is running, and dispatches
 * `start` / `pause` / `reset` in response to user input.
 *
 * Typical display:
 *
 *   const t = timer.connect<State>(s => s.timer, msg => send({type: 'timer', msg}))
 *   div({ ...t.root }, [
 *     div({ ...t.display }, [text(s => timer.formatMs(timer.display(s.timer), 'mm:ss'))]),
 *     button({ ...t.startTrigger }, [text('Start')]),
 *     button({ ...t.pauseTrigger }, [text('Pause')]),
 *     button({ ...t.resetTrigger }, [text('Reset')]),
 *   ])
 */

export type Direction = 'up' | 'down'

export interface TimerState {
  running: boolean
  direction: Direction
  /** Target in milliseconds for countdown (0 = no target, runs indefinitely). */
  targetMs: number
  /** Accumulated elapsed time, excluding the current running interval. */
  elapsedMs: number
  /** Timestamp when the current running interval started (null when paused). */
  startedAt: number | null
}

export type TimerMsg =
  | { type: 'start'; now: number }
  | { type: 'pause'; now: number }
  | { type: 'reset' }
  | { type: 'tick'; now: number }
  | { type: 'setTarget'; targetMs: number }

export interface TimerInit {
  direction?: Direction
  targetMs?: number
  elapsedMs?: number
}

export function init(opts: TimerInit = {}): TimerState {
  return {
    running: false,
    direction: opts.direction ?? 'up',
    targetMs: opts.targetMs ?? 0,
    elapsedMs: opts.elapsedMs ?? 0,
    startedAt: null,
  }
}

export function update(state: TimerState, msg: TimerMsg): [TimerState, never[]] {
  switch (msg.type) {
    case 'start':
      if (state.running) return [state, []]
      return [{ ...state, running: true, startedAt: msg.now }, []]
    case 'pause': {
      if (!state.running || state.startedAt === null) return [state, []]
      const elapsed = state.elapsedMs + (msg.now - state.startedAt)
      return [{ ...state, running: false, elapsedMs: elapsed, startedAt: null }, []]
    }
    case 'reset':
      return [{ ...state, running: false, elapsedMs: 0, startedAt: null }, []]
    case 'tick': {
      if (!state.running || state.startedAt === null) return [state, []]
      const elapsed = state.elapsedMs + (msg.now - state.startedAt)
      // Countdown: auto-stop at target.
      if (state.direction === 'down' && state.targetMs > 0 && elapsed >= state.targetMs) {
        return [{ ...state, running: false, elapsedMs: state.targetMs, startedAt: null }, []]
      }
      return [{ ...state, elapsedMs: elapsed, startedAt: msg.now }, []]
    }
    case 'setTarget':
      return [{ ...state, targetMs: msg.targetMs }, []]
  }
}

/** Returns the display value in ms (elapsed for count-up, remaining for count-down). */
export function display(state: TimerState): number {
  if (state.direction === 'up') return state.elapsedMs
  return Math.max(0, state.targetMs - state.elapsedMs)
}

export function isComplete(state: TimerState): boolean {
  return state.direction === 'down' && state.targetMs > 0 && state.elapsedMs >= state.targetMs
}

/** Breaks a ms value into `{ hours, minutes, seconds, ms }` parts for rendering. */
export function parts(ms: number): { hours: number; minutes: number; seconds: number; ms: number } {
  const total = Math.max(0, Math.floor(ms))
  const hours = Math.floor(total / 3_600_000)
  const minutes = Math.floor((total % 3_600_000) / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000)
  const rem = total % 1000
  return { hours, minutes, seconds, ms: rem }
}

const pad = (n: number, width: number): string => String(n).padStart(width, '0')

/**
 * Format a ms value using a simple template. Supported tokens:
 *   HH / H  — hours (2-digit / unpadded)
 *   mm / m  — minutes
 *   ss / s  — seconds
 *   SSS / S — milliseconds (3-digit / unpadded)
 *
 * Example: formatMs(125_500, 'mm:ss.SSS') → "02:05.500"
 */
export function formatMs(ms: number, template: string): string {
  const p = parts(ms)
  return template
    .replace(/HH/g, pad(p.hours, 2))
    .replace(/H/g, String(p.hours))
    .replace(/mm/g, pad(p.minutes, 2))
    .replace(/m/g, String(p.minutes))
    .replace(/ss/g, pad(p.seconds, 2))
    .replace(/s/g, String(p.seconds))
    .replace(/SSS/g, pad(p.ms, 3))
    .replace(/S/g, String(p.ms))
}

export interface TimerParts<S> {
  root: {
    'data-scope': 'timer'
    'data-part': 'root'
    'data-running': (s: S) => '' | undefined
    'data-direction': (s: S) => Direction
  }
  display: {
    role: 'timer'
    'aria-live': 'off' | 'polite'
    'data-scope': 'timer'
    'data-part': 'display'
  }
  startTrigger: {
    type: 'button'
    'aria-label': string
    'data-scope': 'timer'
    'data-part': 'start-trigger'
    disabled: (s: S) => boolean
    onClick: (e: MouseEvent) => void
  }
  pauseTrigger: {
    type: 'button'
    'aria-label': string
    'data-scope': 'timer'
    'data-part': 'pause-trigger'
    disabled: (s: S) => boolean
    onClick: (e: MouseEvent) => void
  }
  resetTrigger: {
    type: 'button'
    'aria-label': string
    'data-scope': 'timer'
    'data-part': 'reset-trigger'
    onClick: (e: MouseEvent) => void
  }
}

export interface ConnectOptions {
  startLabel?: string
  pauseLabel?: string
  resetLabel?: string
  /**
   * aria-live politeness for the display element. `'polite'` announces
   * updates to assistive tech; `'off'` (default) keeps it silent — use
   * 'polite' sparingly to avoid spamming screen reader users with
   * every tick.
   */
  ariaLive?: 'off' | 'polite'
}

export function connect<S>(
  get: (s: S) => TimerState,
  send: Send<TimerMsg>,
  opts: ConnectOptions = {},
): TimerParts<S> {
  return {
    root: {
      'data-scope': 'timer',
      'data-part': 'root',
      'data-running': (s) => (get(s).running ? '' : undefined),
      'data-direction': (s) => get(s).direction,
    },
    display: {
      role: 'timer',
      'aria-live': opts.ariaLive ?? 'off',
      'data-scope': 'timer',
      'data-part': 'display',
    },
    startTrigger: {
      type: 'button',
      'aria-label': opts.startLabel ?? 'Start timer',
      'data-scope': 'timer',
      'data-part': 'start-trigger',
      disabled: (s) => get(s).running,
      onClick: () => send({ type: 'start', now: Date.now() }),
    },
    pauseTrigger: {
      type: 'button',
      'aria-label': opts.pauseLabel ?? 'Pause timer',
      'data-scope': 'timer',
      'data-part': 'pause-trigger',
      disabled: (s) => !get(s).running,
      onClick: () => send({ type: 'pause', now: Date.now() }),
    },
    resetTrigger: {
      type: 'button',
      'aria-label': opts.resetLabel ?? 'Reset timer',
      'data-scope': 'timer',
      'data-part': 'reset-trigger',
      onClick: () => send({ type: 'reset' }),
    },
  }
}

export const timer = { init, update, connect, display, isComplete, parts, formatMs }
