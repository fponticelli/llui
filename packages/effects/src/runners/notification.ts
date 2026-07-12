import type { InternalSend, Runner } from '../core.js'
import type { NotificationEffect } from '../types.js'

function runNotification(
  effect: NotificationEffect,
  send: InternalSend,
  signal: AbortSignal,
): void {
  if (typeof Notification === 'undefined') {
    if (effect.onError) send(effect.onError())
    return
  }

  const show = (): void => {
    if (signal.aborted) return
    const n = new Notification(effect.title, {
      body: effect.body,
      icon: effect.icon,
      tag: effect.tag,
    })
    if (effect.onClick) {
      const cb = effect.onClick
      n.onclick = () => {
        if (!signal.aborted) send(cb())
      }
    }
    if (effect.onClose) {
      const cb = effect.onClose
      n.onclose = () => {
        if (!signal.aborted) send(cb())
      }
    }
    if (effect.onError) {
      const cb = effect.onError
      n.onerror = () => {
        if (!signal.aborted) send(cb())
      }
    }
  }

  if (Notification.permission === 'granted') {
    show()
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((perm) => {
      if (perm === 'granted') {
        show()
      } else if (effect.onError) {
        if (!signal.aborted) send(effect.onError())
      }
    })
  } else if (effect.onError) {
    send(effect.onError())
  }
}

export const notificationRunner: Runner = {
  types: ['notification'],
  completesWithoutDispatch: false,
  run(effect, send, signal) {
    runNotification(effect as NotificationEffect, send, signal)
  },
}
