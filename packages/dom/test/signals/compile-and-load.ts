// Shared harness for the end-to-end compiled-tier tests: take AUTHORED signal
// source, run it through the real compiler transform (`transformSignalComponentSource`
// — the same call the Vite plugin makes), transpile to JS, evaluate it with a
// supplied set of runtime symbols in scope, and hand back the named component
// def(s) ready to mount.
//
// Each test file needs a DIFFERENT set of injected symbols (whichever lowered
// helpers its fixtures reference, plus its own `component` / `derived` stubs), so
// the injection set is a parameter: the wrapper's parameter list is derived from
// the record's keys and the arguments from its values, which keeps them in lockstep
// by construction. That parameterisation is the only thing that varied across the
// four hand-rolled copies this replaces.

import ts from 'typescript'
import { transformSignalComponentSource } from '@llui/compiler'
import type { SignalComponentDef } from '../../src/signals/component'

/** Runtime symbols made visible to the evaluated module body, by name. Keys must be
 * valid JS identifiers — they become the wrapper function's parameters. */
export type RuntimeScope = Readonly<Record<string, unknown>>

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * Compile `authored`, evaluate it with `runtime` in scope, and return every export
 * named in `names`. Import statements are stripped (the injected scope stands in for
 * them) and `export const` is de-exported so the body is plain statements.
 */
export function compileAndLoadAll(
  authored: string,
  names: readonly string[],
  runtime: RuntimeScope,
): Record<string, unknown> {
  const params = Object.keys(runtime)
  for (const p of params) {
    if (!IDENTIFIER.test(p))
      throw new Error(`compileAndLoad: ${JSON.stringify(p)} is not a valid identifier`)
  }
  const lowered = transformSignalComponentSource(authored)
  const body = lowered
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('import '))
    .join('\n')
    .replace(/export\s+const/g, 'const')
  const wrapped = `(function(${params.join(', ')}){
    ${body}
    return { ${names.join(', ')} }
  })`
  const js = ts.transpileModule(wrapped, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText
  // Evaluating the compiler's own output IS the test.
  const factory = eval(js) as (...args: unknown[]) => Record<string, unknown>
  return factory(...Object.values(runtime))
}

/**
 * Single-export form of {@link compileAndLoadAll}. The State/Msg/Effect types are
 * caller-declared: evaluated source carries no static type, so this is the one
 * place the assertion lives — callers get a properly typed def and never need an
 * `as never` at their `send` sites.
 */
export function compileAndLoad<S, M, E = never>(
  authored: string,
  name: string,
  runtime: RuntimeScope,
): SignalComponentDef<S, M, E> {
  return compileAndLoadAll(authored, [name], runtime)[name] as SignalComponentDef<S, M, E>
}

/** The `component()` call in authored source is an identity wrapper at runtime —
 * the compiler has already lowered the def, so evaluation just needs the object
 * back. Shared by every caller. */
export const identityComponent = (spec: unknown): unknown => spec
