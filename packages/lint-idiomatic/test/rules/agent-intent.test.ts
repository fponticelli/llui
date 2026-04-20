import { describe, it, expect } from 'vitest'
import { lintIdiomatic } from '../../src/index'

describe('agent-missing-intent', () => {
  it('emits 1 diagnostic when 3 variants are annotated and 1 is not', () => {
    const source = `
      type Msg =
        /** @intent("Do A") */
        | { type: 'a' }
        /** @intent("Do B") */
        | { type: 'b' }
        /** @intent("Do C") */
        | { type: 'c' }
        | { type: 'missing' }
    `
    const result = lintIdiomatic(source)
    const violations = result.violations.filter((v) => v.rule === 'agent-missing-intent')
    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain('"missing"')
  })

  it('emits 0 diagnostics when all variants have @intent', () => {
    const source = `
      type Msg =
        /** @intent("Do A") */
        | { type: 'a' }
        /** @intent("Do B") */
        | { type: 'b' }
    `
    const result = lintIdiomatic(source)
    const violations = result.violations.filter((v) => v.rule === 'agent-missing-intent')
    expect(violations).toHaveLength(0)
  })

  it('emits 0 diagnostics when there is no Msg alias in the file', () => {
    const source = `
      type OtherMsg =
        | { type: 'x' }
        | { type: 'y' }
    `
    const result = lintIdiomatic(source)
    const violations = result.violations.filter((v) => v.rule === 'agent-missing-intent')
    expect(violations).toHaveLength(0)
  })

  it('emits 0 diagnostics when Msg alias is not a union', () => {
    const source = `
      type Msg = { type: 'single'; value: string }
    `
    const result = lintIdiomatic(source)
    const violations = result.violations.filter((v) => v.rule === 'agent-missing-intent')
    expect(violations).toHaveLength(0)
  })

  it('skips non-object union members (primitives) without emitting diagnostics', () => {
    const source = `
      type Msg =
        /** @intent("Do A") */
        | { type: 'a' }
        | string
        | number
    `
    const result = lintIdiomatic(source)
    const violations = result.violations.filter((v) => v.rule === 'agent-missing-intent')
    // string and number are non-object — no diagnostic for them. 'a' has @intent — no diagnostic.
    expect(violations).toHaveLength(0)
  })

  it('emits multiple diagnostics when multiple variants are missing @intent', () => {
    const source = `
      type Msg =
        | { type: 'x' }
        | { type: 'y' }
        /** @intent("Do Z") */
        | { type: 'z' }
    `
    const result = lintIdiomatic(source)
    const violations = result.violations.filter((v) => v.rule === 'agent-missing-intent')
    expect(violations).toHaveLength(2)
    const messages = violations.map((v) => v.message)
    expect(messages.some((m) => m.includes('"x"'))).toBe(true)
    expect(messages.some((m) => m.includes('"y"'))).toBe(true)
  })

  it('reports the correct variant name in the message', () => {
    const source = `
      type Msg =
        /** @intent("First") */
        | { type: 'first' }
        | { type: 'second' }
    `
    const result = lintIdiomatic(source)
    const violations = result.violations.filter((v) => v.rule === 'agent-missing-intent')
    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain('"second"')
    expect(violations[0]!.message).toContain('@intent("...")')
  })
})
