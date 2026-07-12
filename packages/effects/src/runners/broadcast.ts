import type { InternalSend, Runner } from '../core.js'
import type { BroadcastEffect, BroadcastListenEffect } from '../types.js'

function runBroadcast(effect: BroadcastEffect): void {
  if (typeof BroadcastChannel === 'undefined') return
  const bc = new BroadcastChannel(effect.channel)
  try {
    bc.postMessage(effect.data)
  } finally {
    bc.close()
  }
}

function runBroadcastListen(
  effect: BroadcastListenEffect,
  send: InternalSend,
  signal: AbortSignal,
): void {
  if (typeof BroadcastChannel === 'undefined') return
  const bc = new BroadcastChannel(effect.channel)
  bc.addEventListener('message', (e: MessageEvent) => {
    send(effect.onMessage(e.data))
  })
  signal.addEventListener(
    'abort',
    () => {
      bc.close()
    },
    { once: true },
  )
}

export const broadcastRunner: Runner = {
  types: ['broadcast'],
  completesWithoutDispatch: true,
  run(effect) {
    runBroadcast(effect as BroadcastEffect)
  },
}

export const broadcastListenRunner: Runner = {
  types: ['broadcast-listen'],
  completesWithoutDispatch: false,
  run(effect, send, signal) {
    runBroadcastListen(effect as BroadcastListenEffect, send, signal)
  },
}
