import { describe, it, expect } from 'vitest'
import { extractBindingDescriptors } from '../src/binding-descriptors.js'

describe('extractBindingDescriptors', () => {
  it('extracts send({type: "..."}) calls from a component view', () => {
    const source = `
import { component, div, button } from '@llui/dom'

type State = { count: number }
type Msg = { type: 'inc' } | { type: 'dec' } | { type: 'reset' }

export const App = component<State, Msg, never>({
  name: 'App',
  init: () => [{ count: 0 }, []],
  update: (s, _m) => [s, []],
  view: ({ send, text }) => [
    div({}, [
      button({ onClick: () => send({ type: 'inc' }) }, [text('+')]),
      button({ onClick: () => send({ type: 'dec' }) }, [text('-')]),
      button({ onClick: () => send({ type: 'reset' }) }, [text('reset')]),
    ]),
  ],
})
`
    const result = extractBindingDescriptors(source)
    expect(result).toEqual([{ variant: 'inc' }, { variant: 'dec' }, { variant: 'reset' }])
  })
})

describe('extractBindingDescriptors — edge cases', () => {
  it('returns empty array when no component() call exists', () => {
    expect(extractBindingDescriptors(`export const x = 1`)).toEqual([])
  })

  it('returns empty array when view has no send() calls', () => {
    const src = `
import { component, div } from '@llui/dom'
type State = { n: number }; type Msg = { type: 'noop' }
export const App = component<State, Msg, never>({
  name: 'X', init: () => [{ n: 0 }, []], update: (s, _m) => [s, []],
  view: ({ text }) => [div({}, [text('hello')])],
})
`
    expect(extractBindingDescriptors(src)).toEqual([])
  })

  it('skips send() with a non-literal type field', () => {
    const src = `
import { component, button } from '@llui/dom'
type State = { nextKind: 'a' | 'b' }; type Msg = { type: 'a' } | { type: 'b' }
export const App = component<State, Msg, never>({
  name: 'X', init: () => [{ nextKind: 'a' }, []], update: (s, _m) => [s, []],
  view: ({ send }) => [
    button({ onClick: () => send({ type: 'a' }) }, []),
    button({ onClick: (_e, s) => send({ type: s.nextKind }) }, []),
  ],
})
`
    expect(extractBindingDescriptors(src)).toEqual([{ variant: 'a' }])
  })

  it('deduplicates nothing — every call site is its own entry', () => {
    const src = `
import { component, button } from '@llui/dom'
type State = { n: number }; type Msg = { type: 'inc' }
export const App = component<State, Msg, never>({
  name: 'X', init: () => [{ n: 0 }, []], update: (s, _m) => [s, []],
  view: ({ send }) => [
    button({ onClick: () => send({ type: 'inc' }) }, []),
    button({ onClick: () => send({ type: 'inc' }) }, []),
  ],
})
`
    expect(extractBindingDescriptors(src)).toEqual([{ variant: 'inc' }, { variant: 'inc' }])
  })

  it('finds send() nested inside branch/show/each bodies', () => {
    const src = `
import { component, branch, button } from '@llui/dom'
type State = { show: boolean }; type Msg = { type: 'a' } | { type: 'b' }
export const App = component<State, Msg, never>({
  name: 'X', init: () => [{ show: true }, []], update: (s, _m) => [s, []],
  view: ({ send, branch }) => [
    branch(s => s.show, [
      button({ onClick: () => send({ type: 'a' }) }, []),
    ]),
    button({ onClick: () => send({ type: 'b' }) }, []),
  ],
})
`
    expect(extractBindingDescriptors(src)).toEqual([{ variant: 'a' }, { variant: 'b' }])
  })

  it('ignores calls whose first argument is not an object literal', () => {
    const src = `
import { component, button } from '@llui/dom'
type State = { n: number }; type Msg = { type: 'real' }
export const App = component<State, Msg, never>({
  name: 'X', init: () => [{ n: 0 }, []], update: (s, _m) => [s, []],
  view: ({ send }) => [
    button({ onClick: () => send({ type: 'real' }) }, []),
    button({ onClick: () => someOtherFn('not an object') }, []),
  ],
})
`
    expect(extractBindingDescriptors(src)).toEqual([{ variant: 'real' }])
  })

  it('handles multiple top-level component() calls', () => {
    const src = `
import { component, button } from '@llui/dom'
type S1 = {}; type M1 = { type: 'a' }
type S2 = {}; type M2 = { type: 'b' }
export const A = component<S1, M1, never>({
  name: 'A', init: () => [{}, []], update: (s, _m) => [s, []],
  view: ({ send }) => [button({ onClick: () => send({ type: 'a' }) }, [])],
})
export const B = component<S2, M2, never>({
  name: 'B', init: () => [{}, []], update: (s, _m) => [s, []],
  view: ({ send }) => [button({ onClick: () => send({ type: 'b' }) }, [])],
})
`
    expect(extractBindingDescriptors(src)).toEqual([{ variant: 'a' }, { variant: 'b' }])
  })
})
