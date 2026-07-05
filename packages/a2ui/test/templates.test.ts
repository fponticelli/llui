import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { ComponentNode } from '../src/index.js'
import { mountA2ui, type A2uiActionEvent, type A2uiHandle } from '../src/index.js'

let container: HTMLElement
let handle: A2uiHandle
const CATALOG = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json'

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  handle?.dispose()
  container.remove()
})

function mount(
  components: ComponentNode[],
  data: unknown,
  opts?: Parameters<typeof mountA2ui>[1],
): void {
  handle = mountA2ui(container, opts)
  handle.apply([
    { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: CATALOG } },
    { version: 'v0.9', updateComponents: { surfaceId: 's', components } },
    { version: 'v0.9', updateDataModel: { surfaceId: 's', path: '/', value: data as never } },
  ])
}

function data(): Record<string, unknown> {
  return handle.getState().surfaces['s']?.dataModel as Record<string, unknown>
}

const listOf = (rowComponents: ComponentNode[]): ComponentNode[] => [
  { id: 'root', component: 'List', children: { componentId: 'row', path: '/rows' } },
  ...rowComponents,
]

describe('template two-way write-back', () => {
  it('writes an input inside a template back to the absolute /rows/N/field path', () => {
    mount(
      listOf([{ id: 'row', component: 'TextField', label: 'Label', value: { path: 'label' } }]),
      {
        rows: [
          { id: 'a', label: 'first' },
          { id: 'b', label: 'second' },
        ],
      },
    )
    const inputs = container.querySelectorAll<HTMLInputElement>('.a2ui-textfield-input')
    expect([...inputs].map((i) => i.value)).toEqual(['first', 'second'])

    // Edit the SECOND row's input — must land at /rows/1/label, not /rows/0.
    inputs[1]!.value = 'edited'
    inputs[1]!.dispatchEvent(new Event('input'))
    const rows = data().rows as { id: string; label: string }[]
    expect(rows[0]?.label).toBe('first')
    expect(rows[1]?.label).toBe('edited')
  })
})

describe('template iteration over an object', () => {
  it('iterates object values keyed by object key, with correct write-back paths', () => {
    mount(
      [
        { id: 'root', component: 'List', children: { componentId: 'row', path: '/people' } },
        { id: 'row', component: 'TextField', label: 'Name', value: { path: 'name' } },
      ],
      { people: { p1: { name: 'Alice' }, p2: { name: 'Bob' } } },
    )
    const inputs = container.querySelectorAll<HTMLInputElement>('.a2ui-textfield-input')
    expect([...inputs].map((i) => i.value)).toEqual(['Alice', 'Bob'])

    // Editing the second row must write to /people/p2/name (object key, not index).
    inputs[1]!.value = 'Bobby'
    inputs[1]!.dispatchEvent(new Event('input'))
    const people = data().people as Record<string, { name: string }>
    expect(people.p1?.name).toBe('Alice')
    expect(people.p2?.name).toBe('Bobby')
  })
})

describe('leading-slash path inside a template (v0.8 compat)', () => {
  it('resolves a leading-slash path against the ITEM, like a relative path', () => {
    // Per the A2UI spec, inside a template `/name` and `name` both resolve to
    // `/rows/N/name` — the item is the local root (contact_list relies on this).
    mount(listOf([{ id: 'row', component: 'Text', text: { path: '/label' } }]), {
      rows: [
        { id: 'a', label: 'Alpha' },
        { id: 'b', label: 'Beta' },
      ],
    })
    expect([...container.querySelectorAll('.a2ui-text')].map((n) => n.textContent)).toEqual([
      'Alpha',
      'Beta',
    ])
  })
})

describe('stateful component repeated in a template', () => {
  it('gives each Tabs instance independent active-tab state per row', () => {
    mount(
      [
        { id: 'root', component: 'List', children: { componentId: 'row-tabs', path: '/items' } },
        {
          id: 'row-tabs',
          component: 'Tabs',
          tabs: [
            { title: 'A', child: 'pa' },
            { title: 'B', child: 'pb' },
          ],
        },
        { id: 'pa', component: 'Text', text: 'panel A' },
        { id: 'pb', component: 'Text', text: 'panel B' },
      ],
      {
        items: [{ id: 'x' }, { id: 'y' }],
      },
    )
    const tabsEls = container.querySelectorAll('.a2ui-tabs')
    expect(tabsEls).toHaveLength(2)
    const triggersOf = (el: Element) => el.querySelectorAll<HTMLButtonElement>('.a2ui-tab')

    // Switch the SECOND row's Tabs to tab B.
    triggersOf(tabsEls[1]!)[1]!.click()
    expect(triggersOf(tabsEls[1]!)[1]!.getAttribute('data-state')).toBe('active')
    // The FIRST row's Tabs must be unaffected — still on tab A.
    expect(triggersOf(tabsEls[0]!)[0]!.getAttribute('data-state')).toBe('active')
    expect(triggersOf(tabsEls[0]!)[1]!.getAttribute('data-state')).toBe('inactive')
  })
})

describe('action fired from inside a template', () => {
  it('resolves relative action context against the row item', () => {
    const events: A2uiActionEvent[] = []
    mount(
      listOf([
        {
          id: 'row',
          component: 'Button',
          child: 'row-label',
          action: { event: { name: 'pick', context: { who: { path: 'name' } } } },
        },
        { id: 'row-label', component: 'Text', text: 'pick' },
      ]),
      {
        rows: [
          { id: 'a', name: 'Ada' },
          { id: 'b', name: 'Bob' },
        ],
      },
      { onAction: (e) => events.push(e) },
    )
    const buttons = container.querySelectorAll<HTMLButtonElement>('.a2ui-button')
    buttons[1]!.click()
    expect(events).toHaveLength(1)
    expect(events[0]?.name).toBe('pick')
    expect(events[0]?.context).toEqual({ who: 'Bob' })
  })
})
