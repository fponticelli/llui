import { button, component, div, mountApp, text } from '@llui/dom'
import type { Mountable, Renderable, Send, Signal } from '@llui/dom'
import * as alertDialog from '../../src/components/alert-dialog.js'
import * as contextMenu from '../../src/components/context-menu.js'
import * as dialog from '../../src/components/dialog.js'
import * as drawer from '../../src/components/drawer.js'
import * as hoverCard from '../../src/components/hover-card.js'
import * as menu from '../../src/components/menu.js'
import * as popover from '../../src/components/popover.js'
import type { PresenceStatus } from '../../src/components/presence.js'
import * as tooltip from '../../src/components/tooltip.js'

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
}

interface MotionTraceEntry {
  event: 'animationstart' | 'animationend'
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
  view: (state: Signal<State>, send: Send<Msg>) => Renderable
}

interface RunningMotion {
  open: () => void
  close: () => void
  snapshot: () => MotionSnapshot
  dispose: () => void
}

declare global {
  interface Window {
    __motionReady: boolean
    __motionProducts: readonly MotionProduct[]
    __mountMotion: (product: MotionProduct, animated: boolean) => MotionSnapshot
    __openMotion: () => MotionSnapshot
    __closeMotion: () => MotionSnapshot
    __motionSnapshot: () => MotionSnapshot
    __motionTrace: MotionTraceEntry[]
    __resetMotionTrace: () => void
  }
}

const content =
  (product: MotionProduct, parts: { content: object }): (() => Renderable) =>
  () => [
    div(
      {
        ...parts.content,
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
  view: (state, send) => {
    const parts = popover.connect(state, send, { id: 'motion-popover' })
    return [
      floatingTrigger(parts),
      popover.overlay({ state, send, parts, content: content('popover', parts) }),
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
      return adapter.view(state.at('motion'), send)
    },
  })

  const host = document.getElementById('app')!
  const handle = mountApp(host, app)
  const snapshot = (): MotionSnapshot => {
    const state = readState()
    const node = document.querySelector<HTMLElement>(`[data-motion-product="${adapter.product}"]`)
    return {
      product: adapter.product,
      status: adapter.status(state),
      mounted: adapter.isMounted(state),
      contentState: node?.dataset['state'] ?? null,
      animationName: node === null ? null : getComputedStyle(node).animationName,
    }
  }

  return {
    open: () => sendRef(adapter.open),
    close: () => sendRef(adapter.close),
    snapshot,
    dispose: () => handle.dispose(),
  }
}

const factories: { [Product in MotionProduct]: (animated: boolean) => RunningMotion } = {
  dialog: (animated) => mountMotion(dialogAdapter, animated),
  'alert-dialog': (animated) => mountMotion(alertDialogAdapter, animated),
  drawer: (animated) => mountMotion(drawerAdapter, animated),
  menu: (animated) => mountMotion(menuAdapter, animated),
  'context-menu': (animated) => mountMotion(contextMenuAdapter, animated),
  popover: (animated) => mountMotion(popoverAdapter, animated),
  'hover-card': (animated) => mountMotion(hoverCardAdapter, animated),
  tooltip: (animated) => mountMotion(tooltipAdapter, animated),
}

let current: RunningMotion | null = null
window.__motionReady = false
window.__motionProducts = motionProducts
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

window.__mountMotion = (product, animated) => {
  current?.dispose()
  document.getElementById('app')!.replaceChildren()
  current = factories[product](animated)
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
window.__motionReady = true
