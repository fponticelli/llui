// Issue #45 — the agent/devtools metadata keys are a WIRE ABI: `@llui/compiler`
// writes them onto the `component({...})` literal in the APP chunk, this runtime
// reads them from whatever chunk it lands in. Under any vendor split the two sides
// are different chunks, so the key must be identical at emit time — no bundle-time
// rewrite can repair a mismatch.
//
// The table is declared twice (once per package) because `@llui/dom` must stay
// dependency-free — it cannot import the compiler, which pulls in `typescript`.
// This test IS the seam that keeps the two declarations honest.
import { describe, it, expect } from 'vitest'
import { COMPILER_META_KEYS as COMPILER_SIDE } from '@llui/compiler'
import { COMPILER_META_KEYS } from '../../src/signals/compiler-keys'
import { mountSignalComponent, type SignalComponentDef } from '../../src/signals/component'
import { el, signalText } from '../../src/signals/dom'
import { compileAndLoad, identityComponent } from './compile-and-load'

const AUTHORED = [
  "import { component } from '@llui/dom'",
  "type Msg = { type: 'inc' }",
  'type State = { count: number }',
  'export const Counter = component<State, Msg>({',
  '  init: () => ({ count: 0 }),',
  '  update: (s) => ({ count: s.count + 1 }),',
  "  view: ({ state }) => [text(state.at('count'))],",
  '})',
].join('\n')

/** Compile AUTHORED with agent metadata on, evaluate it, and hand back the def
 * exactly as a production `agent: true` bundle would carry it. */
function compileWithAgentMetadata(): SignalComponentDef<{ count: number }, { type: 'inc' }> {
  return compileAndLoad<{ count: number }, { type: 'inc' }>(
    AUTHORED,
    'Counter',
    { component: identityComponent, text: () => null, signalText, el },
    { emitAgentMetadata: true },
  )
}

describe('compiler ↔ runtime metadata ABI (issue #45)', () => {
  it('the runtime key table matches the compiler key table exactly', () => {
    expect(COMPILER_META_KEYS).toEqual(COMPILER_SIDE)
  })

  it('the runtime reads schemas straight off a compiler-emitted def', () => {
    const def = compileWithAgentMetadata()
    expect(def[COMPILER_META_KEYS.msgSchema]).toEqual({
      discriminant: 'type',
      variants: { inc: {} },
    })
    expect(def[COMPILER_META_KEYS.stateSchema]).toBeDefined()
    expect(typeof def[COMPILER_META_KEYS.schemaHash]).toBe('string')
  })

  it('surfaces the compiler-emitted msg schema through the debug registry', () => {
    // The devtools/agent read path — the one a production `agent: true` build
    // depends on. A key mismatch shows up here as `undefined`, not as a crash.
    const g = globalThis as unknown as { __lluiDebug?: { getMessageSchema(): unknown } }
    const container = document.createElement('div')
    const def = compileWithAgentMetadata()
    const h = mountSignalComponent(container, { ...def, name: 'AbiCounter' })
    try {
      expect(g.__lluiDebug?.getMessageSchema()).toEqual({
        discriminant: 'type',
        variants: { inc: {} },
      })
    } finally {
      h.dispose()
    }
  })
})
