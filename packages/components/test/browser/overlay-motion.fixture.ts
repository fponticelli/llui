import { button, component, div, each, input, mountApp, text } from '@llui/dom'
import type { Mountable, Renderable, Send, Signal, TransitionOptions } from '@llui/dom'
import * as alertDialog from '../../src/components/alert-dialog.js'
import * as contextMenu from '../../src/components/context-menu.js'
import * as dialog from '../../src/components/dialog.js'
import * as drawer from '../../src/components/drawer.js'
import * as hoverCard from '../../src/components/hover-card.js'
import * as menu from '../../src/components/menu.js'
import * as popover from '../../src/components/popover.js'
import type { PresenceStatus } from '../../src/components/presence.js'
import * as tooltip from '../../src/components/tooltip.js'
import * as toast from '../../src/components/toast.js'
import * as select from '../../src/components/select.js'
import * as combobox from '../../src/components/combobox.js'
import * as menubar from '../../src/components/menubar.js'
import type { Placement } from '@llui/interactions'

export const motionProducts = [
  'dialog',
  'alert-dialog',
  'drawer',
  'menu',
  'context-menu',
  'popover',
  'hover-card',
  'tooltip',
] as const

export type MotionProduct = (typeof motionProducts)[number]

interface MotionSnapshot {
  product: MotionProduct
  status: PresenceStatus
  mounted: boolean
  contentState: string | null
  animationName: string | null
  placement: string | null
  side: string | null
  positioner: {
    position: string
    top: string
    left: string
    transform: string
  } | null
  triggerRect: RectSnapshot | null
  contentRect: RectSnapshot | null
  arrow: {
    position: string
    top: string
    right: string
    bottom: string
    left: string
    rect: RectSnapshot
  } | null
}

