// Issue #45 — the agent-metadata property keys are a WIRE CONTRACT between the
// compiler (writer) and `@llui/dom` / `@llui/agent` (readers), and the writer and
// the readers land in DIFFERENT bundle chunks under any vendor split. The compiler
// must therefore emit the FINAL key name itself; nothing downstream is allowed to
// rewrite it.
import { describe, it, expect } from 'vitest'
import { transformSignalComponentSource } from '../../src/signals/transform-component.js'
import { COMPILER_META_KEYS } from '../../src/emit-names.js'

const SRC = [
  "import { component } from '@llui/dom'",
  "type Msg = { type: 'inc' } | { type: 'set'; v: number }",
  'type State = { count: number }',
  "type Effect = { type: 'ping' }",
  'export const Counter = component<State, Msg, Effect>({',
  '  init: () => ({ count: 0 }),',
  '  update: (s) => ({ count: s.count + 1 }),',
  "  view: ({ state }) => [text(state.at('count'))],",
  '})',
].join('\n')

const ANNOTATED = [
  "import { component } from '@llui/dom'",
  'type Msg =',
  '  /** @intent("Increment") */',
  "  | { type: 'inc' }",
  "  | { type: 'noop' }",
  'type State = { count: number }',
  'export const Counter = component({',
  '  init: () => ({ count: 0 }),',
  '  update: (s) => ({ count: s.count + 1 }),',
  "  view: ({ state }) => [text(state.at('count'))],",
  '})',
].join('\n')

describe('compiler-emitted metadata keys (issue #45)', () => {
  it('emits the short ABI keys, never the descriptive long form', () => {
    const out = transformSignalComponentSource(SRC, {
      emitAgentMetadata: true,
      devMode: true,
      fileName: '/p/Counter.ts',
    })
    expect(out).toContain(`${COMPILER_META_KEYS.msgSchema}:`)
    expect(out).toContain(`${COMPILER_META_KEYS.effectSchema}:`)
    expect(out).toContain(`${COMPILER_META_KEYS.stateSchema}:`)
    expect(out).toContain(`${COMPILER_META_KEYS.schemaHash}:`)
    expect(out).toContain(`${COMPILER_META_KEYS.componentMeta}:`)
    // The long descriptive names are the AUTHORING vocabulary only — a bundle
    // that still carries them depends on a post-bundle rewrite to become
    // readable, which is exactly the split-chunk bug.
    for (const long of [
      '__msgSchema',
      '__effectSchema',
      '__stateSchema',
      '__schemaHash',
      '__componentMeta',
    ]) {
      expect(out).not.toContain(long)
    }
  })

  it('emits the short key for sparse msg annotations', () => {
    const out = transformSignalComponentSource(ANNOTATED, { emitAgentMetadata: true })
    expect(out).toContain(`${COMPILER_META_KEYS.msgAnnotations}:`)
    expect(out).not.toContain('__msgAnnotations')
  })

  it('every ABI key is a distinct, valid, `$`-prefixed identifier', () => {
    const values = Object.values(COMPILER_META_KEYS)
    expect(new Set(values).size).toBe(values.length)
    for (const v of values) expect(v).toMatch(/^\$[A-Za-z][A-Za-z0-9]*$/)
  })
})
