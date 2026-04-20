import { describe, it, expect } from 'vitest'
import { lintIdiomatic } from '../../src/index'

describe('agent-exclusive-annotations', () => {
  it('emits 1 diagnostic for @humanOnly combined with @requiresConfirm', () => {
    const source = `
      type Msg =
        /**
         * @intent("Delete")
         * @humanOnly
         * @requiresConfirm
         */
        | { type: 'delete' }
    `
    const result = lintIdiomatic(source)
    const violations = result.violations.filter((v) => v.rule === 'agent-exclusive-annotations')
    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain('@requiresConfirm')
    expect(violations[0]!.message).toContain('"delete"')
  })

  it('emits 1 diagnostic for @humanOnly combined with @alwaysAffordable', () => {
    const source = `
      type Msg =
        /**
         * @intent("Checkout")
         * @humanOnly
         * @alwaysAffordable
         */
        | { type: 'checkout' }
    `
    const result = lintIdiomatic(source)
    const violations = result.violations.filter((v) => v.rule === 'agent-exclusive-annotations')
    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain('@alwaysAffordable')
    expect(violations[0]!.message).toContain('"checkout"')
  })

  it('emits 1 diagnostic mentioning both conflicts when @humanOnly combined with both @requiresConfirm and @alwaysAffordable', () => {
    const source = `
      type Msg =
        /**
         * @intent("Danger")
         * @humanOnly
         * @requiresConfirm
         * @alwaysAffordable
         */
        | { type: 'danger' }
    `
    const result = lintIdiomatic(source)
    const violations = result.violations.filter((v) => v.rule === 'agent-exclusive-annotations')
    expect(violations).toHaveLength(1)
    expect(violations[0]!.message).toContain('@requiresConfirm')
    expect(violations[0]!.message).toContain('@alwaysAffordable')
    expect(violations[0]!.message).toContain('"danger"')
  })

  it('emits 0 diagnostics when only @humanOnly is present', () => {
    const source = `
      type Msg =
        /**
         * @intent("Checkout")
         * @humanOnly
         */
        | { type: 'checkout' }
    `
    const result = lintIdiomatic(source)
    const violations = result.violations.filter((v) => v.rule === 'agent-exclusive-annotations')
    expect(violations).toHaveLength(0)
  })

  it('emits 0 diagnostics when only @requiresConfirm and @alwaysAffordable (no @humanOnly)', () => {
    const source = `
      type Msg =
        /**
         * @intent("Submit")
         * @requiresConfirm
         * @alwaysAffordable
         */
        | { type: 'submit' }
    `
    const result = lintIdiomatic(source)
    const violations = result.violations.filter((v) => v.rule === 'agent-exclusive-annotations')
    expect(violations).toHaveLength(0)
  })

  it('emits 0 diagnostics when no annotations are present', () => {
    const source = `
      type Msg =
        | { type: 'noop' }
    `
    const result = lintIdiomatic(source)
    const violations = result.violations.filter((v) => v.rule === 'agent-exclusive-annotations')
    expect(violations).toHaveLength(0)
  })

  it('emits 0 diagnostics when there is no Msg alias', () => {
    const source = `
      type Actions =
        /**
         * @humanOnly
         * @requiresConfirm
         */
        | { type: 'delete' }
    `
    const result = lintIdiomatic(source)
    const violations = result.violations.filter((v) => v.rule === 'agent-exclusive-annotations')
    expect(violations).toHaveLength(0)
  })
})
