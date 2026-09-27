import { describe, expect, it } from 'vitest'
import { formatGalleryQuery } from '@llui/cli/gallery'
import {
  frameKey,
  initialEffects,
  initialState,
  update,
  type Effect,
  type Msg,
  type State,
} from '../src/shell/state'

function run(state: State, ...msgs: Msg[]): [State, Effect[]] {
  let current = state
  const effects: Effect[] = []
  for (const msg of msgs) {
    const [next, emitted] = update(current, msg)
    current = next
    effects.push(...emitted)
  }
  return [current, effects]
}

const search = (state: State) => formatGalleryQuery(state.location)

describe('shell update', () => {
  it('replaces a non-canonical landing URL instead of adding history', () => {
    const state = initialState('?entry=dropdown-menu')
    expect(search(state)).toBe('?entry=menu&path=registry&artifact=dropdown-menu')
    expect(initialEffects(state, '?entry=dropdown-menu')).toEqual([
      { type: 'history', mode: 'replace', search: search(state) },
      { type: 'title', title: 'Menu — Open menu states · Component Gallery · LLui' },
      ...Object.keys(state.frames).map((key) => ({ type: 'watchFrame', key })),
    ])
    expect(initialEffects(state, search(state)).some(({ type }) => type === 'history')).toBe(false)
  })

  it('pushes history on navigation and moves focus when the entry changes', () => {
    const [state, effects] = run(initialState(''), {
      type: 'navigate',
      location: { entry: 'tabs' },
    })
    expect(search(state)).toBe('?entry=tabs')
    expect(effects).toContainEqual({ type: 'history', mode: 'push', search: '?entry=tabs' })
    expect(effects).toContainEqual({ type: 'focusMain' })
    expect(effects.filter(({ type }) => type === 'watchFrame')).toHaveLength(1)
  })

  it('replaces history while typing a search and keeps the entry', () => {
    const [state, effects] = run(initialState('?entry=tabs'), { type: 'setQuery', query: 'men' })
    expect(search(state)).toBe('?entry=tabs&q=men')
    expect(effects).toEqual([
      { type: 'history', mode: 'replace', search: '?entry=tabs&q=men' },
      { type: 'title', title: 'Tabs — Active tab · Component Gallery · LLui' },
    ])
    expect(state.results[0]).toBe('menu')
  })

  it('follows back/forward without writing history', () => {
    const [state, effects] = run(initialState('?entry=tabs'), {
      type: 'popState',
      search: '?entry=menu',
    })
    expect(search(state)).toBe('?entry=menu')
    expect(effects.every(({ type }) => type !== 'history')).toBe(true)
  })

  it('switches path keeping the case and environment', () => {
    const [state] = run(initialState('?entry=accordion&case=closed&dir=rtl'), {
      type: 'setPath',
      path: 'registryTailwind',
    })
    expect(search(state)).toBe('?entry=accordion&path=registry&case=closed&dir=rtl')
  })

  it('remembers an axis across a case that cannot vary it', () => {
    // accordion: `closed` varies direction, `disabled` varies nothing.
    const [state] = run(
      initialState('?entry=accordion&case=closed'),
      { type: 'setAxis', patch: { direction: 'rtl' } },
      { type: 'setCase', caseId: 'disabled' },
      { type: 'setCase', caseId: 'closed' },
    )
    expect(search(state)).toBe('?entry=accordion&case=closed&dir=rtl')
    expect(state.notices).toEqual([])
  })

  it('tracks each frame by document URL and retry generation, ignoring stale reports', () => {
    const [state] = run(initialState('?entry=tabs'))
    const [key] = Object.keys(state.frames)
    expect(key).toBe(frameKey('./baseline/?entry=tabs&case=active', 0))
    const [ready] = run(state, { type: 'frameStatus', key: key!, status: 'ready' })
    expect(ready.frames[key!]).toEqual({ status: 'ready' })
    const [stale] = run(ready, { type: 'frameStatus', key: 'elsewhere#0', status: 'error' })
    expect(stale).toBe(ready)
  })

  it('times out only a frame that is still loading', () => {
    const state = initialState('?entry=tabs')
    const [key] = Object.keys(state.frames)
    const [timedOut] = run(state, { type: 'frameTimeout', key: key! })
    expect(timedOut.frames[key!]).toMatchObject({ status: 'error', code: 'timeout' })
    const [ready] = run(state, { type: 'frameStatus', key: key!, status: 'ready' })
    expect(run(ready, { type: 'frameTimeout', key: key! })[0]).toBe(ready)
  })

  it('retries by changing every frame key, which re-creates the frames', () => {
    const state = initialState('?entry=tabs&view=compare')
    const [retried, effects] = run(state, { type: 'retry' })
    expect(Object.keys(retried.frames)).toHaveLength(2)
    for (const key of Object.keys(retried.frames)) {
      expect(state.frames[key]).toBeUndefined()
      expect(key.endsWith('#1')).toBe(true)
    }
    expect(effects.filter(({ type }) => type === 'watchFrame')).toHaveLength(2)
  })

  it('never writes shell-only state into the URL', () => {
    const [state] = run(
      initialState('?entry=tabs'),
      { type: 'setShellTheme', theme: 'dark' },
      { type: 'toggleNav' },
    )
    expect(search(state)).toBe('?entry=tabs')
  })
})
