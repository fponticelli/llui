import type { Runner } from '../core.js'
import type { LogEffect } from '../types.js'

function runLog(effect: LogEffect): void {
  const fn = console[effect.level ?? 'log'] ?? console.log
  if (effect.data !== undefined) fn(effect.message, effect.data)
  else fn(effect.message)
}

export const logRunner: Runner = {
  types: ['log'],
  completesWithoutDispatch: true,
  run(effect) {
    runLog(effect as LogEffect)
  },
}
