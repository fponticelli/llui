import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Plugin } from 'vite'
import llui from '../src/index'

const SRC_WITH_COMPONENT = `
  import { component, div, text } from '@llui/dom'
  export const C = component({
    name: 'C',
    init: () => [{ count: 0, label: '' }, []],
    update: (s) => [s, []],
    view: ({ text }) => [
      div({}, [text((s) => String(s.count)), text((s) => s.label)]),
    ],
  })
`

const SRC_NO_COMPONENT = `
  export const x = 1
`

function runTransform(plugin: Plugin, code: string, id: string): void {
  const warn = vi.fn()
  const error = vi.fn()
  const ctx = { warn, error } as unknown as ThisParameterType<
    Extract<Plugin['transform'], (...a: never) => unknown>
  >
  const transform = plugin.transform as (this: unknown, c: string, i: string) => unknown
  try {
    transform.call(ctx, code, id)
  } catch {
    // ignore this.error paths
  }
}

describe('verbose plugin option', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    infoSpy.mockRestore()
  })

  it('stays silent when verbose is omitted', () => {
    const plugin = llui()
    runTransform(plugin, SRC_WITH_COMPONENT, '/tmp/a.ts')
    expect(infoSpy).not.toHaveBeenCalled()
  })

  it('stays silent when verbose is false', () => {
    const plugin = llui({ verbose: false })
    runTransform(plugin, SRC_WITH_COMPONENT, '/tmp/a.ts')
    expect(infoSpy).not.toHaveBeenCalled()
  })

  it('logs a tagged entry per transformed component file when verbose is true', () => {
    const plugin = llui({ verbose: true })
    runTransform(plugin, SRC_WITH_COMPONENT, '/tmp/a.ts')
    const messages = infoSpy.mock.calls.map((call: unknown[]) => call.join(' '))
    // At least one message tagged with [llui]
    expect(messages.some((m: string) => m.includes('[llui]'))).toBe(true)
    // Mentions the file
    expect(messages.some((m: string) => m.includes('a.ts'))).toBe(true)
    // Mentions discovered paths (count and label)
    expect(messages.some((m: string) => /count|label/.test(m))).toBe(true)
  })

  it('does not log non-component files even with verbose', () => {
    const plugin = llui({ verbose: true })
    runTransform(plugin, SRC_NO_COMPONENT, '/tmp/a.ts')
    expect(infoSpy).not.toHaveBeenCalled()
  })
})
