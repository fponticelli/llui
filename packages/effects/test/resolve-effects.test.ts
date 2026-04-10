import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveEffects } from '../src/resolve'
import { http, type Effect, type ApiError } from '../src/index'

type State = { items: string[]; error: string | null }
type Msg =
  | { type: 'loaded'; payload: { items: string[] } }
  | { type: 'error'; error: { kind: string } }

function update(state: State, msg: Msg): [State, Effect[]] {
  switch (msg.type) {
    case 'loaded':
      return [{ ...state, items: msg.payload.items }, []]
    case 'error':
      return [{ ...state, error: msg.error.kind }, []]
  }
}

function mockFetch(responses: Record<string, { ok: boolean; status?: number; body: unknown }>) {
  return vi.fn().mockImplementation((url: string) => {
    const resp = responses[url]
    if (!resp) return Promise.reject(new Error(`No mock for ${url}`))
    return Promise.resolve({
      ok: resp.ok,
      status: resp.status ?? (resp.ok ? 200 : 500),
      statusText: resp.ok ? 'OK' : 'Error',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(resp.body),
    })
  })
}

describe('resolveEffects', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('executes HTTP effects and returns loaded state', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/api/items': { ok: true, body: { items: ['a', 'b'] } },
      }),
    )

    const effects: Effect[] = [
      http<{ type: string; payload?: unknown; error?: ApiError }>({
        url: '/api/items',
        onSuccess: (data) => ({ type: 'loaded', payload: data }),
        onError: (err) => ({ type: 'error', error: err }),
      }),
    ]

    const result = await resolveEffects<State, Msg, Effect>(
      { items: [], error: null },
      effects,
      update,
    )

    expect(result.items).toEqual(['a', 'b'])
    expect(result.error).toBeNull()
    vi.unstubAllGlobals()
  })

  it('executes multiple HTTP effects in parallel', async () => {
    const callOrder: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        callOrder.push(url)
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ items: [url] }),
        })
      }),
    )

    type S2 = { a: string[]; b: string[] }
    type M2 =
      | { type: 'aOk'; payload: { items: string[] } }
      | { type: 'bOk'; payload: { items: string[] } }

    const effects: Effect[] = [
      http<{ type: string; payload?: unknown; error?: ApiError }>({
        url: '/api/a',
        onSuccess: (data) => ({ type: 'aOk', payload: data }),
        onError: () => ({ type: 'err' }),
      }),
      http<{ type: string; payload?: unknown; error?: ApiError }>({
        url: '/api/b',
        onSuccess: (data) => ({ type: 'bOk', payload: data }),
        onError: () => ({ type: 'err' }),
      }),
    ]

    const result = await resolveEffects<S2, M2, Effect>({ a: [], b: [] }, effects, (s, m) => {
      if (m.type === 'aOk') return [{ ...s, a: m.payload.items }, []]
      if (m.type === 'bOk') return [{ ...s, b: m.payload.items }, []]
      return [s, []]
    })

    expect(callOrder).toContain('/api/a')
    expect(callOrder).toContain('/api/b')
    expect(result.a).toEqual(['/api/a'])
    expect(result.b).toEqual(['/api/b'])
    vi.unstubAllGlobals()
  })

  it('maps HTTP errors to ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/api/items': { ok: false, status: 404, body: {} },
      }),
    )

    const result = await resolveEffects<State, Msg, Effect>(
      { items: [], error: null },
      [
        http<{ type: string; payload?: unknown; error?: ApiError }>({
          url: '/api/items',
          onSuccess: (data) => ({ type: 'loaded', payload: data }),
          onError: (err) => ({ type: 'error', error: err }),
        }),
      ],
      update,
    )

    expect(result.error).toBe('notfound')
    vi.unstubAllGlobals()
  })

  it('returns unchanged state when no HTTP effects', async () => {
    const state: State = { items: ['existing'], error: null }
    const result = await resolveEffects<State, Msg, Effect>(
      state,
      [{ type: 'cancel', token: 'x' }],
      update,
    )

    expect(result).toBe(state)
  })

  it('returns unchanged state when effects array is empty', async () => {
    const state: State = { items: ['existing'], error: null }
    const result = await resolveEffects<State, Msg, Effect>(state, [], update)
    expect(result).toBe(state)
  })

  it('recurses when responses produce more effects', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        '/api/init': { ok: true, body: { next: '/api/data' } },
        '/api/data': { ok: true, body: { items: ['final'] } },
      }),
    )

    type S3 = { items: string[]; nextUrl: string | null }
    type M3 =
      | { type: 'initOk'; payload: { next: string } }
      | { type: 'dataOk'; payload: { items: string[] } }

    const result = await resolveEffects<S3, M3, Effect>(
      { items: [], nextUrl: null },
      [
        http<{ type: string; payload?: unknown; error?: ApiError }>({
          url: '/api/init',
          onSuccess: (data) => ({ type: 'initOk', payload: data }),
          onError: () => ({ type: 'err' }),
        }),
      ],
      (s, m) => {
        if (m.type === 'initOk') {
          return [
            { ...s, nextUrl: m.payload.next },
            [
              http<{ type: string; payload?: unknown; error?: ApiError }>({
                url: m.payload.next,
                onSuccess: (data) => ({ type: 'dataOk', payload: data }),
                onError: () => ({ type: 'err' }),
              }),
            ],
          ]
        }
        if (m.type === 'dataOk') {
          return [{ ...s, items: m.payload.items }, []]
        }
        return [s, []]
      },
    )

    expect(result.items).toEqual(['final'])
    expect(result.nextUrl).toBe('/api/data')
    vi.unstubAllGlobals()
  })

  it('respects maxDepth limit', async () => {
    let fetchCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        fetchCount++
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ items: [] }),
        })
      }),
    )

    // update always produces another effect — would infinite loop without depth limit
    const result = await resolveEffects<State, Msg, Effect>(
      { items: [], error: null },
      [
        http<{ type: string; payload?: unknown; error?: ApiError }>({
          url: '/api/loop',
          onSuccess: (data) => ({ type: 'loaded', payload: data }),
          onError: (err) => ({ type: 'error', error: err }),
        }),
      ],
      (s, m) => {
        if (m.type === 'loaded') {
          return [
            s,
            [
              http<{ type: string; payload?: unknown; error?: ApiError }>({
                url: '/api/loop',
                onSuccess: (data) => ({ type: 'loaded', payload: data }),
                onError: (err) => ({ type: 'error', error: err }),
              }),
            ],
          ]
        }
        return [s, []]
      },
      2, // maxDepth
    )

    // Should stop after 2 levels of recursion
    expect(fetchCount).toBeLessThanOrEqual(3)
    vi.unstubAllGlobals()
  })

  it('handles fetch network failures gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const result = await resolveEffects<State, Msg, Effect>(
      { items: ['preserved'], error: null },
      [
        http<{ type: string; payload?: unknown; error?: ApiError }>({
          url: '/api/items',
          onSuccess: (data) => ({ type: 'loaded', payload: data }),
          onError: (err) => ({ type: 'error', error: err }),
        }),
      ],
      update,
    )

    // Fetch rejection → Promise.allSettled catches it → state unchanged
    expect(result.items).toEqual(['preserved'])
    vi.unstubAllGlobals()
  })
})
