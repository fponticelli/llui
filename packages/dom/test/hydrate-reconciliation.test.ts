import { describe, it, expect } from 'vitest'
import { hydrateApp, renderToString, mountApp } from '../src/index'
import { component, div, span, button, text, branch, show, each } from '../src/index'
import { browserEnv } from '../src/dom-env'
import type { Send } from '../src/types'

const env = browserEnv()

/**
 * Comprehensive hydration reconciliation tests.
 * Each test renders server HTML via renderToString, then hydrates
 * and verifies: DOM reuse, no duplicates, correct structure,
 * event handlers working, reactive updates functioning.
 */

describe('hydration reconciliation', () => {
  // Helper: render + hydrate + return container
  function serverRenderAndHydrate<S, M>(def: ReturnType<typeof component<S, M, never>>, state: S) {
    const html = renderToString(def, state, env)
    const container = document.createElement('div')
    container.innerHTML = html
    const nodeCountBefore = container.childNodes.length
    const handle = hydrateApp(container, def, state)
    return { container, handle, html, nodeCountBefore }
  }

  describe('basic elements', () => {
    it('hydrates a simple element tree without duplicates', () => {
      type S = { label: string }
      const def = component<S, never, never>({
        name: 'Basic',
        init: () => [{ label: 'hello' }, []],
        update: (s) => [s, []],
        view: () => [
          div({ class: 'wrapper' }, [span({}, [text('static')]), text((s: S) => s.label)]),
        ],
      })

      const { container } = serverRenderAndHydrate(def, { label: 'hello' })

      // Should have exactly 1 child (the wrapper div)
      const wrappers = container.querySelectorAll('.wrapper')
      expect(wrappers.length).toBe(1)

      // Content correct
      expect(container.textContent).toContain('static')
      expect(container.textContent).toContain('hello')

      // No duplicate text
      const content = container.textContent!
      expect(content.indexOf('hello')).toBe(content.lastIndexOf('hello'))
    })

    it('produces correct DOM structure after hydration', () => {
      const def = component<null, never, never>({
        name: 'Structure',
        init: () => [null, []],
        update: (s) => [s, []],
        view: () => [div({ class: 'root' }, [span({ class: 'child' }, [text('x')])])],
      })

      const { container } = serverRenderAndHydrate(def, null)

      expect(container.querySelectorAll('.root').length).toBe(1)
      expect(container.querySelectorAll('.child').length).toBe(1)
      expect(container.querySelector('.child')!.textContent).toBe('x')
    })
  })

  describe('branch()', () => {
    it('hydrates branch without duplicating content', () => {
      type S = { mode: 'a' | 'b' }
      type M = { type: 'switch' }

      const def = component<S, M, never>({
        name: 'Branch',
        init: () => [{ mode: 'a' }, []],
        update: (s) => [{ mode: s.mode === 'a' ? 'b' : 'a' }, []],
        view: () =>
          branch<S, M>({
            on: (s) => s.mode,
            cases: {
              a: () => [div({ class: 'page-a' }, [text('Page A')])],
              b: () => [div({ class: 'page-b' }, [text('Page B')])],
            },
          }),
        __dirty: (o, n) => (Object.is(o.mode, n.mode) ? 0 : 1),
      })

      const { container } = serverRenderAndHydrate(def, { mode: 'a' as const })

      // Should have Page A, not duplicated
      expect(container.querySelectorAll('.page-a').length).toBe(1)
      expect(container.querySelectorAll('.page-b').length).toBe(0)
      expect(container.textContent).toContain('Page A')
    })
  })

  describe('show()', () => {
    it('hydrates show(when=true) without duplicates', () => {
      type S = { visible: boolean }

      const def = component<S, never, never>({
        name: 'Show',
        init: () => [{ visible: true }, []],
        update: (s) => [s, []],
        view: () => [
          div({}, [text('before')]),
          ...show<S>({
            when: (s) => s.visible,
            render: () => [span({ class: 'shown' }, [text('visible')])],
          }),
          div({}, [text('after')]),
        ],
      })

      const { container } = serverRenderAndHydrate(def, { visible: true })

      expect(container.querySelectorAll('.shown').length).toBe(1)
      // "before", "visible", "after" — each once
      const t = container.textContent!
      expect(t).toContain('before')
      expect(t).toContain('visible')
      expect(t).toContain('after')
    })

    it('hydrates show(when=false) without phantom content', () => {
      type S = { visible: boolean }

      const def = component<S, never, never>({
        name: 'ShowFalse',
        init: () => [{ visible: false }, []],
        update: (s) => [s, []],
        view: () => [
          div({}, [text('before')]),
          ...show<S>({
            when: (s) => s.visible,
            render: () => [span({ class: 'shown' }, [text('visible')])],
          }),
          div({}, [text('after')]),
        ],
      })

      const { container } = serverRenderAndHydrate(def, { visible: false })

      expect(container.querySelectorAll('.shown').length).toBe(0)
      expect(container.textContent).not.toContain('visible')
    })
  })

  describe('each()', () => {
    it('hydrates a list without duplicating items', () => {
      type S = { items: Array<{ id: number; label: string }> }

      const def = component<S, never, never>({
        name: 'EachList',
        init: () => [
          {
            items: [
              { id: 1, label: 'one' },
              { id: 2, label: 'two' },
            ],
          },
          [],
        ],
        update: (s) => [s, []],
        view: () => [
          div({ class: 'list' }, [
            ...each<S, { id: number; label: string }>({
              items: (s) => s.items,
              key: (t) => t.id,
              render: ({ item }) => [div({ class: 'item' }, [text(item((t) => t.label))])],
            }),
          ]),
        ],
        __dirty: (o, n) => (Object.is(o.items, n.items) ? 0 : 1),
      })

      const { container } = serverRenderAndHydrate(def, {
        items: [
          { id: 1, label: 'one' },
          { id: 2, label: 'two' },
        ],
      })

      const items = container.querySelectorAll('.item')
      expect(items.length).toBe(2)
      expect(items[0]!.textContent).toBe('one')
      expect(items[1]!.textContent).toBe('two')
    })
  })

  describe('hydration vs fresh mount produce same result', () => {
    it('complex component: hydrated content matches mounted content', () => {
      type S = { count: number; items: string[]; show: boolean }
      type M = { type: 'inc' }

      const def = component<S, M, never>({
        name: 'Complex',
        init: () => [{ count: 5, items: ['a', 'b', 'c'], show: true }, []],
        update: (s, m) => {
          if (m.type === 'inc') return [{ ...s, count: s.count + 1 }, []]
          return [s, []]
        },
        view: () => [
          div({ class: 'header' }, [
            text((s: S) => `Count: ${s.count}`),
            button({ onClick: () => {} }, [text('click')]),
          ]),
          ...show<S, M>({
            when: (s) => s.show,
            render: () => [
              div({ class: 'panel' }, [
                ...each<S, string, M>({
                  items: (s) => s.items,
                  key: (item) => item,
                  render: ({ item }) => [span({ class: 'tag' }, [text(item((i) => i))])],
                }),
              ]),
            ],
          }),
        ],
        __dirty: () => 1,
      })

      const state: S = { count: 5, items: ['a', 'b', 'c'], show: true }

      // Fresh mount
      const mountContainer = document.createElement('div')
      const mountHandle = mountApp(mountContainer, def)

      // Hydrated
      const html = renderToString(def, state, env)
      const hydrateContainer = document.createElement('div')
      hydrateContainer.innerHTML = html
      const hydrateHandle = hydrateApp(hydrateContainer, def, state)

      // Compare structure
      expect(hydrateContainer.querySelectorAll('.header').length).toBe(1)
      expect(hydrateContainer.querySelectorAll('.panel').length).toBe(1)
      expect(hydrateContainer.querySelectorAll('.tag').length).toBe(3)

      // Content matches
      expect(hydrateContainer.querySelector('.header')!.textContent).toContain('Count: 5')

      mountHandle.dispose()
      hydrateHandle.dispose()
    })
  })

  describe('post-hydration reactivity', () => {
    it('reactive text updates after hydration', () => {
      type S = { label: string }
      type M = { type: 'set'; value: string }

      let sendFn: Send<M>

      const def = component<S, M, never>({
        name: 'Reactive',
        init: () => [{ label: 'initial' }, []],
        update: (s, m) => [{ label: m.value }, []],
        view: ({ send }) => {
          sendFn = send
          return [div({}, [text((s: S) => s.label)])]
        },
        __dirty: (o, n) => (Object.is(o.label, n.label) ? 0 : 1),
      })

      const { container, handle } = serverRenderAndHydrate(def, { label: 'initial' })

      expect(container.textContent).toBe('initial')

      sendFn!({ type: 'set', value: 'updated' })
      handle.flush()
      expect(container.textContent).toBe('updated')
    })

    it('event handlers work after hydration', () => {
      type S = { count: number }
      type M = { type: 'inc' }

      const def = component<S, M, never>({
        name: 'Events',
        init: () => [{ count: 0 }, []],
        update: (s) => [{ count: s.count + 1 }, []],
        view: ({ send }) => [
          div({}, [
            text((s: S) => String(s.count)),
            button({ class: 'btn', onClick: () => send({ type: 'inc' }) }, [text('+')]),
          ]),
        ],
        __dirty: (o, n) => (Object.is(o.count, n.count) ? 0 : 1),
      })

      const { container, handle } = serverRenderAndHydrate(def, { count: 0 })

      expect(container.textContent).toContain('0')

      // Click button
      ;(container.querySelector('.btn') as HTMLElement).click()
      handle.flush()

      expect(container.textContent).toContain('1')
    })
  })
})
