import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { component, mountApp, button, div, text } from '@llui/dom'
import * as dialog from '../../src/components/dialog'
import * as popover from '../../src/components/popover'
import * as tooltip from '../../src/components/tooltip'
import { positionerProps } from '../../src/utils/overlay-engine'

/**
 * The positioner is the one node in an overlay's tree the CONSUMER does not
 * build: `createOverlay` emits `div(opts.positioner, opts.content())` itself. So
 * before `positionerClass` there was no way to put a class — in practice, the
 * `z-index` for the floating layer — on it. Invisible while the opt-in baseline
 * stylesheet is doing the work (it targets `[data-part='positioner']` directly),
 * and a hard blocker for anyone styling with utilities instead, which is exactly
 * what the component registry does.
 *
 * The default must stay EXACTLY as it was: no `class` attribute at all, not an
 * empty one. `class=""` would show up as a diff in every existing consumer's DOM
 * and could shadow a stylesheet rule in nobody's favour.
 */

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

const positionerOf = (scope: string): HTMLElement | null =>
  document.querySelector(`[data-scope='${scope}'][data-part='positioner']`)

describe('positionerProps', () => {
  it('returns the SAME object when no class is supplied', () => {
    const base = { 'data-part': 'positioner', style: 'top:0' }
    // Identity, not merely equality: every overlay mount goes through here, and
    // an unconditional spread would allocate a fresh props object per mount for
    // the overwhelmingly common case of no class at all.
    expect(positionerProps(base, undefined)).toBe(base)
  })

  it('adds the class without disturbing the placement style', () => {
    expect(positionerProps({ 'data-part': 'positioner', style: 'top:0' }, 'z-popover')).toEqual({
      'data-part': 'positioner',
      style: 'top:0',
      class: 'z-popover',
    })
  })

  it('lets the caller override a class the part bag already carried', () => {
    expect(positionerProps({ class: 'a' }, 'b')).toEqual({ class: 'b' })
  })
})

describe('overlay positionerClass', () => {
  let app: ReturnType<typeof mountApp> | null = null

  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    app?.dispose()
    app = null
    document.body.innerHTML = ''
    document.body.style.overflow = ''
    document.body.style.paddingRight = ''
  })

  type Ctx = { dlg: dialog.DialogState; pop: popover.PopoverState; tip: tooltip.TooltipState }
  type Msg = { type: 'noop' }

  /** Mounts all three overlays open at once; `positionerClass` is passed only
   * where `classes` supplies one, so the same app covers both directions. */
  function mountAll(classes: { dialog?: string; popover?: string; tooltip?: string }): void {
    const def = component<Ctx, Msg, never>({
      name: 'PositionerClasses',
      init: () => [
        {
          dlg: dialog.init({ open: true }),
          pop: popover.init({ open: true }),
          tip: tooltip.init({ open: true }),
        },
        [],
      ],
      update: (state) => [state, []],
      view: ({ state, send }) => {
        const noop = (): void => send({ type: 'noop' })
        const dlgParts = dialog.connect(state.at('dlg'), noop, { id: 'dlg' })
        const popParts = popover.connect(state.at('pop'), noop, { id: 'pop' })
        const tipParts = tooltip.connect(state.at('tip'), noop, { id: 'tip' })
        return [
          button({ ...dlgParts.trigger }, [text('dialog')]),
          dialog.overlay({
            state: state.at('dlg'),
            send: noop,
            parts: dlgParts,
            positionerClass: classes.dialog,
            content: () => [div({ ...dlgParts.content }, [text('body')])],
          }),
          button({ ...popParts.trigger }, [text('popover')]),
          popover.overlay({
            state: state.at('pop'),
            send: noop,
            parts: popParts,
            positionerClass: classes.popover,
            content: () => [div({ ...popParts.content }, [text('body')])],
          }),
          button({ ...tipParts.trigger }, [text('tooltip')]),
          tooltip.overlay({
            state: state.at('tip'),
            send: noop,
            parts: tipParts,
            positionerClass: classes.tooltip,
            content: () => [div({ ...tipParts.content }, [text('tip')])],
          }),
        ]
      },
    })
    const host = document.createElement('div')
    document.body.appendChild(host)
    app = mountApp(host, def)
  }

  it('applies the class to each overlay’s positioner', async () => {
    mountAll({
      dialog: 'z-dialog grid place-items-center',
      popover: 'z-popover',
      tooltip: 'z-tooltip',
    })
    await tick()
    expect(positionerOf('dialog')?.getAttribute('class')).toBe('z-dialog grid place-items-center')
    expect(positionerOf('popover')?.getAttribute('class')).toBe('z-popover')
    expect(positionerOf('tooltip')?.getAttribute('class')).toBe('z-tooltip')
  })

  it('emits NO class attribute when the option is omitted', async () => {
    mountAll({})
    await tick()
    for (const scope of ['dialog', 'popover', 'tooltip']) {
      const el = positionerOf(scope)
      expect(el, `${scope} positioner missing`).not.toBeNull()
      expect(el!.hasAttribute('class'), `${scope} gained a class attribute`).toBe(false)
    }
  })

  it('keeps the placement style the part bag supplies', async () => {
    mountAll({ popover: 'z-popover' })
    await tick()
    const el = positionerOf('popover')
    expect(el?.getAttribute('class')).toBe('z-popover')
    expect(el?.getAttribute('style')).toBeTruthy()
  })
})
