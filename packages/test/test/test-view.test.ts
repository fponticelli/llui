import { describe, it, expect } from 'vitest'
import { testView } from '../src/test-view'
import { component, div, ul, li, span, h1, text, each } from '@llui/dom'

type State = { items: string[]; title: string }

const ListComponent = component<State, never, never>({
  name: 'List',
  init: () => [{ items: ['one', 'two', 'three'], title: 'My List' }, []],
  update: (s) => [s, []],
  view: () => [
    div({ class: 'container' }, [
      h1({}, [text((s: State) => s.title)]),
      ul(
        { class: 'list' },
        each<State, string>({
          items: (s) => s.items,
          key: (item) => item,
          render: (item) => [li({ 'data-testid': 'item' }, [text(item((t) => t))])],
        }),
      ),
    ]),
  ],
})

describe('testView', () => {
  it('queries elements by selector', () => {
    const v = testView(ListComponent, { items: ['a', 'b'], title: 'Test' })
    expect(v.query('.container')).not.toBeNull()
    expect(v.query('.list')).not.toBeNull()
  })

  it('queries all matching elements', () => {
    const v = testView(ListComponent, { items: ['a', 'b', 'c'], title: 'Test' })
    expect(v.queryAll('[data-testid="item"]')).toHaveLength(3)
  })

  it('reads text content', () => {
    const v = testView(ListComponent, { items: ['hello'], title: 'Title' })
    expect(v.query('h1')?.textContent).toBe('Title')
  })

  it('returns null for non-existent selectors', () => {
    const v = testView(ListComponent, { items: [], title: '' })
    expect(v.query('.nonexistent')).toBeNull()
  })
})
