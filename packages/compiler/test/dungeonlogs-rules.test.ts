// Regression tests for the two compile-time rules added in response
// to the dungeonlogs 2026-05-21 issue report:
//   - llui/no-sample-in-event-handler — sample() inside onClick/etc.
//   - llui/no-repeated-item-current   — repeated item.current().X in
//                                       an each.render accessor.

import { describe, it, expect } from 'vitest'
import { transformLlui } from '../src/transform.js'
import type { Diagnostic } from '../src/diagnostic.js'

function diagsFor(source: string, id: string): Diagnostic[] {
  const result = transformLlui(source, 'fixture.ts')
  if (!result) return []
  return result.diagnostics.filter((d) => d.id === id)
}

describe('llui/no-sample-in-event-handler', () => {
  it('errors when sample() appears inside onClick', () => {
    const diags = diagsFor(
      `
        import { component, button, sample } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ id: 'a' }, []],
          update: (s) => [s, []],
          view: ({ send }) => [
            button({ onClick: () => send({ type: 'pick', id: sample((s) => s.id) }) }),
          ],
        })
      `,
      'llui/no-sample-in-event-handler',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.severity).toBe('error')
    expect(diags[0]!.message).toMatch(/Capture the value at render time/)
  })

  it('errors on h.sample inside onInput', () => {
    const diags = diagsFor(
      `
        import { component, input } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ id: 'a' }, []],
          update: (s) => [s, []],
          view: (h) => [
            input({ onInput: (e) => h.send({ type: 'commit', id: h.sample((s) => s.id) }) }),
          ],
        })
      `,
      'llui/no-sample-in-event-handler',
    )
    expect(diags).toHaveLength(1)
  })

  it('does NOT fire for sample at render time (the correct pattern)', () => {
    const diags = diagsFor(
      `
        import { component, button, sample } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ id: 'a' }, []],
          update: (s) => [s, []],
          view: ({ send }) => {
            const id = sample((s) => s.id)
            return [button({ onClick: () => send({ type: 'pick', id }) })]
          },
        })
      `,
      'llui/no-sample-in-event-handler',
    )
    expect(diags).toHaveLength(0)
  })

  it('does NOT fire on non-handler properties whose name happens to start with "on"', () => {
    // `oneof` is not an on-event handler — the rule must gate on the
    // /^on[A-Z]/ shape, not anything starting with "on".
    const diags = diagsFor(
      `
        import { component, sample } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ id: 'a' }, []],
          update: (s) => [s, []],
          view: () => [],
        })
        const cfg = { oneof: () => sample((s) => s.id) }
        void cfg
      `,
      'llui/no-sample-in-event-handler',
    )
    expect(diags).toHaveLength(0)
  })
})

