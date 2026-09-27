import { describe, expect, it } from 'vitest'
import { mountApp, component, text, type Mountable } from '@llui/dom'
import { Table, TableBody, TableCell, TableRow } from '../llui/ui/table'

/**
 * #264 review item 3: `Table` restores shadcn's single-component shape —
 * ALWAYS rendering the scrolling container div plus the `<table>` — with
 * `viewport` as a separately-typed OPTIONAL option, never a second exported
 * `TableContainer` a caller has to remember to nest. Two things to prove
 * structurally, independent of any machine: (1) a bare `Table(...)` with no
 * `viewport` option still renders the container and still scrolls
 * horizontally, and (2) passing a machine's `viewport` bag makes the
 * container BE that part — one scrollport, not a nested pair.
 */
function mount(root: Mountable): HTMLElement {
  const host = document.createElement('div')
  document.body.append(host)
  mountApp(
    host,
    component<null, never>({
      name: 'TableViewportContainerFixture',
      init: () => [null, []],
      update: (state) => [state, []],
      view: () => [root],
    }),
  )
  return host
}

describe('Table always renders shadcn`s single scrolling container', () => {
  it('with no viewport option: still renders exactly one container div wrapping the <table>', () => {
    const host = mount(Table({}, [TableBody([TableRow([TableCell([text('Alpha')])])])]))
    const container = host.firstElementChild
    expect(container).not.toBeNull()
    expect(container?.tagName).toBe('DIV')
    expect(container?.className).toMatch(/overflow-x-auto/)
    expect(container?.querySelectorAll('table')).toHaveLength(1)
    // No second, nested scrollport: exactly one element carries the
    // overflow-x-auto container recipe.
    expect(
      container?.querySelectorAll('.overflow-x-auto, [class*="overflow-x-auto"]'),
    ).toHaveLength(0)
  })

  it('with a viewport option: the container IS that part, not a second wrapper around it', () => {
    const host = mount(
      Table({}, [TableBody([TableRow([TableCell([text('Alpha')])])])], {
        viewport: { 'data-scope': 'table', 'data-part': 'viewport' },
      }),
    )
    const container = host.firstElementChild
    expect(container?.getAttribute('data-scope')).toBe('table')
    expect(container?.getAttribute('data-part')).toBe('viewport')
    expect(container?.className).toMatch(/overflow-x-auto/)
    // Exactly ONE element with data-part="viewport" — never a bare
    // TableContainer wrapping a second, separately-part-tagged one.
    expect(host.querySelectorAll('[data-part="viewport"]')).toHaveLength(1)
    const table = container?.querySelector('table')
    expect(table).not.toBeNull()
    expect(table?.parentElement).toBe(container)
  })
})
