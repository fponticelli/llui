import { describe, it, expect } from 'vitest'
import { testView } from '../src/test-view'
import { component, div, ul, li, span, h1, text, each, button, input } from '@llui/dom'

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
          render: ({ item }) => [li({ 'data-testid': 'item' }, [text(item((t) => t))])],
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

  it('text() helper reads text content', () => {
    const v = testView(ListComponent, { items: [], title: 'Hello' })
    expect(v.text('h1')).toBe('Hello')
    expect(v.text('.missing')).toBe('')
  })

  it('attr() reads attributes', () => {
    const v = testView(ListComponent, { items: [], title: 'x' })
    expect(v.attr('.container', 'class')).toBe('container')
    expect(v.attr('.missing', 'x')).toBeNull()
  })
})

describe('testView — interactive', () => {
  type State = { count: number; label: string }
  type Msg = { type: 'inc' } | { type: 'setLabel'; value: string }

  const Counter = component<State, Msg, never>({
    name: 'Counter',
    init: () => [{ count: 0, label: '' }, []],
    update: (s, m) => {
      if (m.type === 'inc') return [{ ...s, count: s.count + 1 }, []]
      if (m.type === 'setLabel') return [{ ...s, label: m.value }, []]
      return [s, []]
    },
    view: (send) => [
      div({ class: 'root' }, [
        span({ class: 'count' }, [text((s: State) => String(s.count))]),
        span({ class: 'label' }, [text((s: State) => s.label)]),
        button({ class: 'bump', onClick: () => send({ type: 'inc' }) }, [text('+')]),
        input({
          class: 'name',
          type: 'text',
          onInput: (e: Event) =>
            send({ type: 'setLabel', value: (e.target as HTMLInputElement).value }),
        }),
      ]),
    ],
  })

  it('send() dispatches a message and flushes', () => {
    const v = testView(Counter, { count: 0, label: '' })
    expect(v.text('.count')).toBe('0')
    v.send({ type: 'inc' })
    expect(v.text('.count')).toBe('1')
    v.unmount()
  })

  it('click() fires onClick and flushes', () => {
    const v = testView(Counter, { count: 0, label: '' })
    v.click('.bump')
    v.click('.bump')
    v.click('.bump')
    expect(v.text('.count')).toBe('3')
    v.unmount()
  })

  it('input() sets value and dispatches input event', () => {
    const v = testView(Counter, { count: 0, label: '' })
    v.input('.name', 'alice')
    expect(v.text('.label')).toBe('alice')
    v.unmount()
  })

  it('click throws when selector matches nothing', () => {
    const v = testView(Counter, { count: 0, label: '' })
    expect(() => v.click('.missing')).toThrow(/no element matches/)
    v.unmount()
  })

  it('unmount disposes and clears the container; is idempotent', () => {
    const v = testView(Counter, { count: 0, label: '' })
    expect(v.query('.root')).not.toBeNull()
    v.unmount()
    v.unmount() // no error
    expect(v.query('.root')).toBeNull()
  })
})
