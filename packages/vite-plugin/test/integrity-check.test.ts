import { describe, it, expect } from 'vitest'
import type { Plugin } from 'vite'
import { COMPILER_META_KEYS } from '@llui/compiler'
import llui from '../src/index'

/**
 * Build-time integrity check.
 *
 * The signal transform is the only compilation path; it sets an internal
 * `sawSignalComponent` flag the moment it lowers a `component()` file. If a
 * production `generateBundle` runs without that flag ever being set, another
 * transform consumed the TS ahead of `@llui/vite-plugin` (plugin-order bug)
 * or the project has no LLui components — either way, fail closed.
 *
 * These tests drive the REAL pipeline (configResolved → transform →
 * generateBundle) rather than hand-writing bundle markers, because the live
 * transform never emits the old `__lluiCompilerEmitted` marker the previous
 * tests asserted on.
 */

const SIGNAL_SOURCE = `import { component, div, text } from '@llui/dom'
type State = { count: number }
type Msg = { type: 'inc' }
export const Counter = component<State, Msg>({
  name: 'Counter',
  init: () => ({ count: 0 }),
  update: (s) => [s, []],
  view: ({ state }) => [div([text(state.map((s) => String(s.count)))])],
})
`

interface BundleChunk {
  type: 'chunk' | 'asset'
  code?: string
  map?: unknown
  moduleIds?: string[]
}

/** Minimal Rollup plugin-context stand-in for the transform hook. */
function transformCtx(): {
  error: (msg: string | { message: string }) => never
  warn: () => void
} {
  return {
    error: (msg) => {
      throw new Error(typeof msg === 'string' ? msg : msg.message)
    },
    warn: () => {},
  }
}

async function runTransform(plugin: Plugin, code: string, id: string): Promise<string> {
  const hook = plugin.transform as
    | ((this: unknown, code: string, id: string, opts?: unknown) => Promise<unknown>)
    | { handler: (this: unknown, code: string, id: string, opts?: unknown) => Promise<unknown> }
    | undefined
  if (!hook) throw new Error('plugin has no transform hook')
  const fn = typeof hook === 'function' ? hook : hook.handler
  const out = await fn.call(transformCtx(), code, id, undefined)
  if (typeof out === 'string') return out
  if (out !== null && typeof out === 'object' && 'code' in out) {
    const { code: emitted } = out as { code?: unknown }
    if (typeof emitted === 'string') return emitted
  }
  return code
}

/** Run generateBundle, capturing (not throwing) the this.error message. */
function runGenerateBundle(plugin: Plugin, bundle: Record<string, BundleChunk>): string | null {
  let captured: string | null = null
  const ctx = {
    error: (msg: string | Error) => {
      captured = typeof msg === 'string' ? msg : msg.message
    },
  }
  const hook = plugin.generateBundle as
    | ((this: unknown, opts: unknown, bundle: unknown) => void)
    | { handler: (this: unknown, opts: unknown, bundle: unknown) => void }
    | undefined
  if (!hook) throw new Error('plugin has no generateBundle hook')
  const fn = typeof hook === 'function' ? hook : hook.handler
  fn.call(ctx, { dir: 'dist' }, bundle)
  return captured
}

async function bootPluginForBuild(opts: { agent?: boolean } = {}): Promise<Plugin> {
  const plugin = llui(opts)
  const configResolved = plugin.configResolved as
    | ((this: unknown, c: unknown) => Promise<void>)
    | { handler: (this: unknown, c: unknown) => Promise<void> }
    | undefined
  const fn = typeof configResolved === 'function' ? configResolved : configResolved?.handler
  await fn?.call(plugin, { command: 'build', mode: 'production', root: process.cwd() })
  return plugin
}

