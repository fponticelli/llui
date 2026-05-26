/// <reference lib="dom" />
// Integration tests for the rect-drawing mode added in P2.
// jsdom is used for DOM; html-to-image is replaced via the `capture`
// option so the test doesn't depend on a real raster pipeline.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mountAnnotateHud } from '../src/index.js'

function dispatchMouse(target: Element, type: string, x: number, y: number): void {
  target.dispatchEvent(
    new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }),
  )
}

const stubCapture = async (): Promise<string> =>
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('mountAnnotateHud — rect mode', () => {
  it('exposes drawRect() as a programmatic API', async () => {
    const handle = mountAnnotateHud()
    const promise = handle.drawRect()
    const overlay = document.querySelector('[data-llui-overlay="rect"]') as HTMLElement
    dispatchMouse(overlay, 'mousedown', 10, 10)
    dispatchMouse(overlay, 'mousemove', 110, 90)
    dispatchMouse(overlay, 'mouseup', 110, 90)
    const rect = await promise
    expect(rect).toEqual({ x: 10, y: 10, w: 100, h: 80 })
  })

  it('submit() with an explicit rect annotation captures a screenshot and POSTs both', async () => {
    const calls: Array<[string, RequestInit]> = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return new Response(
        JSON.stringify({
          id: '001',
          filename: '001-human-rect-test.md',
          path: '/tmp/x',
          sessionId: 's',
        }),
        { status: 201 },
      )
    }) as unknown as typeof fetch

    const stubBake = async (_screenshot: string, _annotations: unknown[]): Promise<string> =>
      'data:image/png;base64,BAKED'

    const handle = mountAnnotateHud({
      origin: 'http://localhost:5173',
      capture: stubCapture,
      bake: stubBake,
    })

    const result = await handle.submit('looks broken', {
      annotations: [{ type: 'rect', x: 5, y: 5, w: 50, h: 30 }],
    })
    expect(result.id).toBe('001')
    expect(calls).toHaveLength(1)
    const body = JSON.parse(calls[0]![1].body as string) as {
      frontmatter: { kind: string; annotations: Array<{ type: string }> }
      screenshot?: string
    }
    expect(body.frontmatter.kind).toBe('rect')
    expect(body.frontmatter.annotations).toHaveLength(1)
    expect(body.frontmatter.annotations[0]!.type).toBe('rect')
    expect(body.screenshot).toBe('BAKED')
  })

  it('submit() without annotations still works (text-only path)', async () => {
    const calls: Array<[string, RequestInit]> = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return new Response(
        JSON.stringify({ id: '001', filename: 'x.md', path: '/x', sessionId: 's' }),
        { status: 201 },
      )
    }) as unknown as typeof fetch

    const handle = mountAnnotateHud({ origin: 'http://localhost:5173' })
    await handle.submit('plain text')
    expect(calls).toHaveLength(1)
    const body = JSON.parse(calls[0]![1].body as string) as {
      frontmatter: { kind: string; annotations: unknown[] }
      screenshot?: string
    }
    expect(body.frontmatter.kind).toBe('text')
    expect(body.frontmatter.annotations).toEqual([])
    expect(body.screenshot).toBeUndefined()
  })

  it('clicking "Add region" launches the drawing overlay', () => {
    mountAnnotateHud()
    const root = document.getElementById('llui-devmode-annotate-root')!
    // Find the "Add region" pill button by its label text.
    const buttons = [...root.querySelectorAll('button')] as HTMLButtonElement[]
    const addRegionBtn = buttons.find((b) => b.textContent?.includes('Add region'))
    expect(addRegionBtn).toBeDefined()
    addRegionBtn!.click()
    // Drawing kicks off — the overlay should mount.
    const overlay = document.querySelector('[data-llui-overlay="rect"]')
    expect(overlay).not.toBeNull()
    // Cancel the overlay to clean up
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })
})
