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
  "import { component, text, button } from '@llui/dom'",
  'export const Counter = component({',
  '  init: () => ({ count: 0 }),',
  '  update: (s) => ({ count: s.count + 1 }),',
  "  view: ({ state, send }) => [text(state.at('count')), button({ onClick: () => send({ type: 'inc' }) }, [text('+')])],",
  '})',
].join('\n')

describe('vite-plugin — signal component routing', () => {
  it('lowers a signal component and injects the @llui/dom import', async () => {
    const out = await runTransform(llui(), SIGNAL_COMPONENT, '/tmp/counter.ts')
    expect(out).toBeDefined()
    expect(out!.code).toContain("from '@llui/dom'")
    expect(out!.code).toContain("signalText((s) => s.count, ['count'])")
    expect(out!.code).toContain('el("button"')
    // the legacy compiler did NOT run: no elSplit / mask emission
    expect(out!.code).not.toContain('elSplit')
    expect(out!.code).not.toContain('__dirty')
  })

  it('halts the build (this.error) when a signal component violates a lint rule', async () => {
    // operator on a signal in a reactive slot — operator-on-signal
    const bad = [
      "import { component, text } from '@llui/dom'",
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

  it('auto-applies a `convention` fix (tabIndex → tabindex) + warns, build proceeds', async () => {
    const src = [
      "import { component, div, text } from '@llui/dom'",
      'export const C = component({',
      '  init: () => ({ n: 0 }),',
      '  update: (s) => s,',
      "  view: ({ state, send }) => [div({ role: 'button', tabIndex: 0, onClick: () => send({ type: 'x' }) }, [text('hi')])],",
      '})',
    ].join('\n')
    const warn = vi.fn()
    const error = vi.fn(() => {
      throw new Error('this.error')
    })
    const ctx = { warn, error, resolve: vi.fn(async () => null) } as unknown as ThisParameterType<
      Extract<Plugin['transform'], (...a: never) => unknown>
    >
    const transform = llui().transform as (this: unknown, c: string, i: string) => unknown
    const out = (await transform.call(ctx, src, '/tmp/conv.ts')) as { code: string }
    expect(error).not.toHaveBeenCalled() // convention does NOT halt
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]![0] as string).toContain('auto-fixed')
    expect(out.code).toContain('tabindex: 0')
    expect(out.code).not.toContain('tabIndex')
  })

  it('STILL halts on a correctness casing bug (miscased handler), even though it has a fix', async () => {
    const bad = [
      "import { component, div, text } from '@llui/dom'",
      'export const Bad = component({',
      '  init: () => ({ n: 0 }),',
      '  update: (s) => s,',
      "  view: ({ state, send }) => [div({ onclick: () => send({ type: 'x' }) }, [text('hi')])],",
      '})',
    ].join('\n')
    const errorMessages: unknown[] = []
    const error = vi.fn((e: unknown) => {
      errorMessages.push(e)
      throw new Error('this.error')
    })
    const ctx = {
      warn: vi.fn(),
      error,
      resolve: vi.fn(async () => null),
    } as unknown as ThisParameterType<Extract<Plugin['transform'], (...a: never) => unknown>>
    const transform = llui().transform as (this: unknown, c: string, i: string) => unknown
    await expect(transform.call(ctx, bad, '/tmp/handler.ts')).rejects.toThrow('this.error')
    expect((errorMessages[0] as { message: string }).message).toContain('event-handler-casing')
  })

  it('lowers a block-body signal view (returned array rewritten, statements preserved)', async () => {
    const blockBody = [
      "import { component, text } from '@llui/dom'",
      'export const C = component({',
      '  init: () => ({ n: 0 }),',
      '  update: (s) => s,',
      '  view: ({ state }) => { const x = 1; return [text(state.at("n"))] },',
      '})',
    ].join('\n')
    const out = await runTransform(llui(), blockBody, '/tmp/block.ts')
    expect(out).toBeDefined()
    // the returned array is lowered (block bodies are no longer skipped)
    expect(out!.code).toContain("signalText((s) => s.n, ['n'])")
    // the block's statements survive
    expect(out!.code).toContain('const x = 1')
    expect(out!.code).toContain('@llui/dom')
  })

  it('routes a HELPER-ONLY file (each, no component) so pass-2 lowers its rows', async () => {
    // Real apps put most eaches in view-helper modules with no component( call.
    // The old pre-check skipped them entirely, so their rows ran verbatim in
    // production regardless of lowerability.
    const helperOnly = [
      "import { ul, li, text, each, type Signal } from '@llui/dom'",
      'export function rows(items: Signal<readonly { id: number; label: string }[]>) {',
      '  return [ul({}, [each(items, { key: (r) => r.id, render: (item) => [li({}, [text(item.at("label"))])] })])]',
      '}',
    ].join('\n')
    const out = await runTransform(llui(), helperOnly, '/tmp/rows-helper.ts')
    expect(out).toBeDefined()
    expect(out!.code).toMatch(/(?<![A-Za-z])eachDirect\(/) // helper each lowered
    expect(out!.code).toContain("import { eachDirect } from '@llui/dom'")
  })

  it('still skips files with no @llui/dom import and dom files with neither component nor each', async () => {
    const noImport =
      'export function rows() { return each([], { key: (r) => r, render: () => [] }) }'
    expect(await runTransform(llui(), noImport, '/tmp/no-import.ts')).toBeUndefined()
    const domNoPrimitives = [
      "import { div, text } from '@llui/dom'",
      "export const banner = () => div({}, [text('hi')])",
    ].join('\n')
    expect(await runTransform(llui(), domNoPrimitives, '/tmp/banner.ts')).toBeUndefined()
  })

  it('warns llui/each-verbatim in dev for an each that cannot lower', async () => {
    const plugin = llui()
    await (plugin.configResolved as (c: unknown) => unknown).call(plugin, {
      command: 'serve',
      mode: 'development',
      root: '/tmp',
    })
    const verbatimEach = [
      "import { ul, li, text, each, type Signal } from '@llui/dom'",
      'export function rows(items: Signal<readonly { id: number }[]>) {',
      '  return [ul({}, [each(items, { key: (r) => r.id, render: (item) => { const el = buildRow(item); attach(el); return [el] } })])]',
      '}',
    ].join('\n')
    const warn = vi.fn()
    const error = vi.fn(() => {
      throw new Error('this.error')
    })
    const ctx = { warn, error, resolve: vi.fn(async () => null) } as unknown as ThisParameterType<
      Extract<Plugin['transform'], (...a: never) => unknown>
    >
    const transform = plugin.transform as (this: unknown, c: string, i: string) => unknown
    await transform.call(ctx, verbatimEach, '/tmp/rows.ts')
    const messages = warn.mock.calls.map((c) => String(c[0]))
    expect(messages.some((m) => m.includes('[llui/each-verbatim]'))).toBe(true)
    expect(messages.some((m) => m.includes('row-body-not-array'))).toBe(true)
  })

  it('stays silent with perfDiagnostics: false', async () => {
    const plugin = llui({ perfDiagnostics: false })
    await (plugin.configResolved as (c: unknown) => unknown).call(plugin, {
      command: 'serve',
      mode: 'development',
      root: '/tmp',
    })
    const verbatimEach = [
      "import { ul, li, text, each } from '@llui/dom'",
      'export function rows(items) {',
      '  return [ul({}, [each(items, { key: (r) => r.id, render: (item) => [li({}, [importedRow(item)])] })])]',
      '}',
    ].join('\n')
    const warn = vi.fn()
    const ctx = {
      warn,
      error: vi.fn(),
      resolve: vi.fn(async () => null),
    } as unknown as ThisParameterType<Extract<Plugin['transform'], (...a: never) => unknown>>
    const transform = plugin.transform as (this: unknown, c: string, i: string) => unknown
    await transform.call(ctx, verbatimEach, '/tmp/rows.ts')
    expect(warn.mock.calls.every((c) => !String(c[0]).includes('each-verbatim'))).toBe(true)
  })

  it('routes a barrel-imported component with no literal `@llui/dom` import', async () => {
    // The runtime surface is often re-exported through a project barrel, so
    // `from '@llui/dom'` never appears literally. The old gate required that
    // literal and silently SKIPPED these files entirely (no transform, no
    // relay, no lint). The fallback routes any qualifying module with a
    // `component(`. Proof of routing: in dev+MCP mode a routed signal file
    // gets the relay bootstrap injected; a skipped file returns `undefined`.
    const barrel = [
      "import { component, text, button } from './framework'",
      'export const Counter = component({',
      '  init: () => ({ count: 0 }),',
      '  update: (s) => ({ count: s.count + 1 }),',
      "  view: ({ state, send }) => [text(state.at('count')), button({ onClick: () => send({ type: 'inc' }) }, [text('+')])],",
      '})',
    ].join('\n')
    const plugin = llui({ mcpPort: 5200 })
    await (plugin.configResolved as (c: unknown) => unknown).call(plugin, {
      command: 'serve',
      mode: 'development',
      root: '/tmp',
    })
    const out = await runTransform(plugin, barrel, '/tmp/barrel-counter.ts')
    expect(out).toBeDefined()
    // Routed → relay bootstrap injected. (Old gate: this file was skipped.)
    expect(out!.code).toContain('__llui_startRelay(5200)')

    // A control: a plain module with no `component(` and no `@llui/dom` import
    // is still skipped (returns undefined) — the fallback is component-gated.
    const plain = 'export const x = 1'
    expect(await runTransform(plugin, plain, '/tmp/plain.ts')).toBeUndefined()
  })

  it('routes a queried id and a .mts module', async () => {
    // A Vite query suffix must not slip the file past the extension gate, and
    // `.mts`/`.cts` are valid TS module extensions.
    const queried = await runTransform(llui(), SIGNAL_COMPONENT, '/tmp/counter.tsx?v=abc123')
    expect(queried).toBeDefined()
    expect(queried!.code).toContain("signalText((s) => s.count, ['count'])")

    const mts = await runTransform(llui(), SIGNAL_COMPONENT, '/tmp/counter.mts')
    expect(mts).toBeDefined()
    expect(mts!.code).toContain("signalText((s) => s.count, ['count'])")
  })

  it('injects the MCP relay startup into signal files in dev (guarded once)', async () => {
    const plugin = llui({ mcpPort: 5200 })
    // simulate Vite dev resolution so devMode + mcpPort are set
    await (plugin.configResolved as (c: unknown) => unknown).call(plugin, {
      command: 'serve',
      mode: 'development',
      root: '/tmp',
    })
    const out = await runTransform(plugin, SIGNAL_COMPONENT, '/tmp/counter.ts')
    expect(out!.code).toContain('__llui_startRelay(5200)')
    expect(out!.code).toContain('__lluiRelayStarted') // start-once guard
    expect(out!.code).toContain("from '@llui/dom'") // still lowered
  })
})
