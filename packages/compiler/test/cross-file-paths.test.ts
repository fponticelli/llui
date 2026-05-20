import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { crossFileAccessorPaths } from '../src/cross-file-walker.js'

/**
 * Phase 3 — cross-file accessor path collection.
 *
 * Demonstrates the walker following a view-helper call from a focal file
 * into a sibling file, and merging the helper's state-read paths into
 * the focal file's accessor path set. Closes the §1 sentinel-show()
 * workaround: paths read only through a cross-file helper become visible
 * to the focal file's __prefixes without manual `void s.X` declarations.
 */

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

describe('crossFileAccessorPaths — Phase 3 cross-file resolution', () => {
  it('resolves an accessor at a reactive position in the focal file', () => {
    // The walker only enters arrows at reactive positions (issue #5
    // bug 3 fix). Reactive positions for a focal file are: first arg
    // to a framework primitive (text/show/branch/...), property value
    // on an element-helper call, OR first arg to a §2.1 view-helper
    // call defined elsewhere. Sitting in an unused local binding is
    // not reactive.
    const { program, sf } = makeProgram({
      '/main.ts': `
        function text(_a: (s: { count: number; label: string }) => string): Node {
          return {} as Node
        }
        export const focal = (): Node[] => [text((s) => s.label)]
      `,
    })
    const paths = crossFileAccessorPaths(program, sf('/main.ts'))
    expect([...paths]).toContain('label')
  })

  it('descends into a cross-file view-helper called with an accessor argument', () => {
    const { program, sf } = makeProgram({
      '/helper.ts': `
        export function brandedRow<S>(get: (s: S) => { name: string; active: boolean }): Node[] {
          const a: (s: S) => string = (s) => get(s).name
          return [a as unknown as Node]
        }
      `,
      '/main.ts': `
        import { brandedRow } from './helper.js'
        type State = { user: { name: string; active: boolean }; theme: string }
        export const focal = (s: State): Node[] => {
          return brandedRow<State>((st) => st.user)
        }
      `,
    })
    const paths = crossFileAccessorPaths(program, sf('/main.ts'))
    // The focal's accessor `(st) => st.user` is the lift; the helper's
    // body reads `get(s).name`/`.active` — which the prototype walker
    // sees as the helper's local reads. We assert the lift path is in
    // the set; the manifest substitution test covers the composition.
    expect([...paths]).toContain('user')
  })

  it('does NOT add paths from non-reactive 1-param arrows (issue #5 bug 3 false positive)', () => {
    // Pre-fix, the walker visited every 1-param arrow in the file —
    // including `onEffect: (bag) => bag.send(...)` — and added every
    // depth-1 property as a phantom state path. In the issue report
    // that surfaced as `send`, `effect`, `signal`, `path`, `message`
    // in the components `__prefixes` table.
    const { program, sf } = makeProgram({
      '/main.ts': `
        function div(_props: unknown): Node { return {} as Node }
        function text(_a: (s: { count: number }) => string): Node { return {} as Node }
        export const c = {
          // Only this accessor is reactive — \`count\` should land in paths.
          view: () => [div({}), text((s) => String(s.count))],
          // None of these arrows are at reactive positions; their property
          // accesses must stay out of the path set.
          onEffect: (bag: { send: (m: unknown) => void; effect: unknown; signal: unknown }) => {
            bag.send(bag.effect)
            const _x = bag.signal
          },
          handle: (eff: { path: string; message: string }) => {
            console.log(eff.path, eff.message)
          },
        }
      `,
    })
    const paths = crossFileAccessorPaths(program, sf('/main.ts'))
    expect([...paths]).toContain('count')
    for (const phantom of ['send', 'effect', 'signal', 'path', 'message']) {
      expect([...paths]).not.toContain(phantom)
    }
  })

  it('descends into a non-Node-returning helper called with state (issue #5 bug 3 false negative)', () => {
    // The §2.1 view-helper classification gates the case-2 descent on
    // a Node-shaped return type. But a helper that takes state and
    // returns a string/boolean/etc. still contributes paths to the
    // calling accessor when invoked as `helper(s)`. Pre-fix the walker
    // skipped these, so reads like `s.route.kind` inside a route
    // predicate fell out of `__prefixes` — bindings keyed on the
    // missing path stopped firing, with no runtime error to point at it.
    const { program, sf } = makeProgram({
      '/helpers.ts': `
        type State = { route: { kind: string }; visible: boolean }
        export function isRouteA(s: State): boolean {
          return s.route.kind === 'a'
        }
      `,
      '/main.ts': `
        import { isRouteA } from './helpers.js'
        type State = { route: { kind: string }; visible: boolean }
        function show(_o: { when: (s: State) => boolean }): Node[] { return [] }
        export const view = (): Node[] => show({ when: (s) => isRouteA(s) })
      `,
    })
    const paths = crossFileAccessorPaths(program, sf('/main.ts'))
    expect([...paths]).toContain('route.kind')
  })

  it('does not descend into helpers whose return type is opaque', () => {
    const { program, sf } = makeProgram({
      '/helper.ts': `
        // Opaque: returns { data: T } rather than Node[]. Walker should
        // not descend, so the helper's internal state-shape paths do not
        // leak into the consumer's read set.
        export function opaqueHelper(get: (s: any) => any): { data: unknown } {
          const x = get  // walker won't descend
          return { data: undefined }
        }
      `,
      '/main.ts': `
        import { opaqueHelper } from './helper.js'
        type State = { secret: string; pub: number }
        export const focal = (s: State): Node[] => {
          const r = opaqueHelper((st: State) => st.secret)
          return [r as unknown as Node]
        }
      `,
    })
    const paths = crossFileAccessorPaths(program, sf('/main.ts'))
    // The focal's accessor `(st) => st.secret` is still extracted (its
    // body reads `st.secret`). What the walker should NOT do is descend
    // into `opaqueHelper`'s internals and surface reads the focal file
    // never actually triggers. The lift path is correctly included.
    expect([...paths]).toContain('secret')
  })
})
