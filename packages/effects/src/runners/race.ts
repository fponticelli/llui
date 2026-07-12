import type { Deps, InternalSend, Runner } from '../core.js'
import type { RaceEffect } from '../types.js'

function runRace(effect: RaceEffect, send: InternalSend, signal: AbortSignal, deps: Deps): void {
  const ctrl = new AbortController()
  const onAbort = (): void => ctrl.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  let settled = false

  const raceSend: InternalSend = (msg) => {
    if (settled) return
    settled = true
    signal.removeEventListener('abort', onAbort) // settled — drop the parent listener
    ctrl.abort()
    send(msg)
  }

  for (const inner of effect.effects) {
    deps.dispatch(inner, raceSend, ctrl.signal, deps)
  }
}

export const raceRunner: Runner = {
  types: ['race'],
  completesWithoutDispatch: false,
  run(effect, send, signal, deps) {
    runRace(effect as RaceEffect, send, signal, deps)
  },
}