interface RectSnapshot {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

interface MotionTraceEntry {
  event: 'animationstart' | 'animationend' | 'transitionstart' | 'transitionend'
  product: string | null
  state: string | null
  animationName: string
}

interface MotionAdapter<State, Msg extends { type: string }> {
  product: MotionProduct
  init: (animated: boolean) => State
  update: (state: State, msg: Msg) => [State, never[]]
  isMounted: (state: State) => boolean
  status: (state: State) => PresenceStatus
  open: Msg
  close: Msg
  view: (state: Signal<State>, send: Send<Msg>, placement?: Placement) => Renderable
}

interface RunningMotion {
  open: () => void
  close: () => void
  snapshot: () => MotionSnapshot
  dispose: () => void
}

interface ToastMotionSnapshot {
  count: number
  mounted: boolean
  status: PresenceStatus | null
  type: toast.ToastType | null
  placement: toast.ToastPlacement
  animationName: string | null
  animationDuration: string | null
  role: string | null
  ariaLive: string | null
  regionRect: RectSnapshot
  toastRect: RectSnapshot | null
}

interface RunningToastMotion {
  create: (type: toast.ToastType) => void
  dismiss: () => void
  snapshot: () => ToastMotionSnapshot
  dispose: () => void
}

export const transitionProducts = ['select', 'combobox', 'menubar'] as const
export type TransitionProduct = (typeof transitionProducts)[number]

interface TransitionSnapshot {
  product: TransitionProduct
  open: boolean
  mounted: boolean
  contentState: string | null
  transitionDuration: string | null
  opacity: string | null
}

interface TransitionAdapter<State, Msg extends { type: string }> {
  product: TransitionProduct
  init: () => State
  update: (state: State, msg: Msg) => [State, unknown[]]
  isOpen: (state: State) => boolean
  open: Msg
  close: Msg
  view: (state: Signal<State>, send: Send<Msg>, withTransition: boolean) => Renderable
}

interface RunningTransition {
  open: () => void
  close: () => void
  snapshot: () => TransitionSnapshot
  dispose: () => void
}

/** A consumer-owned leave recipe proving the optional TransitionOptions seam
 * without making @llui/components depend on the deliberately separate
 * @llui/transitions package. The browser assertions require the real
 * `transitionstart`/`transitionend`; the timer only prevents a throttled page
 * from retaining test DOM forever. */
function fadeOutTransition(duration = 80): TransitionOptions {
  return {
    leave: (nodes) => {
      const elements = nodes.filter((node): node is HTMLElement => node instanceof HTMLElement)
      if (elements.length === 0) return
      const completions = elements.map(
        (element) =>
          new Promise<void>((resolve) => {
            let settled = false
            const finish = (): void => {
              if (settled) return
              settled = true
              element.removeEventListener('transitionend', onEnd)
              clearTimeout(timer)
              resolve()
            }
            const onEnd = (event: TransitionEvent): void => {
              if (event.target === element && event.propertyName === 'opacity') finish()
            }
            element.style.opacity = '1'
            element.style.transition = `opacity ${duration}ms ease-out`
            element.addEventListener('transitionend', onEnd)
            const timer = setTimeout(finish, duration + 32)
          }),
      )
      void elements[0]!.offsetHeight
      for (const element of elements) element.style.opacity = '0'
      return Promise.all(completions).then(() => undefined)
    },
  }
}

declare global {
  interface Window {
    __motionReady: boolean
    __motionProducts: readonly MotionProduct[]
    __mountMotion: (
      product: MotionProduct,
      animated: boolean,
      placement?: Placement,
    ) => MotionSnapshot
    __openMotion: () => MotionSnapshot
    __closeMotion: () => MotionSnapshot
    __motionSnapshot: () => MotionSnapshot
    __motionTrace: MotionTraceEntry[]
    __resetMotionTrace: () => void
    __setMotionSkin: (skin: { contentClass?: string; arrowClass?: string }) => void
    __setMotionAnchorRect: (rect: RectSnapshot) => void
    __setToastMotionSkin: (skin: { regionClass?: string; toastClass?: string }) => void
    __mountToastMotion: (animated: boolean, placement?: toast.ToastPlacement) => ToastMotionSnapshot
    __createToastMotion: (type: toast.ToastType) => ToastMotionSnapshot
    __dismissToastMotion: () => ToastMotionSnapshot
    __toastMotionSnapshot: () => ToastMotionSnapshot
    __transitionProducts: readonly TransitionProduct[]
    __mountTransitionMotion: (
      product: TransitionProduct,
      withTransition?: boolean,
    ) => TransitionSnapshot
    __openTransitionMotion: () => TransitionSnapshot
    __closeTransitionMotion: () => TransitionSnapshot
    __transitionMotionSnapshot: () => TransitionSnapshot
  }
}

let motionSkin: { contentClass?: string; arrowClass?: string } = {}
let toastMotionSkin: { regionClass?: string; toastClass?: string } = {}

const content =
  (product: MotionProduct, parts: { content: object }): (() => Renderable) =>
  () => [
    div(
      {
        ...parts.content,
        ...(motionSkin.contentClass ? { class: motionSkin.contentClass } : {}),
        'data-motion-product': product,
      },
      [text(product)],
    ),
  ]

const floatingTrigger = (parts: { trigger: object }): Mountable =>
  button({ ...parts.trigger }, [text('trigger')])

const dialogStatus = (state: dialog.DialogState): PresenceStatus =>
  state.status ?? (state.open ? 'open' : 'closed')

const dialogAdapter: MotionAdapter<dialog.DialogState, dialog.DialogMsg> = {
  product: 'dialog',
  init: (animated) => dialog.init({ skipAnimations: !animated }),
  update: dialog.update,
  isMounted: dialog.isMounted,
  status: dialogStatus,
  open: { type: 'open' },
  close: { type: 'close' },
  view: (state, send) => {
    const parts = dialog.connect(state, send, { id: 'motion-dialog' })
    return [
      floatingTrigger(parts),
      dialog.overlay({
        state,
        send,
        parts,
        content: content('dialog', parts),
        trapFocus: false,
        lockScroll: false,
        hideSiblings: false,
      }),
    ]
  },
}

const alertDialogAdapter: MotionAdapter<alertDialog.AlertDialogState, alertDialog.AlertDialogMsg> =
  {
    product: 'alert-dialog',
    init: (animated) => alertDialog.init({ skipAnimations: !animated }),
    update: alertDialog.update,
    isMounted: alertDialog.isMounted,
    status: dialogStatus,
    open: { type: 'open' },
    close: { type: 'close' },
    view: (state, send) => {
      const parts = alertDialog.connect(state, send, { id: 'motion-alert-dialog' })
      return [
        floatingTrigger(parts),
        alertDialog.overlay({
          state,
          send,
          parts,
          content: content('alert-dialog', parts),
          trapFocus: false,
          lockScroll: false,
          hideSiblings: false,
        }),
      ]
    },
  }

const drawerAdapter: MotionAdapter<drawer.DrawerState, drawer.DrawerMsg> = {
  product: 'drawer',
  init: (animated) => drawer.init({ skipAnimations: !animated }),
  update: drawer.update,
  isMounted: drawer.isMounted,
  status: (state) => state.status,
  open: { type: 'open' },
  close: { type: 'close' },
  view: (state, send) => {
    const parts = drawer.connect(state, send, { id: 'motion-drawer', side: 'right' })
    return [
      floatingTrigger(parts),
      drawer.overlay({
        state,
        send,
        parts,
        content: content('drawer', parts),
        trapFocus: false,
        lockScroll: false,
        hideSiblings: false,
      }),
    ]
  },
}

const items = [{ value: 'item', kind: 'action' }] as const

const menuAdapter: MotionAdapter<menu.MenuState, menu.MenuMsg> = {
  product: 'menu',
  init: (animated) => menu.init({ items: [...items], skipAnimations: !animated }),
  update: menu.update,
  isMounted: menu.isPresent,
  status: (state) => state.status,
  open: { type: 'open' },
  close: { type: 'close' },
  view: (state, send) => {
    const parts = menu.connect(state, send, { id: 'motion-menu' })
    return [
      floatingTrigger(parts),
      menu.overlay({ state, send, parts, content: content('menu', parts) }),
    ]
  },
}

const contextMenuAdapter: MotionAdapter<contextMenu.ContextMenuState, contextMenu.ContextMenuMsg> =
  {
    product: 'context-menu',
    init: (animated) => contextMenu.init({ items: [...items], skipAnimations: !animated }),
    update: contextMenu.update,
    isMounted: contextMenu.isPresent,
    status: (state) => state.status,
    open: { type: 'openAt', x: 24, y: 32 },
    close: { type: 'close' },
    view: (state, send) => {
      const parts = contextMenu.connect(state, send, { id: 'motion-context-menu' })
      return [
        div({ ...parts.trigger }, [text('context region')]),
        contextMenu.overlay({
          state,
          send,
          parts,
          content: content('context-menu', parts),
        }),
      ]
    },
  }

const popoverAdapter: MotionAdapter<popover.PopoverState, popover.PopoverMsg> = {
  product: 'popover',
  init: (animated) => popover.init({ skipAnimations: !animated }),
  update: popover.update,
  isMounted: popover.isMounted,
  status: (state) => state.status,
  open: { type: 'open' },
  close: { type: 'close' },
  view: (state, send, placement) => {
    const parts = popover.connect(state, send, { id: 'motion-popover' })
    return [
      floatingTrigger(parts),
      popover.overlay({
        state,
        send,
        parts,
        placement,
        arrowSelector: '[data-motion-arrow]',
        content: () => [
          div(
            {
              ...parts.content,
              ...(motionSkin.contentClass ? { class: motionSkin.contentClass } : {}),
              'data-motion-product': 'popover',
            },
            [
              text('popover'),
              div({
                ...parts.arrow,
                ...(motionSkin.arrowClass ? { class: motionSkin.arrowClass } : {}),
                'data-motion-arrow': '',
              }),
            ],
          ),
        ],
      }),
    ]
  },
}

const hoverCardAdapter: MotionAdapter<hoverCard.HoverCardState, hoverCard.HoverCardMsg> = {
  product: 'hover-card',
  init: (animated) => hoverCard.init({ skipAnimations: !animated }),
  update: hoverCard.update,
  isMounted: hoverCard.isMounted,
  status: (state) => state.status,
  open: { type: 'show' },
  close: { type: 'hide' },
  view: (state, send) => {
    const parts = hoverCard.connect(state, send, { id: 'motion-hover-card' })
    return [
      div({ ...parts.trigger }, [text('hover trigger')]),
      hoverCard.overlay({ state, send, parts, content: content('hover-card', parts) }),
    ]
  },
}

const tooltipAdapter: MotionAdapter<tooltip.TooltipState, tooltip.TooltipMsg> = {
  product: 'tooltip',
  init: (animated) => tooltip.init({ animated }),
  update: tooltip.update,
  isMounted: tooltip.isMounted,
  status: (state) => state.status,
  open: { type: 'show' },
  close: { type: 'hide' },
  view: (state, send) => {
    const parts = tooltip.connect(state, send, { id: 'motion-tooltip' })
    return [
      div({ ...parts.trigger }, [text('tooltip trigger')]),
      tooltip.overlay({ state, send, parts, content: content('tooltip', parts) }),
    ]
  },
}

const mountMotion = <State, Msg extends { type: string }>(
  adapter: MotionAdapter<State, Msg>,
  animated: boolean,
  placement?: Placement,
): RunningMotion => {
  let sendRef!: Send<Msg>
  let readState!: () => State
  const app = component<{ motion: State }, Msg, never>({
    name: `OverlayMotion(${adapter.product})`,
    init: () => [{ motion: adapter.init(animated) }, []],
    update: (state, msg) => {
      const [next] = adapter.update(state.motion, msg)
      return [{ motion: next }, []]
    },
    view: ({ state, send }) => {
      sendRef = send
      readState = () => state.peek().motion
      return adapter.view(state.at('motion'), send, placement)
    },
  })

  const host = document.getElementById('app')!
  const handle = mountApp(host, app)
  const snapshot = (): MotionSnapshot => {
    const state = readState()
    const node = document.querySelector<HTMLElement>(`[data-motion-product="${adapter.product}"]`)
    const rectSnapshot = (element: Element | null): RectSnapshot | null => {
      if (element === null) return null
      const rect = element.getBoundingClientRect()
      return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }
    }
    const trigger = document.querySelector<HTMLElement>(
      `[data-scope="${adapter.product}"][data-part="trigger"]`,
    )
    const arrow = node?.querySelector<HTMLElement>('[data-motion-arrow]') ?? null
    const arrowStyle = arrow === null ? null : getComputedStyle(arrow)
    return {
      product: adapter.product,
      status: adapter.status(state),
      mounted: adapter.isMounted(state),
      contentState: node?.dataset['state'] ?? null,
      animationName: node === null ? null : getComputedStyle(node).animationName,
      placement: node?.dataset['placement'] ?? null,
      side: node?.dataset['side'] ?? null,
      positioner:
        node === null
          ? null
          : (() => {
              const positioner = node.closest<HTMLElement>('[data-part="positioner"]')
              return positioner === null
                ? null
                : {
                    position: positioner.style.position,
                    top: positioner.style.top,
                    left: positioner.style.left,
                    transform: positioner.style.transform,
                  }
            })(),
      triggerRect: rectSnapshot(trigger),
      contentRect: rectSnapshot(node),
      arrow:
        arrow === null || arrowStyle === null
          ? null
          : {
              position: arrowStyle.position,
              top: arrow.style.top,
              right: arrow.style.right,
              bottom: arrow.style.bottom,
              left: arrow.style.left,
              rect: rectSnapshot(arrow)!,
            },
    }
  }

