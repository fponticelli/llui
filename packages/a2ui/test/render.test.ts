import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { ServerToClientEnvelope } from '../src/index.js'
import { mountA2ui, type A2uiActionEvent, type A2uiHandle } from '../src/index.js'

let container: HTMLElement
let handle: A2uiHandle

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  handle?.dispose()
  container.remove()
})

function surfaceEl(): HTMLElement | null {
  return container.querySelector('.a2ui-surface')
}

describe('createSurface + updateComponents + updateDataModel', () => {
  const stream: ServerToClientEnvelope[] = [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: 'card',
        catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
        theme: { primaryColor: '#FF0000' },
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'card',
        components: [
          { id: 'root', component: 'Column', children: ['title', 'sub'] },
          { id: 'title', component: 'Text', variant: 'h1', text: { path: '/title' } },
          { id: 'sub', component: 'Text', text: 'Static subtitle' },
        ],
      },
    },
    {
      version: 'v0.9',
      updateDataModel: { surfaceId: 'card', path: '/', value: { title: 'Hello A2UI' } },
    },
  ]

  it('renders the component tree with bound + static text', () => {
    handle = mountA2ui(container)
    handle.apply(stream)
    expect(surfaceEl()).not.toBeNull()
    const h1 = container.querySelector('.a2ui-text-h1')
    expect(h1?.textContent).toBe('Hello A2UI')
    expect(container.querySelector('.a2ui-text-body')?.textContent).toBe('Static subtitle')
  })

  it('applies the theme primary color as a CSS custom property', () => {
    handle = mountA2ui(container)
    handle.apply(stream)
    expect(surfaceEl()?.getAttribute('style')).toContain('--a2ui-primary: #FF0000')
  })

  it('reacts to a later updateDataModel without rebuilding the tree', () => {
    handle = mountA2ui(container)
    handle.apply(stream)
    const h1 = container.querySelector('.a2ui-text-h1')
    handle.apply({
      version: 'v0.9',
      updateDataModel: { surfaceId: 'card', path: '/title', value: 'Updated' },
    })
    expect(container.querySelector('.a2ui-text-h1')?.textContent).toBe('Updated')
    // Same DOM node — data update did not rebuild structure.
    expect(container.querySelector('.a2ui-text-h1')).toBe(h1)
  })

  it('updates only the changed component, preserving other nodes (fix 2)', () => {
    handle = mountA2ui(container)
    handle.apply([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'multi',
          catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'multi',
          components: [
            { id: 'root', component: 'Column', children: ['a', 'b', 'c'] },
            { id: 'a', component: 'Text', text: 'Alpha' },
            { id: 'b', component: 'Text', text: 'Bravo' },
            { id: 'c', component: 'Text', text: 'Charlie' },
          ],
        },
      },
    ])
    const texts = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('.a2ui-text')]
    const before = texts()
    expect(before.map((t) => t.textContent)).toEqual(['Alpha', 'Bravo', 'Charlie'])

    // Update ONLY node 'b' — the merge keeps a/c/root by reference.
    handle.apply({
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'multi',
        components: [{ id: 'b', component: 'Text', text: 'Bravo!' }],
      },
    })
    const after = texts()
    expect(after.map((t) => t.textContent)).toEqual(['Alpha', 'Bravo!', 'Charlie'])
    // Siblings are the SAME live DOM nodes (not rebuilt); only 'b' was replaced.
    expect(after[0]).toBe(before[0])
    expect(after[2]).toBe(before[2])
    expect(after[1]).not.toBe(before[1])
  })

  it('renders components that arrive before their data (streaming)', () => {
    handle = mountA2ui(container)
    handle.apply(stream[0]!)
    handle.apply(stream[1]!) // components, but no data yet
    expect(container.querySelector('.a2ui-text-h1')?.textContent).toBe('')
    handle.apply(stream[2]!)
    expect(container.querySelector('.a2ui-text-h1')?.textContent).toBe('Hello A2UI')
  })
})

describe('template children', () => {
  const stream: ServerToClientEnvelope[] = [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: 'list',
        catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'list',
        components: [
          { id: 'root', component: 'List', children: { componentId: 'row', path: '/items' } },
          { id: 'row', component: 'Text', text: { path: 'name' } },
        ],
      },
    },
    {
      version: 'v0.9',
      updateDataModel: {
        surfaceId: 'list',
        path: '/items',
        value: [{ name: 'Alpha' }, { name: 'Beta' }],
      },
    },
  ]

  it('repeats a template over a collection with relative (scoped) paths', () => {
    handle = mountA2ui(container)
    handle.apply(stream)
    const rows = container.querySelectorAll('.a2ui-list .a2ui-text')
    expect([...rows].map((r) => r.textContent)).toEqual(['Alpha', 'Beta'])
  })

  it('reacts to collection growth (streaming rows)', () => {
    handle = mountA2ui(container)
    handle.apply(stream)
    handle.apply({
      version: 'v0.9',
      updateDataModel: {
        surfaceId: 'list',
        path: '/items',
        value: [{ name: 'Alpha' }, { name: 'Beta' }, { name: 'Gamma' }],
      },
    })
    const rows = container.querySelectorAll('.a2ui-list .a2ui-text')
    expect([...rows].map((r) => r.textContent)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })
})

describe('two-way input binding', () => {
  it('writes user input back into the data model', () => {
    handle = mountA2ui(container)
    handle.apply([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'form',
          catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'form',
          components: [
            { id: 'root', component: 'TextField', label: 'Name', value: { path: '/name' } },
          ],
        },
      },
      { version: 'v0.9', updateDataModel: { surfaceId: 'form', path: '/', value: { name: 'Jo' } } },
    ])
    const input = container.querySelector<HTMLInputElement>('.a2ui-textfield-input')!
    expect(input.value).toBe('Jo')
    input.value = 'Jordan'
    input.dispatchEvent(new Event('input'))
    expect((handle.getState().surfaces['form']?.dataModel as { name: string }).name).toBe('Jordan')
  })
})

describe('actions', () => {
  it('emits a resolved action event on button click', () => {
    const events: A2uiActionEvent[] = []
    handle = mountA2ui(container, { onAction: (e) => events.push(e) })
    handle.apply([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 's',
          catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's',
          components: [
            {
              id: 'root',
              component: 'Button',
              child: 'label',
              action: { event: { name: 'submit', context: { who: { path: '/who' } } } },
            },
            { id: 'label', component: 'Text', text: 'Go' },
          ],
        },
      },
      { version: 'v0.9', updateDataModel: { surfaceId: 's', path: '/', value: { who: 'Ada' } } },
    ])
    container.querySelector<HTMLButtonElement>('.a2ui-button')!.click()
    expect(events).toHaveLength(1)
    expect(events[0]?.name).toBe('submit')
    expect(events[0]?.context).toEqual({ who: 'Ada' })
    expect(events[0]?.sourceComponentId).toBe('root')
  })
})

describe('deleteSurface', () => {
  it('removes the surface from the DOM', () => {
    handle = mountA2ui(container)
    handle.apply([
      {
        version: 'v0.9',
        createSurface: {
          surfaceId: 'x',
          catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'x',
          components: [{ id: 'root', component: 'Text', text: 'bye' }],
        },
      },
    ])
    expect(surfaceEl()).not.toBeNull()
    handle.apply({ version: 'v0.9', deleteSurface: { surfaceId: 'x' } })
    expect(surfaceEl()).toBeNull()
  })
})
