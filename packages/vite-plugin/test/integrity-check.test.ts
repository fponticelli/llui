import { describe, it, expect, vi } from 'vitest'
import type { Plugin } from 'vite'
import llui from '../src/index'

/**
 * Build-time integrity check (v2a §2.4 / shared.md §20.12).
 *
 * Every compiled `component()` call carries a `__lluiCompilerEmitted: 1`
 * marker. The plugin's `generateBundle` hook scans the final bundle for
 * that literal; zero occurrences in a production build means another
 * transform consumed TS ahead of `@llui/vite-plugin` (plugin-order bug)
 * or the project has no LLui components. Either way, fail closed — the
 * v2b runtime would silently degrade to FULL_MASK without this gate.
 */

interface BundleChunk {
  type: 'chunk' | 'asset'
  code?: string
}

function runGenerateBundle(plugin: Plugin, bundle: Record<string, BundleChunk>): string | null {
  // Capture the this.error message without throwing.
  let captured: string | null = null
  const ctx = {
    error: (msg: string | Error) => {
      captured = typeof msg === 'string' ? msg : msg.message
    },
  }
  const hook = plugin.generateBundle as
    | ((this: unknown, opts: unknown, bundle: unknown) => void)
    | undefined
  if (!hook) throw new Error('plugin has no generateBundle hook')
  hook.call(ctx, { dir: 'dist' }, bundle)
  return captured
}

async function bootPluginForBuild(): Promise<Plugin> {
  // Disable cross-file walking — these tests focus on the
  // `transform` / `generateBundle` integrity contract, not path
  // resolution. With the default `'silent'`, the first transform call
  // would build a TS Program over the whole repo's tsconfig, which on
  // a CI runner takes well over the default 5s test timeout.
  const plugin = llui({ crossFile: false })
  // Simulate a `vite build` resolved-config: command === 'build', mode === 'production'.
  const configResolved = plugin.configResolved as ((c: unknown) => Promise<void>) | undefined
  await configResolved?.call(plugin, {
    command: 'build',
    mode: 'production',
    root: process.cwd(),
  })
  return plugin
}

describe('build-time integrity check (v2a §2.4)', () => {
  it('fires when the bundle contains zero `__lluiCompilerEmitted` markers', async () => {
    const plugin = await bootPluginForBuild()
    const bundle: Record<string, BundleChunk> = {
      'main.js': {
        type: 'chunk',
        code: 'export const x = 1; console.log("hello, world")',
      },
    }
    const msg = runGenerateBundle(plugin, bundle)
    expect(msg).not.toBeNull()
    expect(msg).toMatch(/integrity check failed/)
    expect(msg).toMatch(/__lluiCompilerEmitted/)
  })

  it('passes when at least one chunk carries the marker', async () => {
    const plugin = await bootPluginForBuild()
    const bundle: Record<string, BundleChunk> = {
      'main.js': {
        type: 'chunk',
        code: 'export const C = component({name:"C", __lluiCompilerEmitted: 1})',
      },
    }
    const msg = runGenerateBundle(plugin, bundle)
    expect(msg).toBeNull()
  })

  it('passes when the marker appears across multiple chunks', async () => {
    const plugin = await bootPluginForBuild()
    const bundle: Record<string, BundleChunk> = {
      'a.js': { type: 'chunk', code: 'export const x = 1' },
      'b.js': { type: 'chunk', code: 'export const C = ({__lluiCompilerEmitted:1})' },
    }
    expect(runGenerateBundle(plugin, bundle)).toBeNull()
  })

  it('skips assets (only chunks are scanned)', async () => {
    const plugin = await bootPluginForBuild()
    const bundle: Record<string, BundleChunk> = {
      'sprite.svg': {
        type: 'asset',
        // Even if the marker text appeared in an asset, it would not count.
        code: '__lluiCompilerEmitted everywhere',
      },
    }
    const msg = runGenerateBundle(plugin, bundle)
    expect(msg).toMatch(/integrity check failed/)
  })

  it('skips the check entirely in dev mode (no error on empty bundle)', async () => {
    const plugin = llui()
    const configResolved = plugin.configResolved as ((c: unknown) => Promise<void>) | undefined
    await configResolved?.call(plugin, {
      command: 'serve',
      mode: 'development',
      root: process.cwd(),
    })
    const bundle: Record<string, BundleChunk> = {
      'main.js': { type: 'chunk', code: 'export const x = 1' },
    }
    expect(runGenerateBundle(plugin, bundle)).toBeNull()
  })

  it('integrates with `transform`: a compiled component leaves the marker in the output', async () => {
    const plugin = await bootPluginForBuild()
    const source = `
      import { component, div, text } from '@llui/dom'
      export const C = component({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (s) => [s, []],
        view: ({ text }) => [div({}, [text((s) => String(s.count))])],
      })
    `
    const transform = plugin.transform as unknown as (
      this: unknown,
      c: string,
      i: string,
    ) => Promise<{ code: string } | undefined>
    const out = await transform.call(
      {
        warn: vi.fn(),
        error: vi.fn(),
        resolve: vi.fn(async () => null),
      },
      source,
      '/tmp/fixture.ts',
    )
    expect(out).toBeDefined()
    expect(out!.code).toMatch(/__lluiCompilerEmitted/)
  })
})
