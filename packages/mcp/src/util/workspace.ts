import { resolve, sep } from 'node:path'

/**
 * Resolve a caller-supplied path against the workspace root and reject
 * anything that escapes it. Returns the absolute, normalized path.
 *
 * Caller-supplied `file`/`rootDir`/`path` arguments flow into filesystem
 * reads and child-process invocations. Even with `execFileSync` (no
 * shell) a `../../../etc` traversal would let a tool read or lint files
 * outside the project, so we contain every path to the workspace subtree.
 * The check is a normalized prefix comparison — `path.resolve` collapses
 * `..` segments first, so `<root>/../evil` resolves outside `<root>` and
 * is rejected. The separator guard prevents `<root>-sibling` from passing
 * the prefix test against `<root>`.
 */
export function assertWithinWorkspace(candidate: string, workspaceRoot: string): string {
  const root = resolve(workspaceRoot)
  const abs = resolve(root, candidate)
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`path escapes the workspace root: ${candidate} resolves outside ${root}`)
  }
  return abs
}
