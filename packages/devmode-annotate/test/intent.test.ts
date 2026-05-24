/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mountAnnotateHud } from '../src/index.js'

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

function mockFetch(): Array<[string, RequestInit]> {
  const calls: Array<[string, RequestInit]> = []
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push([url, init])
    return new Response(
      JSON.stringify({ id: '001', filename: 'x.md', path: '/x', sessionId: 's' }),
      { status: 201 },
    )
  }) as unknown as typeof fetch
  return calls
}

describe('mountAnnotateHud — intent (P6)', () => {
  it('defaults intent to "task" in frontmatter', async () => {
    const calls = mockFetch()
    const handle = mountAnnotateHud({ origin: 'http://localhost', subscribeEvents: false })
    await handle.submit('a task')
    const body = JSON.parse(calls[0]![1].body as string) as {
      frontmatter: { intent: string }
    }
    expect(body.frontmatter.intent).toBe('task')
  })

  it('honors per-call intent override', async () => {
    const calls = mockFetch()
    const handle = mountAnnotateHud({ origin: 'http://localhost', subscribeEvents: false })
    await handle.submit('just an fyi', { intent: 'note' })
    const body = JSON.parse(calls[0]![1].body as string) as {
      frontmatter: { intent: string }
    }
    expect(body.frontmatter.intent).toBe('note')
  })

  it('setIntent() persists across submits until changed again', async () => {
    const calls = mockFetch()
    const handle = mountAnnotateHud({ origin: 'http://localhost', subscribeEvents: false })
    handle.setIntent('note')
    await handle.submit('first')
    await handle.submit('second')
    handle.setIntent('task')
    await handle.submit('third')
    const intents = calls.map(
      (c) =>
        (
          JSON.parse(c[1].body as string) as {
            frontmatter: { intent: string }
          }
        ).frontmatter.intent,
    )
    expect(intents).toEqual(['note', 'note', 'task'])
  })
})
