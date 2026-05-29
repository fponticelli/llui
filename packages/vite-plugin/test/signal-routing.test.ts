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

  it('halts the build (this.error) when a signal component violates a lint rule', async () => {
    // operator on a signal in a reactive slot — operator-on-signal
    const bad = [
      "import { component } from '@llui/dom'",
      'export const Bad = component({',
      '  init: () => ({ n: 0 }),',
      '  update: (s) => s,',
      "  view: ({ state }) => [text(state.at('n') + 1)],",
      '})',
    ].join('\n')
    const warn = vi.fn()
    const errorMessages: unknown[] = []
    const error = vi.fn((e: unknown) => {
      errorMessages.push(e)
      throw new Error('this.error')
    })
    const ctx = { warn, error, resolve: vi.fn(async () => null) } as unknown as ThisParameterType<
      Extract<Plugin['transform'], (...a: never) => unknown>
    >
    const transform = llui().transform as (this: unknown, c: string, i: string) => unknown
    await expect(transform.call(ctx, bad, '/tmp/bad.ts')).rejects.toThrow('this.error')
    expect(error).toHaveBeenCalledOnce()
    const msg = (errorMessages[0] as { message: string }).message
    expect(msg).toContain('signal lint failed')
    expect(msg).toContain('operator-on-signal')
  })

  it('fails the build when a signal view cannot be lowered (block body)', async () => {
    const blockBody = [
      "import { component } from '@llui/dom'",
      "import { text } from '@llui/dom/signals'",
      'export const C = component({',
      '  init: () => ({ n: 0 }),',
      '  update: (s) => s,',
      '  view: ({ state }) => { const x = 1; return [text(state.at("n"))] },',
      '})',
    ].join('\n')
    const errors: unknown[] = []
    const error = vi.fn((e: unknown) => {
      errors.push(e)
      throw new Error('this.error')
    })
    const ctx = {
      warn: vi.fn(),
      error,
      resolve: vi.fn(async () => null),
    } as unknown as ThisParameterType<Extract<Plugin['transform'], (...a: never) => unknown>>
    const transform = llui().transform as (this: unknown, c: string, i: string) => unknown
    await expect(transform.call(ctx, blockBody, '/tmp/block.ts')).rejects.toThrow('this.error')
    const msg = String(errors[0])
    expect(msg).toContain('was not lowered')
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
