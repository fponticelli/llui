import { describe, it, expect, vi } from 'vitest'
import type { Plugin } from 'vite'
import llui from '../src/index'

// Invoke the plugin's transform hook directly, like the other plugin tests.
async function runTransform(
  plugin: Plugin,
  code: string,
  id: string,
): Promise<{ code: string } | undefined> {
  const warn = vi.fn()
  const error = vi.fn(() => {
    throw new Error('this.error')
  })
  const resolve = vi.fn(async () => null)
  const ctx = { warn, error, resolve } as unknown as ThisParameterType<
    Extract<Plugin['transform'], (...a: never) => unknown>
  >
  const transform = plugin.transform as (this: unknown, c: string, i: string) => unknown
  const out = (await transform.call(ctx, code, id)) as { code: string } | undefined
  return out
}

const SIGNAL_COMPONENT = [
  "import { component } from '@llui/dom'",
  'export const Counter = component({',
  '  init: () => ({ count: 0 }),',
  '  update: (s) => ({ count: s.count + 1 }),',
  "  view: ({ state, send }) => [text(state.at('count')), button({ onClick: () => send({ type: 'inc' }) }, [text('+')])],",
  '})',
].join('\n')

describe('vite-plugin — signal component routing', () => {
  it('lowers a signal component and injects the @llui/dom/signals import', async () => {
    const out = await runTransform(llui(), SIGNAL_COMPONENT, '/tmp/counter.ts')
    expect(out).toBeDefined()
    expect(out!.code).toContain("from '@llui/dom/signals'")
    expect(out!.code).toContain("signalText((s) => s.count, ['count'])")
    expect(out!.code).toContain('el("button"')
    // the legacy compiler did NOT run: no elSplit / mask emission
    expect(out!.code).not.toContain('elSplit')
    expect(out!.code).not.toContain('__dirty')
  })

  it('does not touch a file with no .at( signal usage', async () => {
    const legacy = [
      "import { component } from '@llui/dom'",
      'const L = component({ init: () => ({ n: 0 }), update: (s) => s, view: (h) => [h.text((s) => String(s.n))] })',
    ].join('\n')
    // legacy path may or may not transform, but it must NOT be the signal lowering
    const out = await runTransform(llui(), legacy, '/tmp/legacy.ts')
    const code = out?.code ?? legacy
    expect(code).not.toContain("from '@llui/dom/signals'")
    expect(code).not.toContain('signalText(')
  })
})
