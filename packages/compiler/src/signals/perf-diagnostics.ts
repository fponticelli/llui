// Perf diagnostics — surface lowering coverage to the author.
//
// The signal transform reports every lowering ATTEMPT that gives up via the
// `LowerBail` hook (transform-view.ts). This module turns those attempt-facts
// into canonical `perf`-category Diagnostics for the sites where it matters:
// an `each` that ends FULLY VERBATIM pays per-row authoring construction
// (pathHandle + Mountable + populate per node, per row) instead of the
// compiled cloneNode RowFactory. A verbatim `show`/`branch` only pays at
// toggle time, so those bails are intentionally not surfaced.
//
// Diagnostics are advisory (`warning`), never build-blocking: bailing is
// legitimate code — the runtime authoring path is fully correct, just slower
// per row. Adapters (the Vite plugin in dev) decide how to present them.

import ts from 'typescript'
import { rangeFromOffsets, type Diagnostic } from '../diagnostic.js'
import type { LowerBail } from './transform-view.js'
import type { TextEdit } from './apply-edits.js'

/** Reason-token → one-line actionable hint. Tokens with a `:detail` suffix
 * (e.g. `row-param-leak:item`) are looked up by their prefix. */
const REASON_HINTS: Record<string, string> = {
  'row-body-not-array':
    'the render body is not `const` decls + a returned element array (imperative bodies cannot compile)',
  'row-child-unsupported':
    'a row child is a structural primitive or a call the compiler cannot resolve statically',
  'row-top-not-element':
    "a row's top-level entry is not an element call (a helper call or structural primitive)",
  'row-prop-spread-or-shorthand':
    'spread/shorthand props (e.g. connect-part bags) are not statically resolvable',
  'row-prop-computed-key': 'a prop uses a computed key the compiler cannot name statically',
  'row-prop-static-idl-or-style':
    "a static `value`/`checked`/`selected`/`indeterminate`/`style.*` prop needs the authoring path's applyAttr",
  'row-prop-reads-nonroot-signal':
    'the row reads a signal that is not rooted in item/index/state (e.g. a helper param handle)',
  'row-text-reads-nonroot-signal':
    'the row reads a signal that is not rooted in item/index/state (e.g. a helper param handle)',
  'row-text-empty': 'a `text()` call has no argument',
  'row-handler-not-inline-fn':
    'an event handler is not an inline arrow/function (e.g. `tagSend(...)`) — it needs the authoring path',
  'row-local-signal-alias':
    "a row local binds a signal HANDLE (`const d = item.at('x')`) — read it inline or `.peek()` it instead",
  'row-local-destructured-or-uninitialized': 'a row local is destructured or has no initializer',
  'row-elem-dynamic-children': 'an element receives dynamic (non-array-literal) children',
  'row-elem-dynamic-args': 'an element receives dynamic (non-literal) arguments',
  'row-param-leak': 'a row param is passed into a call or position the compiler cannot follow',
  'arm-not-concise-array': 'the render is not a concise `(item) => [...]` arm',
  'arm-param-leak': 'a row param leaks into a verbatim helper call or handler',
  'helper-body-not-inlinable':
    'the delegated helper body has statements other than `const` decls + a single return',
  'decl-capture-risk':
    'a render-local name is also used inside the delegated helper — rename the local to allow inlining',
  'param-substitution-hygiene':
    'a helper param is shadowed or used as an object shorthand, blocking inlining',
  'arg-count-mismatch': 'the delegation call and helper params are not 1:1',
  'destructured-param': 'the delegated helper destructures a param, blocking inlining',
  'render-decl-destructured': 'a render-side decl is destructured, blocking inlining',
  'items-not-rooted-signal': 'the items source is not a state-rooted signal expression',
  'opts-not-object-literal': 'the each options are not a plain `{ key, render }` object literal',
  'opts-missing-or-not-object': 'the each options are not a plain `{ key, render }` object literal',
  'opt-spread-or-shorthand': 'the each options object uses spread/shorthand properties',
  'missing-key-or-render': 'the each options are missing `key` or `render`',
  'missing-render': 'the each options are missing `render`',
}

