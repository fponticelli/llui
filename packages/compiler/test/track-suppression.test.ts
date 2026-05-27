// Tests for the dicerun 2026-05-27 report:
// `track({ deps })` was advertised as the escape hatch for both
// `llui/opaque-state-flow` AND `llui/opaque-accessor-file-wide-mask`
// (the diagnostic literally says: "...declare the dependencies via
// `track({ deps: (s) => [...] })`."). The suppression worked for
// `opaque-state-flow` but NOT for `opaque-accessor-file-wide-mask` —
// the diagnostic simply shifted to the `track(...)` line, breaking
// the documented escape hatch.
//
// Same root cause as before: the file-wide-mask diagnostic comes
// from `collect-deps.ts`'s `detectOpaqueStateFlow` and the cross-file
// walker's `walkAccessorBody`, neither of which checked whether the
// accessor under analysis is the `deps:` value of a `track({...})`
// call.
//
// These tests pin the suppression contract: an accessor whose body
// would otherwise opaque-leak state but which is the `deps` callback
// of a `track()` call MUST be treated as the user's intentional
// declaration of dependencies, not as a leak.

import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { transformLlui } from '../src/transform.js'
import { crossFileAccessorPaths } from '../src/cross-file-walker.js'

function diagsFor(source: string, id: string): Array<{ message: string; severity: string }> {
  const result = transformLlui(source, 'fixture.ts')
  if (!result) return []
  return result.diagnostics.filter((d) => d.id === id)
}

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

