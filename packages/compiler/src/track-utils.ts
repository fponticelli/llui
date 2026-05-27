// Shared utilities for handling `track({ deps: (s) => [...] })` calls.
//
// `track()` is the documented escape hatch for accessors whose body
// the walker can't statically infer. When the lint rules and the
// path-collection walker see an accessor in the `deps:` position of
// a track call, they treat its body as the user's intentional
// declaration of dependencies — extracting any direct path reads
// (`s.foo`, `s.bar.baz`) into the mask, but NOT flagging opaque
// shapes inside it as leaks. The user has explicitly said
// "trust me here."
//
// This helper is consumed by:
//   - `modules/opaque-state-flow.ts` — suppresses the strict
//     `llui/opaque-state-flow` error inside track.deps
//   - `collect-deps.ts` — suppresses the file-local opaque flag
//     (which drives the `opaque-accessor-file-wide-mask` warning)
//     and skips delegation-following inside track.deps
//   - `cross-file-walker.ts` — same suppression for the cross-file
//     opacity flag
//
// Handles both forms: bare `track({...})` imported from `@llui/dom`
// and the View-bag form `h.track({...})` if it ever exists.

import ts from 'typescript'

/**
 * Returns true when `arrow` is the value of a `deps:` PropertyAssignment
 * in a `track({ ... })` (or `h.track({ ... })`) call. Both forms must
 * agree because the file-local walker doesn't always know the import
 * shape ahead of time.
 */
export function isInsideTrackDeps(arrow: ts.Node): boolean {
  if (!ts.isArrowFunction(arrow) && !ts.isFunctionExpression(arrow)) return false
  const pa = arrow.parent
  if (!pa || !ts.isPropertyAssignment(pa) || !ts.isIdentifier(pa.name) || pa.name.text !== 'deps') {
    return false
  }
  const obj = pa.parent
  if (!obj || !ts.isObjectLiteralExpression(obj)) return false
  const call = obj.parent
  if (!call || !ts.isCallExpression(call) || call.arguments[0] !== obj) return false
  if (ts.isIdentifier(call.expression)) return call.expression.text === 'track'
  if (ts.isPropertyAccessExpression(call.expression)) {
    return call.expression.name.text === 'track'
  }
  return false
}
