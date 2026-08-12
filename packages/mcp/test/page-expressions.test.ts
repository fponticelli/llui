// The Playwright-fallback page expressions must be DERIVED from @llui/dom's
// shared collector, never hand-mirrored.
//
// This is the regression gate for issue #50: the telemetry walk used to exist
// three times, once as a stringified CDP expression the type-checker could not
// see — and it had already drifted (it never excluded the HUD's own components).
// Evaluating the expression here and comparing it against a direct call to the
// shared function fails the moment the two stop being the same code.
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectComponentInfo,
  collectDebugSnapshot,
  DEVTOOLS_COMPONENT_PREFIX,
  type DebugSnapshot,
  type TelemetrySource,
} from '@llui/dom/debug-collect'
import type { LluiDebugAPI } from '@llui/dom'
import { PAGE_META_EXPR, PAGE_TELEMETRY_EXPR } from '../src/tools/notes.js'

/** Registry entries are `LluiDebugAPI`; the collector probes only the telemetry
 *  subset, so a partial stub stands in for everything it reads. */
function asRegistry(entries: Record<string, TelemetrySource>): Record<string, LluiDebugAPI> {
  return entries as Record<string, LluiDebugAPI>
}

function stub(
  state: unknown,
  info?: { name: string; file: string; line: number },
): TelemetrySource {
  return {
    getState: () => state,
    getMessageHistory: () => [{ index: 0, timestamp: 1700000000000, msg: { type: 'Load' } }],
    getPendingEffects: () => [],
    getEffectTimeline: () => [
      { effectId: 'e0', type: 'http', phase: 'resolved', timestamp: 1700000000001 },
    ],
    ...(info ? { getComponentInfo: () => info } : {}),
  }
}

/** Evaluate the expression the way `page.evaluate(string)` does — as an
 *  expression in a bare function scope over the same global object. */
function evaluate<T>(expression: string): T {
  return new Function(`return ${expression}`)() as T
}

afterEach(() => {
  globalThis.__lluiComponents = undefined
})

describe('PAGE_TELEMETRY_EXPR', () => {
  it('produces exactly what the shared collector produces in-process', () => {
    globalThis.__lluiComponents = asRegistry({
      App: stub({ route: '/' }, { name: 'App', file: 'src/App.ts', line: 4 }),
    })
    expect(evaluate<DebugSnapshot>(PAGE_TELEMETRY_EXPR)).toEqual(collectDebugSnapshot())
  })

  it('returns {} when the page has no debug registry', () => {
    expect(evaluate<DebugSnapshot>(PAGE_TELEMETRY_EXPR)).toEqual({})
  })

  it('excludes the devmode HUD from captured telemetry', () => {
    globalThis.__lluiComponents = asRegistry({
      App: stub({ route: '/' }),
      [`${DEVTOOLS_COMPONENT_PREFIX}hud`]: stub({ open: true }),
    })
    const snapshot = evaluate<DebugSnapshot>(PAGE_TELEMETRY_EXPR)
    expect(Object.keys(snapshot.stateSnapshot ?? {})).toEqual(['App'])
  })
})

describe('PAGE_META_EXPR', () => {
  it('derives componentPath/componentMeta from the shared collector', () => {
    globalThis.__lluiComponents = asRegistry({
      App: stub({ route: '/' }, { name: 'App', file: 'src/App.ts', line: 4 }),
    })
    const meta = evaluate<{
      url: string
      viewport: { w: number; h: number; dpr: number }
      llui: { runtime: string; compiler: string }
      componentPath: string[] | null
      componentMeta: { file: string; line: number; name: string } | null
    }>(PAGE_META_EXPR)
    const info = collectComponentInfo()
    expect(meta.componentPath).toEqual(info?.componentPath)
    expect(meta.componentMeta).toEqual(info?.componentMeta)
    // page-only fields still come from the page itself
    expect(meta.url).toBe(location.href)
    expect(meta.viewport.dpr).toBeGreaterThan(0)
    expect(meta.llui).toEqual({ runtime: 'unknown', compiler: 'unknown' })
  })

  it('keeps componentPath null when nothing is mounted', () => {
    const meta = evaluate<{ componentPath: string[] | null; componentMeta: unknown }>(
      PAGE_META_EXPR,
    )
    expect(meta.componentPath).toBe(null)
    expect(meta.componentMeta).toBe(null)
  })
})
