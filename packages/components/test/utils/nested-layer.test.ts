import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  registerNestedLayer,
  getNestedLayers,
  isInNestedLayer,
  _nestedLayerCount,
  ALL_NESTED_LAYER_ASPECTS,
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

  it('a registration with no aspects participates in all three', () => {
    const el = document.createElement('div')
    document.body.append(el)
    const cleanup = registerNestedLayer(el)
    for (const aspect of ALL_NESTED_LAYER_ASPECTS) {
      expect(getNestedLayers(aspect)).toEqual([el])
      expect(isInNestedLayer(el, aspect)).toBe(true)
    }
    cleanup()
  })

  it('a narrowed registration is invisible to the aspects it did not name', () => {
    const el = document.createElement('div')
    document.body.append(el)
    const cleanup = registerNestedLayer(el, { aspects: ['focus', 'hide'] })
    expect(getNestedLayers('focus')).toEqual([el])
    expect(getNestedLayers('hide')).toEqual([el])
    expect(getNestedLayers('outside')).toEqual([])
    expect(isInNestedLayer(el, 'outside')).toBe(false)
    // Aspect-less lookups still see it (the registry-wide view).
    expect(getNestedLayers()).toEqual([el])
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

/**
 * #171 — the registry is PER-LAYER: a lookup asks "is this nested inside ME?"
 *
 * It used to be flat, which is the right answer for a layer opened from inside
 * the asker and the wrong answer for an unrelated sibling. The consequence was
 * an a11y defect: a modal `dialog` opened over an already-open `popover` left
 * that popover un-hidden, un-inerted and Tab-reachable from inside the modal.
 *
 * The discriminator is the OWNER — the element the layer is logically nested
 * inside (normally its trigger). The DOM answers the question directly: a nested
 * layer's trigger really is rendered inside the layer it belongs to, even though
 * its portal is a body-level sibling.
 */
describe('nested layer scoping (per-layer registry, #171)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    expect(_nestedLayerCount()).toBe(0)
  })

  /** dialogContent > innerTrigger; portal is a body-level sibling. */
  function scene(): {
    dialogContent: HTMLElement
    innerTrigger: HTMLElement
    siblingTrigger: HTMLElement
    portal: HTMLElement
  } {
    const dialogContent = document.createElement('div')
    const innerTrigger = document.createElement('button')
    dialogContent.append(innerTrigger)
    const siblingTrigger = document.createElement('button')
    const portal = document.createElement('div')
    document.body.append(dialogContent, siblingTrigger, portal)
    return { dialogContent, innerTrigger, siblingTrigger, portal }
  }

  it('a layer whose owner is inside the asker is nested in it', () => {
    const { dialogContent, innerTrigger, portal } = scene()
    const cleanup = registerNestedLayer(portal, { owner: innerTrigger })
    expect(getNestedLayers('focus', dialogContent)).toEqual([portal])
    expect(isInNestedLayer(portal, 'focus', dialogContent)).toBe(true)
    cleanup()
  })

  it('a SIBLING layer — owner outside the asker — is not nested in it', () => {
    const { dialogContent, siblingTrigger, portal } = scene()
    const cleanup = registerNestedLayer(portal, { owner: siblingTrigger })
    // This is the #171 case: flat lookups answered `[portal]` here, which is
    // what exempted an unrelated popover from a modal's sweep and trap.
    expect(getNestedLayers('focus', dialogContent)).toEqual([])
    expect(isInNestedLayer(portal, 'focus', dialogContent)).toBe(false)
    // …and it is still visible to a lookup that does not scope itself, and to
    // the layer it really does belong to.
    expect(getNestedLayers('focus')).toEqual([portal])
    expect(getNestedLayers('focus', siblingTrigger)).toEqual([portal])
    cleanup()
  })

  it('nesting is TRANSITIVE through another nested layer', () => {
    const { dialogContent, innerTrigger, portal } = scene()
    // A tooltip opened from a control inside the select's own portal.
    const deepTrigger = document.createElement('button')
    portal.append(deepTrigger)
    const deepPortal = document.createElement('div')
    document.body.append(deepPortal)

    const outerReg = registerNestedLayer(portal, { owner: innerTrigger })
    const deepReg = registerNestedLayer(deepPortal, { owner: deepTrigger })

    const nested = getNestedLayers('focus', dialogContent)
    expect(nested).toContain(portal)
    expect(nested).toContain(deepPortal)

    // Non-vacuous: it is the intermediate layer that carries it. Drop that one
    // and the deep layer is no longer reachable from the dialog.
    outerReg()
    expect(getNestedLayers('focus', dialogContent)).toEqual([])

    deepReg()
  })

  it('resolves transitively regardless of REGISTRATION ORDER', () => {
    const { dialogContent, innerTrigger, portal } = scene()
    const deepTrigger = document.createElement('button')
    portal.append(deepTrigger)
    const deepPortal = document.createElement('div')
    document.body.append(deepPortal)

    // Inner-most registered FIRST — the fixpoint has to make a second pass.
    const deepReg = registerNestedLayer(deepPortal, { owner: deepTrigger })
    const outerReg = registerNestedLayer(portal, { owner: innerTrigger })

    const nested = getNestedLayers('focus', dialogContent)
    expect(nested).toContain(portal)
    expect(nested).toContain(deepPortal)

    outerReg()
    deepReg()
  })

  it('an UNOWNED registration keeps the flat answer (documented fallback)', () => {
    const { dialogContent, portal } = scene()
    const cleanup = registerNestedLayer(portal)
    // No owner → not attributable to any layer → exempt from whoever asks.
    expect(getNestedLayers('focus', dialogContent)).toEqual([portal])
    cleanup()
  })

  it('an owner that no longer resolves is not nested anywhere', () => {
    const { dialogContent, portal } = scene()
    let live = true
    const owner = document.createElement('button')
    dialogContent.append(owner)
    const cleanup = registerNestedLayer(portal, { owner: () => (live ? owner : null) })
    expect(getNestedLayers('focus', dialogContent)).toEqual([portal])
    live = false
    expect(getNestedLayers('focus', dialogContent)).toEqual([])
    cleanup()
  })

  it('scoping composes with the aspect filter rather than replacing it', () => {
    const { dialogContent, innerTrigger, portal } = scene()
    const cleanup = registerNestedLayer(portal, { owner: innerTrigger, aspects: ['focus'] })
    expect(getNestedLayers('focus', dialogContent)).toEqual([portal])
    expect(getNestedLayers('hide', dialogContent)).toEqual([])
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

  it('DOES fire for a registered layer owned by something outside the watched region (#171)', () => {
    const content = document.createElement('div')
    const elsewhere = document.createElement('button') // owner, outside `content`
    const toolbar = document.createElement('div')
    const boldBtn = document.createElement('button')
    toolbar.append(boldBtn)
    document.body.append(content, elsewhere, toolbar)

    const onInteractOutside = vi.fn()
    const stopWatch = watchInteractOutside({ element: content, onInteractOutside })
    // Registered for `outside` — but owned by a layer this watcher has nothing
    // to do with. A flat lookup made it invisible to EVERY watcher on the page.
    const unregister = registerNestedLayer(toolbar, { owner: elsewhere })

    // BOTH paths, because they consult the registry at two separate call sites
    // and a scope dropped from one of them is invisible to a test that only
    // exercises the other.
    boldBtn.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(onInteractOutside).toHaveBeenCalledTimes(1)
    boldBtn.focus() // focusin
    expect(onInteractOutside).toHaveBeenCalledTimes(2)

    // Non-vacuous: the very same registration IS honoured by the layer it does
    // belong to — on both paths.
    const ownerOnInteractOutside = vi.fn()
    const stopOwnerWatch = watchInteractOutside({
      element: elsewhere,
      onInteractOutside: ownerOnInteractOutside,
    })
    boldBtn.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    boldBtn.blur()
    boldBtn.focus()
    expect(ownerOnInteractOutside).not.toHaveBeenCalled()

    stopOwnerWatch()
    unregister()
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

  it('DOES inert a registered layer owned by something outside the swept target (#171)', () => {
    const positioner = document.createElement('div')
    const content = document.createElement('div')
    positioner.append(content)
    const elsewhere = document.createElement('button') // owner, outside `content`
    const toolbar = document.createElement('div')
    document.body.append(positioner, elsewhere, toolbar)

    const unregister = registerNestedLayer(toolbar, { owner: elsewhere })
    const cleanup = setAriaHiddenOutside(content)

    // The modal's whole point: a layer it does not own is hidden from AT.
    expect(toolbar.hasAttribute('inert')).toBe(true)
    expect(toolbar.getAttribute('aria-hidden')).toBe('true')

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

  it('Tab does NOT reach a registered layer owned by something outside the trap (#171)', () => {
    const content = document.createElement('div')
    const inTrap = document.createElement('button')
    const alsoInTrap = document.createElement('button')
    content.append(inTrap, alsoInTrap)
    const elsewhere = document.createElement('button') // owner, outside the trap
    const toolbar = document.createElement('div')
    const toolbarBtn = document.createElement('button')
    toolbar.append(toolbarBtn)
    document.body.append(content, elsewhere, toolbar)

    const unregister = registerNestedLayer(toolbar, { owner: elsewhere })
    const release = pushFocusTrap({ container: content, restoreFocus: false })

    // Tab off the LAST focusable of the trap must wrap back to the first, not
    // continue into a layer the trap does not own. (With the flat registry the
    // trap's container set was `[content, toolbar]` and this landed on
    // `toolbarBtn` — measured as `TRAP-CYCLE containers=2`.)
    alsoInTrap.focus()
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    document.dispatchEvent(ev)
    expect(document.activeElement).toBe(inTrap)
    expect(document.activeElement).not.toBe(toolbarBtn)
    expect(ev.defaultPrevented).toBe(true)

    release()
    unregister()
  })
})
