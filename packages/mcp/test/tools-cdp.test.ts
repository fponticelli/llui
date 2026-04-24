import { describe, it, expect, vi } from 'vitest'
import { LluiMcpServer } from '../src/index'
import type { CdpTransport, ConsoleEntry, NetworkEntry, ErrorEntry } from '../src/tool-registry'

function mockCdp(overrides: Partial<CdpTransport> = {}): CdpTransport {
  return {
    call: vi.fn().mockResolvedValue({}),
    isAvailable: () => true,
    screenshot: vi.fn().mockResolvedValue({ data: 'abc123', format: 'png', mimeType: 'image/png' }),
    accessibilitySnapshot: vi.fn().mockResolvedValue({ role: 'WebArea', children: [] }),
    getConsoleBuffer: vi.fn().mockReturnValue([]),
    getNetworkBuffer: vi.fn().mockReturnValue([]),
    getErrorBuffer: vi.fn().mockReturnValue([]),
    closeBrowser: vi.fn().mockResolvedValue({ closed: true }),
    ...overrides,
  }
}

describe('llui_screenshot', () => {
  it('returns base64 PNG data', async () => {
    const server = new LluiMcpServer()
    ;(server as unknown as { cdp: CdpTransport }).cdp = mockCdp()
    const result = (await server.handleToolCall('llui_screenshot', {})) as {
      data: string
      format: string
    }
    expect(result.data).toBe('abc123')
    expect(result.format).toBe('png')
  })

  it('exposes llui_screenshot in tool list', () => {
    expect(new LluiMcpServer().getTools().some((t) => t.name === 'llui_screenshot')).toBe(true)
  })
})

describe('llui_a11y_tree', () => {
  it('returns accessibility snapshot', async () => {
    const cdp = mockCdp()
    const server = new LluiMcpServer()
    ;(server as unknown as { cdp: CdpTransport }).cdp = cdp
    const result = await server.handleToolCall('llui_a11y_tree', {})
    expect(cdp.accessibilitySnapshot).toHaveBeenCalledWith({
      selector: undefined,
      interestingOnly: true,
    })
    expect(result).toEqual({ role: 'WebArea', children: [] })
  })
})

describe('llui_console_tail', () => {
  it('returns console entries', async () => {
    const entries: ConsoleEntry[] = [{ level: 'error', text: 'oh no', timestamp: 1000 }]
    const server = new LluiMcpServer()
    ;(server as unknown as { cdp: CdpTransport }).cdp = mockCdp({ getConsoleBuffer: () => entries })
    const result = (await server.handleToolCall('llui_console_tail', { limit: 10 })) as {
      entries: ConsoleEntry[]
    }
    expect(result.entries).toEqual(entries)
  })
})

describe('llui_network_tail', () => {
  it('returns network entries', async () => {
    const entries: NetworkEntry[] = [
      {
        requestId: 'r1',
        url: 'http://localhost/api',
        method: 'GET',
        status: 200,
        startTime: 1000,
        endTime: 1050,
        durationMs: 50,
        failed: false,
      },
    ]
    const server = new LluiMcpServer()
    ;(server as unknown as { cdp: CdpTransport }).cdp = mockCdp({ getNetworkBuffer: () => entries })
    const result = (await server.handleToolCall('llui_network_tail', {})) as {
      entries: NetworkEntry[]
    }
    expect(result.entries).toEqual(entries)
  })
})

describe('llui_uncaught_errors', () => {
  it('returns error entries', async () => {
    const errors: ErrorEntry[] = [{ text: 'ReferenceError: foo', stack: 'at ...', timestamp: 2000 }]
    const server = new LluiMcpServer()
    ;(server as unknown as { cdp: CdpTransport }).cdp = mockCdp({ getErrorBuffer: () => errors })
    const result = (await server.handleToolCall('llui_uncaught_errors', {})) as {
      errors: ErrorEntry[]
    }
    expect(result.errors).toEqual(errors)
  })
})

describe('llui_browser_close', () => {
  it('closes a playwright-owned browser', async () => {
    const cdp = mockCdp()
    const server = new LluiMcpServer()
    ;(server as unknown as { cdp: CdpTransport }).cdp = cdp
    const result = (await server.handleToolCall('llui_browser_close', {})) as {
      closed: boolean
    }
    expect(result.closed).toBe(true)
    expect(cdp.closeBrowser).toHaveBeenCalled()
  })
})

describe('tool list', () => {
  it('exposes all 6 CDP tools', () => {
    const server = new LluiMcpServer()
    const names = server.getTools().map((t) => t.name)
    expect(names).toContain('llui_screenshot')
    expect(names).toContain('llui_a11y_tree')
    expect(names).toContain('llui_network_tail')
    expect(names).toContain('llui_console_tail')
    expect(names).toContain('llui_uncaught_errors')
    expect(names).toContain('llui_browser_close')
  })
})
