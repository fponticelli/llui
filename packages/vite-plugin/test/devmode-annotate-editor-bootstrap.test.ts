import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import llui from '../src/index'

const HUD_VMOD_ID = 'virtual:llui-devmode-annotate-init'

function provisionPackage(root: string, name: string): string {
  const pkgDir = resolve(root, 'node_modules', ...name.split('/'))
  const entry = resolve(pkgDir, 'dist', 'index.js')
  mkdirSync(resolve(pkgDir, 'dist'), { recursive: true })
  writeFileSync(
    resolve(pkgDir, 'package.json'),
    JSON.stringify({ name, exports: { '.': { import: './dist/index.js' } } }),
  )
  writeFileSync(entry, 'export {}\n')
  return entry
}

function bootstrapSource(plugin: Plugin): string {
  const resolved = (plugin.resolveId as (id: string) => string | undefined)(HUD_VMOD_ID)
  expect(resolved).toBeTruthy()
  return (plugin.load as (id: string) => string)(resolved!)
}

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(resolve(tmpdir(), 'llui-annotate-editor-bootstrap-'))
  writeFileSync(resolve(tmpRoot, 'package.json'), JSON.stringify({ name: 'test' }))
  mkdirSync(resolve(tmpRoot, 'node_modules'), { recursive: true })
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('devmode annotate editor bootstrap', () => {
  it('mounts core without importing an editor when the optional package is absent', async () => {
    const coreEntry = provisionPackage(tmpRoot, '@llui/devmode-annotate')
    const plugin = llui()
    await (plugin.configResolved as (config: unknown) => Promise<void>)({
      root: tmpRoot,
      command: 'serve',
      mode: 'development',
      plugins: [],
    })

    const source = bootstrapSource(plugin)
    expect(source).toContain(JSON.stringify(coreEntry))
    expect(source).not.toContain('devmode-annotate-editor')
  })

  it('registers the optional editor before mounting core', async () => {
    const coreEntry = provisionPackage(tmpRoot, '@llui/devmode-annotate')
    const editorEntry = provisionPackage(tmpRoot, '@llui/devmode-annotate-editor')
    const plugin = llui()
    await (plugin.configResolved as (config: unknown) => Promise<void>)({
      root: tmpRoot,
      command: 'serve',
      mode: 'development',
      plugins: [],
    })

    const source = bootstrapSource(plugin)
    const editorImport = source.indexOf(`import ${JSON.stringify(editorEntry)}`)
    const coreImport = source.indexOf(
      `import { mountAnnotateHud } from ${JSON.stringify(coreEntry)}`,
    )
    expect(editorImport).toBeGreaterThanOrEqual(0)
    expect(coreImport).toBeGreaterThan(editorImport)
    expect(source.indexOf('mountAnnotateHud(')).toBeGreaterThan(coreImport)
  })
})
