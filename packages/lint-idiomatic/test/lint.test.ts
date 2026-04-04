import { describe, it, expect } from 'vitest'
import { lintIdiomatic } from '../src/index'

describe('lintIdiomatic', () => {
  it('detects state mutation via assignment', () => {
    const source = `
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
        view: (send) => [],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'state-mutation')).toBe(true)
    expect(result.score).toBeLessThan(6)
  })

  it('detects state mutation via push', () => {
    const source = `
      import { component } from '@llui/dom'
      type State = { items: string[] }
      type Msg = { type: 'add'; item: string }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (state, msg) => {
          state.items.push(msg.item)
          return [state, []]
        },
        view: (send) => [],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'state-mutation')).toBe(true)
  })

  it('detects state mutation via compound assignment', () => {
    const source = `
      import { component } from '@llui/dom'
      type State = { count: number }
      type Msg = { type: 'inc' }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (state, msg) => {
          state.count += 1
          return [state, []]
        },
        view: (send) => [],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'state-mutation')).toBe(true)
    expect(
      result.violations.some((v) => v.rule === 'state-mutation' && v.message.includes('Compound')),
    ).toBe(true)
  })

  it('detects state mutation via increment', () => {
    const source = `
      import { component } from '@llui/dom'
      type State = { count: number }
      type Msg = { type: 'inc' }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ count: 0 }, []],
        update: (state, msg) => {
          state.count++
          return [state, []]
        },
        view: (send) => [],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'state-mutation')).toBe(true)
    expect(
      result.violations.some((v) => v.rule === 'state-mutation' && v.message.includes('Increment')),
    ).toBe(true)
  })

  it('detects .map() on state arrays in view', () => {
    const source = `
      import { component, div, text } from '@llui/dom'
      type State = { items: string[] }
      type Msg = never
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ items: [] }, []],
        update: (s, m) => [s, []],
        view: (send) => [
          div({}, state.items.map(item => text(item)))
        ],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'map-on-state-array')).toBe(true)
  })

  it('detects form boilerplate', () => {
    const source = `
      type Msg =
        | { type: 'setName'; value: string }
        | { type: 'setEmail'; value: string }
        | { type: 'setPhone'; value: string }
        | { type: 'submit' }
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'form-boilerplate')).toBe(true)
  })

  it('does not flag form boilerplate with fewer than 3 similar variants', () => {
    const source = `
      type Msg =
        | { type: 'setName'; value: string }
        | { type: 'setEmail'; value: string }
        | { type: 'submit' }
    `
    const result = lintIdiomatic(source)
    expect(result.violations.some((v) => v.rule === 'form-boilerplate')).toBe(false)
  })

  it('reports perfect score for clean code', () => {
    const source = `
      import { component, div, button, text, each, memo } from '@llui/dom'
      type State = { count: number; items: { id: number; text: string }[] }
      type Msg = { type: 'inc' } | { type: 'dec' }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ count: 0, items: [] }, []],
        update: (state, msg) => {
          switch (msg.type) {
            case 'inc': return [{ ...state, count: state.count + 1 }, []]
            case 'dec': return [{ ...state, count: state.count - 1 }, []]
          }
        },
        view: (send) => [
          div({}, [
            text(s => String(s.count)),
            button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
          ]),
        ],
      })
    `
    const result = lintIdiomatic(source)
    expect(result.score).toBe(6)
  })

  it('score decreases by unique violated rule categories', () => {
    const source = `
      import { component, div, text } from '@llui/dom'
      type State = { items: string[]; count: number }
      type Msg =
        | { type: 'setA'; value: string }
        | { type: 'setB'; value: string }
        | { type: 'setC'; value: string }
      const C = component<State, Msg, never>({
        name: 'C',
        init: () => [{ items: [], count: 0 }, []],
        update: (state, msg) => {
          state.count = 0
          return [state, []]
        },
        view: (send) => [
          div({}, state.items.map(item => text(item)))
        ],
      })
    `
    const result = lintIdiomatic(source)
    // Should have at least state-mutation, map-on-state-array, and form-boilerplate
    const violatedRules = new Set(result.violations.map((v) => v.rule))
    expect(violatedRules.size).toBeGreaterThanOrEqual(3)
    expect(result.score).toBe(6 - violatedRules.size)
  })

  it('includes correct file and position info', () => {
    const source = `const C = component({
  update: (state, msg) => {
    state.x = 1
    return [state, []]
  },
  view: () => [],
})`
    const result = lintIdiomatic(source, 'myfile.ts')
    const violation = result.violations.find((v) => v.rule === 'state-mutation')
    expect(violation).toBeDefined()
    expect(violation!.file).toBe('myfile.ts')
    expect(violation!.line).toBe(3)
    expect(violation!.column).toBeGreaterThan(0)
  })
})
