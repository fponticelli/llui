import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  BASIC_CATALOG_ID,
  defineCatalog,
  mountA2ui,
  type A2uiActionEvent,
  type A2uiHandle,
} from '../src/index.js'

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

function mountWithButton(sendDataModel: boolean, onAction: (e: A2uiActionEvent) => void): void {
  handle = mountA2ui(container, { onAction })
  handle.apply([
    { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: CATALOG, sendDataModel } },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 's',
        components: [
          { id: 'root', component: 'Button', child: 'l', action: { event: { name: 'go' } } },
          { id: 'l', component: 'Text', text: 'Go' },
        ],
      },
    },
    { version: 'v0.9', updateDataModel: { surfaceId: 's', path: '/', value: { a: 1, b: 'x' } } },
  ])
}

describe('sendDataModel client→server sync', () => {
  it('rides the surface data model on the action event when sendDataModel is true', () => {
    const events: A2uiActionEvent[] = []
    mountWithButton(true, (e) => events.push(e))
    container.querySelector<HTMLButtonElement>('.a2ui-button')!.click()
    expect(events).toHaveLength(1)
    expect(events[0]?.dataModel).toEqual({ a: 1, b: 'x' })
  })

  it('omits the data model when sendDataModel is not set', () => {
    const events: A2uiActionEvent[] = []
    mountWithButton(false, (e) => events.push(e))
    container.querySelector<HTMLButtonElement>('.a2ui-button')!.click()
    expect(events).toHaveLength(1)
    expect(events[0]?.dataModel).toBeUndefined()
  })
})

describe('capabilities + version negotiation', () => {
  it('advertises the Basic catalog plus any custom catalogs', () => {
    const custom = defineCatalog({ id: 'https://x/cat.json', components: {} })
    handle = mountA2ui(container, { catalogs: { 'https://x/cat.json': custom } })
    expect(handle.capabilities().supportedCatalogIds).toEqual([
      BASIC_CATALOG_ID,
      'https://x/cat.json',
    ])
  })

  it('warns (but does not throw) on an unsupported protocol version', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    handle = mountA2ui(container)
    expect(() =>
      handle.apply({ version: 'v0.7', createSurface: { surfaceId: 's', catalogId: CATALOG } }),
    ).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unsupported A2UI version "v0.7"'))
    warn.mockRestore()
  })
})