/** Most-actionable-first ordering for the reasons included in a message. */
const REASON_PRECEDENCE: readonly string[] = [
  'decl-capture-risk',
  'helper-body-not-inlinable',
  'param-substitution-hygiene',
  'arg-count-mismatch',
  'destructured-param',
  'render-decl-destructured',
  'row-local-signal-alias',
  'row-handler-not-inline-fn',
  'row-prop-spread-or-shorthand',
  'row-prop-static-idl-or-style',
  'row-child-unsupported',
  'row-top-not-element',
  'row-body-not-array',
]

const EACH_KINDS = new Set<LowerBail['kind']>([
  'each-direct',
  'each-render',
  'helper-each',
  'inline-helper',
])

function hintFor(reason: string): string {
  const base = reason.includes(':') ? reason.slice(0, reason.indexOf(':')) : reason
  return REASON_HINTS[base] ?? 'see the reason token'
}

function precedenceOf(reason: string): number {
  const base = reason.includes(':') ? reason.slice(0, reason.indexOf(':')) : reason
  const i = REASON_PRECEDENCE.indexOf(base)
  return i === -1 ? REASON_PRECEDENCE.length : i
}

/**
 * Build `llui/each-verbatim` diagnostics for the `each` call sites in `sf`
 * that the transform left fully verbatim, attributing each recorded bail
 * event to its INNERMOST verbatim `each` call. One diagnostic per site;
 * reasons deduped and capped to the three most actionable.
 *
 * A site counts as LOWERED only when a success event was recorded at its
 * position AND a text edit covers its span. Neither alone is sufficient:
 * pass 1 rewrites the whole view array as ONE edit that embeds verbatim
 * survivors (edit cover ≠ lowered), and a success can come from a lowering
 * whose surrounding arm was later discarded (success ≠ emitted).
 */
export function perfDiagnosticsForFile(
  sf: ts.SourceFile,
  sourceText: string,
  fileName: string,
  edits: readonly TextEdit[],
  loweredStarts: ReadonlySet<number>,
  bails: readonly LowerBail[],
): Diagnostic[] {
  // 1. every `each(...)` call span in the file
  const calls: Array<{ start: number; end: number; calleeEnd: number }> = []
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'each') {
      calls.push({ start: n.getStart(sf), end: n.getEnd(), calleeEnd: n.expression.getEnd() })
    }
    n.forEachChild(visit)
  }
  visit(sf)

  // 2. keep only the VERBATIM ones (success event + covering edit ⇒ lowered)
  const verbatim = calls.filter(
    (c) => !(loweredStarts.has(c.start) && edits.some((e) => c.start >= e.start && c.end <= e.end)),
  )
  if (verbatim.length === 0) return []

  // 3. attribute each `each`-kind event to its innermost containing verbatim call
  const reasonsByCall = new Map<number, Set<string>>() // key: call start offset
  for (const b of bails) {
    if (!EACH_KINDS.has(b.kind)) continue
    let best: { start: number; end: number } | null = null
    for (const c of verbatim) {
      if (b.pos < c.start || b.pos >= c.end) continue
      if (!best || c.end - c.start < best.end - best.start) best = c
    }
    if (!best) continue
    let set = reasonsByCall.get(best.start)
    if (!set) {
      set = new Set()
      reasonsByCall.set(best.start, set)
    }
    set.add(b.reason)
  }

  // 4. one diagnostic per attributed site
  const out: Diagnostic[] = []
  for (const c of verbatim) {
    const reasons = reasonsByCall.get(c.start)
    if (!reasons || reasons.size === 0) continue
    const top = [...reasons].sort((a, b) => precedenceOf(a) - precedenceOf(b)).slice(0, 3)
    const detail = top.map((r) => `${r} — ${hintFor(r)}`).join('; ')
    out.push({
      id: 'llui/each-verbatim',
      severity: 'warning',
      category: 'perf',
      message:
        `this \`each\` renders via the runtime authoring path — its rows pay per-row ` +
        `construction overhead instead of the compiled cloneNode factory (${detail})`,
      location: {
        file: fileName,
        range: rangeFromOffsets(sourceText, c.start, c.calleeEnd),
      },
    })
  }
  return out
}
