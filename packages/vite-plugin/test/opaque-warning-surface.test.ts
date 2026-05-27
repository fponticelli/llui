// End-to-end test that `llui/opaque-accessor-file-wide-mask` diagnostics
// actually reach Rollup's warning channel via `this.warn(...)`. Compiler
// tests prove the diagnostic ends up in `result.diagnostics`; this test
// proves the vite-plugin's transform hook then forwards it.
//
// Background: an external consumer reported the warning didn't surface
// in `vite build` stdout. The compiler side was producing the
// diagnostic; the routing through the plugin was unverified by any
// test before this one. We mock the Vite/Rollup transform hook context
// just enough to capture `warn(...)` calls, then assert the routing.
//
// Note on test inputs: we avoid `s[expr]` shapes here — they trip the
// strict `llui/opaque-state-flow` rule (severity 'error') which throws
// out of `this.error` before subsequent warnings get processed. The
// inputs use plain `host.fn(s, …)` patterns which only fire the
// warning. String-literal keyed accessors (`'data-x'`, `'aria-…'`) are
// now walked identically to identifier-keyed ones; coverage for the
// equivalence lives in compiler-side tests (dungeonlogs-rules.test.ts).

import { describe, it, expect } from 'vitest'
import type { Plugin } from 'vite'
import llui from '../src/index'

type WarnArg = string | { message?: string }

interface MockTransformCtx {
  warn: (arg: WarnArg) => void
  error: (arg: WarnArg) => never
  resolve?: (
    source: string,
    importer?: string,
  ) => Promise<{ id: string; external?: boolean } | null>
}

async function bootPluginForBuild(opts: Parameters<typeof llui>[0] = {}): Promise<Plugin> {
  // crossFile: false keeps the test fast (no whole-repo TS Program) and
  // ensures the warnings we observe come from the file-local walker —
  // the surface we're testing for the consumer's case.
  const plugin = llui({ crossFile: false, ...opts })
  const configResolved = plugin.configResolved as ((c: unknown) => Promise<void>) | undefined
  await configResolved?.call(plugin, {
    command: 'build',
    mode: 'production',
    root: process.cwd(),
  })
  return plugin
}

function makeCtx(): {
  ctx: MockTransformCtx
  warnings: string[]
  errors: string[]
} {
  const warnings: string[] = []
  const errors: string[] = []
  const ctx: MockTransformCtx = {
    warn: (arg) => {
      warnings.push(typeof arg === 'string' ? arg : (arg.message ?? JSON.stringify(arg)))
    },
    error: (arg) => {
      const msg = typeof arg === 'string' ? arg : (arg.message ?? JSON.stringify(arg))
      errors.push(msg)
      throw new Error(msg)
    },
  }
  return { ctx, warnings, errors }
}

async function runTransform(
  plugin: Plugin,
  ctx: MockTransformCtx,
  code: string,
  id: string,
): Promise<unknown> {
  const hook = plugin.transform
  if (!hook || typeof hook !== 'function') throw new Error('plugin has no transform hook')
  return await (hook as (this: MockTransformCtx, code: string, id: string) => unknown).call(
    ctx,
    code,
    id,
  )
}