describe('llui/opaque-accessor-file-wide-mask', () => {
  // Catch-all diagnostic for the file-wide FULL_MASK fallback. Fires
  // for any opaque shape that flips `hasOpaqueAccessor=true`, including
  // the method-call-with-state pattern (`host.fn(s, …)`) that the
  // existing strict `llui/opaque-state-flow` rule deliberately tolerates.
  // The dungeonlogs 2026-05-26 report named "I had to grep for `(s`
  // patterns by eye" as the actual time sink — this rule names the
  // offending accessor's line directly.

  it('flags a method-call-with-state pattern (host.fn(s, …)) with the line of the call', () => {
    const diags = diagsFor(
      `
        import { component, div } from '@llui/dom'
        const host = { dirtyAt: (_s: { a: number }, _e: number, _p: number) => false }
        const App = component({
          name: 'X',
          init: () => [{ a: 0 }, []],
          update: (s) => [s, []],
          view: () => [
            div({ title: (s) => host.dirtyAt(s, 0, 0) ? '1' : '0' }),
          ],
        })
      `,
      'llui/opaque-accessor-file-wide-mask',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.severity).toBe('warning')
    expect(diags[0]!.category).toBe('perf')
    expect(diags[0]!.message).toMatch(/method call/i)
    expect(diags[0]!.message).toMatch(/host\.dirtyAt/)
    // The `[file-local]` / `[cross-file]` tag at the head of the message
    // is the consumer's grep-friendly signal for "which walker bailed."
    expect(diags[0]!.message).toMatch(/^\[file-local\]/)
    expect(diags[0]!.location.range.start.line).toBeGreaterThan(0)
  })

  it('does NOT fire for clean property-access accessors', () => {
    const diags = diagsFor(
      `
        import { component, div } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ a: 0, b: 0 }, []],
          update: (s) => [s, []],
          view: () => [
            div({ 'data-a': (s) => String(s.a), 'data-b': (s) => String(s.b) }),
          ],
        })
      `,
      'llui/opaque-accessor-file-wide-mask',
    )
    expect(diags).toHaveLength(0)
  })

  it('flags dynamic element access (s[expr])', () => {
    const diags = diagsFor(
      `
        import { component, div } from '@llui/dom'
        type S = { keys: string[] } & Record<string, unknown>
        const App = component({
          name: 'X',
          init: () => [({ keys: ['a','b'], a: 1, b: 2 } as S), []],
          update: (s) => [s, []],
          view: () => [
            div({ title: (s: S) => String(s[s.keys[0]!]) }),
          ],
        })
      `,
      'llui/opaque-accessor-file-wide-mask',
    )
    expect(diags.length).toBeGreaterThanOrEqual(1)
    expect(diags[0]!.message).toMatch(/dynamic element access|state used outside/)
  })

  it('fires at file level when only crossFileOpaque is set (cross-file walker bail)', () => {
    // The cross-file walker can't surface the specific in-file node
    // that caused the bail (the focal-file walker would have flagged
    // it if it were locally analyzable). Verify the diagnostic still
    // fires so the user knows mask precision is degraded — without
    // this, an app whose only opacity comes from an imported helper
    // gets a silent file-wide FULL_MASK and zero warning.
    const result = transformLlui(
      `
        import { component, div } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ a: 0 }, []],
          update: (s) => [s, []],
          view: () => [
            div({ 'data-a': (s) => String(s.a) }),
          ],
        })
      `,
      'fixture.ts',
      false, // devMode
      false, // emitAgentMetadata
      5200, // mcpPort
      false, // verbose
      undefined, // typeSources
      undefined, // preExtracted
      undefined, // crossFilePaths
      true, // crossFileOpaque
    )
    expect(result).not.toBeNull()
    const diags = result!.diagnostics.filter((d) => d.id === 'llui/opaque-accessor-file-wide-mask')
    expect(diags).toHaveLength(1)
    expect(diags[0]!.severity).toBe('warning')
    expect(diags[0]!.message).toMatch(/cross-file/i)
    expect(diags[0]!.message).toMatch(/^\[cross-file\]/)
    expect(diags[0]!.location.range.start.line).toBe(0)
  })

  it('fires on opaque accessor under a STRING-LITERAL key (data-*, aria-*)', () => {
    // Pre-fix `isReactiveAccessor` only accepted Identifier keys, so an
    // opaque flow inside `'data-x': (s) => host.fn(s)` was silent — the
    // accessor body wasn't walked at all. String-literal and identifier
    // keys are equally valid HTML attribute positions; the walker now
    // treats them uniformly.
    const diags = diagsFor(
      `
        import { component, div } from '@llui/dom'
        const host = { dirtyAt: (_s: { a: number }, _e: number) => false }
        const App = component({
          name: 'X',
          init: () => [{ a: 0 }, []],
          update: (s) => [s, []],
          view: () => [
            div({ 'data-dirty': (s) => host.dirtyAt(s, 0) ? '1' : '0' }),
          ],
        })
      `,
      'llui/opaque-accessor-file-wide-mask',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toMatch(/host\.dirtyAt/)
    expect(diags[0]!.message).toMatch(/^\[file-local\]/)
  })

  it('fires on opaque accessor under an aria-* string-literal key', () => {
    const diags = diagsFor(
      `
        import { component, button } from '@llui/dom'
        const host = { describe: (_s: { msg: string }) => '' }
        const App = component({
          name: 'X',
          init: () => [{ msg: '' }, []],
          update: (s) => [s, []],
          view: () => [
            button({ 'aria-label': (s) => host.describe(s) }, []),
          ],
        })
      `,
      'llui/opaque-accessor-file-wide-mask',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toMatch(/host\.describe/)
  })

  it('file-local and cross-file are mutually exclusive: file-local takes precedence', () => {
    // When BOTH paths flip, the diagnostic should still point at the
    // concrete in-file node (the file-local message). Otherwise users
    // would see a vague [cross-file] message even when the precise
    // location is known. Locks the `else if` ordering at transform.ts.
    const result = transformLlui(
      `
        import { component, div } from '@llui/dom'
        const host = { dirtyAt: (_s: { a: number }, _e: number) => false }
        const App = component({
          name: 'X',
          init: () => [{ a: 0 }, []],
          update: (s) => [s, []],
          view: () => [
            div({ title: (s) => host.dirtyAt(s, 0) ? '1' : '0' }),
          ],
        })
      `,
      'fixture.ts',
      false,
      false,
      5200,
      false,
      undefined,
      undefined,
      undefined,
      true, // crossFileOpaque ALSO true
    )
    expect(result).not.toBeNull()
    const diags = result!.diagnostics.filter((d) => d.id === 'llui/opaque-accessor-file-wide-mask')
    expect(diags).toHaveLength(1)
    expect(diags[0]!.message).toMatch(/^\[file-local\]/)
    expect(diags[0]!.message).not.toMatch(/^\[cross-file\]/)
  })
})

describe('llui/no-repeated-item-current', () => {
  it('warns on two chained item.current() reads in one accessor', () => {
    const diags = diagsFor(
      `
        import { component, each, li, text } from '@llui/dom'
        interface Row { id: string; name: string; meta: { label: string } }
        const App = component({
          name: 'X',
          init: () => [{ rows: [] as Row[] }, []],
          update: (s) => [s, []],
          view: () => [
            each<Row>({
              items: (s) => s.rows,
              key: (r) => r.id,
              render: ({ item }) => [
                li([
                  text(() => item.current().name + ':' + item.current().meta.label),
                ]),
              ],
            }),
          ],
        })
      `,
      'llui/no-repeated-item-current',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.severity).toBe('warning')
    expect(diags[0]!.message).toMatch(/destructure once|project to a row type/)
  })

  it('warns on a SINGLE chained item.current().X (opaques the bitmask analyzer)', () => {
    // Updated semantics: any chained access after item.current() —
    // even a single one — falls back to FULL_MASK because the
    // compiler can't trace through .current(). The 2+ case adds a
    // reconcile-race risk on top, but the bitmask trap fires on the
    // first chain.
    const diags = diagsFor(
      `
        import { component, each, li, text } from '@llui/dom'
        interface Row { id: string; name: string }
        const App = component({
          name: 'X',
          init: () => [{ rows: [] as Row[] }, []],
          update: (s) => [s, []],
          view: () => [
            each<Row>({
              items: (s) => s.rows,
              key: (r) => r.id,
              render: ({ item }) => [
                li([text(() => item.current().name)]),
              ],
            }),
          ],
        })
      `,
      'llui/no-repeated-item-current',
    )
    expect(diags).toHaveLength(1)
    expect(diags[0]!.severity).toBe('warning')
    expect(diags[0]!.message).toMatch(/FULL_MASK|bitmask/)
  })

  it('does NOT warn on a bare item.current() with no chained access', () => {
    // Bare `item.current()` — used as the value passed to a helper or
    // returned directly — is fine for primitive T (where field
    // accessors are useless) and whole-record sampling. The chain is
    // what opaques the analyzer; without it there's nothing to flag.
    const diags = diagsFor(
      `
        import { component, each, li, text } from '@llui/dom'
        const App = component({
          name: 'X',
          init: () => [{ tags: [] as string[] }, []],
          update: (s) => [s, []],
          view: () => [
            each<string>({
              items: (s) => s.tags,
              key: (t) => t,
              render: ({ item }) => [
                li([text(() => item.current())]),
              ],
            }),
          ],
        })
      `,
      'llui/no-repeated-item-current',
    )
    expect(diags).toHaveLength(0)
  })

  it('does NOT warn when destructured once at the top of the accessor', () => {
    const diags = diagsFor(
      `
        import { component, each, li, text } from '@llui/dom'
        interface Row { id: string; name: string; meta: { label: string } }
        const App = component({
          name: 'X',
          init: () => [{ rows: [] as Row[] }, []],
          update: (s) => [s, []],
          view: () => [
            each<Row>({
              items: (s) => s.rows,
              key: (r) => r.id,
              render: ({ item }) => [
                li([
                  text(() => {
                    const e = item.current()
                    return e.name + ':' + e.meta.label
                  }),
                ]),
              ],
            }),
          ],
        })
      `,
      'llui/no-repeated-item-current',
    )
    expect(diags).toHaveLength(0)
  })
})
