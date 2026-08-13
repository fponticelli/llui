import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { component, mountApp, button, div, text } from '@llui/dom'
import * as dialog from '../../src/components/dialog'
import * as popover from '../../src/components/popover'
import * as select from '../../src/components/select'
import * as tooltip from '../../src/components/tooltip'
import { _nestedLayerCount } from '../../src/utils/nested-layer'
import { _dismissableStackSize } from '../../src/utils/dismissable'

/**
 * #123 — "every body-portaling overlay calls registerNestedLayer".
 *
 * A non-modal overlay opened from INSIDE an open dialog portals to a body-level
 * sibling the dialog's focus trap cannot Tab to. These tests pin the two halves
 * that must hold TOGETHER: the nested overlay becomes Tab-reachable, and the
 * dialog+select outside-click cooperation the dismissable stack already gives is
 * NOT broken by the registration.
 */

type Ctx = {
  dlg: dialog.DialogState
  pop: popover.PopoverState
  sel: select.SelectState
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('non-modal overlays register as nested layers of an open dialog', () => {
  let currentApp: ReturnType<typeof mountApp> | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    if (currentApp) {
      currentApp.dispose()
      currentApp = null
    }
    document.body.innerHTML = ''
    document.body.style.overflow = ''
    document.body.style.paddingRight = ''
    // Every registration/layer must unwind with the app.
    expect(_nestedLayerCount()).toBe(0)
    expect(_dismissableStackSize()).toBe(0)
  })

  type Msg =
    | { type: 'dlg'; msg: dialog.DialogMsg }
    | { type: 'pop'; msg: popover.PopoverMsg }
    | { type: 'sel'; msg: select.SelectMsg }

  function makeApp(open: { dialog?: boolean; popover?: boolean; select?: boolean }): {
    send: (m: Msg) => void
  } {
    let sendRef!: (m: Msg) => void
    const selInit = select.init({ items: ['a', 'b'] })
    if (open.select) selInit.open = true
    const def = component<Ctx, Msg, never>({
      name: 'NestedOverlays',
      init: () => [
        {
          dlg: dialog.init({ open: open.dialog === true }),
          pop: popover.init({ open: open.popover === true }),
          sel: selInit,
        },
        [],
      ],
      update: (state, msg) => {
        if (msg.type === 'dlg') return [{ ...state, dlg: dialog.update(state.dlg, msg.msg)[0] }, []]
        if (msg.type === 'pop')
          return [{ ...state, pop: popover.update(state.pop, msg.msg)[0] }, []]
        return [{ ...state, sel: select.update(state.sel, msg.msg)[0] }, []]
      },
      view: ({ state, send }) => {
        sendRef = send
        const dlgSend = (m: dialog.DialogMsg): void => send({ type: 'dlg', msg: m })
        const popSend = (m: popover.PopoverMsg): void => send({ type: 'pop', msg: m })
        const selSend = (m: select.SelectMsg): void => send({ type: 'sel', msg: m })
        const dlgParts = dialog.connect(state.at('dlg'), dlgSend, { id: 'dlg' })
        const popParts = popover.connect(state.at('pop'), popSend, { id: 'pop' })
        const selParts = select.connect(state.at('sel'), selSend, { id: 'sel' })
        return [
          button({ ...dlgParts.trigger }, [text('Open dialog')]),
          dialog.overlay({
            state: state.at('dlg'),
            send: dlgSend,
            parts: dlgParts,
            content: () => [
              div({ ...dlgParts.content }, [
                // The dialog's ONLY focusable — so a Shift+Tab off it must leave
                // the base container to reach anything else.
                button({ ...popParts.trigger }, [text('Open popover')]),
                popover.overlay({
                  state: state.at('pop'),
                  send: popSend,
                  parts: popParts,
                  content: () => [
                    div({ ...popParts.content }, [
                      button({ id: 'pop-action' }, [text('Popover action')]),
                    ]),
                  ],
                }),
                select.overlay({
                  state: state.at('sel'),
                  send: selSend,
                  parts: selParts,
                  content: () => [div({ ...selParts.content }, [])],
                }),
              ]),
            ],
          }),
          // The select trigger lives inside the dialog content in a real app; it
          // is rendered here so `requireAnchor` resolves.
          button({ ...selParts.trigger }, [text('Select')]),
        ]
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    currentApp = mountApp(container, def)
    return { send: (m) => sendRef(m) }
  }

  it('Shift+Tab out of an open dialog reaches a popover portaled from inside it', async () => {
    makeApp({ dialog: true, popover: true })
    await tick()

    const popTrigger = document.getElementById('pop:trigger') as HTMLElement
    const popAction = document.getElementById('pop-action') as HTMLElement
    expect(popTrigger).not.toBeNull()
    expect(popAction).not.toBeNull()
    // Non-vacuous: the popover content really is a body-level SIBLING of the
    // dialog content, not a descendant of the trap container.
    const dlgContent = document.getElementById('dlg:content') as HTMLElement
    expect(dlgContent.contains(popAction)).toBe(false)
    // Exactly ONE registration: the popover. The dialog is the modal everything
    // else nests inside and must never register itself (that is the case that
    // breaks the inner select's outside-click, pinned by the next test).
    expect(_nestedLayerCount()).toBe(1)

    popTrigger.focus()
    const ev = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    document.dispatchEvent(ev)

    expect(document.activeElement).toBe(popAction)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('clicking the dialog background still dismisses a select open inside it', async () => {
    const { send } = makeApp({ dialog: true, select: true })
    await tick()

    const dlgContent = document.getElementById('dlg:content') as HTMLElement
    expect(document.getElementById('sel:content')).not.toBeNull()

    dlgContent.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await tick()

    // The select dismissed …
    expect(document.getElementById('sel:content')).toBeNull()
    // … and the dialog beneath it did NOT (the stack gates outside-clicks to the
    // topmost layer).
    expect(document.getElementById('dlg:content')).not.toBeNull()

    send({ type: 'dlg', msg: { type: 'close' } })
    await tick()
  })

  it('a click inside the popover does not dismiss the dialog beneath it', async () => {
    const { send } = makeApp({ dialog: true, popover: true })
    await tick()

    const popAction = document.getElementById('pop-action') as HTMLElement
    popAction.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await tick()

    expect(document.getElementById('dlg:content')).not.toBeNull()

    send({ type: 'pop', msg: { type: 'close' } })
    send({ type: 'dlg', msg: { type: 'close' } })
    await tick()
  })
})

describe('an overlay that pushes NO dismissable layer is still covered', () => {
  let currentApp: ReturnType<typeof mountApp> | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    if (currentApp) {
      currentApp.dispose()
      currentApp = null
    }
    document.body.innerHTML = ''
    document.body.style.overflow = ''
    document.body.style.paddingRight = ''
    expect(_nestedLayerCount()).toBe(0)
    expect(_dismissableStackSize()).toBe(0)
  })

  type TipCtx = { dlg: dialog.DialogState; tip: tooltip.TooltipState }
  type TipMsg = { type: 'dlg'; msg: dialog.DialogMsg } | { type: 'tip'; msg: tooltip.TooltipMsg }

  function makeApp(): { send: (m: TipMsg) => void } {
    let sendRef!: (m: TipMsg) => void
    const def = component<TipCtx, TipMsg, never>({
      name: 'TooltipInDialog',
      init: () => [{ dlg: dialog.init({ open: true }), tip: tooltip.init({ open: true }) }, []],
      update: (state, msg) => {
        if (msg.type === 'dlg') return [{ ...state, dlg: dialog.update(state.dlg, msg.msg)[0] }, []]
        return [{ ...state, tip: tooltip.update(state.tip, msg.msg)[0] }, []]
      },
      view: ({ state, send }) => {
        sendRef = send
        const dlgSend = (m: dialog.DialogMsg): void => send({ type: 'dlg', msg: m })
        const tipSend = (m: tooltip.TooltipMsg): void => send({ type: 'tip', msg: m })
        const dlgParts = dialog.connect(state.at('dlg'), dlgSend, { id: 'dlg' })
        const tipParts = tooltip.connect(state.at('tip'), tipSend, { id: 'tip' })
        return [
          button({ ...dlgParts.trigger }, [text('Open dialog')]),
          dialog.overlay({
            state: state.at('dlg'),
            send: dlgSend,
            parts: dlgParts,
            content: () => [
              div({ ...dlgParts.content }, [
                button({ ...tipParts.trigger }, [text('Hover me')]),
                tooltip.overlay({
                  state: state.at('tip'),
                  send: tipSend,
                  parts: tipParts,
                  // `closeOnEscape: false` is the config under which tooltip
                  // pushes NO dismissable layer at all (#123 census hole).
                  closeOnEscape: false,
                  content: () => [div({ ...tipParts.content }, [text('tip')])],
                }),
              ]),
            ],
          }),
        ]
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    currentApp = mountApp(container, def)
    return { send: (m) => sendRef(m) }
  }

  type StackedCtx = { outer: dialog.DialogState; inner: dialog.DialogState }
  type StackedMsg =
    | { type: 'outer'; msg: dialog.DialogMsg }
    | { type: 'inner'; msg: dialog.DialogMsg }

  function makeStackedApp(): { send: (m: StackedMsg) => void } {
    let sendRef!: (m: StackedMsg) => void
    const def = component<StackedCtx, StackedMsg, never>({
      name: 'StackedDialogs',
      init: () => [{ outer: dialog.init({ open: true }), inner: dialog.init({ open: true }) }, []],
      update: (state, msg) =>
        msg.type === 'outer'
          ? [{ ...state, outer: dialog.update(state.outer, msg.msg)[0] }, []]
          : [{ ...state, inner: dialog.update(state.inner, msg.msg)[0] }, []],
      view: ({ state, send }) => {
        sendRef = send
        const outerSend = (m: dialog.DialogMsg): void => send({ type: 'outer', msg: m })
        const innerSend = (m: dialog.DialogMsg): void => send({ type: 'inner', msg: m })
        const outerParts = dialog.connect(state.at('outer'), outerSend, { id: 'outer' })
        const innerParts = dialog.connect(state.at('inner'), innerSend, { id: 'inner' })
        return [
          dialog.overlay({
            state: state.at('outer'),
            send: outerSend,
            parts: outerParts,
            content: () => [
              div({ ...outerParts.content }, [
                button({ ...innerParts.trigger }, [text('Open inner')]),
                dialog.overlay({
                  state: state.at('inner'),
                  send: innerSend,
                  parts: innerParts,
                  // The config under which the engine used to push NO layer.
                  closeOnEscape: false,
                  closeOnOutsideClick: false,
                  content: () => [div({ ...innerParts.content }, [text('inner')])],
                }),
              ]),
            ],
          }),
        ]
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    currentApp = mountApp(container, def)
    return { send: (m) => sendRef(m) }
  }

  it('an undismissable MODAL still occupies the stack, so clicks in it spare the layer beneath', async () => {
    const { send } = makeStackedApp()
    await tick()

    const innerContent = document.getElementById('inner:content') as HTMLElement
    expect(innerContent).not.toBeNull()
    // Non-vacuous: both dialogs really are on the stack (the inner one used to
    // push nothing at all, leaving the outer dialog's watcher topmost).
    expect(_dismissableStackSize()).toBe(2)

    innerContent.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await tick()

    expect(document.getElementById('outer:content')).not.toBeNull()
    expect(document.getElementById('inner:content')).not.toBeNull()

    send({ type: 'inner', msg: { type: 'close' } })
    send({ type: 'outer', msg: { type: 'close' } })
    await tick()
  })

  it('a pointerdown inside a layerless tooltip does not dismiss the dialog', async () => {
    const { send } = makeApp()
    await tick()

    const tipContent = document.getElementById('tip:content') as HTMLElement
    expect(tipContent).not.toBeNull()
    // Non-vacuous: the tooltip really pushes no dismissable layer — only the
    // dialog's is on the stack.
    expect(_dismissableStackSize()).toBe(1)

    tipContent.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await tick()

    expect(document.getElementById('dlg:content')).not.toBeNull()

    send({ type: 'dlg', msg: { type: 'close' } })
    await tick()
  })
})
