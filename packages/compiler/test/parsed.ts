// Test-only string façades over the module-taking entry points.
//
// The compiler parses each module ONCE per pass and threads the resulting
// `ParsedModule` through lint, cross-file resolution and the transform (issue
// #93), so every entry point takes a module rather than a source string. The
// tests below are about grammar/lowering, not about parse plumbing — these
// wrappers keep their call sites reading `(source, { fileName })` while making
// the filename (and with it the ScriptKind) explicit at exactly one place.
//
// Production code must NOT do this: a caller that wraps text on every call
// re-parses on every call, which is the defect #93 removed.

import { parseModule } from '../src/parse.js'
import {
  transformSignalComponentSource as transformSource,
  transformSignalComponentSourceWithMap as transformSourceWithMap,
  type SignalTransformOptions,
  type SignalTransformResult,
} from '../src/signals/transform-component.js'
import {
  lintSignalSource as lintModule,
  lintAnnotationSyntaxSource as lintAnnotationSyntaxModule,
  lintTagSendSource as lintTagSendModule,
  lintImperativeDomSource as lintImperativeDomModule,
  type SignalLintMessage,
} from '../src/signals/rules.js'

/** Transform options plus the filename the test wants the module parsed under.
 * Defaults to `m.tsx` — the default the transform itself used to apply. */
export type TestTransformOptions = SignalTransformOptions & { fileName?: string }

export function transformSignalComponentSource(
  source: string,
  opts: TestTransformOptions = {},
): string {
  return transformSource(parseModule(opts.fileName ?? 'm.tsx', source), opts)
}

export function transformSignalComponentSourceWithMap(
  source: string,
  opts: TestTransformOptions = {},
): SignalTransformResult {
  return transformSourceWithMap(parseModule(opts.fileName ?? 'm.tsx', source), opts)
}

export function lintSignalSource(source: string, fileName = 'm.tsx'): SignalLintMessage[] {
  return lintModule(parseModule(fileName, source))
}

export function lintAnnotationSyntaxSource(source: string, fileName = 'm.ts'): SignalLintMessage[] {
  return lintAnnotationSyntaxModule(parseModule(fileName, source))
}

export function lintTagSendSource(source: string, fileName = 'm.ts'): SignalLintMessage[] {
  return lintTagSendModule(parseModule(fileName, source))
}

export function lintImperativeDomSource(source: string, fileName = 'm.ts'): SignalLintMessage[] {
  return lintImperativeDomModule(parseModule(fileName, source))
}
