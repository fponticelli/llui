/// <reference lib="dom" />
// Tests for the HUD-side handler that responds to LLM-initiated
// capture-requests. We disable the SSE subscription (no EventSource in
// jsdom by default) and invoke handleCaptureRequest directly — same
// code path the SSE listener uses.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mountAnnotateHud } from '../src/index.js'

const stubCapture = async (): Promise<string> => 'data:image/png;base64,SHOT'
const stubBake = async (): Promise<string> => 'data:image/png;base64,BAKED'

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('handleCaptureRequest', () => {
  it('POSTs a note tagged author=llm with fulfillsRequestId set', async () => {
    const calls: Array<[string, RequestInit]> = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return new Response(
        JSON.stringify({
          id: '002',
          filename: '002-llm-capture-x.md',
          path: '/tmp/x',
          sessionId: 's',
        }),
        { status: 201 },
      )
    }) as unknown as typeof fetch

    const handle = mountAnnotateHud({
      origin: 'http://localhost:5173',
      capture: stubCapture,
      bake: stubBake,
      subscribeEvents: false,
    })

    const result = await handle.handleCaptureRequest('req-1', { prose: 'inspect' })
    expect(result.id).toBe('002')
    expect(calls).toHaveLength(1)
    const body = JSON.parse(calls[0]![1].body as string) as {
      frontmatter: { author: string; kind: string; fulfillsRequestId?: string }
      screenshot?: string
    }
    expect(body.frontmatter.author).toBe('llm')
    expect(body.frontmatter.kind).toBe('capture')
    expect(body.frontmatter.fulfillsRequestId).toBe('req-1')
    // No annotations → raw screenshot is sent (not baked)
    expect(body.screenshot).toBe('SHOT')
  })

  it('bakes annotations into the screenshot before POST', async () => {
    const calls: Array<[string, RequestInit]> = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return new Response(
        JSON.stringify({ id: '001', filename: 'x.md', path: '/x', sessionId: 's' }),
        { status: 201 },
      )
    }) as unknown as typeof fetch

    const handle = mountAnnotateHud({
      origin: 'http://localhost:5173',
      capture: stubCapture,
      bake: stubBake,
      subscribeEvents: false,
    })

    await handle.handleCaptureRequest('req-2', {
      prose: 'circled bug',
      annotate: [{ type: 'rect', x: 10, y: 10, w: 50, h: 30 }],
    })
    const body = JSON.parse(calls[0]![1].body as string) as {
      frontmatter: { annotations: unknown[] }
      screenshot?: string
    }
    expect(body.frontmatter.annotations).toHaveLength(1)
    expect(body.screenshot).toBe('BAKED')
  })

  it('still POSTs a fulfillment note when capture itself throws', async () => {
    const calls: Array<[string, RequestInit]> = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return new Response(
        JSON.stringify({ id: '003', filename: 'x.md', path: '/x', sessionId: 's' }),
        { status: 201 },
      )
    }) as unknown as typeof fetch

    const failingCapture = async (): Promise<string> => {
      throw new Error('canvas exploded')
    }
    const handle = mountAnnotateHud({
      origin: 'http://localhost:5173',
      capture: failingCapture,
      subscribeEvents: false,
    })

    await handle.handleCaptureRequest('req-3', { prose: 'try this' })
    expect(calls).toHaveLength(1)
    const body = JSON.parse(calls[0]![1].body as string) as {
      body: string
      frontmatter: { fulfillsRequestId: string; screenshot: string | null }
    }
    expect(body.frontmatter.fulfillsRequestId).toBe('req-3')
    expect(body.frontmatter.screenshot).toBe(null)
    expect(body.body).toContain('capture failed')
  })

  it('honors captureLevel from payload', async () => {
    const calls: Array<[string, RequestInit]> = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return new Response(
        JSON.stringify({ id: '001', filename: 'x.md', path: '/x', sessionId: 's' }),
        { status: 201 },
      )
    }) as unknown as typeof fetch

    const handle = mountAnnotateHud({
      origin: 'http://localhost:5173',
      capture: stubCapture,
      subscribeEvents: false,
    })

    await handle.handleCaptureRequest('req-4', { captureLevel: 'verbose' })
    const body = JSON.parse(calls[0]![1].body as string) as {
      frontmatter: { captureLevel: string }
    }
    expect(body.frontmatter.captureLevel).toBe('verbose')
  })
})
