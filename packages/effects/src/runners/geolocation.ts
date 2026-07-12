import type { InternalSend, Runner } from '../core.js'
import type { GeolocationEffect } from '../types.js'

function runGeolocation(effect: GeolocationEffect, send: InternalSend, signal: AbortSignal): void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    send(effect.onError('Geolocation API not available'))
    return
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (!signal.aborted) {
        send(
          effect.onSuccess({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          }),
        )
      }
    },
    (err) => {
      if (!signal.aborted) send(effect.onError(err.message))
    },
    { enableHighAccuracy: effect.enableHighAccuracy },
  )
}

export const geolocationRunner: Runner = {
  types: ['geolocation'],
  completesWithoutDispatch: false,
  run(effect, send, signal) {
    runGeolocation(effect as GeolocationEffect, send, signal)
  },
}
