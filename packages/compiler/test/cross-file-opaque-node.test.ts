// Regression tests for the cross-file walker's offending-node capture.
//
// Pre-fix: `crossFileAccessorPaths` returned only `{ paths, opaque: boolean }`.
// The `opaque: true` signal was useful but carried no positional info,
// so the `llui/opaque-accessor-file-wide-mask` diagnostic emitted with
// `range.start.line = 0`. Users got a file-level warning with no clue
// which accessor inside the file caused it.
//
// Post-fix: the walker tracks the FOCAL-FILE accessor whose body
// triggered the cross-file opacity flip and returns it as `opaqueNode`.
// The diagnostic then carries a meaningful line number, IDEs can jump
// to it, and Rollup's (code, file, line) dedup works correctly when
// the same file has multiple offending accessors.

import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { crossFileAccessorPaths } from '../src/cross-file-walker.js'

function makeProgram(files: Record<string, string>): {
  program: ts.Program
  sf: (name: string) => ts.SourceFile
} {
  const fixtureFiles = new Map(Object.entries(files))
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    types: [],
  }
  const defaultHost = ts.createCompilerHost(compilerOptions, true)
  const host: ts.CompilerHost = {
    ...defaultHost,
    getSourceFile: (fileName, lang, onError, shouldCreateNewSourceFile) => {
      if (fixtureFiles.has(fileName)) {
        return ts.createSourceFile(fileName, fixtureFiles.get(fileName)!, lang, true)
      }
      return defaultHost.getSourceFile(fileName, lang, onError, shouldCreateNewSourceFile)
    },
    fileExists: (f) => fixtureFiles.has(f) || defaultHost.fileExists(f),
    readFile: (f) => (fixtureFiles.has(f) ? fixtureFiles.get(f) : defaultHost.readFile(f)),
  }
  const program = ts.createProgram({
    rootNames: [...fixtureFiles.keys()],
    options: compilerOptions,
    host,
  })
  return {
    program,
    sf: (name) => {
      const sf = program.getSourceFile(name)
      if (!sf) throw new Error(`no source file ${name}`)
      return sf
    },
  }
}

describe('crossFileAccessorPaths — opaqueNode capture for diagnostic plumbing', () => {
  it('captures the focal-file accessor when an imported helper is unanalyzable', () => {
    // The focal file calls `mystery(s)` inside a reactive position (a
    // local `text(...)` view-primitive stand-in). `mystery` is declared
    // ambient — its body is invisible to the walker — so cross-file
    // resolution bails and opacity flips. The walker must hand back the
    // focal-file accessor node so the diagnostic can carry a real line.
    const fx = makeProgram({
      '/helper.d.ts': `export declare function mystery(s: { a: number }): string`,
      '/view.ts': `
        import { mystery } from './helper.js'
        function text(_a: (s: { a: number }) => string): Node { return {} as Node }
        export const focal = (): Node[] => [text((s) => mystery(s))]
      `,
    })
    const result = crossFileAccessorPaths(fx.program, fx.sf('/view.ts'))
    expect(result.opaque).toBe(true)
    // The opaqueNode must be set AND must live in the focal file —
    // pointing at the helper's source file isn't actionable for the user.
    expect(result.opaqueNode).toBeDefined()
    expect(result.opaqueNode!.getSourceFile().fileName).toBe('/view.ts')
    // And its line in the focal file must be > 0 (it's on a real line,
    // not the synthetic line 0 we used pre-fix).
    const startLine = result
      .opaqueNode!.getSourceFile()
      .getLineAndCharacterOfPosition(result.opaqueNode!.getStart()).line
    expect(startLine).toBeGreaterThan(0)
  })

  it('captures the FIRST focal-file accessor when multiple flip opacity', () => {
    // Two accessors in the focal file, both calling `mystery(s)`. The
    // walker should capture the first one encountered (deterministic
    // by AST traversal order). Locking this matters because Rollup
    // dedupes warnings by `(code, file, line)` — if we captured an
    // arbitrary one each run, build output would be non-deterministic.
    const fx = makeProgram({
      '/helper.d.ts': `export declare function mystery(s: { a: number }): string`,
      '/view.ts': `
        import { mystery } from './helper.js'
        function text(_a: (s: { a: number }) => string): Node { return {} as Node }
        export const first = (): Node[] => [text((s) => mystery(s))]
        export const second = (): Node[] => [text((s) => mystery(s))]
      `,
    })
    const result = crossFileAccessorPaths(fx.program, fx.sf('/view.ts'))
    expect(result.opaque).toBe(true)
    expect(result.opaqueNode).toBeDefined()
    // First accessor (inside `first`) is on a lower line than second's.
    // Lock that we picked the FIRST one (deterministic ordering).
    const firstAccessorLine =
      result
        .opaqueNode!.getSourceFile()
        .getLineAndCharacterOfPosition(result.opaqueNode!.getStart()).line + 1
    expect(firstAccessorLine).toBeLessThan(6)
  })

  it('returns undefined opaqueNode when nothing is opaque', () => {
    // Sanity counter-test. A file with only precise property-access
    // accessors should report opaque=false AND no node.
    const fx = makeProgram({
      '/view.ts': `
        function text(_a: (s: { a: number; b: string }) => string): Node { return {} as Node }
        type S = { a: number; b: string }
        export const focal = (): Node[] => [text((s: S) => String(s.a) + s.b)]
      `,
    })
    const result = crossFileAccessorPaths(fx.program, fx.sf('/view.ts'))
    expect(result.opaque).toBe(false)
    expect(result.opaqueNode).toBeUndefined()
  })
})
