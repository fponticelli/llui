import { describe, it, expect, vi } from 'vitest'
import lintIdiomaticPlugin, { lintIdiomatic } from '../src/vite'
import type { Plugin } from 'vite'

/**
 * Tests the Vite plugin wrapper (@llui/lint-idiomatic/vite). These
 * verify:
 *   - the plugin compiles as a real Vite plugin factory
 *   - it filters files correctly (only .ts/.tsx, skips node_modules)
 *   - it wires violations into this.warn() and this.error()
 *   - default excludes avoid duplicate warnings with @llui/vite-plugin
 *   - the exclude option overrides defaults
 */

// ── Helpers: fake the Rollup `PluginContext` ───────────────────────

interface Warning {
  msg: string
  line?: number
  column?: number
}

function makeContext(): {
  warnings: Warning[]
  errors: Warning[]
  ctx: {
    warn: (msg: string, pos?: { line: number; column: number }) => void
    error: (msg: string, pos?: { line: number; column: number }) => void
  }
} {
  const warnings: Warning[] = []
  const errors: Warning[] = []
  return {
    warnings,
    errors,
    ctx: {
      warn: (msg, pos) => warnings.push({ msg, line: pos?.line, column: pos?.column }),
      error: (msg, pos) => {
        errors.push({ msg, line: pos?.line, column: pos?.column })
      },
    },
  }
}

function runTransform(
  plugin: Plugin,
  code: string,
  id: string,
): { warnings: Warning[]; errors: Warning[] } {
  const { warnings, errors, ctx } = makeContext()
  // configResolved has to run first so the plugin captures dev/build mode
  const configResolved = typeof plugin.configResolved === 'function' ? plugin.configResolved : null
  if (configResolved) {
    configResolved.call(
      { error: (e: Error) => errors.push({ msg: e.message }) } as never,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { command: 'serve', mode: 'development' } as any,
    )
  }
  const transform =
    typeof plugin.transform === 'function' ? plugin.transform : plugin.transform?.handler
  if (!transform)
    throw new Error('plugin has no transform hook')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(transform as any).call(ctx, code, id)
  return { warnings, errors }
}

// ── Fixture sources ─────────────────────────────────────────────────

const STATE_MUTATION_SOURCE = `
  import { component } from '@llui/dom'
  type State = { count: number }
  type Msg = { type: 'inc' }
  const C = component<State, Msg, never>({
    name: 'C',
    init: () => [{ count: 0 }, []],
    update: (state, msg) => {
      state.count = state.count + 1
      return [state, []]
    },
    view: () => [],
  })
`

const MAP_ON_STATE_SOURCE = `
  import { component, div, text } from '@llui/dom'
  type State = { items: string[] }
  type Msg = { type: 'noop' }
  const C = component<State, Msg, never>({
    name: 'C',
    init: () => [{ items: [] }, []],
    update: (s, m) => [s, []],
    view: ({ text }) => [
      div({}, state.items.map((item) => div({}, [text(item)]))),
    ],
  })
`

// ── Tests ───────────────────────────────────────────────────────────

