import { describe, it, expect, expectTypeOf } from 'vitest'
import { upload, type UploadEffect, type Effect, type ApiError } from '../src/index'

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
})
