import { describe, it, expect, vi } from 'vitest'
import { mountApp } from '../src/mount'
import { child } from '../src/primitives/child'
import { text } from '../src/primitives/text'
import { div, button } from '../src/elements'
import { component } from '../src/component'
import type { ComponentDef } from '../src/types'

// ── Child component ──────────────────────────────────────────────

type ChildState = { value: number }
type ChildMsg = { type: 'propsChanged'; props: { initial: number } } | { type: 'increment' }

const ChildCounter = component<ChildState, ChildMsg, never>({
  name: 'ChildCounter',
  init: (data) => [{ value: (data as { initial: number }).initial }, []],
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
  view: (_state, send) => [
    div({ class: 'child' }, [
      text((s: ChildState) => String(s.value)),
      button({ onClick: () => send({ type: 'increment' }) }, [text('+')]),
    ]),
  ],
  __dirty: (o, n) => (Object.is(o.value, n.value) ? 0 : 1),
})

// ── Parent component ─────────────────────────────────────────────

type ParentState = { base: number; childClicks: number }
type ParentMsg =
  | { type: 'setBase'; value: number }
  | { type: 'childIncremented' }

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
    view: (_state, _send) => [
      div({ class: 'parent' }, [
        text((s: ParentState) => `clicks: ${s.childClicks}`),
        ...child<ParentState, ChildMsg>({
          def: ChildCounter,
          key: 'counter',
          props: (s) => ({ initial: s.base }),
          onMsg: (msg) =>
            msg.type === 'increment' ? { type: 'childIncremented' as const } : null,
        }),
      ]),
    ],
    __dirty: (o, n) =>
      (Object.is(o.base, n.base) ? 0 : 0b01) |
      (Object.is(o.childClicks, n.childClicks) ? 0 : 0b10),
  }
}

describe('child()', () => {
  let parentSend: (msg: ParentMsg) => void

  function mount() {
    const def = parentDef()
    const origView = def.view
    def.view = (state, send) => {
      parentSend = send
      return origView(state, send)
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
    const spy = vi.spyOn(ChildCounter, 'update' as never)
    // Send a parent message that changes childClicks but not base
    parentSend({ type: 'childIncremented' })
    handle.flush()
    // ChildCounter.update should NOT have been called with propsChanged
    // because base (the prop) didn't change
    const propsCalls = (spy as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: [ChildState, ChildMsg]) => c[1]?.type === 'propsChanged',
    )
    expect(propsCalls).toHaveLength(0)
    spy.mockRestore()
  })

  it('cleans up child on parent dispose', () => {
    const { container, handle } = mount()
    handle.dispose()
    expect(container.children.length).toBe(0)
  })
})
