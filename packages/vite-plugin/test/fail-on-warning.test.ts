import { describe, it, expect, vi } from 'vitest'
import type { Plugin } from 'vite'
import llui from '../src/index'

// A source that reliably trips a diagnostic — namespace import of @llui/dom
// always fires `checkNamespaceImport`, regardless of other passes.
const SRC_WITH_WARNING = `
  import * as L from '@llui/dom'
  export const x = 1
`

function runTransform(
  plugin: Plugin,
  code: string,
  id: string,
): { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; threw: Error | null } {
  const warn = vi.fn()
  const error = vi.fn((msg: unknown) => {
    const text =
      typeof msg === 'string'
        ? msg
        : msg && typeof msg === 'object' && 'message' in msg
          ? String((msg as { message: string }).message)
          : String(msg)
    throw new Error(text)
  })
  const ctx = { warn, error } as unknown as ThisParameterType<
    Extract<Plugin['transform'], (...a: never) => unknown>
  >
  let threw: Error | null = null
  try {
    const transform = plugin.transform as (this: unknown, c: string, i: string) => unknown
    transform.call(ctx, code, id)
  } catch (err) {
    threw = err as Error
  }
  return { warn, error, threw }
}

describe('failOnWarning plugin option', () => {
  it('defaults to warning (non-fatal) when option is omitted', () => {
    const plugin = llui()
    const { warn, error, threw } = runTransform(plugin, SRC_WITH_WARNING, '/tmp/a.ts')
    expect(warn).toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(threw).toBeNull()
  })

  it('prefixes each warning with file:line:column', () => {
    const plugin = llui()
    const { warn } = runTransform(plugin, SRC_WITH_WARNING, '/tmp/my-file.ts')
    const [message] = warn.mock.calls[0] as [string]
    expect(message).toMatch(/my-file\.ts:\d+:\d+:/)
  })

  it('carries the same prefix through this.error when failOnWarning is set', () => {
    const plugin = llui({ failOnWarning: true })
    const { error } = runTransform(plugin, SRC_WITH_WARNING, '/tmp/my-file.ts')
    const [arg] = error.mock.calls[0] as [{ message: string }]
    expect(arg.message).toMatch(/my-file\.ts:\d+:\d+:/)
  })

  it('defaults to warning when failOnWarning is explicitly false', () => {
    const plugin = llui({ failOnWarning: false })
    const { warn, error, threw } = runTransform(plugin, SRC_WITH_WARNING, '/tmp/a.ts')
    expect(warn).toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(threw).toBeNull()
  })

  it('routes diagnostics through this.error when failOnWarning is true', () => {
    const plugin = llui({ failOnWarning: true })
    const { warn, error, threw } = runTransform(plugin, SRC_WITH_WARNING, '/tmp/a.ts')
    expect(error).toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(threw).not.toBeNull()
  })

  it('does not fire on files without diagnostics', () => {
    const plugin = llui({ failOnWarning: true })
    const { warn, error, threw } = runTransform(
      plugin,
      `import { div } from '@llui/dom'\nexport const x = div({ class: 'ok' }, [])`,
      '/tmp/a.ts',
    )
    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(threw).toBeNull()
  })
})
