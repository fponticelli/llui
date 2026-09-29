// TEST-ONLY composition (registry/test/baseline-navigation-menubar.browser.test.ts,
// registry/test/menus-container-direction.browser.test.ts). A consumer-authored
// NavigationMenu, Menubar and dropdown Menu on the Baseline path — `theme.css`
// alone, no Tailwind, no registry skin — with the ids those suites address.
//
// These are real application compositions rather than scenario cases: the
// NavigationMenu is a `nav` landmark with list/link anatomy and a leaf item,
// the Menubar has three menus and an engine-owned submenu, and every floating
// surface portals to `<body>`, OUTSIDE the app container. The Component
// Gallery's scenario adapters deliberately mount each case self-contained in
// its host, so they cannot reproduce the portal-outside-a-`dir`-container
// shape these suites exist to prove.
//
// It replaces the matching sections of the retired `examples/components-demo`.
// Theme.css does not lay out a navigation menu or a menubar, so the
// few layout declarations the geometry assertions depend on (a positioned
// nav root, inline-start anchored panels, a menu's minimum inline size) are
// written inline, as a consumer's own layout would be.
import { a, button, component, div, li, nav, onMount, text, ul } from '@llui/dom'
import type { Mountable, Renderable, Send, Signal } from '@llui/dom'
import { navigationMenu } from '@llui/components/navigation-menu'
import { menubar } from '@llui/components/menubar'
import { menu, type MenuItem, type MenuParts } from '@llui/components/menu'

