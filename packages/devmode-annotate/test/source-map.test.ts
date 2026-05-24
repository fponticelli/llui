/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectSourceMap, uniqueSelectorFor } from '../src/debug-collector.js'
import { mountAnnotateHud } from '../src/index.js'

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
  delete (globalThis as { __lluiComponents?: unknown }).__lluiComponents
})

describe('uniqueSelectorFor', () => {
  it('returns # selector for elements with id', () => {
    const el = document.createElement('div')
    el.id = 'thing-1'
    document.body.appendChild(el)
    expect(uniqueSelectorFor(el)).toBe('#thing-1')
  })

  it('returns a nth-child path when no id present', () => {
    document.body.innerHTML = '<div><span></span><span></span></div>'
    const second = document.querySelectorAll('span')[1]!
    const selector = uniqueSelectorFor(second)
    expect(selector).not.toBeNull()
    // querySelector must find the same element back
    expect(document.querySelector(selector!)).toBe(second)
  })

  it('escapes special chars in ids', () => {
    const el = document.createElement('div')
    el.id = 'user@host'
    document.body.appendChild(el)
    const selector = uniqueSelectorFor(el)!
    // selector should be queryable; the @ must be escaped or the
    // string remains valid via CSS.escape.
    expect(document.querySelector(selector)).toBe(el)
  })
})

describe('collectSourceMap', () => {
  it('returns [] when no components are mounted', () => {
    const out = collectSourceMap({ x: 0, y: 0, w: 100, h: 100 })
    expect(out).toEqual([])
  })

  it('returns [] when elementFromPoint returns nothing useful', () => {
    document.elementFromPoint = () => null
    const out = collectSourceMap(
      { x: 0, y: 0, w: 10, h: 10 },
      {
        components: {
          App: {
            getState: () => ({}),
            inspectElement: () => null,
            getBindingSource: () => null,
          },
        },
      },
    )
    expect(out).toEqual([])
  })

  it('returns [] when document.elementFromPoint is not defined (jsdom default)', () => {
    // Strip the override to simulate fresh jsdom.
    delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint
    const out = collectSourceMap(
      { x: 0, y: 0, w: 10, h: 10 },
      {
        components: {
          App: { getState: () => ({}) },
        },
      },
    )
    expect(out).toEqual([])
  })

  it('walks elements in the bbox and collects binding sources', () => {
    document.body.innerHTML = '<div id="root"><button id="b1">click</button></div>'

    const components = {
      App: {
        getState: () => ({}),
        inspectElement: (selector: string) => {
          // The grid sampler should hit the button at center
          if (selector.includes('b1')) {
            return { bindings: [{ bindingIndex: 0 }, { bindingIndex: 1 }] }
          }
          return null
        },
        getBindingSource: (bi: number) =>
          bi === 0
            ? { file: 'src/App.ts', line: 14, column: 3 }
            : { file: 'src/App.ts', line: 15, column: 5 },
      },
    }

    // Force elementFromPoint to return our button (jsdom layout is naive)
    const btn = document.getElementById('b1')!
    document.elementFromPoint = () => btn

    const out = collectSourceMap({ x: 10, y: 10, w: 50, h: 30 }, { components, samples: 1 })
    expect(out).toHaveLength(2)
    expect(out[0]!.file).toBe('src/App.ts')
    expect(out[0]!.line).toBe(14)
    expect(out[1]!.line).toBe(15)
    expect(out[0]!.componentPath).toEqual(['App'])
  })

  it('survives inspectElement throwing', () => {
    document.body.innerHTML = '<button id="b2"></button>'
    const btn = document.getElementById('b2')!
    document.elementFromPoint = () => btn

    const out = collectSourceMap(
      { x: 0, y: 0, w: 10, h: 10 },
      {
        components: {
          A: {
            getState: () => ({}),
            inspectElement: () => {
              throw new Error('boom')
            },
          },
        },
        samples: 1,
      },
    )
    expect(out).toEqual([])
  })

  it('dedupes elements seen at multiple grid points', () => {
    document.body.innerHTML = '<button id="b3"></button>'
    const btn = document.getElementById('b3')!
    document.elementFromPoint = () => btn

    let inspectCount = 0
    const components = {
      A: {
        getState: () => ({}),
        inspectElement: () => {
          inspectCount++
          return { bindings: [{ bindingIndex: 0 }] }
        },
        getBindingSource: () => ({ file: 'x.ts', line: 1, column: 0 }),
      },
    }
    collectSourceMap({ x: 0, y: 0, w: 100, h: 100 }, { components, samples: 3 })
    // All 9 sample points hit the same button → inspectElement called once
    expect(inspectCount).toBe(1)
  })
})

describe('mountAnnotateHud — sourceMap in NoteBody', () => {
  it('submit() with a rect annotation populates body.sourceMap', async () => {
    document.body.innerHTML = '<button id="bx"></button>'
    const btn = document.getElementById('bx')!
    document.elementFromPoint = () => btn
    ;(globalThis as { __lluiComponents?: Record<string, unknown> }).__lluiComponents = {
      App: {
        getState: () => ({}),
        inspectElement: () => ({ bindings: [{ bindingIndex: 0 }] }),
        getBindingSource: () => ({ file: 'src/App.ts', line: 7, column: 2 }),
      },
    }

    const calls: Array<[string, RequestInit]> = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return new Response(
        JSON.stringify({ id: '001', filename: 'x.md', path: '/x', sessionId: 's' }),
        { status: 201 },
      )
    }) as unknown as typeof fetch

    const stubCapture = async (): Promise<string> => 'data:image/png;base64,SHOT'
    const stubBake = async (): Promise<string> => 'data:image/png;base64,BAKED'

    const handle = mountAnnotateHud({
      origin: 'http://localhost',
      capture: stubCapture,
      bake: stubBake,
      subscribeEvents: false,
    })
    await handle.submit('rect note', {
      annotations: [{ type: 'rect', x: 0, y: 0, w: 100, h: 50 }],
    })
    const body = JSON.parse(calls[0]![1].body as string) as {
      noteBody: {
        sourceMap?: Array<{ file: string; line: number; componentPath: string[] }>
      }
    }
    expect(body.noteBody.sourceMap).toHaveLength(1)
    expect(body.noteBody.sourceMap![0]).toMatchObject({
      file: 'src/App.ts',
      line: 7,
      componentPath: ['App'],
    })
  })

  it('text-only submit() does NOT include sourceMap', async () => {
    const calls: Array<[string, RequestInit]> = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return new Response(
        JSON.stringify({ id: '001', filename: 'x.md', path: '/x', sessionId: 's' }),
        { status: 201 },
      )
    }) as unknown as typeof fetch

    const handle = mountAnnotateHud({ origin: 'http://localhost', subscribeEvents: false })
    await handle.submit('plain text')
    const body = JSON.parse(calls[0]![1].body as string) as {
      noteBody: { sourceMap?: unknown }
    }
    expect(body.noteBody.sourceMap).toBeUndefined()
  })
})