describe('opaque-accessor diagnostic surfaces via Vite plugin warn channel', () => {
  it('file-local opaque accessor (host.fn(s, …)) surfaces a [file-local] warning to this.warn', async () => {
    const plugin = await bootPluginForBuild()
    const { ctx, warnings, errors } = makeCtx()
    const source = `
      import { component, div } from '@llui/dom'
      const host = { dirtyAt: (_s: { a: number }, _e: number) => false }
      export const App = component({
        name: 'X',
        init: () => [{ a: 0 }, []],
        update: (s) => [s, []],
        view: () => [
          div({ title: (s) => host.dirtyAt(s, 0) ? '1' : '0' }),
        ],
      })
    `
    await runTransform(plugin, ctx, source, '/proj/src/host-opaque.ts')
    expect(errors).toEqual([])

    const opaque = warnings.filter((m) => m.includes('llui/opaque-accessor-file-wide-mask'))
    expect(opaque).toHaveLength(1)
    expect(opaque[0]).toMatch(/\[file-local\]/)
    expect(opaque[0]).toMatch(/method call/i)
    expect(opaque[0]).toMatch(/host\.dirtyAt/)
    // Format from plugin: `[<id>] <message>`.
    expect(opaque[0]).toMatch(/^\[llui\/opaque-accessor-file-wide-mask\]/)
  })

  it('single-arg host.fn(s) shape also surfaces', async () => {
    // The original consumer pattern. Locks that 1-arg method calls
    // trigger the perf warning, not just 2+-arg shapes.
    const plugin = await bootPluginForBuild()
    const { ctx, warnings } = makeCtx()
    const source = `
      import { component, div } from '@llui/dom'
      const host = { activeCalendar: (_s: { a: number }) => 'cal' }
      export const App = component({
        name: 'X',
        init: () => [{ a: 0 }, []],
        update: (s) => [s, []],
        view: () => [div({ title: (s) => host.activeCalendar(s) })],
      })
    `
    await runTransform(plugin, ctx, source, '/proj/src/host-1arg.ts')
    const opaque = warnings.filter((m) => m.includes('llui/opaque-accessor-file-wide-mask'))
    expect(opaque).toHaveLength(1)
    expect(opaque[0]).toMatch(/host\.activeCalendar/)
  })

  it('clean property-access accessors emit NO opaque warning', async () => {
    const plugin = await bootPluginForBuild()
    const { ctx, warnings } = makeCtx()
    const source = `
      import { component, div } from '@llui/dom'
      export const App = component({
        name: 'X',
        init: () => [{ a: 0, b: 0 }, []],
        update: (s) => [s, []],
        view: () => [
          div({ title: (s) => String(s.a), class: (s) => String(s.b) }),
        ],
      })
    `
    await runTransform(plugin, ctx, source, '/proj/src/clean.ts')
    const opaque = warnings.filter((m) => m.includes('llui/opaque-accessor-file-wide-mask'))
    expect(opaque).toHaveLength(0)
  })

  it('warning routes through this.warn (not this.error) — severity gating is correct', async () => {
    // Catches a class of regressions where the plugin accidentally
    // routes 'warning' severity through `this.error` (which would fail
    // the build instead of just printing). We re-throw on `this.error`
    // in the mock, so this test would crash before warnings populate.
    const plugin = await bootPluginForBuild()
    const { ctx, warnings, errors } = makeCtx()
    const source = `
      import { component, div } from '@llui/dom'
      const host = { fn: (_s: { a: number }) => 0 }
      export const App = component({
        name: 'X',
        init: () => [{ a: 0 }, []],
        update: (s) => [s, []],
        view: () => [div({ title: (s) => String(host.fn(s)) })],
      })
    `
    await runTransform(plugin, ctx, source, '/proj/src/route-via-warn.ts')
    // The opaque-accessor-file-wide-mask diagnostic must be in warnings,
    // not errors.
    expect(warnings.some((m) => /opaque-accessor-file-wide-mask/.test(m))).toBe(true)
    expect(errors.some((m) => /opaque-accessor-file-wide-mask/.test(m))).toBe(false)
  })

  it('source-id is preserved in the diagnostic location (so editors can jump)', async () => {
    // The compiler-side test asserts `range.start.line > 0`. Here we
    // also lock that the plugin doesn't drop the location when
    // forwarding to `this.warn` — Rollup uses it for the code-frame.
    const plugin = await bootPluginForBuild()
    const ctxObj: { calls: Array<{ message: string; loc?: { file?: string; line?: number } }> } = {
      calls: [],
    }
    const ctx: MockTransformCtx = {
      warn: (arg) => {
        if (typeof arg === 'object' && arg !== null) {
          const o = arg as { message?: string; loc?: { file?: string; line?: number } }
          ctxObj.calls.push({ message: o.message ?? '', loc: o.loc })
        } else {
          ctxObj.calls.push({ message: arg as string })
        }
      },
      error: (arg) => {
        throw new Error(
          typeof arg === 'string' ? arg : ((arg as { message?: string }).message ?? ''),
        )
      },
    }
    const source = `
      import { component, div } from '@llui/dom'
      const host = { activeCalendar: (_s: { a: number }) => 'cal' }
      export const App = component({
        name: 'X',
        init: () => [{ a: 0 }, []],
        update: (s) => [s, []],
        view: () => [div({ title: (s) => host.activeCalendar(s) })],
      })
    `
    await runTransform(plugin, ctx, source, '/proj/src/loc-preserved.ts')
    const opaque = ctxObj.calls.find((c) =>
      c.message.includes('llui/opaque-accessor-file-wide-mask'),
    )
    expect(opaque).toBeDefined()
    expect(opaque!.loc).toBeDefined()
    expect(opaque!.loc!.file).toBe('/proj/src/loc-preserved.ts')
    // Line is 1-based for Rollup; the offending `s` parameter ref lives
    // somewhere past the imports / type decls. Loose lower bound is
    // enough to lock that line info is not zero / missing.
    expect(opaque!.loc!.line).toBeGreaterThan(1)
  })

  // ──── Path A: file path in message body ────────────────────────────
  //
  // Vite/Rolldown's build reporter drops the structured `loc` object on
  // plugin warnings in many configurations. The user is left with just
  // the message body — and if that body doesn't carry the file path,
  // they can't tell which file produced the warning. These tests lock
  // the plugin's formatter to embed `<relfile>:<line>:` (or `<relfile>:`
  // when no line is known) into the message body itself, so the signal
  // survives any reporter.

  it('file-local warning message body INCLUDES <file>:<line>:', async () => {
    const plugin = await bootPluginForBuild()
    const { ctx, warnings } = makeCtx()
    const source = `
      import { component, div } from '@llui/dom'
      const host = { dirtyAt: (_s: { a: number }, _e: number) => false }
      export const App = component({
        name: 'X',
        init: () => [{ a: 0 }, []],
        update: (s) => [s, []],
        view: () => [
          div({ title: (s) => host.dirtyAt(s, 0) ? '1' : '0' }),
        ],
      })
    `
    // Use an absolute path inside the cwd so the plugin can compute a
    // relative form against `process.cwd()` (its captured project root).
    const cwd = process.cwd()
    const id = `${cwd}/__fixtures__/host-opaque.ts`
    await runTransform(plugin, ctx, source, id)
    const opaque = warnings.find((m) => m.includes('llui/opaque-accessor-file-wide-mask'))
    expect(opaque).toBeDefined()
    // The plugin must prepend `<relfile>:<line>:` to the message body.
    expect(opaque!).toMatch(/__fixtures__\/host-opaque\.ts:\d+:/)
  })

  it('cross-file warning message body INCLUDES <file>:<line>: (line plumbed through from compiler)', async () => {
    // After the cross-file plumbing fix, a cross-file diagnostic must
    // carry a real line number, AND that line must appear in the
    // message body via Path A. The "line >= 0" assertion at the
    // compiler layer doesn't guarantee the plugin formats it correctly.
    //
    // We construct a fixture where `mystery` is declared ambient in a
    // sibling file, so the file-local walker sees `mystery(s)` as a
    // tracked identifier-callee delegation — but cross-file resolution
    // bails (mystery has no body). The vite-plugin's `crossFile: 'silent'`
    // is required for this path; we keep the test's tsconfig overhead
    // minimal by using a single in-memory file pair.
    //
    // (Full cross-file program setup with multiple files is heavy; this
    // test instead exercises the FORMATTING contract via the file-local
    // path with a high source line. The cross-file plumbing's line
    // emission is unit-tested at the compiler layer.)
    const plugin = await bootPluginForBuild()
    const { ctx, warnings } = makeCtx()
    // Source crafted so the offending accessor lives well past line 1.
    const source = `
      // Padding to push the accessor onto a high line number, so the
      // 'line >= 2' assertion is meaningful even under whitespace edits.
      // padding 3
      // padding 4
      // padding 5
      import { component, div } from '@llui/dom'
      const host = { fn: (_s: { a: number }) => 0 }
      export const App = component({
        name: 'X',
        init: () => [{ a: 0 }, []],
        update: (s) => [s, []],
        view: () => [div({ title: (s) => String(host.fn(s)) })],
      })
    `
    const cwd = process.cwd()
    const id = `${cwd}/__fixtures__/line-preserved.ts`
    await runTransform(plugin, ctx, source, id)
    const opaque = warnings.find((m) => m.includes('llui/opaque-accessor-file-wide-mask'))
    expect(opaque).toBeDefined()
    // Concrete line number is in the body. >= 8 because the offending
    // arrow is on or past the `view:` line, well past the padding.
    const m = opaque!.match(/__fixtures__\/line-preserved\.ts:(\d+):/)
    expect(m).not.toBeNull()
    const line = parseInt(m![1]!, 10)
    expect(line).toBeGreaterThanOrEqual(8)
  })

  it('two files with opaque accessors produce TWO DISTINCT message bodies', async () => {
    // Pre-fix: the cross-file diagnostic emitted at line 0 with an
    // identical message body per file. Five files of cross-file
    // opacity → five identical lines in stdout. After Path A, each
    // message carries its own file path, so the messages are
    // distinguishable on sight without grep.
    const plugin = await bootPluginForBuild()
    const { ctx, warnings } = makeCtx()
    const mkSource = (callee: string) => `
      import { component, div } from '@llui/dom'
      const host = { ${callee}: (_s: { a: number }, _e: number) => false }
      export const App = component({
        name: 'X',
        init: () => [{ a: 0 }, []],
        update: (s) => [s, []],
        view: () => [
          div({ title: (s) => host.${callee}(s, 0) ? '1' : '0' }),
        ],
      })
    `
    const cwd = process.cwd()
    await runTransform(plugin, ctx, mkSource('fnA'), `${cwd}/__fixtures__/a.ts`)
    await runTransform(plugin, ctx, mkSource('fnB'), `${cwd}/__fixtures__/b.ts`)
    const opaque = warnings.filter((m) => m.includes('llui/opaque-accessor-file-wide-mask'))
    expect(opaque).toHaveLength(2)
    const aMsg = opaque.find((m) => m.includes('__fixtures__/a.ts'))
    const bMsg = opaque.find((m) => m.includes('__fixtures__/b.ts'))
    expect(aMsg).toBeDefined()
    expect(bMsg).toBeDefined()
    // Distinguishable: each file's name appears in only one of the two
    // messages. Pre-fix both messages had identical bodies.
    expect(aMsg).not.toBe(bMsg)
    expect(aMsg).not.toContain('__fixtures__/b.ts')
    expect(bMsg).not.toContain('__fixtures__/a.ts')
  })
})
