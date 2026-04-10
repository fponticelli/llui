import { describe, it, expect, vi } from 'vitest'
import { mountApp } from '../src/mount'
import { child } from '../src/primitives/child'
import { text } from '../src/primitives/text'
import { div, button } from '../src/elements'
import { component } from '../src/component'
import type { ComponentDef } from '../src/types'
import type { View } from '../src/view-helpers'

// ── Child component ──────────────────────────────────────────────

type ChildState = { value: number }
type ChildMsg = { type: 'propsChanged'; props: { initial: number } } | { type: 'increment' }

const ChildCounter = component<ChildState, ChildMsg, never>({
  name: 'ChildCounter',
  init: (data) => [{ value: (data as unknown as { initial: number }).initial }, []],
  update: (state, msg) => {
    switch (msg.type) {
      case 'propsChanged':
        return [{ ...state, value: msg.props.initial }, []]
      case 'increment':
        return [{ ...state, value: state.value + 1 }, []]
    }
  },
  propsMsg: (props) => ({
    type: 'propsChanged' as const,
    props: props as { initial: number },
  }),
  view: ({ send }) => [
    div({ class: 'child' }, [
      text((s: ChildState) => String(s.value)),
      button({ onClick: () => send({ type: 'increment' }) }, [text('+')]),
    ]),
  ],
  __dirty: (o, n) => (Object.is(o.value, n.value) ? 0 : 1),
})

// ── Parent component ─────────────────────────────────────────────

type ParentState = { base: number; childClicks: number }
type ParentMsg = { type: 'setBase'; value: number } | { type: 'childIncremented' }

function parentDef(): ComponentDef<ParentState, ParentMsg, never> {
  return {
    name: 'Parent',
    init: () => [{ base: 10, childClicks: 0 }, []],
    update: (state, msg) => {
      switch (msg.type) {
        case 'setBase':
          return [{ ...state, base: msg.value }, []]
        case 'childIncremented':
          return [{ ...state, childClicks: state.childClicks + 1 }, []]
      }
    },
    view: () => [
      div({ class: 'parent' }, [
        text((s: ParentState) => `clicks: ${s.childClicks}`),
        ...child<ParentState, ChildMsg>({
          def: ChildCounter as unknown as ComponentDef<unknown, ChildMsg, unknown>,
          key: 'counter',
          props: (s) => ({ initial: s.base }),
          onMsg: (msg) => (msg.type === 'increment' ? { type: 'childIncremented' as const } : null),
        }),
      ]),
    ],
    __dirty: (o, n) =>
      (Object.is(o.base, n.base) ? 0 : 0b01) | (Object.is(o.childClicks, n.childClicks) ? 0 : 0b10),
  }
}

describe('child()', () => {
  let parentSend: (msg: ParentMsg) => void

  function mount() {
    const def = parentDef()
    const origView = def.view
    def.view = (h) => {
      parentSend = h.send
      return origView(h)
    }
    const container = document.createElement('div')
    const handle = mountApp(container, def)
    return { container, handle }
  }

  it('renders the child component', () => {
    const { container } = mount()
    expect(container.querySelector('.child')).not.toBeNull()
    expect(container.querySelector('.child')!.textContent).toContain('10')
  })

  it('child has its own state — increment works independently', async () => {
    const { container, handle } = mount()
    const childBtn = container.querySelector('.child button')!
    ;(childBtn as HTMLElement).click()
    // Child processes via microtask
    await Promise.resolve()
    handle.flush()
    // Child value should be 11 (10 + 1)
    expect(container.querySelector('.child')!.textContent).toContain('11')
  })

  it('onMsg maps child messages to parent messages', async () => {
    const { container, handle } = mount()
    const childBtn = container.querySelector('.child button')!
    ;(childBtn as HTMLElement).click()
    await Promise.resolve()
    handle.flush()
    // Parent should have received childIncremented
    expect(container.querySelector('.parent')!.textContent).toContain('clicks: 1')
  })

  it('props changes propagate to child via propsMsg', () => {
    const { container, handle } = mount()
    parentSend({ type: 'setBase', value: 20 })
    handle.flush()
    // Child should receive propsChanged and update
    expect(container.querySelector('.child')!.textContent).toContain('20')
  })

  it('does not call propsMsg when props are unchanged', () => {
    const { handle } = mount()
    const spy = vi.spyOn(ChildCounter, 'update')
    // Send a parent message that changes childClicks but not base
    parentSend({ type: 'childIncremented' })
    handle.flush()
    // ChildCounter.update should NOT have been called with propsChanged
    // because base (the prop) didn't change
    const propsCalls = spy.mock.calls.filter((c) => (c[1] as ChildMsg)?.type === 'propsChanged')
    expect(propsCalls).toHaveLength(0)
    spy.mockRestore()
  })

  it('cleans up child on parent dispose', () => {
    const { container, handle } = mount()
    handle.dispose()
    expect(container.children.length).toBe(0)
  })

  it('child view receives full View bag with all helpers', () => {
    let capturedBag: View<unknown, unknown> | null = null
    const ChildSpy = component<{ v: number }, never, never>({
      name: 'ChildSpy',
      init: () => [{ v: 0 }, []],
      update: (s) => [s, []],
      view: (h) => {
        capturedBag = h as View<unknown, unknown>
        return [document.createTextNode('spy')]
      },
    })

    const Parent: ComponentDef<Record<string, never>, never, never> = {
      name: 'SpyParent',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [
        ...child({
          def: ChildSpy as unknown as ComponentDef<unknown, never, unknown>,
          key: 'spy',
          props: () => ({}),
        }),
      ],
    }

    const container = document.createElement('div')
    mountApp(container, Parent)

    expect(capturedBag).not.toBeNull()
    expect(capturedBag!.send).toBeTypeOf('function')
    expect(capturedBag!.each).toBeTypeOf('function')
    expect(capturedBag!.show).toBeTypeOf('function')
    expect(capturedBag!.branch).toBeTypeOf('function')
    expect(capturedBag!.text).toBeTypeOf('function')
    expect(capturedBag!.memo).toBeTypeOf('function')
    expect(capturedBag!.selector).toBeTypeOf('function')
    expect(capturedBag!.ctx).toBeTypeOf('function')
  })

  it('each() works when destructured from child View bag', () => {
    type CS = { items: string[] }
    const ListChild = component<CS, never, never>({
      name: 'ListChild',
      init: () => [{ items: ['x', 'y'] }, []],
      update: (s) => [s, []],
      view: ({ each }) => [
        div({ class: 'list' }, [
          ...each<string>({
            items: (s) => s.items,
            key: (v) => v,
            render: ({ item }) => {
              const el = document.createElement('span')
              el.textContent = item((v: string) => v)()
              return [el]
            },
          }),
        ]),
      ],
    })

    const Parent: ComponentDef<Record<string, never>, never, never> = {
      name: 'ListParent',
      init: () => [{}, []],
      update: (s) => [s, []],
      view: () => [
        ...child({
          def: ListChild as unknown as ComponentDef<unknown, never, unknown>,
          key: 'list',
          props: () => ({}),
        }),
      ],
    }

    const container = document.createElement('div')
    mountApp(container, Parent)

    const spans = container.querySelectorAll('.list span')
    expect(spans.length).toBe(2)
    expect(spans[0]!.textContent).toBe('x')
    expect(spans[1]!.textContent).toBe('y')
  })
})
