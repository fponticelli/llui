import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { ComponentNode } from '../src/index.js'
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

function mount(components: ComponentNode[], data: unknown): void {
  handle = mountA2ui(container)
  handle.apply([
    { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: CATALOG } },
    { version: 'v0.9', updateComponents: { surfaceId: 's', components } },
    { version: 'v0.9', updateDataModel: { surfaceId: 's', path: '/', value: data as never } },
  ])
}

function data(): Record<string, unknown> {
  return handle.getState().surfaces['s']?.dataModel as Record<string, unknown>
}

describe('TextField number variant', () => {
  it('writes a NUMBER back to the data model, not a string (fix 4)', () => {
    mount(
      [
        {
          id: 'root',
          component: 'TextField',
          variant: 'number',
          label: 'Age',
          value: { path: '/age' },
        },
      ],
      { age: 3 },
    )
    const input = container.querySelector<HTMLInputElement>('.a2ui-textfield-input')!
    expect(input.getAttribute('type')).toBe('number')
    input.value = '42'
    input.dispatchEvent(new Event('input'))
    expect(data().age).toBe(42)
    expect(typeof data().age).toBe('number')
  })

  it('skips write on an incomplete numeric entry ("-") instead of writing NaN', () => {
    mount(
      [
        {
          id: 'root',
          component: 'TextField',
          variant: 'number',
          label: 'Age',
          value: { path: '/age' },
        },
      ],
      { age: 7 },
    )
    const input = container.querySelector<HTMLInputElement>('.a2ui-textfield-input')!
    input.value = '-'
    input.dispatchEvent(new Event('input'))
    // Value untouched — no NaN clobber mid-entry.
    expect(data().age).toBe(7)
  })

  it('shortText variant still writes a string', () => {
    mount([{ id: 'root', component: 'TextField', label: 'Name', value: { path: '/name' } }], {
      name: 'Jo',
    })
    const input = container.querySelector<HTMLInputElement>('.a2ui-textfield-input')!
    input.value = 'Jordan'
    input.dispatchEvent(new Event('input'))
    expect(data().name).toBe('Jordan')
  })
})

describe('CheckBox (via @llui/components)', () => {
  beforeEach(() => {
    mount([{ id: 'root', component: 'CheckBox', label: 'Agree', value: { path: '/agree' } }], {
      agree: false,
    })
  })

  it('renders an accessible checkbox reflecting the bound value', () => {
    const box = container.querySelector('.a2ui-checkbox-box')!
    expect(box.getAttribute('role')).toBe('checkbox')
    expect(box.getAttribute('aria-checked')).toBe('false')
  })

  it('toggles the bound data path on click and updates ARIA', () => {
    const box = container.querySelector<HTMLElement>('.a2ui-checkbox-box')!
    box.click()
    expect(data().agree).toBe(true)
    expect(box.getAttribute('aria-checked')).toBe('true')
    box.click()
    expect(data().agree).toBe(false)
  })
})

describe('Slider (via @llui/components)', () => {
  it('binds a number path with ARIA and drives value via keyboard', () => {
    mount(
      [{ id: 'root', component: 'Slider', label: 'Vol', min: 0, max: 10, value: { path: '/vol' } }],
      { vol: 3 },
    )
    const thumb = container.querySelector<HTMLElement>('.a2ui-slider-thumb')!
    expect(thumb.getAttribute('role')).toBe('slider')
    expect(thumb.getAttribute('aria-valuenow')).toBe('3')
    expect(thumb.getAttribute('aria-valuemin')).toBe('0')
    expect(thumb.getAttribute('aria-valuemax')).toBe('10')

    thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(data().vol).toBe(4)
    expect(container.querySelector('.a2ui-slider-thumb')?.getAttribute('aria-valuenow')).toBe('4')
  })
})

