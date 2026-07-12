// ── Shared HTTP core ─────────────────────────────────────────────
//
// The request-building, response-parsing, and status→error mapping shared by the
// live `http` runner (fetch), the `upload` runner (XHR), and the SSR
// `resolveEffects` path, so all three derive identical requests and errors.

import type { ApiError, HttpEffect } from './types.js'

export function isPassThroughBody(
  body: unknown,
): body is FormData | Blob | URLSearchParams | ArrayBuffer {
  return (
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
    (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer)
  )
}

/**
 * Build the `RequestInit` (method + body + content-type headers) for an http
 * effect, WITHOUT a signal. Shared by the live `runHttp` and the SSR
 * `resolveEffects` so both derive identical requests. Callers add `signal`
 * (and any timeout) themselves.
 * @internal
 */
export function buildRequest(effect: HttpEffect): RequestInit {
  const opts: RequestInit = {}
  if (effect.method) opts.method = effect.method

  if (effect.body !== undefined) {
    if (isPassThroughBody(effect.body) || typeof effect.body === 'string') {
      opts.body = effect.body as BodyInit
    } else {
      opts.body = JSON.stringify(effect.body)
    }
  }

  // Build headers: start with user-provided, then add content-type logic
  const headers: Record<string, string> = { ...(effect.headers ?? {}) }
  if (effect.contentType) {
    headers['content-type'] = effect.contentType
  } else if (
    effect.body !== undefined &&
    !isPassThroughBody(effect.body) &&
    typeof effect.body !== 'string'
  ) {
    // Auto-set for JSON-serialized bodies, unless user already set it
    if (!headers['content-type'] && !headers['Content-Type']) {
      headers['content-type'] = 'application/json'
    }
  }
  if (Object.keys(headers).length > 0) opts.headers = headers
  return opts
}

/**
 * Parse a response body by explicit `responseType`, else auto-detect from the
 * `content-type` header. Shared by `runHttp` and `resolveEffects`.
 * @internal
 */
export async function parseResponse(
  res: Response,
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer',
): Promise<unknown> {
  if (responseType) {
    switch (responseType) {
      case 'json':
        return res.json()
      case 'text':
        return res.text()
      case 'blob':
        return res.blob()
      case 'arrayBuffer':
        return res.arrayBuffer()
    }
  }
  // Auto-detect from content-type
  const ct = res.headers.get('content-type') ?? ''
  return ct.includes('application/json') ? res.json() : res.text()
}

/**
 * Map an HTTP status to an {@link ApiError}, without needing a `Response` — shared
 * by the fetch (`http`) and XHR (`upload`) paths. For 400/422 a parsed JSON body
 * (if any) is inspected for a `{ errors }` validation map.
 */
export function statusToApiError(
  status: number,
  statusText: string,
  extra: { retryAfter?: string | null; jsonBody?: unknown } = {},
): ApiError {
  switch (status) {
    case 401:
      return { kind: 'unauthorized' }
    case 403:
      return { kind: 'forbidden' }
    case 404:
      return { kind: 'notfound' }
    case 429:
      return {
        kind: 'ratelimit',
        retryAfter: extra.retryAfter ? parseInt(extra.retryAfter, 10) : undefined,
      }
    case 400:
    case 422: {
      const body = extra.jsonBody
      if (body && typeof body === 'object' && 'errors' in body) {
        const errors = (body as { errors: Record<string, string[]> }).errors
        return { kind: 'validation', fields: errors }
      }
      return { kind: 'server', status, message: statusText }
    }
    default:
      return { kind: 'server', status, message: statusText }
  }
}

export async function httpStatusToApiError(res: Response): Promise<ApiError> {
  let jsonBody: unknown
  if (res.status === 400 || res.status === 422) {
    try {
      jsonBody = await res.json()
    } catch {
      /* no JSON body — fall through to a plain server error */
    }
  }
  return statusToApiError(res.status, res.statusText, {
    retryAfter: res.headers.get('retry-after'),
    jsonBody,
  })
}
