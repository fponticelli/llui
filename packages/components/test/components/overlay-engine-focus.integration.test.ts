import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { component, mountApp, button, div, text } from '@llui/dom'
import * as popover from '../../src/components/popover'
import * as menu from '../../src/components/menu'
import * as dialog from '../../src/components/dialog'
import { _nestedLayerCount } from '../../src/utils/nested-layer'
import { _dismissableStackSize } from '../../src/utils/dismissable'

/**
 * #155 — an engine-initiated focus move must not be observable to other layers
 * as a user interaction.
 *
 * Dismissing an overlay restores focus to its trigger. That trigger is OUTSIDE
 * every sibling layer, so the sibling's `focusin` watcher used to read the
 * engine's own bookkeeping as an outside interaction and dismiss as well —
 * which meant a click on a control INSIDE a popover could close that popover.
 *
 * The fix suppresses only the FOCUS path, and only for one synchronous turn —
 * the whole transitive closure of the engine's `.focus()` call, consumer
 * `focusin` listeners included (`utils/engine-focus.ts` spells the window out).
 * Three focus-moving sites are covered here, one app each: the engine's own
 * teardown restore (menu),
 * `popover`'s `dismiss.extra` restore (sibling popovers), and the focus trap's
 * activate/release pair (dialog).
 *
 * The two tests at the bottom are what keep the guard from becoming a blunt mute
 * — a genuine pointerdown delivered DURING a teardown still dismisses, and a
 * genuine focus move out of a layer still dismisses it. Neither may go red for a
 * change that only makes the suppression wider.
 */

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('#155 — a dismissal’s focus restore is invisible to sibling layers', () => {
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

  // ---------------------------------------------------------------------------
  // App A — a popover with a MENU open above it, the menu's trigger outside the
  // popover. Exercises the ENGINE's restore (`overlay-engine.ts`), the site
  // `menu`/`menubar`/`context-menu` use (popover uses `dismiss.extra`).
  //
  // `menu` and not `select`: select focuses its own TRIGGER on open
  // (`focusOnOpenId: trigger.id`, `allowAnchorActive`), so its restore re-focuses
  // an already-focused element and moves nothing — no `focusin`, nothing for a
  // sibling to observe, and a test built on it would pass with the fix reverted.
  // A menu focuses its CONTENT on open, so its restore is a real move.
  // ---------------------------------------------------------------------------
  type MenuCtx = { pop: popover.PopoverState; mnu: menu.MenuState }
  type MenuMsg = { type: 'pop'; msg: popover.PopoverMsg } | { type: 'mnu'; msg: menu.MenuMsg }

  function makePopoverWithMenu(): { send: (m: MenuMsg) => void } {
    let sendRef!: (m: MenuMsg) => void
    const def = component<MenuCtx, MenuMsg, never>({
      name: 'PopoverWithMenu',
      init: () => [
        {
          pop: popover.init({ open: true }),
          mnu: menu.init({ open: true, items: [{ kind: 'action', value: 'one' }] }),
        },
        [],
      ],
      update: (state, msg) =>
        msg.type === 'pop'
          ? [{ ...state, pop: popover.update(state.pop, msg.msg)[0] }, []]
          : [{ ...state, mnu: menu.update(state.mnu, msg.msg)[0] }, []],
      view: ({ state, send }) => {
        sendRef = send
        const popSend = (m: popover.PopoverMsg): void => send({ type: 'pop', msg: m })
        const mnuSend = (m: menu.MenuMsg): void => send({ type: 'mnu', msg: m })
        const popParts = popover.connect(state.at('pop'), popSend, { id: 'pop' })
        const mnuParts = menu.connect(state.at('mnu'), mnuSend, { id: 'mnu' })
        return [
          button({ ...popParts.trigger }, [text('Open popover')]),
          // Mount order fixes stack order: the menu pushes last and is topmost.
          popover.overlay({
            state: state.at('pop'),
            send: popSend,
            parts: popParts,
            content: () => [
              div({ ...popParts.content }, [button({ id: 'pop-action' }, [text('Act')])]),
            ],
          }),
          // The menu's trigger lives OUTSIDE the popover — so restoring focus to
          // it lands outside the popover's dismiss boundary.
          button({ ...mnuParts.trigger }, [text('Menu')]),
          menu.overlay({
            state: state.at('mnu'),
            send: mnuSend,
            parts: mnuParts,
            content: () => [div({ ...mnuParts.content }, [text('items')])],
          }),
        ]
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    currentApp = mountApp(container, def)
    return { send: (m) => sendRef(m) }
  }

  it('a click inside a popover does not close that popover when it dismisses a layer above', async () => {
    const { send } = makePopoverWithMenu()
    await tick()

    const popAction = document.getElementById('pop-action') as HTMLElement
    const mnuTrigger = document.getElementById('mnu:trigger') as HTMLElement
    const mnuContent = document.getElementById('mnu:content') as HTMLElement
    expect(popAction).not.toBeNull()
    expect(mnuContent).not.toBeNull()
    // Non-vacuous: both layers really are on the stack, the menu's trigger — the
    // element its teardown focuses — really is outside the popover, and focus
    // really starts inside the menu, so the restore is a REAL focus move.
    expect(_dismissableStackSize()).toBe(2)
    const popContent = document.getElementById('pop:content') as HTMLElement
    expect(popContent.contains(mnuTrigger)).toBe(false)
    expect(document.activeElement).toBe(mnuContent)

    popAction.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await tick()

    // The menu dismissed (the click was outside it) …
    expect(document.getElementById('mnu:content')).toBeNull()
    // … its teardown restored focus to its trigger …
    expect(document.activeElement).toBe(mnuTrigger)
    // … and the popover the click actually landed in SURVIVED.
    expect(document.getElementById('pop:content')).not.toBeNull()

    send({ type: 'pop', msg: { type: 'close' } })
    await tick()
  })

  // ---------------------------------------------------------------------------
  // App B — two sibling popovers at production defaults, plus a body-level
  // control outside both. Exercises popover's `dismiss.extra` restore.
  // ---------------------------------------------------------------------------
  type SibCtx = { lower: popover.PopoverState; upper: popover.PopoverState }
  type SibMsg =
    | { type: 'lower'; msg: popover.PopoverMsg }
    | { type: 'upper'; msg: popover.PopoverMsg }

  function makeSiblings(): { send: (m: SibMsg) => void } {
    let sendRef!: (m: SibMsg) => void
    const def = component<SibCtx, SibMsg, never>({
      name: 'SiblingPopoversFocus',
      init: () => [
        { lower: popover.init({ open: true }), upper: popover.init({ open: true }) },
        [],
      ],
      update: (state, msg) =>
        msg.type === 'lower'
          ? [{ ...state, lower: popover.update(state.lower, msg.msg)[0] }, []]
          : [{ ...state, upper: popover.update(state.upper, msg.msg)[0] }, []],
      view: ({ state, send }) => {
        sendRef = send
        const lowerSend = (m: popover.PopoverMsg): void => send({ type: 'lower', msg: m })
        const upperSend = (m: popover.PopoverMsg): void => send({ type: 'upper', msg: m })
        const lowerParts = popover.connect(state.at('lower'), lowerSend, { id: 'lower' })
        const upperParts = popover.connect(state.at('upper'), upperSend, { id: 'upper' })
        return [
          // A control outside BOTH popovers — the stand-in for "somewhere else
          // on the page" that a genuine interaction can land on.
          button({ id: 'elsewhere' }, [text('Elsewhere')]),
          button({ ...lowerParts.trigger }, [text('Lower')]),
          popover.overlay({
            state: state.at('lower'),
            send: lowerSend,
            parts: lowerParts,
            content: () => [
              div({ ...lowerParts.content }, [button({ id: 'lower-action' }, [text('Lower')])]),
            ],
          }),
          button({ ...upperParts.trigger }, [text('Upper')]),
          popover.overlay({
            state: state.at('upper'),
            send: upperSend,
            parts: upperParts,
            content: () => [
              div({ ...upperParts.content }, [button({ id: 'upper-action' }, [text('Upper')])]),
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

  it('a pointerdown inside the lower sibling popover leaves it open while the upper dismisses', async () => {
    const { send } = makeSiblings()
    await tick()

    const lowerAction = document.getElementById('lower-action') as HTMLElement
    const upperTrigger = document.getElementById('upper:trigger') as HTMLElement
    expect(_dismissableStackSize()).toBe(2)

    lowerAction.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await tick()

    // The upper (topmost) layer dismissed and restored focus to its trigger …
    expect(document.getElementById('upper:content')).toBeNull()
    expect(document.activeElement).toBe(upperTrigger)
    // … and that restore did NOT knock out the popover the click landed in.
    expect(document.getElementById('lower:content')).not.toBeNull()

    send({ type: 'lower', msg: { type: 'close' } })
    await tick()
  })

  // --- the two guards against OVER-suppression ------------------------------

  it('a genuine pointerdown delivered DURING the dismissal’s focus restore still dismisses', async () => {
    makeSiblings()
    await tick()

    const lowerAction = document.getElementById('lower-action') as HTMLElement
    const elsewhere = document.getElementById('elsewhere') as HTMLElement
    const upperTrigger = document.getElementById('upper:trigger') as HTMLElement

    // A real user click that lands WHILE the engine is restoring focus. The
    // guard is scoped to the focus path only, so this must still be seen: at the
    // moment it fires the upper layer has already unwound and the lower popover
    // is topmost, and the click is outside it.
    let delivered = false
    const onFocusIn = (event: Event): void => {
      if (event.target !== upperTrigger || delivered) return
      delivered = true
      elsewhere.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    }
    document.addEventListener('focusin', onFocusIn, true)
    try {
      lowerAction.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      await tick()
    } finally {
      document.removeEventListener('focusin', onFocusIn, true)
    }

    // Non-vacuous: the interleaved click really was delivered mid-restore.
    expect(delivered).toBe(true)
    expect(document.getElementById('upper:content')).toBeNull()
    // The genuine interaction dismissed the lower popover too.
    expect(document.getElementById('lower:content')).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // App C — a popover with a modal DIALOG opened over it. Exercises the third
  // focus-moving site, `focus-trap.ts`: activating a trap moves focus INTO the
  // dialog, releasing it hands focus BACK to whatever was focused before.
  // ---------------------------------------------------------------------------
  type DlgCtx = { pop: popover.PopoverState; dlg: dialog.DialogState }
  type DlgMsg = { type: 'pop'; msg: popover.PopoverMsg } | { type: 'dlg'; msg: dialog.DialogMsg }

  function makePopoverWithDialog(): { send: (m: DlgMsg) => void } {
    let sendRef!: (m: DlgMsg) => void
    const def = component<DlgCtx, DlgMsg, never>({
      name: 'PopoverWithDialog',
      init: () => [{ pop: popover.init({ open: false }), dlg: dialog.init({ open: false }) }, []],
      update: (state, msg) =>
        msg.type === 'pop'
          ? [{ ...state, pop: popover.update(state.pop, msg.msg)[0] }, []]
          : [{ ...state, dlg: dialog.update(state.dlg, msg.msg)[0] }, []],
      view: ({ state, send }) => {
        sendRef = send
        const popSend = (m: popover.PopoverMsg): void => send({ type: 'pop', msg: m })
        const dlgSend = (m: dialog.DialogMsg): void => send({ type: 'dlg', msg: m })
        const popParts = popover.connect(state.at('pop'), popSend, { id: 'pop' })
        const dlgParts = dialog.connect(state.at('dlg'), dlgSend, { id: 'dlg' })
        return [
          // Focus parks here — outside BOTH layers — before either opens.
          button({ id: 'elsewhere' }, [text('Elsewhere')]),
          button({ ...popParts.trigger }, [text('Open popover')]),
          popover.overlay({
            state: state.at('pop'),
            send: popSend,
            parts: popParts,
            content: () => [
              div({ ...popParts.content }, [button({ id: 'pop-action' }, [text('Act')])]),
            ],
          }),
          button({ ...dlgParts.trigger }, [text('Open dialog')]),
          dialog.overlay({
            state: state.at('dlg'),
            send: dlgSend,
            parts: dlgParts,
            content: () => [
              div({ ...dlgParts.content }, [button({ id: 'dlg-action' }, [text('Dialog')])]),
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

  // ACCEPTED A11Y CONSEQUENCE, asserted deliberately below — read before
  // "fixing" this test. Because the popover is no longer dismissed when the
  // dialog's trap activates, a fully interactive NON-MODAL layer coexists with
  // a modal: the popover's positioner is not `aria-hidden`, not `inert`, and is
  // Tab-reachable from inside the dialog (via the `focus` nested-layer aspect,
  // `focus-trap.ts`). A modal that does not exclude the layer beneath it is not
  // really modal.
  //
  // It is kept because the alternative is worse and the cause is elsewhere.
  // The exemption comes from the FLAT `nested-layer.ts` registry — a lookup has
  // no notion of which layer asked, so a modal's `hide`/`focus` sweep exempts
  // EVERY registered layer, nested inside it or not. What #155's guard removed
  // was only an ACCIDENTAL mitigation (the trap's own focusin misread as a user
  // interaction — the very defect being fixed), and an unreliable one: on
  // `main`, a modal whose content has no focusable element moves no focus, so
  // the popover survives there too, in exactly this state. Measured both ways.
  //
  // It also needs a PROGRAMMATIC modal open: a pointerdown on the dialog's
  // trigger goes through the un-gated pointer path and dismisses the popover
  // first.
  //
  // The real fix is a per-layer registry ("is this nested inside ME?"), tracked
  // as #171. Do not patch it by having `pushFocusTrap` dismiss the layers below
  // it — that regresses nested dialogs, whose inner trap pushes before the
  // inner dialog's own dismissable layer.
  it('a focus trap activating and releasing does not dismiss the popover beneath it — which leaves that popover interactive behind the modal (accepted, #171)', async () => {
    const { send } = makePopoverWithDialog()
    await tick()

    const elsewhere = document.getElementById('elsewhere') as HTMLElement

    // Focus parks outside everything, then both layers open programmatically —
    // the popover first, so the dialog is the topmost layer.
    elsewhere.focus()
    send({ type: 'pop', msg: { type: 'open' } })
    await tick()
    send({ type: 'dlg', msg: { type: 'open' } })
    await tick()

    const popAction = document.getElementById('pop-action') as HTMLElement
    const dlgAction = document.getElementById('dlg-action') as HTMLElement
    // The trap pushes BEFORE the dialog's dismissable layer does (see the cleanup
    // order in `overlay-engine.ts`), so when it pulled focus into the dialog the
    // popover was still the topmost layer with a live `focusin` watcher. That was
    // the engine moving focus, not the user — the popover stays.
    expect(document.activeElement).toBe(dlgAction)
    expect(document.getElementById('pop:content')).not.toBeNull()
    expect(_dismissableStackSize()).toBe(2)

    // The accepted a11y cost, stated as an assertion rather than left implicit
    // (see the comment above the test, and #171): the surviving popover is NOT
    // excluded by the modal — its positioner carries neither `aria-hidden` nor
    // `inert`, so it stays interactive and Tab-reachable beside a modal dialog.
    // If a future change makes the modal exclude it, this is the assertion to
    // flip — deliberately, not by deleting it.
    const popPositioner = document.getElementById('pop:content')!.parentElement!
    expect(popPositioner.getAttribute('aria-hidden')).toBeNull()
    expect(popPositioner.hasAttribute('inert')).toBe(false)

    // Now a click inside the POPOVER. It is outside the dialog, so the dialog
    // dismisses — and releasing its trap hands focus back to where it was before
    // the trap, which is outside the popover. That restore must not take the
    // popover with it.
    popAction.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await tick()

    expect(document.getElementById('dlg:content')).toBeNull()
    expect(document.activeElement).toBe(elsewhere)
    expect(document.getElementById('pop:content')).not.toBeNull()

    send({ type: 'pop', msg: { type: 'close' } })
    await tick()
  })

  it('a genuine focus move out of a popover still dismisses it', async () => {
    makeSiblings()
    await tick()

    const elsewhere = document.getElementById('elsewhere') as HTMLElement
    const upperTrigger = document.getElementById('upper:trigger') as HTMLElement

    // Not routed through `engineFocus` — this is the user moving focus (Tab, or
    // a click that focuses). The topmost layer must dismiss.
    elsewhere.focus()
    await tick()
    expect(document.getElementById('upper:content')).toBeNull()
    expect(document.getElementById('lower:content')).not.toBeNull()

    // …and the suppression did not leak past the upper layer's restore: the very
    // next genuine focus move dismisses the layer beneath. Non-vacuous — the
    // restore really did pull focus off `elsewhere`, so this is a real move.
    expect(document.activeElement).toBe(upperTrigger)
    elsewhere.focus()
    await tick()
    expect(document.getElementById('lower:content')).toBeNull()
    // Its own restore then took focus back to ITS trigger — the same engine move,
    // now with no layer left to observe it.
    expect(document.activeElement).toBe(document.getElementById('lower:trigger'))
  })
})