describe('ChoicePicker (via @llui/components combobox)', () => {
  const options = [
    { label: 'Small', value: 's' },
    { label: 'Large', value: 'l' },
    { label: 'Medium', value: 'm' },
  ]
  const itemTexts = () => [...container.querySelectorAll('.a2ui-cb-item')].map((i) => i.textContent)

  it('opens, filters by label, and writes the value on select', () => {
    mount(
      [
        {
          id: 'root',
          component: 'ChoicePicker',
          label: 'Size',
          variant: 'mutuallyExclusive',
          options,
          value: { path: '/size' },
        },
      ],
      { size: ['s'] },
    )
    expect(container.querySelector('.a2ui-cb-input')).not.toBeNull()
    container.querySelector<HTMLButtonElement>('.a2ui-cb-trigger')!.click() // open
    expect(itemTexts()).toEqual(['Small', 'Large', 'Medium'])

    // Typeahead filters on the visible label, not the value.
    const input = container.querySelector<HTMLInputElement>('.a2ui-cb-input')!
    input.value = 'La'
    input.dispatchEvent(new Event('input'))
    expect(itemTexts()).toEqual(['Large'])

    container.querySelector<HTMLElement>('.a2ui-cb-item')!.click()
    expect(data().size).toEqual(['l'])
  })

  it('keeps duplicate labels as distinct rows and selects the right value (fix 6)', () => {
    mount(
      [
        {
          id: 'root',
          component: 'ChoicePicker',
          label: 'Pick',
          variant: 'mutuallyExclusive',
          options: [
            { label: 'Dup', value: 'a' },
            { label: 'Dup', value: 'b' },
            { label: 'Other', value: 'c' },
          ],
          value: { path: '/choice' },
        },
      ],
      { choice: [] },
    )
    container.querySelector<HTMLButtonElement>('.a2ui-cb-trigger')!.click() // open
    const rows = [...container.querySelectorAll<HTMLElement>('.a2ui-cb-item')]
    // Both 'Dup' rows survive (not collapsed to one) alongside 'Other'.
    expect(rows.map((r) => r.textContent)).toEqual(['Dup', 'Dup', 'Other'])
    expect(rows.map((r) => r.getAttribute('data-value'))).toEqual(['a', 'b', 'c'])

    // Selecting the SECOND 'Dup' writes its own value 'b', not the first's.
    rows[1]!.click()
    expect(data().choice).toEqual(['b'])
  })

  it('multi-select shows chips and toggles values', () => {
    mount(
      [
        {
          id: 'root',
          component: 'ChoicePicker',
          label: 'Sizes',
          variant: 'multipleSelection',
          options,
          value: { path: '/picked' },
        },
      ],
      { picked: ['s'] },
    )
    expect([...container.querySelectorAll('.a2ui-cb-chip')].map((c) => c.textContent)).toEqual([
      'Small✕',
    ])
    container.querySelector<HTMLButtonElement>('.a2ui-cb-trigger')!.click()
    const large = [...container.querySelectorAll<HTMLElement>('.a2ui-cb-item')].find(
      (i) => i.textContent === 'Large',
    )!
    large.click()
    expect(data().picked).toEqual(['s', 'l'])
  })
})

describe('Tabs (via @llui/components)', () => {
  it('switches the active panel on tab click', () => {
    mount(
      [
        {
          id: 'root',
          component: 'Tabs',
          tabs: [
            { title: 'One', child: 'p1' },
            { title: 'Two', child: 'p2' },
          ],
        },
        { id: 'p1', component: 'Text', text: 'Panel one' },
        { id: 'p2', component: 'Text', text: 'Panel two' },
      ],
      {},
    )
    const tablist = container.querySelector('.a2ui-tabs-list')!
    expect(tablist.getAttribute('role')).toBe('tablist')
    const triggers = container.querySelectorAll<HTMLButtonElement>('.a2ui-tab')
    const panels = container.querySelectorAll<HTMLElement>('.a2ui-tab-panel')
    expect(triggers[0]?.getAttribute('data-state')).toBe('active')
    expect(panels[0]?.hasAttribute('hidden')).toBe(false)
    expect(panels[1]?.hasAttribute('hidden')).toBe(true)

    triggers[1]!.click()
    expect(triggers[1]?.getAttribute('data-state')).toBe('active')
    expect(triggers[0]?.getAttribute('data-state')).toBe('inactive')
    expect(panels[0]?.hasAttribute('hidden')).toBe(true)
    expect(panels[1]?.hasAttribute('hidden')).toBe(false)
  })
})

describe('Modal (via @llui/components)', () => {
  it('opens and closes the dialog, mounting content only when open', () => {
    mount(
      [
        { id: 'root', component: 'Modal', trigger: 't', content: 'c' },
        { id: 't', component: 'Text', text: 'Open' },
        { id: 'c', component: 'Text', text: 'Dialog body' },
      ],
      {},
    )
    const bodyPresent = () =>
      [...container.querySelectorAll('.a2ui-text')].some((n) => n.textContent === 'Dialog body')
    expect(bodyPresent()).toBe(false)

    container.querySelector<HTMLElement>('.a2ui-modal-trigger')!.click()
    expect(bodyPresent()).toBe(true)
    const content = container.querySelector('.a2ui-modal-content')!
    expect(content.getAttribute('role')).toBe('dialog')
    // Body scroll is locked while open (focus-trap + scroll-lock reused from
    // @llui/components).
    expect(document.body.style.overflow).toBe('hidden')

    container.querySelector<HTMLElement>('.a2ui-modal-close')!.click()
    expect(bodyPresent()).toBe(false)
    expect(document.body.style.overflow).toBe('') // released on close
  })
})
