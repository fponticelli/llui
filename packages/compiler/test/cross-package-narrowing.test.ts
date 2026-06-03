import { describe, it, expect, afterAll } from 'vitest'
import ts from 'typescript'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crossFileAccessorPaths } from '../src/cross-file-walker.js'
import { clearManifestCache } from '../src/manifest-resolve.js'
import { serializeManifest } from '../src/manifest-io.js'
import { COMPILER_VERSION } from '../src/version.js'
import type { Manifest } from '../src/manifest.js'

// Headline end-to-end proof: a consumer calls a precompiled package's helper in
// a reactive accessor — `text((s) => itemFill(s, 1))`. With the package's
// `__llui_deps.json` present, the compiler narrows the binding to the exact
// state paths itemFill reads; without it, the binding coarsens to opaque
// (FULL_MASK). This is the whole point of the cross-package library ABI.

const ROOTS: string[] = []
afterAll(() => {
  for (const r of ROOTS) rmSync(r, { recursive: true, force: true })
})

const ITEMFILL_DTS =
  `export declare function itemFill(` +
  `state: { value: number; hoveredValue?: number; allowHalf?: boolean }, index: number` +
  `): 'full' | 'half' | 'empty';\n`

const APP = `
import { itemFill } from '@fix/lib'
declare function text(f: (s: { value: number; hoveredValue?: number; allowHalf?: boolean }) => string): unknown
export const node = text((s) => itemFill(s, 1))
`

function manifest(): Manifest {
  return {
    version: 2,
    compilerVersion: COMPILER_VERSION,
    helpers: {
      'index#itemFill': {
        kind: 'view-helper',
        helperLocalPaths: [],
        viaParams: [
          { index: 0, shape: 'state-value', reads: ['value', 'hoveredValue', 'allowHalf'] },
          { index: 1, shape: 'opaque' },
        ],
      },
    },
    components: {},
  }
}

// `manifestText: null` ships no manifest; a string ships it verbatim.
function fixture(manifestText: string | null): { program: ts.Program; appSf: ts.SourceFile } {
  const root = mkdtempSync(join(tmpdir(), 'llui-xpkg-'))
  ROOTS.push(root)
  const libDist = join(root, 'node_modules', '@fix', 'lib', 'dist')
  mkdirSync(libDist, { recursive: true })
  writeFileSync(
    join(root, 'node_modules', '@fix', 'lib', 'package.json'),
    JSON.stringify({
      name: '@fix/lib',
      version: '1.0.0',
      types: 'dist/index.d.ts',
      main: 'dist/index.js',
    }),
  )
  writeFileSync(join(libDist, 'index.d.ts'), ITEMFILL_DTS)
  if (manifestText !== null) writeFileSync(join(libDist, '__llui_deps.json'), manifestText)

  const appPath = join(root, 'app.ts')
  writeFileSync(appPath, APP)

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    baseUrl: root,
    skipLibCheck: true,
    noResolve: false,
  }
  const program = ts.createProgram([appPath], options, ts.createCompilerHost(options, true))
  const appSf = program.getSourceFile(appPath)!
  return { program, appSf }
}

describe('cross-package narrowing via __llui_deps.json', () => {
  it('narrows itemFill(s, 1) to its exact reads when the manifest is present', () => {
    clearManifestCache()
    const { program, appSf } = fixture(serializeManifest(manifest()))
    const { paths, opaque } = crossFileAccessorPaths(program, appSf)
    expect(opaque).toBe(false)
    expect([...paths].sort()).toEqual(['allowHalf', 'hoveredValue', 'value'])
  })

  it('coarsens to opaque (FULL_MASK) when no manifest is shipped', () => {
    clearManifestCache()
    const { program, appSf } = fixture(null)
    const { paths, opaque } = crossFileAccessorPaths(program, appSf)
    expect(opaque).toBe(true)
    expect(paths.size).toBe(0)
  })

  it('coarsens when the manifest is version-incompatible (soundness floor)', () => {
    clearManifestCache()
    const incompatible = serializeManifest(manifest()).replace(
      /"compilerVersion": "[^"]*"/,
      '"compilerVersion": "999.0.0"',
    )
    const { program, appSf } = fixture(incompatible)
    const { opaque } = crossFileAccessorPaths(program, appSf)
    expect(opaque).toBe(true)
  })

  it('coarsens when the manifest is malformed JSON (soundness floor)', () => {
    clearManifestCache()
    const { program, appSf } = fixture('{ not valid json')
    const { opaque } = crossFileAccessorPaths(program, appSf)
    expect(opaque).toBe(true)
  })

  it('coarsens when the manifest omits the called helper (soundness floor)', () => {
    clearManifestCache()
    const empty = serializeManifest({ ...manifest(), helpers: {} })
    const { program, appSf } = fixture(empty)
    const { opaque } = crossFileAccessorPaths(program, appSf)
    expect(opaque).toBe(true)
  })
})
