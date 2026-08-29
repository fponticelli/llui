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
      '  return [ul([each(items, { key: (r) => r.id, render: (item) => [li([text(item.at("label"))])] })])]',
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
      "export const banner = () => div([text('hi')])",
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
      '  return [ul([each(items, { key: (r) => r.id, render: (item) => { const el = buildRow(item); attach(el); return [el] } })])]',
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
      '  return [ul([each(items, { key: (r) => r.id, render: (item) => [li([importedRow(item)])] })])]',
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

  // ── agent-annotation-syntax on NON-component modules (issue #89) ────────
  // A Msg union usually lives in a plain `msg.ts` with no `component(` call —
  // exactly where `@routeGated`/`@validates` are authored. Without this path
  // the rule would never see the file, and a malformed (therefore DROPPED)
  // predicate would ship as an ungated action / unchecked field.
  const MALFORMED_MSG = [
    'export type Msg =',
    '  /** @routeGated("state.mode === "admin"") */',
    "  | { type: 'purge' }",
    "  | { type: 'noop' }",
  ].join('\n')

  it('halts the build for a malformed annotation in a module with no component()', async () => {
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
    await expect(transform.call(ctx, MALFORMED_MSG, '/tmp/msg.ts')).rejects.toThrow('this.error')
    const msg = (errorMessages[0] as { message: string }).message
    expect(msg).toContain('agent-annotation-syntax')
    expect(msg).toContain('@routeGated')
  })

  it('leaves a WELL-FORMED annotation module alone (no error, no rewrite)', async () => {
    const good = MALFORMED_MSG.replace(
      '@routeGated("state.mode === "admin"")',
      '@routeGated("state.mode === \\"admin\\"", "admins only")',
    )
    const warn = vi.fn()
    const error = vi.fn(() => {
      throw new Error('this.error')
    })
    const ctx = {
      warn,
      error,
      resolve: vi.fn(async () => null),
    } as unknown as ThisParameterType<Extract<Plugin['transform'], (...a: never) => unknown>>
    const transform = llui().transform as (this: unknown, c: string, i: string) => unknown
    await expect(transform.call(ctx, good, '/tmp/msg.ts')).resolves.toBeUndefined()
    expect(error).not.toHaveBeenCalled()
  })

  // ── tag-send-drift on NON-component modules (issue #118) ────────────────
  // Same shape, same reason as the block above: `tagSend` is a LIBRARY-author
  // helper, so its canonical call site is a plain `connect()` module with no
  // `component(` call in it — which `lintSignalSource` never reaches. Without
  // this wiring the rule would cover only the rarest call sites, and dropping
  // `...lintTagSendSource(mod)` from the transform broke nothing.
  const DRIFTED_CONNECT = [
    "import { tagSend } from '@llui/dom'",
    'export const connect = (send) => ({',
    "  onClick: tagSend(send, ['touch'], () => send({ type: 'touched' })),",
    '})',
  ].join('\n')

  it('halts the build for a drifted tagSend in a module with no component()', async () => {
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
    await expect(transform.call(ctx, DRIFTED_CONNECT, '/tmp/connect.ts')).rejects.toThrow(
      'this.error',
    )
    const msg = (errorMessages[0] as { message: string }).message
    expect(msg).toContain('tag-send-drift')
    expect(msg).toContain('touched')
  })

  it('leaves a MATCHING tagSend module alone (no error, no rewrite)', async () => {
    const good = DRIFTED_CONNECT.replace("type: 'touched'", "type: 'touch'")
    const error = vi.fn(() => {
      throw new Error('this.error')
    })
    const ctx = {
      warn: vi.fn(),
      error,
      resolve: vi.fn(async () => null),
    } as unknown as ThisParameterType<Extract<Plugin['transform'], (...a: never) => unknown>>
    const transform = llui().transform as (this: unknown, c: string, i: string) => unknown
    await expect(transform.call(ctx, good, '/tmp/connect.ts')).resolves.toBeUndefined()
    expect(error).not.toHaveBeenCalled()
  })

  // ── imperative-dom-mutation on NON-component modules (issue #231) ───────
  // The incident's own code was a `CopyButton` view HELPER: a module that
  // builds elements with `@llui/dom` helpers and contains no `component(` call,
  // so it takes this branch. Wiring the rule only into `lintSignalSource` would
  // have left the reported shape uncovered.
  const IMPERATIVE_HELPER = [
    "import { button, span } from '@llui/dom'",
    'export const CopyButton = (label) =>',
    '  button({',
    '    onClick: (e) => {',
    '      const btn = e.currentTarget',
    "      btn.querySelector('.label').textContent = 'Copied!'",
    '    },',
    "  }, [span({ class: 'label' }, [])])",
  ].join('\n')

  it('halts the build for an imperative DOM write in a module with no component()', async () => {
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
    await expect(transform.call(ctx, IMPERATIVE_HELPER, '/tmp/copy-button.ts')).rejects.toThrow(
      'this.error',
    )
    const msg = (errorMessages[0] as { message: string }).message
    expect(msg).toContain('imperative-dom-mutation')
    expect(msg).toContain('textContent')
  })

  it('leaves the reactive rewrite of the same helper alone', async () => {
    const good = IMPERATIVE_HELPER.replace(
      "      const btn = e.currentTarget\n      btn.querySelector('.label').textContent = 'Copied!'",
      "      send({ type: 'copy' })",
    )
    const error = vi.fn(() => {
      throw new Error('this.error')
    })
    const ctx = {
      warn: vi.fn(),
      error,
      resolve: vi.fn(async () => null),
    } as unknown as ThisParameterType<Extract<Plugin['transform'], (...a: never) => unknown>>
    const transform = llui().transform as (this: unknown, c: string, i: string) => unknown
    await expect(transform.call(ctx, good, '/tmp/copy-button.ts')).resolves.toBeUndefined()
    expect(error).not.toHaveBeenCalled()
  })
})