const MENUBAR_MENUS: { id: string; label: string; items: MenuItem[] }[] = [
  {
    id: 'file',
    label: 'File',
    items: [
      { value: 'new', kind: 'action' },
      { value: 'open', kind: 'action' },
      { value: 'sep1', kind: 'separator' },
      { value: 'save', kind: 'action' },
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    items: [
      { value: 'undo', kind: 'action' },
      { value: 'redo', kind: 'action' },
      { value: 'sep2', kind: 'separator' },
      { value: 'find', kind: 'action' },
    ],
  },
  {
    id: 'view',
    label: 'View',
    items: [
      { value: 'zoom-in', kind: 'action' },
      { value: 'zoom-out', kind: 'action' },
      {
        value: 'more',
        kind: 'action',
        children: [
          { value: 'reset-zoom', kind: 'action' },
          { value: 'fit-width', kind: 'action' },
        ],
      },
    ],
  },
]

const ITEM_LABELS: Record<string, string> = {
  new: 'New File',
  open: 'Open…',
  save: 'Save',
  undo: 'Undo',
  redo: 'Redo',
  find: 'Find & Replace',
  'zoom-in': 'Zoom In',
  'zoom-out': 'Zoom Out',
  more: 'More',
  'reset-zoom': 'Reset Zoom',
  'fit-width': 'Fit Width',
}

// `Share` is a real nested submenu: it exercises the machine's per-level
// `openPath` and an engine-owned floating overlay per level.
const MENU_ITEMS: MenuItem[] = [
  { value: 'Edit', kind: 'action' },
  { value: 'Duplicate', kind: 'action' },
  {
    value: 'Share',
    kind: 'action',
    children: [
      { value: 'Email', kind: 'action' },
      { value: 'Copy Link', kind: 'action' },
    ],
  },
  { value: 'Archive', kind: 'action' },
  { value: 'Delete', kind: 'action' },
]

/** A floating menu surface's minimum inline size, as an application's own
 * menu recipe would set it. */
const MENU_SURFACE = 'min-inline-size: 8rem; padding: 0.25rem'

/** A bar trigger's padding, as an application's own recipe would set it. */
const BAR_TRIGGER = 'padding: 0.375rem 0.75rem'

export interface State {
  nav: ReturnType<typeof navigationMenu.init>
  menubar: ReturnType<typeof menubar.init>
  menu: ReturnType<typeof menu.init>
}

export type Msg =
  | { type: 'nav'; msg: Parameters<typeof navigationMenu.update>[1] }
  | { type: 'menubar'; msg: Parameters<typeof menubar.update>[1] }
  | { type: 'menu'; msg: Parameters<typeof menu.update>[1] }

export const init = (): [State, never[]] => [
  {
    nav: navigationMenu.init(),
    menubar: menubar.init({ menus: MENUBAR_MENUS.map(({ id, items }) => ({ id, items })) }),
    menu: menu.init({ items: MENU_ITEMS, open: false }),
  },
  [],
]

export function update(state: State, msg: Msg): [State, never[]] {
  switch (msg.type) {
    case 'nav':
      return [{ ...state, nav: navigationMenu.update(state.nav, msg.msg)[0] }, []]
    case 'menubar':
      return [{ ...state, menubar: menubar.update(state.menubar, msg.msg)[0] }, []]
    case 'menu':
      return [{ ...state, menu: menu.update(state.menu, msg.msg)[0] }, []]
  }
}

export function view(state: Signal<State>, send: Send<Msg>): Renderable {
  const nv = navigationMenu.connect(state.at('nav'), (m) => send({ type: 'nav', msg: m }), {
    id: 'nav-demo',
  })
  const mb = menubar.connect(state.at('menubar'), (m) => send({ type: 'menubar', msg: m }), {
    id: 'menubar-demo',
    label: 'Application menu',
  })
  const me = menu.connect(state.at('menu'), (m) => send({ type: 'menu', msg: m }), {
    id: 'menu-demo',
  })

  // ---- NavigationMenu: a `nav` landmark, a `ul`/`li` list, real links ----
  const navBranch = (id: string, label: string, links: readonly string[]): Mountable => {
    const item = nv.item(id, { isBranch: true })
    return li({ style: 'position: relative' }, [
      button({ ...item.trigger }, [text(label)]),
      div(
        {
          ...item.content,
          style: 'position: absolute; inset-block-start: 100%; inset-inline-start: 0',
        },
        [ul(links.map((link) => li([a({ href: '#' }, [text(link)])])))],
      ),
    ])
  }

  // ---- Menubar: a real subTrigger + an ENGINE-OWNED submenu overlay per
  // `children` node (`menubar.subOverlay`), recursively ----
  const renderMenubarItems = (items: MenuItem[], menuId: string, parts: MenuParts): Renderable =>
    items.flatMap((it): Renderable => {
      if (it.kind === 'separator') return [div({ ...parts.separator() }, [])]
      if (it.children !== undefined && it.children.length > 0) {
        const nested = it.children
        return [
          div({ ...parts.subTrigger(it.value) }, [text(ITEM_LABELS[it.value] ?? it.value)]),
          menubar.subOverlay({
            menuId,
            value: it.value,
            state: state.at('menubar'),
            parts,
            content: () => [
              div(
                { ...parts.subContent(it.value), style: MENU_SURFACE },
                renderMenubarItems(nested, menuId, parts),
              ),
            ],
          }),
        ]
      }
      return [div({ ...parts.item(it.value).item }, [text(ITEM_LABELS[it.value] ?? it.value)])]
    })

  // ---- Dropdown menu: the same recursion through `menu.subOverlay` ----
  const renderMenuItems = (items: MenuItem[]): Renderable =>
    items.flatMap((it): Renderable => {
      if (it.children !== undefined && it.children.length > 0) {
        const nested = it.children
        return [
          div({ ...me.subTrigger(it.value) }, [text(it.value)]),
          menu.subOverlay({
            value: it.value,
            state: state.at('menu'),
            parts: me,
            content: () => [div({ ...me.subContent(it.value) }, renderMenuItems(nested))],
          }),
        ]
      }
      return [div({ ...me.item(it.value).item }, [text(it.value)])]
    })

  return [
    nav({ ...nv.root, id: 'nav-demo', 'data-viewport': 'false', style: 'position: relative' }, [
      // The machine decides WHETHER the indicator shows; WHERE it sits is
      // layout, measured by the watcher. `onMount` hands the callback the
      // BUILD's root container, so the query is scoped by id.
      onMount((root) => {
        const el = (root as HTMLElement).querySelector('#nav-demo')
        return el instanceof HTMLElement ? navigationMenu.watchNavMenuIndicator(el) : undefined
      }),
      // A discarded Mountable is inert: the direction sync must be PLACED.
      nv.directionSync,
      ul({ style: 'display: flex; gap: 0.25rem; list-style: none; margin: 0; padding: 0' }, [
        navBranch('file', 'File', ['New File', 'Open...', 'Save']),
        navBranch('edit', 'Edit', ['Undo', 'Redo', 'Find & Replace']),
        li([button({ ...nv.item('help', { isBranch: false }).trigger }, [text('Help')])]),
      ]),
      div({ ...nv.indicator }, []),
    ]),
    mb.directionSync,
    div(
      { ...mb.root, style: 'display: flex; gap: 0.25rem' },
      MENUBAR_MENUS.map((m) =>
        button({ ...mb.menuTrigger(m.id), style: BAR_TRIGGER }, [text(m.label)]),
      ),
    ),
    ...MENUBAR_MENUS.map((m) => {
      const menuParts = mb.menu(m.id)
      return menubar.overlay({
        state: state.at('menubar'),
        send: (msg) => send({ type: 'menubar', msg }),
        menuId: m.id,
        parts: menuParts,
        content: () => [
          div(
            { ...menuParts.content, style: MENU_SURFACE },
            renderMenubarItems(m.items, m.id, menuParts),
          ),
        ],
      })
    }),
    me.directionSync,
    button({ ...me.trigger, class: 'btn btn-secondary' }, [text('Actions')]),
    menu.overlay({
      state: state.at('menu'),
      send: (m) => send({ type: 'menu', msg: m }),
      parts: me,
      content: () => [div({ ...me.content }, renderMenuItems(MENU_ITEMS))],
    }),
  ]
}

export const MenusComposition = component<State, Msg, never>({
  name: 'BaselineMenusComposition',
  init,
  update,
  view: ({ state, send }) => view(state, send),
})
