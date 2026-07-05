import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { el } from '@llui/dom'
import {
  defineCatalog,
  basicCatalog,
  mountA2ui,
  type A2uiHandle,
  type ComponentNode,
} from '../src/index.js'

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

const CUSTOM_ID = 'https://example.com/catalogs/my/catalog.json'
const BASIC_ID = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json'

const myCatalog = defineCatalog({
  id: CUSTOM_ID,
  extends: basicCatalog,
  components: {
    Gauge: ({ node }) => [el('div', { class: 'my-gauge', 'data-pct': String(node.pct ?? 0) })],
  },
})

function mount(catalogId: string, components: ComponentNode[]): void {
  handle = mountA2ui(container, { catalogs: { [CUSTOM_ID]: myCatalog } })
  handle.apply([
    { version: 'v0.9', createSurface: { surfaceId: 's', catalogId } },
    { version: 'v0.9', updateComponents: { surfaceId: 's', components } },
  ])
}

describe('defineCatalog', () => {
  it('inherits from the extended catalog and adds/overrides builders', () => {
    expect('Text' in myCatalog.components).toBe(true) // inherited
    expect('Gauge' in myCatalog.components).toBe(true) // added
    expect(myCatalog.id).toBe(CUSTOM_ID)

    const overridden = defineCatalog({
      extends: basicCatalog,
      components: { Text: () => [el('div', { class: 'custom-text' })] },
    })
    expect(overridden.components['Text']).not.toBe(basicCatalog.components['Text'])
  })
})

describe('catalog resolution', () => {
  it('renders a custom catalog component when the surface names it', () => {
    mount(CUSTOM_ID, [{ id: 'root', component: 'Gauge', pct: 42 }])
    const gauge = container.querySelector('.my-gauge')
    expect(gauge).not.toBeNull()
    expect(gauge?.getAttribute('data-pct')).toBe('42')
  })

  it('still resolves inherited Basic components in a custom catalog', () => {
    mount(CUSTOM_ID, [{ id: 'root', component: 'Text', text: 'inherited' }])
    expect(container.querySelector('.a2ui-text')?.textContent).toBe('inherited')
  })

  it('falls back to the Basic catalog for an unknown catalogId', () => {
    mount('https://unknown.example/catalog.json', [
      { id: 'root', component: 'Text', text: 'fallback' },
    ])
    expect(container.querySelector('.a2ui-text')?.textContent).toBe('fallback')
  })

  it('renders nothing (and does not crash) for an unknown component type', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount(BASIC_ID, [{ id: 'root', component: 'NoSuchThing' }])
    expect(container.querySelector('.a2ui-surface')?.textContent).toBe('')
    warn.mockRestore()
  })
})
