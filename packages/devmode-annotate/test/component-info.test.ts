/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { collectComponentInfo } from '../src/debug-collector.js'
import { mountAnnotateHud } from '../src/index.js'

function mockComponent(info: { file: string; line: number; name?: string } | null) {
  return {
    getState: () => ({}),
    getComponentInfo: info
      ? () => ({ name: info.name ?? 'Anon', file: info.file, line: info.line })
      : undefined,
  }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

afterEach(() => {
  document.body.innerHTML = ''
  delete (globalThis as { __lluiComponents?: unknown }).__lluiComponents
})

describe('collectComponentInfo', () => {
  it('returns null when no components are mounted', () => {
    expect(collectComponentInfo({ components: {} })).toBe(null)
  })

  it('returns componentPath = names of all mounted components', () => {
    const info = collectComponentInfo({
      components: {
        App: mockComponent({ file: 'src/App.ts', line: 8, name: 'App' }),
        UserCard: mockComponent({ file: 'src/UserCard.ts', line: 14, name: 'UserCard' }),
      },
    })
    expect(info?.componentPath).toEqual(['App', 'UserCard'])
  })

  it('uses the first component as the anchor for componentMeta', () => {
    const info = collectComponentInfo({
      components: {
        App: mockComponent({ file: 'src/App.ts', line: 8, name: 'App' }),
        UserCard: mockComponent({ file: 'src/UserCard.ts', line: 14, name: 'UserCard' }),
      },
    })
    expect(info?.componentMeta).toEqual({ file: 'src/App.ts', line: 8, name: 'App' })
  })

  it('returns componentMeta=null when the first component lacks file:line', () => {
    const info = collectComponentInfo({
      components: { App: mockComponent(null) },
    })
    expect(info?.componentPath).toEqual(['App'])
    expect(info?.componentMeta).toBe(null)
  })

  it('survives getComponentInfo() throwing', () => {
    const broken = {
      getState: () => ({}),
      getComponentInfo: () => {
        throw new Error('boom')
      },
    }
    const info = collectComponentInfo({ components: { Broken: broken } })
    expect(info?.componentPath).toEqual(['Broken'])
    expect(info?.componentMeta).toBe(null)
  })

  it('falls back to component key when getComponentInfo returns no name', () => {
    const namelessComp = {
      getState: () => ({}),
      getComponentInfo: () => ({ name: '', file: 'x.ts', line: 1 }),
    }
    const info = collectComponentInfo({
      components: { Fallback: namelessComp },
    })
    expect(info?.componentMeta).toEqual({ file: 'x.ts', line: 1, name: 'Fallback' })
  })
})

describe('mountAnnotateHud — frontmatter component info', () => {
  it('submit() populates componentPath + componentMeta from __lluiComponents', async () => {
    ;(globalThis as { __lluiComponents?: Record<string, unknown> }).__lluiComponents = {
      App: mockComponent({ file: 'src/App.ts', line: 5, name: 'App' }),
    }
    const calls: Array<[string, RequestInit]> = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return new Response(
        JSON.stringify({ id: '001', filename: 'x.md', path: '/x', sessionId: 's' }),
        { status: 201 },
      )
    }) as unknown as typeof fetch

    const handle = mountAnnotateHud({ origin: 'http://localhost', subscribeEvents: false })
    await handle.submit('hello')
    const body = JSON.parse(calls[0]![1].body as string) as {
      frontmatter: {
        componentPath: string[] | null
        componentMeta: { file: string; line: number; name: string } | null
      }
    }
    expect(body.frontmatter.componentPath).toEqual(['App'])
    expect(body.frontmatter.componentMeta).toEqual({
      file: 'src/App.ts',
      line: 5,
      name: 'App',
    })
  })

  it('handleCaptureRequest() populates componentPath + componentMeta', async () => {
    ;(globalThis as { __lluiComponents?: Record<string, unknown> }).__lluiComponents = {
      UserCard: mockComponent({ file: 'src/UserCard.ts', line: 12, name: 'UserCard' }),
    }
    const calls: Array<[string, RequestInit]> = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return new Response(
        JSON.stringify({ id: '002', filename: 'x.md', path: '/x', sessionId: 's' }),
        { status: 201 },
      )
    }) as unknown as typeof fetch

    const stubCapture = async (): Promise<string> => 'data:image/png;base64,SHOT'
    const handle = mountAnnotateHud({
      origin: 'http://localhost',
      capture: stubCapture,
      subscribeEvents: false,
    })
    await handle.handleCaptureRequest('req-1', { prose: 'inspect' })
    const body = JSON.parse(calls[0]![1].body as string) as {
      frontmatter: { componentPath: string[] | null; componentMeta: object | null }
    }
    expect(body.frontmatter.componentPath).toEqual(['UserCard'])
    expect(body.frontmatter.componentMeta).toEqual({
      file: 'src/UserCard.ts',
      line: 12,
      name: 'UserCard',
    })
  })

  it('keeps componentPath null when no components are mounted', async () => {
    // Ensure no leak from prior tests
    delete (globalThis as { __lluiComponents?: unknown }).__lluiComponents
    const calls: Array<[string, RequestInit]> = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return new Response(
        JSON.stringify({ id: '001', filename: 'x.md', path: '/x', sessionId: 's' }),
        { status: 201 },
      )
    }) as unknown as typeof fetch

    const handle = mountAnnotateHud({ origin: 'http://localhost', subscribeEvents: false })
    await handle.submit('plain')
    const body = JSON.parse(calls[0]![1].body as string) as {
      frontmatter: { componentPath: string[] | null }
    }
    expect(body.frontmatter.componentPath).toBe(null)
  })
})
