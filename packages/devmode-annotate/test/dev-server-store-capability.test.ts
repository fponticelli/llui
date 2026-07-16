import { describe, expect, it, vi, afterEach } from 'vitest'
import { devServerStore } from '../src/stores/dev-server-store.js'
import type { CreateNoteRequest } from '../src/note-types.js'

// Regression (audit S2 follow-up): the HUD must echo the vite-plugin's out-of-band
// `taskCapabilityToken` as the `x-llui-task-capability` header, or the middleware
// never trusts an in-HUD task submission (created but never spawned).

const req = { body: 'hi', frontmatter: {}, noteBody: {} } as unknown as CreateNoteRequest

function stubFetch() {
  const calls: Array<Record<string, string>> = []
  const impl = vi.fn(async (_url: string, init?: RequestInit) => {
    calls.push((init?.headers as Record<string, string>) ?? {})
    return { ok: true, status: 200, json: async () => ({ id: 'n1' }) } as Response
  })
  globalThis.fetch = impl as unknown as typeof fetch
  return calls
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('devServerStore — task capability token', () => {
  it('sends x-llui-task-capability on note POSTs when a token is supplied', async () => {
    const calls = stubFetch()
    await devServerStore('http://localhost:5173', 'CAP-TOKEN').createNote(req)
    expect(calls[0]?.['x-llui-task-capability']).toBe('CAP-TOKEN')
  })

  it('omits the header when no token is supplied', async () => {
    const calls = stubFetch()
    await devServerStore('http://localhost:5173').createNote(req)
    expect(calls[0]?.['x-llui-task-capability']).toBeUndefined()
  })
})