describe('track({ deps }) suppression with shadowed param names (dicerun follow-up)', () => {
  // Consumer report: suppression worked inside `() => { track(...) }`
  // but NOT inside `(s: PS) => { track(...) }`. The footgun was the
  // outer accessor's parameter being walked through the inner
  // `track({ deps: (s) => ... })` arrow whose `s` shadows the outer.
  // The detect walker matched the inner `s` against the outer's
  // stateParam name and flagged the file-wide opaque flow even though
  // the suspect identifier was actually the inner arrow's parameter.

  it('outer (s) accessor with INNER arrow shadowing s — opacity inside track.deps must not leak', () => {
    const diags = diagsFor(
      `
        import { component, div, track } from '@llui/dom'
        const opts = { getDialog: (_s: { a: number }) => ({ title: '' }) }
        const App = component({
          name: 'X',
          init: () => [{ a: 0 }, []],
          update: (s) => [s, []],
          view: () => [
            div({
              // Outer (s) accessor — its param shadows nothing yet.
              // Inner track.deps arrow uses 's' too; walker must
              // recognise the shadow and not flag the inner read
              // against the outer's stateParam.
              title: (s: { a: number }) => {
                track<{ a: number }>({ deps: (s) => [opts.getDialog(s).title] })
                return 'ok'
              },
            }),
          ],
        })
      `,
      'llui/opaque-accessor-file-wide-mask',
    )
    expect(diags).toHaveLength(0)
  })

  it('outer (s) accessor with track.deps using a DIFFERENT param name — already worked, locked here', () => {
    // Same test as above but with the inner arrow's param renamed.
    // Pre-fix, this passed (no shadowing), so the user's diagnosis
    // was "rename to avoid the bug" — locking it as a known-good shape.
    const diags = diagsFor(
      `
        import { component, div, track } from '@llui/dom'
        const opts = { getDialog: (_s: { a: number }) => ({ title: '' }) }
        const App = component({
          name: 'X',
          init: () => [{ a: 0 }, []],
          update: (s) => [s, []],
          view: () => [
            div({
              title: (_outer: { a: number }) => {
                track<{ a: number }>({ deps: (inner) => [opts.getDialog(inner).title] })
                return 'ok'
              },
            }),
          ],
        })
      `,
      'llui/opaque-accessor-file-wide-mask',
    )
    expect(diags).toHaveLength(0)
  })

  it('outer (s) with a NON-track inner arrow shadowing s must still detect outer opacity', () => {
    // Counter-test: shadowing-aware walker must NOT silently suppress
    // outer-scope opaque flow. Here the inner arrow is a plain helper
    // (not track), and the OUTER body has its own opaque read.
    // The diagnostic must fire because of the outer's opaque flow,
    // independent of the inner arrow.
    const diags = diagsFor(
      `
        import { component, div } from '@llui/dom'
        const opts = { getDialog: (_s: { a: number }) => ({ title: '' }) }
        const helper = (_arr: number[]) => 0
        const App = component({
          name: 'X',
          init: () => [{ a: 0 }, []],
          update: (s) => [s, []],
          view: () => [
            div({
              title: (s: { a: number }) => {
                // Inner arrow's s shadows outer; reads opaquely.
                // But this is NOT inside track.deps — the walker must
                // continue to flag the OUTER opaque flow below.
                helper([1, 2, 3].map((s) => opts.getDialog({ a: s }).title.length))
                // Outer's own opaque read — this should fire the diagnostic.
                return opts.getDialog(s).title
              },
            }),
          ],
        })
      `,
      'llui/opaque-accessor-file-wide-mask',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toMatch(/^\[file-local\]/)
  })
})

describe('track({ deps }) suppression for opaque-accessor-file-wide-mask (file-local)', () => {
  it('suppresses the file-wide-mask diagnostic when the opaque shape is inside track.deps', () => {
    // The accessor body has a method-call-with-state shape
    // (`opts.getDialog(s)`) that would normally flip the file to
    // `hasOpaqueAccessor = true`. Wrapping it in `track({ deps })`
    // is the documented escape hatch — the diagnostic must NOT fire.
    const diags = diagsFor(
      `
        import { component, div, track } from '@llui/dom'
        const opts = { getDialog: (_s: { a: number }) => ({ title: '' }) }
        const App = component({
          name: 'X',
          init: () => [{ a: 0 }, []],
          update: (s) => [s, []],
          view: () => [
            div({
              title: () => {
                track<{ a: number }>({ deps: (s) => [opts.getDialog(s)] })
                return 'ok'
              },
            }),
          ],
        })
      `,
      'llui/opaque-accessor-file-wide-mask',
    )
    expect(diags).toHaveLength(0)
  })

  it('still fires when the opaque shape lives OUTSIDE track.deps in the same file', () => {
    // Sanity counter-test. A track() call doesn't suppress the
    // diagnostic for unrelated opaque accessors elsewhere in the file.
    const diags = diagsFor(
      `
        import { component, div, track } from '@llui/dom'
        const opts = { getDialog: (_s: { a: number }) => ({ title: '' }) }
        const App = component({
          name: 'X',
          init: () => [{ a: 0 }, []],
          update: (s) => [s, []],
          view: () => [
            div({
              // Wrapped in track — suppressed.
              'data-x': () => {
                track<{ a: number }>({ deps: (s) => [opts.getDialog(s)] })
                return 'ok'
              },
              // NOT wrapped — opaque leak; diagnostic fires.
              title: (s) => opts.getDialog(s).title,
            }),
          ],
        })
      `,
      'llui/opaque-accessor-file-wide-mask',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toMatch(/^\[file-local\]/)
  })

  it('extracts paths from inside track.deps when present (counter-test)', () => {
    // Suppression must NOT prevent path extraction. `track({ deps: (s) => [s.foo] })`
    // declares `foo` as a dependency; the binding's mask should reflect it.
    // We check the OUTPUT contains `foo` in the prefix table — proves the
    // walker still descended into the deps body to collect explicit reads.
    const result = transformLlui(
      `
        import { component, div, track } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ foo: 0 }, []],
          update: (s) => [s, []],
          view: () => [
            div({
              title: () => {
                track<{ foo: number }>({ deps: (s) => [s.foo] })
                return 'ok'
              },
            }),
          ],
        })
      `,
      'fixture.ts',
    )
    expect(result).not.toBeNull()
    // The output should include `foo` in __prefixes — track extracted it.
    expect(result!.output).toMatch(/__prefixes:\s*\[s\s*=>\s*s\.foo\]/)
  })
})

describe('track({ deps }) suppression for opaque-accessor-file-wide-mask (cross-file)', () => {
  it('does not flag a file whose ONLY opacity comes from inside track.deps via imported helper', () => {
    // Cross-file equivalent: the focal file imports a helper, calls it
    // inside track({ deps }). The walker would otherwise flag the
    // call as opaque (helper has no body — ambient declaration).
    // Suppression must apply to the cross-file walker too.
    const fx = makeProgram({
      '/helper.d.ts': `export declare function mystery(s: { a: number }): { title: string }`,
      '/view.ts': `
        import { mystery } from './helper.js'
        function text(_a: (s: { a: number }) => string): Node { return {} as Node }
        function track<S>(_o: { deps: (s: S) => unknown[] }): void {}
        export const focal = (): Node[] => [
          text((s) => {
            track<{ a: number }>({ deps: (s2) => [mystery(s2).title] })
            return 'ok'
          }),
        ]
      `,
    })
    const result = crossFileAccessorPaths(fx.program, fx.sf('/view.ts'))
    // Pre-fix: opacity flips because mystery(s2) is unanalyzable.
    // Post-fix: track.deps suppresses the flag for that body.
    expect(result.opaque).toBe(false)
    expect(result.opaqueNode).toBeUndefined()
  })

  it('cross-file walker also respects shadowing — inner s in track.deps ≠ outer s', () => {
    // Same shadowing footgun, cross-file flavour. The outer accessor
    // is `(s) => ...`; the track.deps inner arrow uses `s` too. The
    // walker must NOT mis-attribute the inner s's opaque read to the
    // outer accessor's stateParam.
    const fx = makeProgram({
      '/helper.d.ts': `export declare function mystery(s: { a: number }): { title: string }`,
      '/view.ts': `
        import { mystery } from './helper.js'
        function text(_a: (s: { a: number }) => string): Node { return {} as Node }
        function track<S>(_o: { deps: (s: S) => unknown[] }): void {}
        export const focal = (): Node[] => [
          text((s) => {
            track<{ a: number }>({ deps: (s) => [mystery(s).title] })
            return 'ok'
          }),
        ]
      `,
    })
    const result = crossFileAccessorPaths(fx.program, fx.sf('/view.ts'))
    expect(result.opaque).toBe(false)
  })

  it('still flags cross-file opacity when the leak is OUTSIDE track.deps', () => {
    // Counter-test: a separate accessor in the same file that uses
    // mystery(s) WITHOUT track wrapping must still flip opacity.
    const fx = makeProgram({
      '/helper.d.ts': `export declare function mystery(s: { a: number }): { title: string }`,
      '/view.ts': `
        import { mystery } from './helper.js'
        function text(_a: (s: { a: number }) => string): Node { return {} as Node }
        export const focal = (): Node[] => [
          text((s) => mystery(s).title),
        ]
      `,
    })
    const result = crossFileAccessorPaths(fx.program, fx.sf('/view.ts'))
    expect(result.opaque).toBe(true)
  })
})
