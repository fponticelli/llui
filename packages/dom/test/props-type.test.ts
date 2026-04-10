import { describe, it, expect } from 'vitest'
import { mountApp, component, div, text, each } from '../src/index'
import type { Props, Send, ComponentDef } from '../src/index'

describe('Props<T, S> type helper + view function composition', () => {
  type Tool = { id: string; label: string }
  type State = {
    tools: Tool[]
    theme: 'light' | 'dark'
    selectedId: string | null
  }
  type Msg = { type: 'select'; id: string }

  // Level-1 view function — declares a TARGET shape, view uses Props<shape, S>
  type ToolbarData = {
    tools: Tool[]
    theme: string
    selectedId: string | null
  }

  function toolbar<S>(props: Props<ToolbarData, S>, send: Send<Msg>): Node[] {
    return [
      div(
        {
          class: (s: S) => `toolbar theme-${props.theme(s)}`,
          id: 'toolbar',
        },
        [
          each<S, Tool, Msg>({
            items: props.tools,
            key: (t) => t.id,
            render: ({ item, send }) => [
              div(
                {
                  class: (s: S) => (props.selectedId(s) === item.id() ? 'tool active' : 'tool'),
                  onClick: () => send({ type: 'select', id: item.id() }),
                },
                [text(item.label)],
              ),
            ],
          }),
        ],
      ),
    ]
  }

  function makeApp(): ComponentDef<State, Msg, never> {
    return {
      name: 'App',
      init: () => [
        {
          tools: [
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
          ],
          theme: 'light',
          selectedId: null,
        },
        [],
      ],
      update: (s, m) => {
        if (m.type === 'select') return [{ ...s, selectedId: m.id }, []]
        return [s, []]
      },
      view: ({ send }) =>
        toolbar<State>(
          {
            tools: (s) => s.tools,
            theme: (s) => s.theme,
            selectedId: (s) => s.selectedId,
          },
          send,
        ),
      __dirty: (o, n) =>
        (Object.is(o.tools, n.tools) ? 0 : 0b001) |
        (Object.is(o.theme, n.theme) ? 0 : 0b010) |
        (Object.is(o.selectedId, n.selectedId) ? 0 : 0b100),
    }
  }

  it('passes per-field accessors that update reactively', () => {
    const container = document.createElement('div')
    const handle = mountApp(container, makeApp())

    // Initial render: both tools visible, none active
    expect(container.querySelectorAll('.tool').length).toBe(2)
    expect(container.querySelectorAll('.tool.active').length).toBe(0)
    expect(container.querySelector('#toolbar')!.className).toBe('toolbar theme-light')

    // Click first tool — reactive to selectedId via props.selectedId
    ;(container.querySelector('.tool') as HTMLElement).click()
    handle.flush()
    expect(container.querySelectorAll('.tool.active').length).toBe(1)
    expect(container.querySelector('.tool.active')!.textContent).toBe('Alpha')
  })

  it('Props<T, S> type rejects non-accessor values at compile time', () => {
    // This test exists for its TypeScript signal — the code below should
    // produce TS errors. Runtime just asserts the type helper is exported.
    type _Check = Props<{ count: number }, { count: number }>

    // Accessor form — compiles:
    const valid: Props<{ count: number }, { count: number }> = {
      count: (s) => s.count,
    }
    expect(typeof valid.count).toBe('function')
    expect(valid.count({ count: 42 })).toBe(42)

    // @ts-expect-error — passing a raw number instead of an accessor
    const _invalid: Props<{ count: number }, { count: number }> = { count: 42 }
  })
})