  return {
    open: () => sendRef(adapter.open),
    close: () => sendRef(adapter.close),
    snapshot,
    dispose: () => handle.dispose(),
  }
}

const mountToastMotion = (
  animated: boolean,
  placement: toast.ToastPlacement = 'bottom-end',
): RunningToastMotion => {
  let sendRef!: Send<toast.ToasterMsg>
  let readState!: () => toast.ToasterState
  const app = component<{ toaster: toast.ToasterState }, toast.ToasterMsg, never>({
    name: 'ToastMotion',
    init: () => [{ toaster: toast.init({ animated, placement }) }, []],
    update: (state, msg) => {
      const [next] = toast.update(state.toaster, msg)
      return [{ toaster: next }, []]
    },
    view: ({ state, send }) => {
      sendRef = send
      readState = () => state.peek().toaster
      const parts = toast.connect(state.at('toaster'), send, {
        regionLabel: 'Motion notifications',
      })
      return [
        div(
          {
            ...parts.region,
            ...(toastMotionSkin.regionClass ? { class: toastMotionSkin.regionClass } : {}),
            'data-toast-motion-region': '',
          },
          [
            each(state.at('toaster').at('toasts'), {
              key: (item: toast.Toast) => item.id,
              render: (item: Signal<toast.Toast>) => {
                const value = item.peek()
                const itemParts = parts.toast(item)
                return [
                  div(
                    {
                      ...itemParts.root,
                      ...(toastMotionSkin.toastClass ? { class: toastMotionSkin.toastClass } : {}),
                      'data-motion-product': 'toast',
                      'data-toast-motion-root': '',
                    },
                    [text(value.title ?? value.type)],
                  ),
                ]
              },
            }),
          ],
        ),
      ]
    },
  })

  const host = document.getElementById('app')!
  const handle = mountApp(host, app)
  const rectSnapshot = (element: Element | null): RectSnapshot | null => {
    if (element === null) return null
    const rect = element.getBoundingClientRect()
    return {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    }
  }
  const snapshot = (): ToastMotionSnapshot => {
    const state = readState()
    const region = document.querySelector<HTMLElement>('[data-toast-motion-region]')!
    const node = document.querySelector<HTMLElement>('[data-toast-motion-root]')
    return {
      count: state.toasts.length,
      mounted: node !== null,
      status: state.toasts[0]?.status ?? null,
      type: state.toasts[0]?.type ?? null,
      placement: state.placement,
      animationName: node === null ? null : getComputedStyle(node).animationName,
      animationDuration: node === null ? null : getComputedStyle(node).animationDuration,
      role: node?.getAttribute('role') ?? null,
      ariaLive: node?.getAttribute('aria-live') ?? null,
      regionRect: rectSnapshot(region)!,
      toastRect: rectSnapshot(node),
    }
  }

  return {
    create: (type) =>
      sendRef({
        type: 'create',
        toast: {
          id: 'motion-toast',
          type,
          title: `${type} notification`,
          description: 'Motion fixture',
          duration: null,
          dismissable: true,
        },
      }),
    dismiss: () => sendRef({ type: 'dismiss', id: 'motion-toast' }),
    snapshot,
    dispose: () => handle.dispose(),
  }
}

