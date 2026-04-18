import { describe, it, expect } from 'vitest'
import { mountApp } from '../src/mount'
import type { ComponentDef } from '../src/types'
import { unsafeHtml } from '../src/primitives/unsafe-html'
import { div } from '../src/elements'

describe('unsafeHtml()', () => {
  // ── Static string path ──────────────────────────────────────────

  it('parses a static HTML string into DOM nodes', () => {
    const def: ComponentDef<object, never, never> = {
      name: 'StaticHtml',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div({ class: 'wrap' }, unsafeHtml('<b>hi</b><i>world</i>'))],
    }
    const container = document.createElement('div')
    mountApp(container, def)
    const wrap = container.querySelector('.wrap')!
    expect(wrap.querySelector('b')?.textContent).toBe('hi')
    expect(wrap.querySelector('i')?.textContent).toBe('world')
  })

  it('returns no nodes for an empty HTML string', () => {
    const def: ComponentDef<object, never, never> = {
      name: 'EmptyHtml',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [div({ class: 'wrap' }, unsafeHtml(''))],
    }
    const container = document.createElement('div')
    mountApp(container, def)
    const wrap = container.querySelector('.wrap')!
    // No element children, no text content
    expect(wrap.children.length).toBe(0)
    expect(wrap.textContent).toBe('')
  })

  it('preserves nested structure and attributes in static HTML', () => {
    const def: ComponentDef<object, never, never> = {
      name: 'Nested',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [
        div({ class: 'wrap' }, unsafeHtml('<a href="/x" title="t"><span>click</span></a>')),
      ],
    }
    const container = document.createElement('div')
    mountApp(container, def)
    const a = container.querySelector('.wrap a') as HTMLAnchorElement
    expect(a).not.toBeNull()
    expect(a.getAttribute('href')).toBe('/x')
    expect(a.getAttribute('title')).toBe('t')
    expect(a.querySelector('span')?.textContent).toBe('click')
  })

  // ── Reactive accessor path ──────────────────────────────────────

  it('renders initial HTML from a reactive accessor', () => {
    type State = { html: string }
    const def: ComponentDef<State, never, never> = {
      name: 'ReactiveInitial',
      init: () => [{ html: '<strong>bold</strong>' }, []],
      update: (s) => [s, []],
      view: ({ unsafeHtml: uh }) => [
        div(
          { class: 'wrap' },
          uh((s: State) => s.html),
        ),
      ],
    }
    const container = document.createElement('div')
    mountApp(container, def)
    const wrap = container.querySelector('.wrap')!
    expect(wrap.querySelector('strong')?.textContent).toBe('bold')
  })

  it('re-parses and swaps nodes when the accessor value changes', () => {
    type State = { html: string }
    type Msg = { type: 'set'; value: string }
    let sendRef: ((msg: Msg) => void) | null = null
    const def: ComponentDef<State, Msg, never> = {
      name: 'ReactiveSwap',
      init: () => [{ html: '<b>first</b>' }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'set':
            return [{ ...state, html: msg.value }, []]
        }
      },
      view: ({ send, unsafeHtml: uh }) => {
        sendRef = send
        return [
          div(
            { class: 'wrap' },
            uh((s: State) => s.html),
          ),
        ]
      },
      __dirty: (o, n) => (Object.is(o.html, n.html) ? 0 : 1),
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    const wrap = container.querySelector('.wrap')!
    expect(wrap.querySelector('b')?.textContent).toBe('first')

    sendRef!({ type: 'set', value: '<i>second</i><em>more</em>' })
    handle.flush()

    expect(wrap.querySelector('b')).toBeNull()
    expect(wrap.querySelector('i')?.textContent).toBe('second')
    expect(wrap.querySelector('em')?.textContent).toBe('more')
  })

  it('handles a transition from empty HTML to non-empty', () => {
    type State = { html: string }
    type Msg = { type: 'set'; value: string }
    let sendRef: ((msg: Msg) => void) | null = null
    const def: ComponentDef<State, Msg, never> = {
      name: 'EmptyToNonEmpty',
      init: () => [{ html: '' }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'set':
            return [{ ...state, html: msg.value }, []]
        }
      },
      view: ({ send, unsafeHtml: uh }) => {
        sendRef = send
        return [
          div(
            { class: 'wrap' },
            uh((s: State) => s.html),
          ),
        ]
      },
      __dirty: (o, n) => (Object.is(o.html, n.html) ? 0 : 1),
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    const wrap = container.querySelector('.wrap')!
    expect(wrap.children.length).toBe(0)

    sendRef!({ type: 'set', value: '<p>now filled</p>' })
    handle.flush()

    expect(wrap.querySelector('p')?.textContent).toBe('now filled')
  })

  it('handles a transition from non-empty HTML to empty', () => {
    type State = { html: string }
    type Msg = { type: 'set'; value: string }
    let sendRef: ((msg: Msg) => void) | null = null
    const def: ComponentDef<State, Msg, never> = {
      name: 'NonEmptyToEmpty',
      init: () => [{ html: '<p>first</p>' }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'set':
            return [{ ...state, html: msg.value }, []]
        }
      },
      view: ({ send, unsafeHtml: uh }) => {
        sendRef = send
        return [
          div(
            { class: 'wrap' },
            uh((s: State) => s.html),
          ),
        ]
      },
      __dirty: (o, n) => (Object.is(o.html, n.html) ? 0 : 1),
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    const wrap = container.querySelector('.wrap')!
    expect(wrap.querySelector('p')?.textContent).toBe('first')

    sendRef!({ type: 'set', value: '' })
    handle.flush()

    expect(wrap.children.length).toBe(0)
  })

  it('does not touch the DOM when the accessor returns the same string', () => {
    // Identity-on-string must short-circuit — avoid destroying DOM
    // identity (focus, selection, event listeners on parsed subtrees)
    // when nothing actually changed.
    type State = { html: string; tick: number }
    type Msg = { type: 'tick' }
    let sendRef: ((msg: Msg) => void) | null = null
    const def: ComponentDef<State, Msg, never> = {
      name: 'SameString',
      init: () => [{ html: '<span id="keep">keep me</span>', tick: 0 }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'tick':
            return [{ ...state, tick: state.tick + 1 }, []]
        }
      },
      view: ({ send, unsafeHtml: uh }) => {
        sendRef = send
        return [
          div(
            { class: 'wrap' },
            uh((s: State) => s.html),
          ),
        ]
      },
      __dirty: () => 1,
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    const keep = container.querySelector('#keep')!
    expect(keep).not.toBeNull()

    sendRef!({ type: 'tick' })
    handle.flush()

    // Same node reference — DOM was not rebuilt because the HTML string
    // did not change.
    expect(container.querySelector('#keep')).toBe(keep)
  })

  it('respects the bitmask hint — irrelevant bits do not trigger re-parse', () => {
    // The reactive unsafeHtml accessor only depends on `html`, so its
    // reconcile should not fire when only `tick` changes.
    type State = { html: string; tick: number }
    type Msg = { type: 'tick' } | { type: 'set'; value: string }
    let sendRef: ((msg: Msg) => void) | null = null
    let accessorCalls = 0
    const def: ComponentDef<State, Msg, never> = {
      name: 'MaskGated',
      init: () => [{ html: '<b>hi</b>', tick: 0 }, []],
      update: (state, msg) => {
        switch (msg.type) {
          case 'tick':
            return [{ ...state, tick: state.tick + 1 }, []]
          case 'set':
            return [{ ...state, html: msg.value }, []]
        }
      },
      view: ({ send, unsafeHtml: uh }) => {
        sendRef = send
        return [
          div({ class: 'wrap' }, [
            ...uh((s: State) => {
              accessorCalls++
              return s.html
            }, 1),
          ]),
        ]
      },
      // bit 1 = html, bit 2 = tick
      __dirty: (o, n) =>
        (Object.is(o.html, n.html) ? 0 : 0b01) | (Object.is(o.tick, n.tick) ? 0 : 0b10),
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    const initialCalls = accessorCalls

    sendRef!({ type: 'tick' })
    handle.flush()
    // tick only changes bit 2 — the unsafeHtml accessor (masked to bit 1)
    // must not be invoked.
    expect(accessorCalls).toBe(initialCalls)

    sendRef!({ type: 'set', value: '<i>x</i>' })
    handle.flush()
    // html change hits the mask — accessor runs once.
    expect(accessorCalls).toBe(initialCalls + 1)
  })
})
