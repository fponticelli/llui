import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mountA2ui,
  type A2uiActionEvent,
  type A2uiHandle,
  type ComponentNode,
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
const setData = (path: string, value: unknown) =>
  handle.apply({
    version: 'v0.9',
    updateDataModel: { surfaceId: 's', path, value: value as never },
  })

describe('validation checks on a TextField', () => {
  it('shows the first failing check message and clears it when valid', () => {
    mount(
      [
        {
          id: 'root',
          component: 'TextField',
          label: 'Email',
          value: { path: '/email' },
          checks: [
            { call: 'required', args: { value: { path: '/email' } }, message: 'Required' },
            {
              call: 'email',
              args: { value: { path: '/email' } },
              message: 'Invalid email',
            },
          ],
        },
      ],
      { email: '' },
    )
    expect(container.querySelector('.a2ui-field-error')?.textContent).toBe('Required')
    setData('/email', 'nope')
    expect(container.querySelector('.a2ui-field-error')?.textContent).toBe('Invalid email')
    setData('/email', 'a@b.com')
    expect(container.querySelector('.a2ui-field-error')).toBeNull()
  })
})

describe('validation checks on a Button', () => {
  it('disables the button and suppresses its action while a check fails', () => {
    const events: A2uiActionEvent[] = []
    mount(
      [
        {
          id: 'root',
          component: 'Button',
          child: 'l',
          action: { event: { name: 'submit' } },
          checks: [{ call: 'required', args: { value: { path: '/name' } }, message: 'Required' }],
        },
        { id: 'l', component: 'Text', text: 'Submit' },
      ],
      { name: '' },
      { onAction: (e) => events.push(e) },
    )
    const button = container.querySelector<HTMLButtonElement>('.a2ui-button')!
    expect(button.disabled).toBe(true)
    button.click()
    expect(events).toHaveLength(0)

    setData('/name', 'Ada')
    expect(button.disabled).toBe(false)
    button.click()
    expect(events).toHaveLength(1)
    expect(events[0]?.name).toBe('submit')
  })
})