const transitionContent =
  (product: TransitionProduct, parts: { content: object }): (() => Renderable) =>
  () => [
    div({ ...parts.content, 'data-transition-product': product }, [text(`${product} content`)]),
  ]

const selectTransitionAdapter: TransitionAdapter<select.SelectState, select.SelectMsg> = {
  product: 'select',
  init: () => select.init({ items: ['item'] }),
  update: select.update,
  isOpen: (state) => state.open,
  open: { type: 'open' },
  close: { type: 'close' },
  view: (state, send, withTransition) => {
    const parts = select.connect(state, send, { id: 'transition-select' })
    const overlayParts = {
      ...parts,
      positioner: { ...parts.positioner, 'data-transition-shell': 'select' },
    }
    return [
      button({ ...parts.trigger }, [text('select trigger')]),
      select.overlay({
        state,
        send,
        parts: overlayParts,
        transition: withTransition ? fadeOutTransition() : undefined,
        content: transitionContent('select', parts),
      }),
    ]
  },
}

const comboboxTransitionAdapter: TransitionAdapter<combobox.ComboboxState, combobox.ComboboxMsg> = {
  product: 'combobox',
  init: () => combobox.init({ items: ['item'] }),
  update: combobox.update,
  isOpen: (state) => state.open,
  open: { type: 'open' },
  close: { type: 'close' },
  view: (state, send, withTransition) => {
    const parts = combobox.connect(state, send, { id: 'transition-combobox' })
    const overlayParts = {
      ...parts,
      positioner: { ...parts.positioner, 'data-transition-shell': 'combobox' },
    }
    return [
      input({ ...parts.input }),
      combobox.overlay({
        state,
        send,
        parts: overlayParts,
        transition: withTransition ? fadeOutTransition() : undefined,
        content: transitionContent('combobox', parts),
      }),
    ]
  },
}

