// ── Effect Types ──────────────────────────────────────────────────

export interface HttpEffect {
  type: 'http'
  url: string
  method?: string
  body?: unknown
  headers?: Record<string, string>
  onSuccess: string
  onError: string
}

export interface CancelEffect {
  type: 'cancel'
  token: string
}

export interface CancelReplaceEffect {
  type: 'cancel'
  token: string
  inner: Effect
}

export interface DebounceEffect {
  type: 'debounce'
  key: string
  ms: number
  inner: Effect
}

export interface SequenceEffect {
  type: 'sequence'
  effects: Effect[]
}

export interface RaceEffect {
  type: 'race'
  effects: Effect[]
}

export type Effect =
  | HttpEffect
  | CancelEffect
  | CancelReplaceEffect
  | DebounceEffect
  | SequenceEffect
  | RaceEffect

// ── Builders ──────────────────────────────────────────────────────

export function http(opts: {
  url: string
  method?: string
  body?: unknown
  headers?: Record<string, string>
  onSuccess: string
  onError: string
}): HttpEffect {
  return { type: 'http', ...opts }
}

export function cancel(token: string): CancelEffect
export function cancel(token: string, inner: Effect): CancelReplaceEffect
export function cancel(token: string, inner?: Effect): CancelEffect | CancelReplaceEffect {
  if (inner) return { type: 'cancel', token, inner }
  return { type: 'cancel', token }
}

export function debounce(key: string, ms: number, inner: Effect): DebounceEffect {
  return { type: 'debounce', key, ms, inner }
}

export function sequence(effects: Effect[]): SequenceEffect {
  return { type: 'sequence', effects }
}

export function race(effects: Effect[]): RaceEffect {
  return { type: 'race', effects }
}

// ── Handler Chain ─────────────────────────────────────────────────

type Send<M> = (msg: M) => void

export function handleEffects<E extends { type: string }>(): {
  else<M>(
    handler: (effect: E, send: Send<M>, signal: AbortSignal) => void,
  ): (effect: E, send: Send<M>, signal: AbortSignal) => void
} {
  return {
    else(handler) {
      return (effect, send, signal) => {
        // TODO: implement built-in effect consumption (http, cancel, debounce, etc.)
        handler(effect, send, signal)
      }
    },
  }
}
