import { describe, it, expect, vi } from 'vitest'
import type { Plugin } from 'vite'
import llui from '../src/index'

// A source that fires `namespace-import` and `empty-props` together.
// Lets us test that disabling one rule keeps the others.
const SRC_TWO_WARNINGS = `
  import * as L from '@llui/dom'
  import { div } from '@llui/dom'
  export const el = div({}, [])
`

function runTransform(
  plugin: Plugin,
  code: string,
  id: string,
): { warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn()
  const error = vi.fn()
  const ctx = { warn, error } as unknown as ThisParameterType<
    Extract<Plugin['transform'], (...a: never) => unknown>
  >
  const transform = plugin.transform as (this: unknown, c: string, i: string) => unknown
  try {
    transform.call(ctx, code, id)
  } catch {
    // failOnWarning throws via this.error — ignore for these tests
  }
  return { warn }
}

describe('disabledWarnings option', () => {
  it('fires all rules when disabledWarnings is omitted', () => {
    const plugin = llui()
    const { warn } = runTransform(plugin, SRC_TWO_WARNINGS, '/tmp/a.ts')
    const messages = warn.mock.calls.map(([m]) => String(m))
    expect(messages.some((m) => /Namespace import/i.test(m))).toBe(true)
    expect(messages.some((m) => /Empty props/i.test(m))).toBe(true)
  })

  it('silences a single rule when listed', () => {
    const plugin = llui({ disabledWarnings: ['namespace-import'] })
    const { warn } = runTransform(plugin, SRC_TWO_WARNINGS, '/tmp/a.ts')
    const messages = warn.mock.calls.map(([m]) => String(m))
    expect(messages.some((m) => /Namespace import/i.test(m))).toBe(false)
    expect(messages.some((m) => /Empty props/i.test(m))).toBe(true)
  })

  it('silences multiple rules when listed', () => {
    const plugin = llui({ disabledWarnings: ['namespace-import', 'empty-props'] })
    const { warn } = runTransform(plugin, SRC_TWO_WARNINGS, '/tmp/a.ts')
    expect(warn).not.toHaveBeenCalled()
  })

  it('unknown rule names are ignored silently (no crash)', () => {
    // Cast through any to simulate a JS caller or stale typings.
    const plugin = llui({ disabledWarnings: ['not-a-real-rule' as never] })
    const { warn } = runTransform(plugin, SRC_TWO_WARNINGS, '/tmp/a.ts')
    // Both warnings should still fire
    expect(warn.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('message text includes rule name in brackets for discoverability', () => {
    const plugin = llui()
    const { warn } = runTransform(plugin, SRC_TWO_WARNINGS, '/tmp/a.ts')
    const messages = warn.mock.calls.map(([m]) => String(m))
    // Rule name prefixed so users know what to pass to disabledWarnings
    expect(messages.some((m) => m.includes('[namespace-import]'))).toBe(true)
    expect(messages.some((m) => m.includes('[empty-props]'))).toBe(true)
  })

  it('works with failOnWarning: disabled rule no longer errors', () => {
    const plugin = llui({
      failOnWarning: true,
      disabledWarnings: ['namespace-import', 'empty-props'],
    })
    const warn = vi.fn()
    const error = vi.fn(() => {
      throw new Error('should not be called')
    })
    const ctx = { warn, error } as unknown as ThisParameterType<
      Extract<Plugin['transform'], (...a: never) => unknown>
    >
    const transform = plugin.transform as (this: unknown, c: string, i: string) => unknown
    expect(() => transform.call(ctx, SRC_TWO_WARNINGS, '/tmp/a.ts')).not.toThrow()
    expect(error).not.toHaveBeenCalled()
  })
})