const menubarTransitionAdapter: TransitionAdapter<menubar.MenubarState, menubar.MenubarMsg> = {
  product: 'menubar',
  init: () =>
    menubar.init({
      menus: [{ id: 'file', items: [{ value: 'item', kind: 'action' }] }],
    }),
  update: menubar.update,
  isOpen: (state) => state.open === 'file',
  open: { type: 'openMenu', id: 'file' },
  close: { type: 'closeMenu' },
  view: (state, send, withTransition) => {
    const parts = menubar.connect(state, send, { id: 'transition-menubar' })
    const menuParts = parts.menu('file')
    const overlayParts = {
      ...menuParts,
      positioner: { ...menuParts.positioner, 'data-transition-shell': 'menubar' },
    }
    return [
      div({ ...parts.root }, [button({ ...parts.menuTrigger('file') }, [text('File')])]),
      menubar.overlay({
        state,
        send,
        menuId: 'file',
        parts: overlayParts,
        transition: withTransition ? fadeOutTransition() : undefined,
        content: transitionContent('menubar', menuParts),
      }),
    ]
  },
}

const mountTransitionMotion = <State, Msg extends { type: string }>(
  adapter: TransitionAdapter<State, Msg>,
  withTransition: boolean,
): RunningTransition => {
  let sendRef!: Send<Msg>
  let readState!: () => State
  const app = component<{ value: State }, Msg, never>({
    name: `TransitionMotion(${adapter.product})`,
    init: () => [{ value: adapter.init() }, []],
    update: (state, msg) => {
      const [next] = adapter.update(state.value, msg)
      return [{ value: next }, []]
    },
    view: ({ state, send }) => {
      sendRef = send
      readState = () => state.peek().value
      return adapter.view(state.at('value'), send, withTransition)
    },
  })
  const host = document.getElementById('app')!
  const handle = mountApp(host, app)
  const snapshot = (): TransitionSnapshot => {
    const content = document.querySelector<HTMLElement>(
      `[data-transition-product="${adapter.product}"]`,
    )
    const shell = document.querySelector<HTMLElement>(
      `[data-transition-shell="${adapter.product}"]`,
    )
    const style = shell === null ? null : getComputedStyle(shell)
    return {
      product: adapter.product,
      open: adapter.isOpen(readState()),
      mounted: content !== null,
      contentState: content?.dataset['state'] ?? null,
      transitionDuration: style?.transitionDuration ?? null,
      opacity: style?.opacity ?? null,
    }
  }
  return {
    open: () => sendRef(adapter.open),
    close: () => sendRef(adapter.close),
    snapshot,
    dispose: () => handle.dispose(),
  }
}

