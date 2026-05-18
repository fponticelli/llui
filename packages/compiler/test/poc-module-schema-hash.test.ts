import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import {
  ModuleRegistry,
  schemaHashModule,
  SCHEMA_HASH_INPUTS_SLOT,
  type SchemaHashInputs,
  type CompilerModule,
} from '../src/index.js'
import { computeSchemaHash } from '../src/schema-hash.js'

/**
 * v2c/decomp-1 — schema-hash module.
 *
 * Validates that the registry-driven schemaHashModule produces the same
 * `__schemaHash` string the monolith's inline `computeSchemaHash` would.
 * Sibling agent modules (`msg-schema`, `state-schema`, `msg-annotations`)
 * don't exist yet — they're future decomposition work. The test uses a
 * stub "inputs producer" module that writes a synthetic schema set into
 * the shared slot; the schemaHashModule's emit consumes that slot.
 */

function parse(source: string): ts.SourceFile {
  return ts.createSourceFile('test.ts', source, ts.ScriptTarget.Latest, true)
}

/**
 * Stub module that pre-populates the schema-hash inputs slot. Models
 * what `msg-schema` + `state-schema` + `msg-annotations` modules will
 * do once they exist; for the POC we synthesize the values directly.
 */
function makeInputsProducer(inputs: SchemaHashInputs): CompilerModule {
  return {
    name: 'inputs-producer',
    compilerVersion: '^0.3.0',
    diagnostics: [],
    visitors: {
      [ts.SyntaxKind.SourceFile]: (ctx) => {
        ctx.getSlot<SchemaHashInputs>(SCHEMA_HASH_INPUTS_SLOT, () => inputs)
      },
    },
  }
}

describe('v2c/decomp-1 — schemaHashModule', () => {
  it('emits __schemaHash matching computeSchemaHash for populated inputs', () => {
    const inputs: SchemaHashInputs = {
      msgSchema: { type: 'union', members: [{ type: 'inc' }, { type: 'reset' }] },
      stateSchema: { kind: 'object', fields: [{ name: 'count', type: 'number' }] },
      // The hash function consumes `Record<string, MessageAnnotations>`
      // but normalises via `sortDeep` over JSON — it doesn't validate
      // field shapes. Cast through `unknown` to keep the test fixture
      // small (vs. spelling out every annotation field, which would
      // bind the test to MessageAnnotations' evolving schema).
      msgAnnotations: { inc: { intent: 'inc' } } as unknown as Record<
        string,
        import('../src/msg-annotations.js').MessageAnnotations
      >,
    }
    const expected = computeSchemaHash({
      msgSchema: inputs.msgSchema,
      stateSchema: inputs.stateSchema,
      msgAnnotations: inputs.msgAnnotations,
    })
    const registry = new ModuleRegistry([makeInputsProducer(inputs), schemaHashModule])
    const result = registry.run(parse(``))
    const emission = result.emissions.find((e) => e.field === '__schemaHash')
    expect(emission).toBeDefined()
    expect(emission!.module).toBe('schema-hash')
    expect(ts.isStringLiteral(emission!.value)).toBe(true)
    expect((emission!.value as ts.StringLiteral).text).toBe(expected)
  })

  it('produces a deterministic hash — same inputs in different declaration order yield the same hash', () => {
    const inputsA: SchemaHashInputs = {
      msgSchema: { variants: ['a', 'b', 'c'] },
      stateSchema: { fields: ['x', 'y'] },
      msgAnnotations: null,
    }
    // Different object key insertion order; `computeSchemaHash`
    // normalises via sortDeep.
    const inputsB: SchemaHashInputs = {
      msgAnnotations: null,
      stateSchema: { fields: ['x', 'y'] },
      msgSchema: { variants: ['a', 'b', 'c'] },
    }
    const hashA = (
      new ModuleRegistry([makeInputsProducer(inputsA), schemaHashModule]).run(parse(``))
        .emissions[0]!.value as ts.StringLiteral
    ).text
    const hashB = (
      new ModuleRegistry([makeInputsProducer(inputsB), schemaHashModule]).run(parse(``))
        .emissions[0]!.value as ts.StringLiteral
    ).text
    expect(hashA).toBe(hashB)
  })

  it('emits nothing when all inputs are null', () => {
    const inputs: SchemaHashInputs = {
      msgSchema: null,
      stateSchema: null,
      msgAnnotations: null,
    }
    const registry = new ModuleRegistry([makeInputsProducer(inputs), schemaHashModule])
    const result = registry.run(parse(``))
    expect(result.emissions.find((e) => e.field === '__schemaHash')).toBeUndefined()
  })

  it('emits __schemaHash even when only one of the three inputs is non-null', () => {
    const inputs: SchemaHashInputs = {
      msgSchema: { type: 'inc' },
      stateSchema: null,
      msgAnnotations: null,
    }
    const registry = new ModuleRegistry([makeInputsProducer(inputs), schemaHashModule])
    const result = registry.run(parse(``))
    const emission = result.emissions.find((e) => e.field === '__schemaHash')
    expect(emission).toBeDefined()
    const expected = computeSchemaHash({
      msgSchema: { type: 'inc' },
      stateSchema: null,
      msgAnnotations: null,
    })
    expect((emission!.value as ts.StringLiteral).text).toBe(expected)
  })

  it('emits nothing when the inputs slot is absent (no sibling producer)', () => {
    // Run schemaHashModule alone — no inputs producer.
    const registry = new ModuleRegistry([schemaHashModule])
    const result = registry.run(parse(``))
    expect(result.emissions).toEqual([])
  })

  it('declares no visitors — pure emit consumer', () => {
    expect(Object.keys(schemaHashModule.visitors)).toHaveLength(0)
  })
})
