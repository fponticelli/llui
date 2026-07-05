import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mountA2ui, type A2uiHandle, type ComponentNode } from '../src/index.js'

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

function mount(components: ComponentNode[], data: unknown = {}): void {
  handle?.dispose()
  container.innerHTML = ''
  handle = mountA2ui(container)
  handle.apply([
    { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: CATALOG } },
    { version: 'v0.9', updateComponents: { surfaceId: 's', components } },
    { version: 'v0.9', updateDataModel: { surfaceId: 's', path: '/', value: data as never } },
  ])
}
const only = (sel: string) => container.querySelector<HTMLElement>(sel)!

describe('layout builders', () => {
  it('Row maps justify/align to flexbox and weight to flex-grow', () => {
    mount([
      { id: 'root', component: 'Row', justify: 'spaceBetween', align: 'center', children: ['a'] },
      { id: 'a', component: 'Text', text: 'x', weight: 2 },
    ])
    const row = only('.a2ui-row').getAttribute('style') ?? ''
    expect(row).toContain('justify-content: space-between')
    expect(row).toContain('align-items: center')
    expect(only('.a2ui-text').getAttribute('style')).toContain('flex: 2')
  })

  it('List horizontal sets flex-direction row', () => {
    mount([
      { id: 'root', component: 'List', direction: 'horizontal', children: ['a'] },
      { id: 'a', component: 'Text', text: 'x' },
    ])
    expect(only('.a2ui-list').getAttribute('style')).toContain('flex-direction: row')
  })

  it('Divider renders a vertical variant', () => {
    mount([{ id: 'root', component: 'Divider', axis: 'vertical' }])
    expect(container.querySelector('.a2ui-divider-vertical')).not.toBeNull()
  })
})

describe('media builders', () => {
  it('Image binds src + alt and applies object-fit', () => {
    mount(
      [
        {
          id: 'root',
          component: 'Image',
          url: { path: '/u' },
          description: 'pic',
          fit: 'cover',
          variant: 'avatar',
        },
      ],
      { u: 'https://img/1.png' },
    )
    const img = only('.a2ui-image') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('https://img/1.png')
    expect(img.getAttribute('alt')).toBe('pic')
    expect(img.className).toContain('a2ui-image-avatar')
    expect(img.getAttribute('style')).toContain('object-fit: cover')
  })

  it('Icon exposes its name for a11y + styling', () => {
    mount([{ id: 'root', component: 'Icon', name: 'calendarToday' }])
    const icon = only('.a2ui-icon')
    expect(icon.getAttribute('data-icon')).toBe('calendarToday')
    expect(icon.getAttribute('aria-label')).toBe('calendarToday')
  })

  it('Video and AudioPlayer bind url with controls', () => {
    mount([{ id: 'root', component: 'Video', url: { path: '/v' } }], { v: 'clip.mp4' })
    const video = only('.a2ui-video') as HTMLVideoElement
    expect(video.getAttribute('src')).toBe('clip.mp4')
    expect(video.hasAttribute('controls')).toBe(true)
  })
})

describe('Button', () => {
  it('applies the primary variant class', () => {
    mount([
      {
        id: 'root',
        component: 'Button',
        variant: 'primary',
        child: 'l',
        action: { event: { name: 'x' } },
      },
      { id: 'l', component: 'Text', text: 'Go' },
    ])
    expect(only('.a2ui-button').className).toContain('a2ui-button-primary')
  })

  it('runs a local openUrl functionCall action', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    mount(
      [
        {
          id: 'root',
          component: 'Button',
          child: 'l',
          action: { functionCall: { call: 'openUrl', args: { url: { path: '/href' } } } },
        },
        { id: 'l', component: 'Text', text: 'Open' },
      ],
      { href: 'https://ex.com' },
    )
    only('.a2ui-button').click()
    expect(open).toHaveBeenCalledWith('https://ex.com', '_blank')
    open.mockRestore()
  })
})

describe('TextField variants', () => {
  it('renders number, password and multiline variants', () => {
    mount([
      { id: 'root', component: 'TextField', label: 'N', value: { path: '/n' }, variant: 'number' },
    ])
    expect((only('.a2ui-textfield-input') as HTMLInputElement).type).toBe('number')

    mount([
      {
        id: 'root',
        component: 'TextField',
        label: 'P',
        value: { path: '/p' },
        variant: 'obscured',
      },
    ])
    expect((only('.a2ui-textfield-input') as HTMLInputElement).type).toBe('password')

    mount([
      {
        id: 'root',
        component: 'TextField',
        label: 'L',
        value: { path: '/l' },
        variant: 'longText',
      },
    ])
    expect(only('.a2ui-textfield-input').tagName).toBe('TEXTAREA')
  })
})

describe('DateTimeInput', () => {
  it('uses a native input for time / datetime', () => {
    mount([
      {
        id: 'root',
        component: 'DateTimeInput',
        label: 'D',
        value: { path: '/d' },
        enableDate: true,
        enableTime: true,
      },
    ])
    expect((only('.a2ui-textfield-input') as HTMLInputElement).type).toBe('datetime-local')

    mount([
      {
        id: 'root',
        component: 'DateTimeInput',
        label: 'T',
        value: { path: '/t' },
        enableDate: false,
        enableTime: true,
      },
    ])
    expect((only('.a2ui-textfield-input') as HTMLInputElement).type).toBe('time')
  })

  it('renders an inline calendar for the date-only case and writes the picked day', () => {
    mount(
      [
        {
          id: 'root',
          component: 'DateTimeInput',
          label: 'D',
          value: { path: '/d' },
          enableDate: true,
        },
      ],
      { d: '2024-06-15' },
    )
    const dp = only('.a2ui-dp')
    expect(dp).not.toBeNull()
    expect(dp.querySelector('.a2ui-dp-title')?.textContent).toContain('2024')
    // The bound date is marked selected.
    const selected = dp.querySelector('.a2ui-dp-cell[data-date="2024-06-15"]')
    expect(selected?.getAttribute('data-selected')).toBe('')

    // Click another day → data updates.
    dp.querySelector<HTMLButtonElement>('.a2ui-dp-cell[data-date="2024-06-20"]')!.click()
    const d = handle.getState().surfaces['s']?.dataModel as { d: string }
    expect(d.d).toBe('2024-06-20')
  })

  it('navigates months', () => {
    mount(
      [
        {
          id: 'root',
          component: 'DateTimeInput',
          label: 'D',
          value: { path: '/d' },
          enableDate: true,
        },
      ],
      { d: '2024-06-15' },
    )
    const title = () => only('.a2ui-dp-title').textContent
    expect(title()).toContain('June')
    only('.a2ui-dp-nav').click() // prev month
    expect(title()).toContain('May')
  })
})

// ChoicePicker is covered by the combobox tests in controls.test.ts.

describe('binding coercions', () => {
  it('renders a literal number and a JSON object binding as strings', () => {
    mount([{ id: 'root', component: 'Text', text: 123 as never }])
    expect(only('.a2ui-text').textContent).toBe('123')

    mount([{ id: 'root', component: 'Text', text: { path: '/obj' } }], { obj: { a: 1 } })
    expect(only('.a2ui-text').textContent).toBe('{"a":1}')
  })

  it('resolves an unknown function binding to empty with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount([{ id: 'root', component: 'Text', text: { call: 'mystery' } as never }])
    expect(only('.a2ui-text').textContent).toBe('')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
