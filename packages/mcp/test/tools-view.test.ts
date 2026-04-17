import { describe, it, expect, vi } from 'vitest'
import { LluiMcpServer } from '../src/index'
import type { LluiDebugAPI, ElementReport } from '@llui/dom'

function mkApi(overrides?: Partial<LluiDebugAPI>): LluiDebugAPI {
  const base: LluiDebugAPI = {
    getState: () => ({ count: 0 }),
    send: vi.fn(),
    flush: vi.fn(),
    evalUpdate: () => ({ state: { count: 0 }, effects: [] }),
    getMessageHistory: () => [],
    exportTrace: () => ({
      lluiTrace: 1 as const,
      component: 'Test',
      generatedBy: 'test',
      timestamp: new Date().toISOString(),
      entries: [],
    }),
    clearLog: vi.fn(),
    validateMessage: () => null,
    getBindings: () => [],
    whyDidUpdate: () => ({
      bindingIndex: 0,
      bindingMask: 0,
      lastDirtyMask: 0,
      matched: false,
      accessorResult: undefined,
      lastValue: undefined,
      changed: false,
    }),
    searchState: () => undefined,
    getMessageSchema: () => null,
    getMaskLegend: () => null,
    decodeMask: () => [],
    getComponentInfo: () => ({ name: 'Test', file: null, line: null }),
    getStateSchema: () => null,
    getEffectSchema: () => null,
    snapshotState: () => ({ count: 0 }),
    restoreState: vi.fn(),
    getBindingsFor: () => [],
    inspectElement: () => null,
    getRenderedHtml: () => '',
    dispatchDomEvent: () => ({
      dispatched: false,
      messagesProducedIndices: [],
      resultingState: null,
    }),
    ...overrides,
  }
  return base
}

describe('llui_inspect_element tool', () => {
  it('returns an ElementReport when the element is found', async () => {
    const report: ElementReport = {
      selector: '#counter',
      tagName: 'div',
      attributes: { id: 'counter', class: 'container' },
      classes: ['container'],
      dataset: { foo: 'bar' },
      text: 'hello',
      computed: {
        display: 'block',
        visibility: 'visible',
        position: 'static',
        width: 100,
        height: 50,
      },
      boundingBox: { x: 0, y: 0, width: 100, height: 50 },
      bindings: [
        {
          bindingIndex: 0,
          kind: 'text',
          mask: 1,
          lastValue: 'hello',
          relation: 'text-child',
        },
      ],
    }

    const fn = vi.fn(() => report)
    const api = mkApi({ inspectElement: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)

    const result = (await server.handleToolCall('llui_inspect_element', {
      selector: '#counter',
    })) as ElementReport

    expect(fn).toHaveBeenCalledWith('#counter')
    expect(result).not.toBeNull()
    expect(result.tagName).toBe('div')
    expect(result.selector).toBe('#counter')
    expect(result.bindings).toHaveLength(1)
    expect(result.bindings[0]!.kind).toBe('text')
    expect(result.bindings[0]!.relation).toBe('text-child')
    expect(result.computed.display).toBe('block')
    expect(result.boundingBox.width).toBe(100)
  })

  it('returns null when no element matches the selector', async () => {
    const api = mkApi({ inspectElement: () => null })
    const server = new LluiMcpServer()
    server.connectDirect(api)

    const result = await server.handleToolCall('llui_inspect_element', {
      selector: '.nonexistent',
    })

    expect(result).toBeNull()
  })
})

describe('llui_get_rendered_html tool', () => {
  it('returns html from getRenderedHtml when no args provided', async () => {
    const fn = vi.fn(() => '<div id="root">Hello</div>')
    const api = mkApi({ getRenderedHtml: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)

    const result = (await server.handleToolCall('llui_get_rendered_html', {})) as string

    expect(fn).toHaveBeenCalledWith(undefined, undefined)
    expect(result).toBe('<div id="root">Hello</div>')
  })

  it('forwards selector and maxLength when both provided', async () => {
    const fn = vi.fn(() => '<section id="s">content</section>')
    const api = mkApi({ getRenderedHtml: fn })
    const server = new LluiMcpServer()
    server.connectDirect(api)

    const result = (await server.handleToolCall('llui_get_rendered_html', {
      selector: '#s',
      maxLength: 100,
    })) as string

    expect(fn).toHaveBeenCalledWith('#s', 100)
    expect(result).toBe('<section id="s">content</section>')
  })
})

describe('llui_dom_diff', () => {
  it('matches exactly when html matches expected', async () => {
    const api = mkApi({ getRenderedHtml: vi.fn(() => '<div>test</div>') })
    const server = new LluiMcpServer()
    server.connectDirect(api)

    const result = (await server.handleToolCall('llui_dom_diff', {
      expected: '<div>test</div>',
    })) as { match: boolean; differences: Array<unknown> }

    expect(result.match).toBe(true)
    expect(result.differences).toHaveLength(0)
  })

  it('reports mismatch when different', async () => {
    const api = mkApi({ getRenderedHtml: vi.fn(() => '<div>actual</div>') })
    const server = new LluiMcpServer()
    server.connectDirect(api)

    const result = (await server.handleToolCall('llui_dom_diff', {
      expected: '<div>expected</div>',
    })) as {
      match: boolean
      differences: Array<{ path: string; expected: string; actual: string }>
    }

    expect(result.match).toBe(false)
    expect(result.differences).toHaveLength(1)
    expect(result.differences[0]!.path).toBe('root')
    expect(result.differences[0]!.expected).toBe('<div>expected</div>')
    expect(result.differences[0]!.actual).toBe('<div>actual</div>')
  })

  it('ignores whitespace when ignoreWhitespace: true', async () => {
    const api = mkApi({ getRenderedHtml: vi.fn(() => '<div>  test  </div>') })
    const server = new LluiMcpServer()
    server.connectDirect(api)

    const result = (await server.handleToolCall('llui_dom_diff', {
      expected: '<div>  test  </div>',
      ignoreWhitespace: true,
    })) as { match: boolean; differences: Array<unknown> }

    expect(result.match).toBe(true)
    expect(result.differences).toHaveLength(0)
  })
})
