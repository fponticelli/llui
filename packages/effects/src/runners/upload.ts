import type { InternalSend, Runner } from '../core.js'
import type { UploadEffect } from '../types.js'
import { statusToApiError } from '../http-core.js'

function runUpload(effect: UploadEffect, send: InternalSend, signal: AbortSignal): void {
  if (typeof XMLHttpRequest === 'undefined') return

  const xhr = new XMLHttpRequest()
  const method = effect.method ?? 'POST'

  xhr.open(method, effect.url)
  if (effect.timeout) xhr.timeout = effect.timeout

  if (effect.headers) {
    for (const [key, value] of Object.entries(effect.headers)) {
      xhr.setRequestHeader(key, value)
    }
  }

  xhr.upload.onprogress = (e: ProgressEvent) => {
    if (signal.aborted) return
    send(effect.onProgress(e.loaded, e.total))
  }

  xhr.onload = () => {
    if (signal.aborted) return
    let data: unknown
    try {
      data = JSON.parse(xhr.responseText)
    } catch {
      data = xhr.responseText
    }
    // Match the http() contract: only 2xx is success; non-2xx maps through the
    // same status→ApiError table and routes to onError.
    if (xhr.status >= 200 && xhr.status < 300) {
      send(effect.onSuccess(data, xhr.status))
    } else {
      send(
        effect.onError(
          statusToApiError(xhr.status, xhr.statusText, {
            retryAfter: xhr.getResponseHeader('retry-after'),
            jsonBody: data,
          }),
        ),
      )
    }
  }

  xhr.onerror = () => {
    if (signal.aborted) return
    send(effect.onError({ kind: 'network', message: 'Upload failed' }))
  }

  xhr.ontimeout = () => {
    if (signal.aborted) return
    send(effect.onError({ kind: 'timeout' }))
  }

  signal.addEventListener('abort', () => xhr.abort(), { once: true })

  xhr.send(effect.body)
}

export const uploadRunner: Runner = {
  types: ['upload'],
  completesWithoutDispatch: false,
  run(effect, send, signal) {
    runUpload(effect as UploadEffect, send, signal)
  },
}
