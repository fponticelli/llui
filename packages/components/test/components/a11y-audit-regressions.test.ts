/**
 * Machine-level regressions for the defects the #268 accessibility audit
 * found (the audit itself runs in `examples/component-gallery/test/
 * audit.browser.test.ts`; these pin each fix at its source, in the package
 * that owns it, so a regression reddens here without the gallery build).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as cascadeSelect from '../../src/components/cascade-select'
import * as dateInput from '../../src/components/date-input'
import * as dialog from '../../src/components/dialog'
import * as editable from '../../src/components/editable'
import * as field from '../../src/components/field'
import * as fileUpload from '../../src/components/file-upload'
import * as floatingPanel from '../../src/components/floating-panel'
import * as marquee from '../../src/components/marquee'
import * as splitter from '../../src/components/splitter'
import * as table from '../../src/components/table'
import * as commandMenu from '../../src/patterns/command-menu'
import { enTable } from '../../src/locale/table'
import { followActiveDescendant } from '../../src/utils/follow-active-descendant'
import { read, rootSignal } from '../_signal'

describe('named focusable grips (floating-panel)', () => {
  it('gives the drag and resize handles a role, so their names are allowed', () => {
    const parts = floatingPanel.connect(rootSignal(), vi.fn())
    expect(parts.dragHandle.role).toBe('group')
    expect(parts.dragHandle['aria-label']).not.toBe('')
    for (const handle of ['n', 'se'] as const) {
      expect(parts.resizeHandle(handle).role).toBe('group')
      expect(parts.resizeHandle(handle)['aria-label']).not.toBe('')
    }
  })
})

describe('named selection checkboxes (table)', () => {
  it('names the select-all and every row checkbox from the locale', () => {
    const parts = table.connect(rootSignal(), vi.fn(), { id: 't' })
    expect(parts.selectAllCheckbox('select')['aria-label']).toBe(enTable.selectAll)
    expect(parts.rowCheckbox('r1', 0)['aria-label']).toBe(enTable.selectRow)
    expect(enTable.selectAll).not.toBe(enTable.selectRow)
  })
})

describe('dialog descriptions that are not rendered', () => {
  it('points aria-describedby at the description by default', () => {
    const parts = dialog.connect(rootSignal(), vi.fn(), { id: 'd' })
    expect(parts.content['aria-describedby']).toBe('d:description')
    expect(parts.content['aria-labelledby']).toBe('d:title')
  })

  it('omits it when the consumer renders no description, keeping the title', () => {
    const parts = dialog.connect(rootSignal(), vi.fn(), { id: 'd', hasDescription: false })
    expect(parts.content['aria-describedby']).toBeUndefined()
    expect(parts.content['aria-labelledby']).toBe('d:title')
  })

  it('command-menu renders no description by default, and forwards an opt-in', () => {
    const plain = commandMenu.connect(rootSignal(), vi.fn(), { id: 'cmd' })
    expect(plain.dialog.content['aria-describedby']).toBeUndefined()
    const described = commandMenu.connect(rootSignal(), vi.fn(), {
      id: 'cmd',
      hasDescription: true,
    })
    expect(described.dialog.content['aria-describedby']).toBe('cmd:description')
  })
})

describe('disabled state reaches every control that ignores it', () => {
  it('disables the editable triggers with the editable', () => {
    const parts = editable.connect(rootSignal(), vi.fn())
    const off = editable.init({ disabled: true })
    const on = editable.init()
    for (const trigger of [parts.submitTrigger, parts.cancelTrigger, parts.editTrigger]) {
      expect(read(trigger.disabled, off)).toBe(true)
      expect(read(trigger.disabled, on)).toBe(false)
    }
  })

  it('disables the cascade-select clear trigger while the instance is disabled', () => {
    const levels = [{ id: 'a', label: 'A', options: [{ value: 'x', label: 'X' }] }]
    const parts = cascadeSelect.connect(rootSignal(), vi.fn(), { id: 'c' })
    const disabled = cascadeSelect.init({ levels, values: ['x'], disabled: true })
    const enabled = cascadeSelect.init({ levels, values: ['x'] })
    expect(read(parts.clearTrigger.disabled, disabled)).toBe(true)
    expect(read(parts.clearTrigger.disabled, enabled)).toBe(false)
    // …and a disabled instance really does ignore `clear`: the trigger now says so.
    expect(cascadeSelect.update(disabled, { type: 'clear' })[0].values).toEqual(['x'])
  })

  it('announces a dimmed field, file upload and marquee as disabled', () => {
    // `field.connect` peeks its id when none is passed, so pass one.
    const fieldRoot = field.connect(rootSignal(), vi.fn(), { id: 'f' }).root
    expect(read(fieldRoot['aria-disabled'], field.init({ id: 'f', disabled: true }))).toBe('true')
    expect(read(fieldRoot['aria-disabled'], field.init({ id: 'f' }))).toBeUndefined()

    const uploadRoot = fileUpload.connect(rootSignal(), vi.fn(), { id: 'u' }).root
    expect(read(uploadRoot['aria-disabled'], fileUpload.init({ disabled: true }))).toBe('true')
    expect(read(uploadRoot['aria-disabled'], fileUpload.init())).toBeUndefined()

    const marqueeRoot = marquee.connect(rootSignal(), vi.fn()).root
    expect(read(marqueeRoot['aria-disabled'], marquee.init({ disabled: true }))).toBe('true')
    expect(read(marqueeRoot['aria-disabled'], marquee.init())).toBeUndefined()
  })

  it("keeps a disabled splitter's state on its handle, never its panels' container", () => {
    const parts = splitter.connect(rootSignal(), vi.fn())
    const off = splitter.init({ disabled: true })
    expect('data-disabled' in parts.root).toBe(false)
    expect(read(parts.resizeTrigger['aria-disabled'], off)).toBe('true')
  })
})

describe('an invalid date names its own error', () => {
  it('points aria-describedby at the error text while invalid', () => {
    const parts = dateInput.connect(rootSignal(), vi.fn(), { id: 'di' })
    const [invalid] = dateInput.update(dateInput.init(), {
      type: 'setInput',
      value: '2026-13-45',
    })
    expect(invalid.error).not.toBeNull()
    expect(parts.errorText.id).toBe('di:error')
    expect(read(parts.input['aria-describedby'], invalid)).toBe('di:error')
    expect(read(parts.input['aria-describedby'], dateInput.init())).toBeUndefined()
  })

  it('associates nothing without an id (and invents none)', () => {
    const parts = dateInput.connect(rootSignal(), vi.fn())
    expect(parts.errorText.id).toBeUndefined()
  })
})

describe('followActiveDescendant', () => {
  afterEach(() => document.body.replaceChildren())

  const setup = () => {
    const owner = document.createElement('div')
    const list = document.createElement('div')
    const inside = document.createElement('div')
    inside.id = 'inside'
    const outside = document.createElement('div')
    outside.id = 'outside'
    list.append(inside)
    document.body.append(owner, list, outside)
    const scrolled: string[] = []
    for (const element of [inside, outside]) {
      element.scrollIntoView = () => scrolled.push(element.id)
    }
    return { owner, list, scrolled }
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('scrolls the item a highlight names into view, only inside its container', async () => {
    const { owner, list, scrolled } = setup()
    const stop = followActiveDescendant(list)
    owner.setAttribute('aria-activedescendant', 'inside')
    await flush()
    owner.setAttribute('aria-activedescendant', 'outside')
    await flush()
    expect(scrolled).toEqual(['inside'])
    stop()
    owner.setAttribute('aria-activedescendant', 'inside')
    await flush()
    expect(scrolled).toEqual(['inside'])
  })

  it('reveals a highlight seeded before it started', () => {
    const { owner, list, scrolled } = setup()
    owner.setAttribute('aria-activedescendant', 'inside')
    const stop = followActiveDescendant(list)
    expect(scrolled).toEqual(['inside'])
    stop()
  })
})