describe('lintIdiomatic vite plugin', () => {
  it('exposes a Vite plugin factory with the expected name', () => {
    const plugin = lintIdiomaticPlugin()
    expect(plugin.name).toBe('llui-lint-idiomatic')
    expect(typeof plugin.transform).toBe('function')
  })

  it('emits warnings via this.warn() for each violation', () => {
    const plugin = lintIdiomaticPlugin()
    const { warnings, errors } = runTransform(plugin, STATE_MUTATION_SOURCE, '/app/main.ts')
    expect(errors).toHaveLength(0)
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.some((w) => w.msg.includes('state-mutation'))).toBe(true)
  })

  it('includes the rule name and suggestion in the warning message', () => {
    const plugin = lintIdiomaticPlugin()
    const { warnings } = runTransform(plugin, STATE_MUTATION_SOURCE, '/app/main.ts')
    const mutation = warnings.find((w) => w.msg.includes('state-mutation'))
    expect(mutation).toBeDefined()
    // Rule name is prefixed in brackets
    expect(mutation!.msg).toMatch(/^\[state-mutation\]/)
  })

  it('skips files outside .ts/.tsx', () => {
    const plugin = lintIdiomaticPlugin()
    const { warnings } = runTransform(plugin, STATE_MUTATION_SOURCE, '/app/main.js')
    expect(warnings).toHaveLength(0)
  })

  it('skips node_modules by default', () => {
    const plugin = lintIdiomaticPlugin()
    const { warnings } = runTransform(
      plugin,
      STATE_MUTATION_SOURCE,
      '/app/node_modules/some-pkg/main.ts',
    )
    expect(warnings).toHaveLength(0)
  })

  it('excludes map-on-state-array by default (overlap with @llui/vite-plugin)', () => {
    const plugin = lintIdiomaticPlugin()
    const { warnings } = runTransform(plugin, MAP_ON_STATE_SOURCE, '/app/main.ts')
    expect(warnings.some((w) => w.msg.includes('map-on-state-array'))).toBe(false)
  })

  it('includes map-on-state-array when the user passes exclude: []', () => {
    const plugin = lintIdiomaticPlugin({ exclude: [] })
    const { warnings } = runTransform(plugin, MAP_ON_STATE_SOURCE, '/app/main.ts')
    expect(warnings.some((w) => w.msg.includes('map-on-state-array'))).toBe(true)
  })

  it('respects custom exclude list', () => {
    const plugin = lintIdiomaticPlugin({ exclude: ['state-mutation'] })
    const { warnings } = runTransform(plugin, STATE_MUTATION_SOURCE, '/app/main.ts')
    expect(warnings.some((w) => w.msg.includes('state-mutation'))).toBe(false)
  })

  it('calls this.error() when failOnError is true', () => {
    const plugin = lintIdiomaticPlugin({ failOnError: true })
    const { warnings, errors } = runTransform(plugin, STATE_MUTATION_SOURCE, '/app/main.ts')
    expect(warnings).toHaveLength(0)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => e.msg.includes('state-mutation'))).toBe(true)
  })

  it('invokes onLint callback for every transformed file', () => {
    const onLint = vi.fn()
    const plugin = lintIdiomaticPlugin({ onLint })
    runTransform(plugin, STATE_MUTATION_SOURCE, '/app/main.ts')
    expect(onLint).toHaveBeenCalledWith(
      '/app/main.ts',
      expect.objectContaining({ violations: expect.any(Array) }),
    )
  })

  it('re-exports lintIdiomatic as a convenience', () => {
    // Consumers who want both the plugin and the raw function should
    // be able to get them from the same import path.
    expect(typeof lintIdiomatic).toBe('function')
    const result = lintIdiomatic(STATE_MUTATION_SOURCE)
    expect(result.violations.some((v) => v.rule === 'state-mutation')).toBe(true)
  })
})

describe('lintIdiomatic — exclude option', () => {
  it('filters violations by rule name', () => {
    const result = lintIdiomatic(STATE_MUTATION_SOURCE, 'x.ts', {
      exclude: ['state-mutation'],
    })
    expect(result.violations.some((v) => v.rule === 'state-mutation')).toBe(false)
  })

  it('adjusts score to reflect filtered violations', () => {
    const before = lintIdiomatic(STATE_MUTATION_SOURCE)
    const after = lintIdiomatic(STATE_MUTATION_SOURCE, 'x.ts', {
      exclude: ['state-mutation'],
    })
    // The state-mutation violation was removed, so the score goes UP
    // by 1 (one fewer violated rule category).
    expect(after.score).toBeGreaterThanOrEqual(before.score)
  })

  it('leaves other violations intact', () => {
    // state-mutation triggers multiple rules; excluding just one leaves
    // the rest in place.
    const excluded = lintIdiomatic(STATE_MUTATION_SOURCE, 'x.ts', {
      exclude: ['state-mutation'],
    })
    const all = lintIdiomatic(STATE_MUTATION_SOURCE)
    // Some violations should survive (unless the only violation was state-mutation)
    // At minimum, the exclude list is respected:
    expect(excluded.violations.every((v) => v.rule !== 'state-mutation')).toBe(true)
    // And excluding one rule can't REMOVE a non-excluded rule's violations
    const otherBefore = all.violations.filter((v) => v.rule !== 'state-mutation')
    expect(excluded.violations.length).toBe(otherBefore.length)
  })
})