const transitionFactories: {
  [Product in TransitionProduct]: (withTransition: boolean) => RunningTransition
} = {
  select: (withTransition) => mountTransitionMotion(selectTransitionAdapter, withTransition),
  combobox: (withTransition) => mountTransitionMotion(comboboxTransitionAdapter, withTransition),
  menubar: (withTransition) => mountTransitionMotion(menubarTransitionAdapter, withTransition),
}

const factories: {
  [Product in MotionProduct]: (animated: boolean, placement?: Placement) => RunningMotion
} = {
  dialog: (animated, placement) => mountMotion(dialogAdapter, animated, placement),
  'alert-dialog': (animated, placement) => mountMotion(alertDialogAdapter, animated, placement),
  drawer: (animated, placement) => mountMotion(drawerAdapter, animated, placement),
  menu: (animated, placement) => mountMotion(menuAdapter, animated, placement),
  'context-menu': (animated, placement) => mountMotion(contextMenuAdapter, animated, placement),
  popover: (animated, placement) => mountMotion(popoverAdapter, animated, placement),
  'hover-card': (animated, placement) => mountMotion(hoverCardAdapter, animated, placement),
  tooltip: (animated, placement) => mountMotion(tooltipAdapter, animated, placement),
}

let current: RunningMotion | null = null
let currentToast: RunningToastMotion | null = null
let currentTransition: RunningTransition | null = null
window.__motionReady = false
window.__motionProducts = motionProducts
window.__transitionProducts = transitionProducts
window.__motionTrace = []
window.__resetMotionTrace = () => {
  window.__motionTrace = []
}

