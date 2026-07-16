// Pick the TypeScript ScriptKind from a filename's extension.
//
// Parsing every source as TSX misparses a `.ts` file that uses the generic
// arrow form `const id = <T>(x: T): T => x` (the `<T>` reads as a JSX element),
// which both suppresses compilation of the component AND fires a spurious
// `operator-on-signal` lint error. Select TS vs TSX from the extension so both
// forms parse correctly.

import ts from 'typescript'

/** ScriptKind for `filename`: `.tsx`/`.jsx` → TSX, `.js`/`.mjs`/`.cjs` → JS,
 * `.jsx` → JSX; `.ts`/`.mts`/`.cts` (and anything else) → TS. */
export function scriptKindForFilename(filename: string): ts.ScriptKind {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX
  if (lower.endsWith('.mjs') || lower.endsWith('.cjs') || lower.endsWith('.js')) {
    return ts.ScriptKind.JS
  }
  // .ts / .mts / .cts and any unknown extension parse as TS (no JSX ambiguity).
  return ts.ScriptKind.TS
}
