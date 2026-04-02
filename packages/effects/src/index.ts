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
  inner: BuiltinEffect
}

export interface DebounceEffect {
  type: 'debounce'
  key: string
  ms: number
  inner: BuiltinEffect
}

export interface SequenceEffect {
  type: 'sequence'
  effects: BuiltinEffect[]
}

export interface RaceEffect {
  type: 'race'
  effects: BuiltinEffect[]
}

type BuiltinEffect =
  | HttpEffect
  | CancelEffect
  | CancelReplaceEffect
  | DebounceEffect
  | SequenceEffect
  | RaceEffect

// Re-export for user convenience
export type { BuiltinEffect as Effect }

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
export function cancel(token: string, inner: BuiltinEffect): CancelReplaceEffect
export function cancel(
  token: string,
  inner?: BuiltinEffect,
): CancelEffect | CancelReplaceEffect {
  if (inner) return { type: 'cancel', token, inner }
  return { type: 'cancel', token }
}

export function debounce(key: string, ms: number, inner: BuiltinEffect): DebounceEffect {
  return { type: 'debounce', key, ms, inner }
}

export function sequence(effects: BuiltinEffect[]): SequenceEffect {
  return { type: 'sequence', effects }
}

export function race(effects: BuiltinEffect[]): RaceEffect {
  return { type: 'race', effects }
}

// ── Handler Chain ─────────────────────────────────────────────────

type Send = (msg: Record<string, unknown>) => void
type CustomHandler = (effect: { type: string }, send: Send, signal: AbortSignal) => void

export function handleEffects<E extends { type: string }>(): {
  else(
    handler: (effect: E, send: Send, signal: AbortSignal) => void,
  ): (effect: E, send: Send, signal: AbortSignal) => void
} {
  const cancelControllers = new Map<string, AbortController>()
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let cleanupRegistered = false

  return {
    else(handler) {
      const custom: CustomHandler = handler as CustomHandler
      return (effect, send, signal) => {
        if (!cleanupRegistered) {
          signal.addEventListener(
            'abort',
            () => {
              for (const ctrl of cancelControllers.values()) ctrl.abort()
              cancelControllers.clear()
              for (const timer of debounceTimers.values()) clearTimeout(timer)
              debounceTimers.clear()
            },
            { once: true },
          )
          cleanupRegistered = true
        }
        dispatchEffect(effect, send, signal, cancelControllers, debounceTimers, custom)
      }
    },
  }
}

function dispatchEffect(
  effect: { type: string },
  send: Send,
  signal: AbortSignal,
  cancelControllers: Map<string, AbortController>,
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>,
  custom: CustomHandler,
): void {
  switch (effect.type) {
    case 'http':
      runHttp(effect as HttpEffect, send, signal)
      break
    case 'cancel':
      runCancel(effect as CancelEffect | CancelReplaceEffect, send, signal, cancelControllers, debounceTimers, custom)
      break
    case 'debounce':
      runDebounce(effect as DebounceEffect, send, signal, cancelControllers, debounceTimers, custom)
      break
    case 'sequence':
      runSequence(effect as SequenceEffect, send, signal, cancelControllers, debounceTimers, custom)
      break
    case 'race':
      runRace(effect as RaceEffect, send, signal, cancelControllers, debounceTimers, custom)
      break
    default:
      custom(effect, send, signal)
  }
}

function runHttp(effect: HttpEffect, send: Send, signal: AbortSignal): void {
  const opts: RequestInit = { signal }
  if (effect.method) opts.method = effect.method
  if (effect.body) opts.body = JSON.stringify(effect.body)
  if (effect.headers) opts.headers = effect.headers

  fetch(effect.url, opts)
    .then((res) => res.json())
    .then((data: unknown) => {
      if (!signal.aborted) {
        send({ type: effect.onSuccess, payload: data })
      }
    })
    .catch((err: unknown) => {
      if (signal.aborted) return
      if (err instanceof DOMException && err.name === 'AbortError') return
      send({ type: effect.onError, error: err })
    })
}

function runCancel(
  effect: CancelEffect | CancelReplaceEffect,
  send: Send,
  componentSignal: AbortSignal,
  cancelControllers: Map<string, AbortController>,
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>,
  custom: CustomHandler,
): void {
  const existing = cancelControllers.get(effect.token)
  if (existing) {
    existing.abort()
    cancelControllers.delete(effect.token)
  }

  const timer = debounceTimers.get(effect.token)
  if (timer !== undefined) {
    clearTimeout(timer)
    debounceTimers.delete(effect.token)
  }

  if ('inner' in effect && effect.inner) {
    const ctrl = new AbortController()
    cancelControllers.set(effect.token, ctrl)
    componentSignal.addEventListener('abort', () => ctrl.abort(), { once: true })
    dispatchEffect(effect.inner, send, ctrl.signal, cancelControllers, debounceTimers, custom)
  }
}

function runDebounce(
  effect: DebounceEffect,
  send: Send,
  componentSignal: AbortSignal,
  cancelControllers: Map<string, AbortController>,
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>,
  custom: CustomHandler,
): void {
  const existing = debounceTimers.get(effect.key)
  if (existing !== undefined) clearTimeout(existing)

  const timer = setTimeout(() => {
    debounceTimers.delete(effect.key)
    if (!componentSignal.aborted) {
      dispatchEffect(effect.inner, send, componentSignal, cancelControllers, debounceTimers, custom)
    }
  }, effect.ms)

  debounceTimers.set(effect.key, timer)
}

function runSequence(
  effect: SequenceEffect,
  send: Send,
  signal: AbortSignal,
  cancelControllers: Map<string, AbortController>,
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>,
  custom: CustomHandler,
): void {
  const effects = effect.effects.slice()

  function next(): void {
    if (signal.aborted || effects.length === 0) return
    const current = effects.shift()!

    // Wrap send to detect when this effect completes (delivers a message)
    const wrappedSend: Send = (msg) => {
      send(msg)
      // After delivering, start the next effect
      next()
    }

    dispatchEffect(current, wrappedSend, signal, cancelControllers, debounceTimers, custom)
  }

  next()
}

function runRace(
  effect: RaceEffect,
  send: Send,
  signal: AbortSignal,
  cancelControllers: Map<string, AbortController>,
  debounceTimers: Map<string, ReturnType<typeof setTimeout>>,
  custom: CustomHandler,
): void {
  const ctrl = new AbortController()
  signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  let settled = false

  const raceSend: Send = (msg) => {
    if (settled) return
    settled = true
    ctrl.abort() // cancel all other racers
    send(msg)
  }

  for (const inner of effect.effects) {
    dispatchEffect(inner, raceSend, ctrl.signal, cancelControllers, debounceTimers, custom)
  }
}
