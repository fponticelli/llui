import { describe, it, expect, expectTypeOf, vi } from 'vitest'
import { handleEffects, upload, type UploadEffect, type Effect, type ApiError } from '../src/index'

type Msg =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'done'; data: unknown; status: number }
  | { type: 'error'; error: ApiError }

describe('upload()', () => {
  const blob = new Blob(['hello'], { type: 'text/plain' })

  const opts = {
    url: '/api/upload',
    body: blob,
    onProgress: (loaded: number, total: number): Msg => ({ type: 'progress', loaded, total }),
    onSuccess: (data: unknown, status: number): Msg => ({ type: 'done', data, status }),
    onError: (error: ApiError): Msg => ({ type: 'error', error }),
  }

  it('returns correct effect shape', () => {
    const effect = upload(opts)

    expect(effect.type).toBe('upload')
    expect(effect.url).toBe('/api/upload')
    expect(effect.body).toBe(blob)
    expect(effect.method).toBeUndefined()
    expect(effect.headers).toBeUndefined()
  })

  it('includes optional method and headers', () => {
    const effect = upload({
      ...opts,
      method: 'PUT',
      headers: { Authorization: 'Bearer tok' },
    })

    expect(effect.method).toBe('PUT')
    expect(effect.headers).toEqual({ Authorization: 'Bearer tok' })
  })

  it('onProgress callback returns correct message', () => {
    const effect = upload(opts)
    const msg = effect.onProgress(500, 1000)

    expect(msg).toEqual({ type: 'progress', loaded: 500, total: 1000 })
  })

  it('onSuccess callback returns correct message', () => {
    const effect = upload(opts)
    const msg = effect.onSuccess({ id: 42 }, 201)

    expect(msg).toEqual({ type: 'done', data: { id: 42 }, status: 201 })
  })

  it('onError callback returns correct message', () => {
    const effect = upload(opts)
    const msg = effect.onError({ kind: 'network', message: 'Upload failed' })

    expect(msg).toEqual({ type: 'error', error: { kind: 'network', message: 'Upload failed' } })
  })

  it('accepts FormData as body', () => {
    const formData = new FormData()
    formData.append('file', blob, 'test.txt')

    const effect = upload({ ...opts, body: formData })
    expect(effect.body).toBe(formData)
  })

  it('UploadEffect is part of the Effect union', () => {
    const effect = upload(opts)
    expectTypeOf(effect).toMatchTypeOf<Effect>()
    expectTypeOf<UploadEffect<Msg>>().toMatchTypeOf<Effect>()
  })

  it('includes optional timeout', () => {
    const effect = upload({ ...opts, timeout: 5000 })
    expect(effect.timeout).toBe(5000)
  })
})

// A minimal XMLHttpRequest stand-in that lets a test drive load/timeout callbacks.
class FakeXHR {
  static last: FakeXHR | null = null
  status = 0
  statusText = ''
  responseText = ''
  timeout = 0
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  private headers: Record<string, string> = {}
  constructor() {
    FakeXHR.last = this
  }
  open(): void {}
  setRequestHeader(): void {}
  getResponseHeader(name: string): string | null {
    return this.headers[name.toLowerCase()] ?? null
  }
  send(): void {}
  abort(): void {}
  respond(status: number, statusText: string, body: string): void {
    this.status = status
    this.statusText = statusText
    this.responseText = body
    this.onload?.()
  }
}

describe('runUpload error contract', () => {
  const blob = new Blob(['x'], { type: 'text/plain' })
  const makeEffect = (onError: (e: ApiError) => Msg): UploadEffect<Msg> =>
    upload<Msg>({
      url: '/api/upload',
      body: blob,
      onProgress: (loaded, total) => ({ type: 'progress', loaded, total }),
      onSuccess: (data, status) => ({ type: 'done', data, status }),
      onError,
    })

  it('routes a non-2xx status through httpStatusToApiError → onError', () => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest)
    const send = vi.fn()
    const handler = handleEffects<Effect>().else(() => {})
    handler({
      effect: makeEffect((e) => ({ type: 'error', error: e })) as Effect,
      send,
      signal: new AbortController().signal,
    })

    FakeXHR.last!.respond(404, 'Not Found', '')
    expect(send).toHaveBeenCalledWith({ type: 'error', error: { kind: 'notfound' } })

    vi.unstubAllGlobals()
  })

  it('maps a 422 validation body through onError', () => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest)
    const send = vi.fn()
    const handler = handleEffects<Effect>().else(() => {})
    handler({
      effect: makeEffect((e) => ({ type: 'error', error: e })) as Effect,
      send,
      signal: new AbortController().signal,
    })

    FakeXHR.last!.respond(422, 'Unprocessable', JSON.stringify({ errors: { file: ['too big'] } }))
    expect(send).toHaveBeenCalledWith({
      type: 'error',
      error: { kind: 'validation', fields: { file: ['too big'] } },
    })

    vi.unstubAllGlobals()
  })

  it('wires effect.timeout onto xhr.timeout', () => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest)
    const send = vi.fn()
    const handler = handleEffects<Effect>().else(() => {})
    handler({
      effect: { ...makeEffect((e) => ({ type: 'error', error: e })), timeout: 3000 } as Effect,
      send,
      signal: new AbortController().signal,
    })

    expect(FakeXHR.last!.timeout).toBe(3000)
    // the (previously dead) ontimeout handler now fires a timeout ApiError
    FakeXHR.last!.ontimeout?.()
    expect(send).toHaveBeenCalledWith({ type: 'error', error: { kind: 'timeout' } })

    vi.unstubAllGlobals()
  })

  it('still delivers a 2xx body to onSuccess', () => {
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest)
    const send = vi.fn()
    const handler = handleEffects<Effect>().else(() => {})
    handler({
      effect: makeEffect((e) => ({ type: 'error', error: e })) as Effect,
      send,
      signal: new AbortController().signal,
    })

    FakeXHR.last!.respond(201, 'Created', JSON.stringify({ id: 7 }))
    expect(send).toHaveBeenCalledWith({ type: 'done', data: { id: 7 }, status: 201 })

    vi.unstubAllGlobals()
  })
})
