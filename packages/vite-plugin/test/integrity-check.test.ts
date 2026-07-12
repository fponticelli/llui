import { describe, it, expect } from 'vitest'
import type { Plugin } from 'vite'
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
  view: ({ state }) => [div({}, text(state.map((s) => String(s.count))))],
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

async function runTransform(plugin: Plugin, code: string, id: string): Promise<void> {
  const hook = plugin.transform as
    | ((this: unknown, code: string, id: string, opts?: unknown) => Promise<unknown>)
    | { handler: (this: unknown, code: string, id: string, opts?: unknown) => Promise<unknown> }
    | undefined
  if (!hook) throw new Error('plugin has no transform hook')
  const fn = typeof hook === 'function' ? hook : hook.handler
  await fn.call(transformCtx(), code, id, undefined)
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

async function bootPluginForBuild(): Promise<Plugin> {
  const plugin = llui()
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

describe('post-bundle property rename (provenance-scoped)', () => {
  it('renames LLui-emitted keys only in chunks that contain compiled modules', async () => {
    const plugin = await bootPluginForBuild()
    await runTransform(plugin, SIGNAL_SOURCE, '/proj/Counter.ts')
    const bundle: Record<string, BundleChunk> = {
      // Compiled chunk: carries an LLui-emitted key and the compiled module id.
      'app.js': {
        type: 'chunk',
        code: 'const d = { __msgSchema: 1, __prefixes: 2 }',
        moduleIds: ['/proj/Counter.ts'],
      },
      // Third-party chunk: same-looking key, but no compiled module → untouched.
      'vendor.js': {
        type: 'chunk',
        code: 'const v = { __msgSchema: 9 }',
        moduleIds: ['/proj/node_modules/foo/index.js'],
      },
    }
    expect(runGenerateBundle(plugin, bundle)).toBeNull()
    expect(bundle['app.js']!.code).not.toContain('__msgSchema')
    expect(bundle['app.js']!.code).not.toContain('__prefixes')
    // The vendor chunk keeps its identifier — provenance kept us out.
    expect(bundle['vendor.js']!.code).toContain('__msgSchema')
  })

  it('never rewrites the generic __update / __dirty names', async () => {
    const plugin = await bootPluginForBuild()
    await runTransform(plugin, SIGNAL_SOURCE, '/proj/Counter.ts')
    const bundle: Record<string, BundleChunk> = {
      'app.js': {
        type: 'chunk',
        code: 'const d = { __update: 1, __dirty: 2, __msgSchema: 3 }',
        moduleIds: ['/proj/Counter.ts'],
      },
    }
    runGenerateBundle(plugin, bundle)
    expect(bundle['app.js']!.code).toContain('__update')
    expect(bundle['app.js']!.code).toContain('__dirty')
    // But the LLui-distinctive key is still shortened.
    expect(bundle['app.js']!.code).not.toContain('__msgSchema')
  })
})
