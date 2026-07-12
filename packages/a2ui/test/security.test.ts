import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ServerToClientEnvelope } from '../src/index.js'
import { mountA2ui, basicCatalog, type A2uiHandle } from '../src/index.js'
import { evalDynamic } from '../src/binding.js'

let container: HTMLElement
let handle: A2uiHandle

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  handle?.dispose()
  container.remove()
  vi.restoreAllMocks()
})

const CATALOG = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json'
const create = (surfaceId: string): ServerToClientEnvelope => ({
  version: 'v0.9',
  createSurface: { surfaceId, catalogId: CATALOG },
})

function surfaceEl(): HTMLElement | null {
  return container.querySelector('.a2ui-surface')
}

describe('prototype-chain registry lookups (fix 1)', () => {
  it('does not invoke a prototype member as a component builder', () => {
    handle = mountA2ui(container)
    // The root component type "toString" would index Object.prototype.toString
    // on a plain-prototype registry.
    expect(() =>
      handle.apply([
        create('s'),
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's',
            components: [{ id: 'root', component: 'toString' }],
          },
        },
      ]),
    ).not.toThrow()
    // Surface exists but the bogus component rendered nothing.
    expect(surfaceEl()).not.toBeNull()
    expect(surfaceEl()?.querySelector('*')).toBeNull()
  })

  it('does not resolve a prototype member as a catalog function', () => {
    expect(evalDynamic(basicCatalog, {}, {}, { call: '__proto__' })).toBeUndefined()
    expect(evalDynamic(basicCatalog, {}, {}, { call: 'constructor' })).toBeUndefined()
    expect(evalDynamic(basicCatalog, {}, {}, { call: 'hasOwnProperty' })).toBeUndefined()
  })

  it('renders a text binding whose {call} names a prototype member as empty', () => {
    handle = mountA2ui(container)
    handle.apply([
      create('s'),
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 's',
          components: [{ id: 'root', component: 'Text', text: { call: 'toString' } }],
        },
      },
    ])
    expect(container.querySelector('.a2ui-text')?.textContent).toBe('')
  })
})

describe('cycle guard in renderById (fix 2)', () => {
  it('does not overflow on a self-referential adjacency list', () => {
    handle = mountA2ui(container)
    expect(() =>
      handle.apply([
        create('s'),
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's',
            components: [{ id: 'root', component: 'Column', children: ['root'] }],
          },
        },
      ]),
    ).not.toThrow()
    expect(surfaceEl()).not.toBeNull()
  })

  it('does not overflow on a mutual cycle A → B → A', () => {
    handle = mountA2ui(container)
    expect(() =>
      handle.apply([
        create('s'),
        {
          version: 'v0.9',
          updateComponents: {
            surfaceId: 's',
            components: [
              { id: 'root', component: 'Column', children: ['a'] },
              { id: 'a', component: 'Column', children: ['b'] },
              { id: 'b', component: 'Column', children: ['a'] },
            ],
          },
        },
      ]),
    ).not.toThrow()
    expect(surfaceEl()).not.toBeNull()
  })
})

describe('openUrl action validation (fix 5)', () => {
  const buttonStream = (url: string): ServerToClientEnvelope[] => [
    create('s'),
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 's',
        components: [
          {
            id: 'root',
            component: 'Button',
            child: 'label',
            action: { functionCall: { call: 'openUrl', args: { url } } },
          },
          { id: 'label', component: 'Text', text: 'Go' },
        ],
      },
    },
  ]

  it('rejects a javascript: URL', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    handle = mountA2ui(container)
    handle.apply(buttonStream('javascript:alert(1)'))
    container.querySelector<HTMLButtonElement>('.a2ui-button')!.click()
    expect(open).not.toHaveBeenCalled()
  })

  it('opens an https URL with noopener,noreferrer', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    handle = mountA2ui(container)
    handle.apply(buttonStream('https://example.com/page'))
    container.querySelector<HTMLButtonElement>('.a2ui-button')!.click()
    expect(open).toHaveBeenCalledWith('https://example.com/page', '_blank', 'noopener,noreferrer')
  })
})

describe('media src sanitization (fix 6)', () => {
  const imageStream = (url: string): ServerToClientEnvelope[] => [
    create('s'),
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 's',
        components: [{ id: 'root', component: 'Image', url: { path: '/img' } }],
      },
    },
    { version: 'v0.9', updateDataModel: { surfaceId: 's', path: '/img', value: url } },
  ]

  it('drops a javascript: media URL', () => {
    handle = mountA2ui(container)
    handle.apply(imageStream('javascript:alert(1)'))
    expect(container.querySelector<HTMLImageElement>('.a2ui-image')!.getAttribute('src')).toBe('')
  })

  it('keeps an https media URL', () => {
    handle = mountA2ui(container)
    handle.apply(imageStream('https://cdn.example.com/a.png'))
    expect(container.querySelector<HTMLImageElement>('.a2ui-image')!.getAttribute('src')).toBe(
      'https://cdn.example.com/a.png',
    )
  })

  it('keeps a data: media URL (inline image)', () => {
    const data = 'data:image/png;base64,iVBOR'
    handle = mountA2ui(container)
    handle.apply(imageStream(data))
    expect(container.querySelector<HTMLImageElement>('.a2ui-image')!.getAttribute('src')).toBe(data)
  })
})

describe('theme value validation (fix: theme injection)', () => {
  const themed = (primaryColor: string): ServerToClientEnvelope[] => [
    {
      version: 'v0.9',
      createSurface: { surfaceId: 's', catalogId: CATALOG, theme: { primaryColor } },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 's',
        components: [{ id: 'root', component: 'Text', text: 'x' }],
      },
    },
  ]

  it('accepts a plain color', () => {
    handle = mountA2ui(container)
    handle.apply(themed('#00FF00'))
    expect(surfaceEl()?.getAttribute('style')).toContain('--a2ui-primary: #00FF00')
  })

  it('rejects a color that tries to inject extra declarations', () => {
    handle = mountA2ui(container)
    handle.apply(themed('red; background: url(https://evil.example/x)'))
    expect(surfaceEl()?.getAttribute('style') ?? '').not.toContain('--a2ui-primary')
  })
})