describe('build-time integrity check', () => {
  it('passes after the transform actually compiles a signal component', async () => {
    const plugin = await bootPluginForBuild()
    await runTransform(plugin, SIGNAL_SOURCE, '/proj/Counter.ts')
    const bundle: Record<string, BundleChunk> = {
      'main.js': { type: 'chunk', code: 'export const x = 1', moduleIds: ['/proj/Counter.ts'] },
    }
    expect(runGenerateBundle(plugin, bundle)).toBeNull()
  })

  it('fires when no signal component ever went through the transform', async () => {
    const plugin = await bootPluginForBuild()
    // A non-signal module: no `component(` / `@llui/dom` import → transform
    // is a no-op and the flag stays unset.
    await runTransform(plugin, 'export const x = 1', '/proj/plain.ts')
    const bundle: Record<string, BundleChunk> = {
      'main.js': { type: 'chunk', code: 'export const x = 1' },
    }
    const msg = runGenerateBundle(plugin, bundle)
    expect(msg).not.toBeNull()
    expect(msg).toMatch(/integrity check failed/)
  })

  it('does not persist the flag across plugin instances', async () => {
    // Instance A compiles a component and passes.
    const a = await bootPluginForBuild()
    await runTransform(a, SIGNAL_SOURCE, '/proj/Counter.ts')
    expect(runGenerateBundle(a, { 'main.js': { type: 'chunk', code: 'x' } })).toBeNull()

    // A fresh instance B has NOT seen any component → must fail closed.
    const b = await bootPluginForBuild()
    const msg = runGenerateBundle(b, { 'main.js': { type: 'chunk', code: 'x' } })
    expect(msg).toMatch(/integrity check failed/)
  })

  it('skips the check entirely in dev mode', async () => {
    const plugin = llui()
    const configResolved = plugin.configResolved as
      | ((this: unknown, c: unknown) => Promise<void>)
      | { handler: (this: unknown, c: unknown) => Promise<void> }
      | undefined
    const fn = typeof configResolved === 'function' ? configResolved : configResolved?.handler
    await fn?.call(plugin, { command: 'serve', mode: 'development', root: process.cwd() })
    const bundle: Record<string, BundleChunk> = {
      'main.js': { type: 'chunk', code: 'export const x = 1' },
    }
    expect(runGenerateBundle(plugin, bundle)).toBeNull()
  })
})

describe('code-split-safe metadata keys (issue #45)', () => {
  it('leaves an agent build’s compiled chunk byte-identical', async () => {
    const plugin = await bootPluginForBuild({ agent: true })
    const compiled = await runTransform(plugin, SIGNAL_SOURCE, '/proj/Counter.ts')
    // Sanity: this really is an agent build carrying metadata to protect.
    // (Only the keys SIGNAL_SOURCE earns: it declares no Effect type and no
    // JSDoc annotations, and component meta is dev-only.)
    for (const key of [
      COMPILER_META_KEYS.msgSchema,
      COMPILER_META_KEYS.stateSchema,
      COMPILER_META_KEYS.schemaHash,
    ]) {
      expect(compiled).toContain(`${key}:`)
    }
    // The realistic `manualChunks: { vendor: ['@llui/dom'] }` split: the compiled
    // component literal lands in `app.js`, the runtime that READS its metadata
    // keys lands in `vendor.js`. A bundle-time rewrite of one and not the other
    // yields `undefined` schemas in production with no error anywhere — so the
    // bundle must leave BOTH sides exactly as emitted.
    const vendorCode = `const read = (d) => d[${JSON.stringify(COMPILER_META_KEYS.msgSchema)}]`
    const bundle: Record<string, BundleChunk> = {
      'app.js': { type: 'chunk', code: compiled, moduleIds: ['/proj/Counter.ts'] },
      'vendor.js': {
        type: 'chunk',
        code: vendorCode,
        moduleIds: ['/proj/node_modules/@llui/dom/dist/index.js'],
      },
    }
    expect(runGenerateBundle(plugin, bundle)).toBeNull()
    expect(bundle['app.js']!.code).toBe(compiled)
    expect(bundle['vendor.js']!.code).toBe(vendorCode)
  })

  it('never rewrites identifiers in a compiled chunk', async () => {
    const plugin = await bootPluginForBuild()
    await runTransform(plugin, SIGNAL_SOURCE, '/proj/Counter.ts')
    // A chunk with LLui provenance carrying `__`-prefixed names of three
    // different origins (an LLui-historical key, Vite's, a user's): the plugin
    // is out of the bundle-rewriting business entirely, so all survive verbatim.
    const code = 'const d = { __msgSchema: 1, __vite__mapDeps: 2, __LLUI_STATE__: 3 }'
    const bundle: Record<string, BundleChunk> = {
      'app.js': { type: 'chunk', code, moduleIds: ['/proj/Counter.ts'] },
    }
    expect(runGenerateBundle(plugin, bundle)).toBeNull()
    expect(bundle['app.js']!.code).toBe(code)
  })
})