for (const event of ['animationstart', 'animationend'] as const) {
  document.addEventListener(
    event,
    (rawEvent) => {
      const animationEvent = rawEvent as AnimationEvent
      const target = animationEvent.target
      if (!(target instanceof HTMLElement) || target.dataset['motionProduct'] === undefined) return
      window.__motionTrace.push({
        event,
        product: target.dataset['motionProduct'] ?? null,
        state: target.dataset['state'] ?? null,
        animationName: animationEvent.animationName,
      })
    },
    true,
  )
}

for (const event of ['transitionstart', 'transitionend'] as const) {
  document.addEventListener(
    event,
    (rawEvent) => {
      const transitionEvent = rawEvent as TransitionEvent
      const target = transitionEvent.target
      if (!(target instanceof HTMLElement) || target.dataset['transitionShell'] === undefined) {
        return
      }
      window.__motionTrace.push({
        event,
        product: target.dataset['transitionShell'] ?? null,
        state: target.dataset['state'] ?? null,
        animationName: transitionEvent.propertyName,
      })
    },
    true,
  )
}

window.__setMotionSkin = (skin) => {
  motionSkin = skin
}
window.__setToastMotionSkin = (skin) => {
  toastMotionSkin = skin
}
window.__setMotionAnchorRect = (rect) => {
  if (current === null) throw new Error('No motion scenario is mounted')
  const product = current.snapshot().product
  const trigger = document.querySelector<HTMLElement>(
    `[data-scope="${product}"][data-part="trigger"]`,
  )
  if (trigger === null) throw new Error(`No trigger for ${product}`)
  trigger.getBoundingClientRect = () =>
    ({
      x: rect.left,
      y: rect.top,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      toJSON: () => ({}),
    }) as DOMRect
  window.dispatchEvent(new Event('resize'))
}
window.__mountMotion = (product, animated, placement) => {
  current?.dispose()
  document.getElementById('app')!.replaceChildren()
  current = factories[product](animated, placement)
  return current.snapshot()
}
window.__openMotion = () => {
  if (current === null) throw new Error('No motion scenario is mounted')
  current.open()
  return current.snapshot()
}
window.__closeMotion = () => {
  if (current === null) throw new Error('No motion scenario is mounted')
  current.close()
  return current.snapshot()
}
window.__motionSnapshot = () => {
  if (current === null) throw new Error('No motion scenario is mounted')
  return current.snapshot()
}
window.__mountToastMotion = (animated, placement) => {
  currentToast?.dispose()
  current?.dispose()
  current = null
  document.getElementById('app')!.replaceChildren()
  currentToast = mountToastMotion(animated, placement)
  return currentToast.snapshot()
}
window.__createToastMotion = (type) => {
  if (currentToast === null) throw new Error('No toast motion scenario is mounted')
  currentToast.create(type)
  return currentToast.snapshot()
}
window.__dismissToastMotion = () => {
  if (currentToast === null) throw new Error('No toast motion scenario is mounted')
  currentToast.dismiss()
  return currentToast.snapshot()
}
window.__toastMotionSnapshot = () => {
  if (currentToast === null) throw new Error('No toast motion scenario is mounted')
  return currentToast.snapshot()
}
window.__mountTransitionMotion = (product, withTransition = true) => {
  currentTransition?.dispose()
  currentToast?.dispose()
  currentToast = null
  current?.dispose()
  current = null
  document.getElementById('app')!.replaceChildren()
  currentTransition = transitionFactories[product](withTransition)
  return currentTransition.snapshot()
}
window.__openTransitionMotion = () => {
  if (currentTransition === null) throw new Error('No transition scenario is mounted')
  currentTransition.open()
  return currentTransition.snapshot()
}
window.__closeTransitionMotion = () => {
  if (currentTransition === null) throw new Error('No transition scenario is mounted')
  currentTransition.close()
  return currentTransition.snapshot()
}
window.__transitionMotionSnapshot = () => {
  if (currentTransition === null) throw new Error('No transition scenario is mounted')
  return currentTransition.snapshot()
}
window.__motionReady = true
