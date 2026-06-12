import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  registerNestedLayer,
  getNestedLayers,
  isInNestedLayer,
  _nestedLayerCount,
} from '../../src/utils/nested-layer'
import { watchInteractOutside } from '../../src/utils/interact-outside'
import { pushDismissable } from '../../src/utils/dismissable'
import { setAriaHiddenOutside } from '../../src/utils/aria-hidden'
import { pushFocusTrap } from '../../src/utils/focus-trap'

describe('nested-layer registry', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    expect(_nestedLayerCount()).toBe(0) // every test must clean up its registrations
  })

  it('registers and resolves an element, cleanup removes it', () => {
    const el = document.createElement('div')
    document.body.append(el)
    const cleanup = registerNestedLayer(el)
    expect(getNestedLayers()).toEqual([el])
    expect(isInNestedLayer(el)).toBe(true)
    cleanup()
    expect(getNestedLayers()).toEqual([])
    expect(isInNestedLayer(el)).toBe(false)
  })

  it('resolver form is re-read live (tracks an overlay opening/closing)', () => {
    let open = false
    const el = document.createElement('div')
    document.body.append(el)
    const cleanup = registerNestedLayer(() => (open ? [el] : []))
    expect(getNestedLayers()).toEqual([]) // closed
    open = true
    expect(getNestedLayers()).toEqual([el]) // opened, no re-registration
    cleanup()
  })

  it('isInNestedLayer matches descendants, not just the root', () => {
    const root = document.createElement('div')
    const child = document.createElement('button')
    root.append(child)
    document.body.append(root)
    const cleanup = registerNestedLayer(root)
    expect(isInNestedLayer(child)).toBe(true)
    cleanup()
  })
})

describe('nested layer ↔ interact-outside / dismissable', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    expect(_nestedLayerCount()).toBe(0)
  })

  it('does NOT fire onInteractOutside for a registered sibling portal', () => {
    const content = document.createElement('div')
    const toolbar = document.createElement('div') // body-level sibling portal
    const boldBtn = document.createElement('button')
    toolbar.append(boldBtn)
    document.body.append(content, toolbar)

    const onInteractOutside = vi.fn()
    const stopWatch = watchInteractOutside({ element: content, onInteractOutside })
    const unregister = registerNestedLayer(toolbar)

    boldBtn.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(onInteractOutside).not.toHaveBeenCalled()

    // Once unregistered, the same click is "outside" again.
    unregister()
    boldBtn.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(onInteractOutside).toHaveBeenCalledTimes(1)
    stopWatch()
  })

  it('the dialog (pushDismissable) is not dismissed by a registered toolbar click', () => {
    const content = document.createElement('div')
    content.id = 'dlg:content'
    const trigger = document.createElement('button')
    const toolbar = document.createElement('div')
    const boldBtn = document.createElement('button')
    toolbar.append(boldBtn)
    document.body.append(content, trigger, toolbar)

    const onDismiss = vi.fn()
    const cleanup = pushDismissable({
      element: content,
      ignore: () => [trigger],
      onDismiss,
    })
    const unregister = registerNestedLayer(toolbar)

    boldBtn.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(onDismiss).not.toHaveBeenCalled()

    unregister()
    cleanup()
  })
})

describe('nested layer ↔ aria-hidden', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    expect(_nestedLayerCount()).toBe(0)
  })

  it('does not inert a sibling that contains a registered nested layer', () => {
    const positioner = document.createElement('div')
    const content = document.createElement('div')
    positioner.append(content)
    const toolbar = document.createElement('div') // body sibling, present at walk
    const plain = document.createElement('div')
    document.body.append(positioner, toolbar, plain)

    const unregister = registerNestedLayer(toolbar)
    const cleanup = setAriaHiddenOutside(content)

    expect(toolbar.hasAttribute('inert')).toBe(false)
    expect(toolbar.getAttribute('aria-hidden')).toBe(null)
    // a non-registered sibling is still inert
    expect(plain.hasAttribute('inert')).toBe(true)

    cleanup()
    unregister()
  })
})

describe('nested layer ↔ focus-trap', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    expect(_nestedLayerCount()).toBe(0)
  })

  it('Tab cycles into a registered nested layer outside the trap container', () => {
    const content = document.createElement('div')
    const inTrap = document.createElement('button')
    content.append(inTrap)
    const toolbar = document.createElement('div')
    const toolbarBtn = document.createElement('button')
    toolbar.append(toolbarBtn)
    document.body.append(content, toolbar)

    const unregister = registerNestedLayer(toolbar)
    const release = pushFocusTrap({ container: content, restoreFocus: false })

    // Focus the last focusable of the base container; Tab should wrap to the
    // first focusable across [content, toolbar] — i.e. stay reachable, not escape.
    toolbarBtn.focus()
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(ev)
    // toolbarBtn is the last focusable across both containers → Tab wraps to first
    expect(document.activeElement).toBe(inTrap)
    expect(ev.defaultPrevented).toBe(true)

    release()
    unregister()
  })
})
