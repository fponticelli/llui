import type { InternalSend, Runner } from '../core.js'
import type { ClipboardReadEffect, ClipboardWriteEffect } from '../types.js'

function runClipboardRead(
  effect: ClipboardReadEffect,
  send: InternalSend,
  signal: AbortSignal,
): void {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    send(effect.onError('Clipboard API not available'))
    return
  }
  navigator.clipboard
    .readText()
    .then((text) => {
      if (!signal.aborted) send(effect.onSuccess(text))
    })
    .catch((err: unknown) => {
      if (!signal.aborted) send(effect.onError(err instanceof Error ? err.message : String(err)))
    })
}

function runClipboardWrite(effect: ClipboardWriteEffect): void {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  navigator.clipboard.writeText(effect.text).catch(() => {
    // fire-and-forget
  })
}

export const clipboardReadRunner: Runner = {
  types: ['clipboard-read'],
  completesWithoutDispatch: false,
  run(effect, send, signal) {
    runClipboardRead(effect as ClipboardReadEffect, send, signal)
  },
}

export const clipboardWriteRunner: Runner = {
  types: ['clipboard-write'],
  completesWithoutDispatch: true,
  run(effect) {
    runClipboardWrite(effect as ClipboardWriteEffect)
  },
}
