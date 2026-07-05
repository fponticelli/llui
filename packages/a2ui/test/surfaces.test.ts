import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountA2ui, type A2uiHandle } from '../src/index.js'

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

describe('multiple surfaces', () => {
  it('renders independent surfaces with their own data, in order', () => {
    handle = mountA2ui(container)
    handle.apply([
      { version: 'v0.9', createSurface: { surfaceId: 'one', catalogId: CATALOG } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'one',
          components: [{ id: 'root', component: 'Text', text: { path: '/t' } }],
        },
      },
      { version: 'v0.9', updateDataModel: { surfaceId: 'one', path: '/', value: { t: 'First' } } },
      { version: 'v0.9', createSurface: { surfaceId: 'two', catalogId: CATALOG } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'two',
          components: [{ id: 'root', component: 'Text', text: { path: '/t' } }],
        },
      },
      { version: 'v0.9', updateDataModel: { surfaceId: 'two', path: '/', value: { t: 'Second' } } },
    ])

    const surfaces = container.querySelectorAll('.a2ui-surface')
    expect(surfaces).toHaveLength(2)
    expect(surfaces[0]?.getAttribute('data-surface-id')).toBe('one')
    expect(surfaces[1]?.getAttribute('data-surface-id')).toBe('two')
    expect(surfaces[0]?.textContent).toBe('First')
    expect(surfaces[1]?.textContent).toBe('Second')

    // Updating one surface does not touch the other.
    handle.apply({
      version: 'v0.9',
      updateDataModel: { surfaceId: 'one', path: '/t', value: 'Updated' },
    })
    expect(container.querySelector('[data-surface-id="one"]')?.textContent).toBe('Updated')
    expect(container.querySelector('[data-surface-id="two"]')?.textContent).toBe('Second')
  })
})

describe('structural rebuild', () => {
  it('rebuilds the tree when updateComponents changes the root component', () => {
    handle = mountA2ui(container)
    handle.apply([
      { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: CATALOG } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's',
          components: [{ id: 'root', component: 'Text', text: 'before' }],
        },
      },
    ])
    expect(container.querySelector('.a2ui-text')?.textContent).toBe('before')
    expect(container.querySelector('.a2ui-button')).toBeNull()

    handle.apply({
      version: 'v0.9',
      updateComponents: {
        surfaceId: 's',
        components: [
          { id: 'root', component: 'Button', child: 'l', action: { event: { name: 'x' } } },
          { id: 'l', component: 'Text', text: 'now a button' },
        ],
      },
    })
    expect(container.querySelector('.a2ui-button')).not.toBeNull()
    expect(container.querySelector('.a2ui-button')?.textContent).toBe('now a button')
  })
})
