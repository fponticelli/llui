import { a, button, div, each, li, nav, span, text, ul } from '@llui/dom'
import type { Mountable, Send, Signal } from '@llui/dom'
import * as contextMenuC from '@llui/components/context-menu'
import * as menubarC from '@llui/components/menubar'
import * as navMenuC from '@llui/components/navigation-menu'
import * as commandMenuC from '@llui/components/patterns/command-menu'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from '../components/ui/context-menu'
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from '../components/ui/menubar'
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuIndicator,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from '../components/ui/navigation-menu'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandInputWrapper,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '../components/ui/command'
import { ChevronDownIcon } from '../components/ui/icons'
import { section } from './shared'

const CONTEXT_ITEMS = [
  { value: 'back', label: 'Back', shortcut: '⌘[' },
  { value: 'forward', label: 'Forward', shortcut: '⌘]' },
  { value: 'reload', label: 'Reload', shortcut: '⌘R' },
]

const MENUBAR_MENUS = [
  {
    id: 'file',
    label: 'File',
    items: [
      { value: 'new', label: 'New Tab', shortcut: '⌘T' },
      { value: 'open', label: 'Open…', shortcut: '⌘O' },
      { value: 'print', label: 'Print', shortcut: '⌘P' },
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    items: [
      { value: 'undo', label: 'Undo', shortcut: '⌘Z' },
      { value: 'redo', label: 'Redo', shortcut: '⇧⌘Z' },
    ],
  },
] as const

const NAV_ITEMS = [
  {
    id: 'docs',
    label: 'Docs',
    links: [
      { label: 'Getting Started', blurb: 'Install, scaffold, first component.' },
      { label: 'Architecture', blurb: 'Build-once views and the chunked mask.' },
    ],
  },
  {
    id: 'components',
    label: 'Components',
    links: [
      { label: 'Registry', blurb: 'Copy shadcn recipes into your own tree.' },
      { label: 'Headless', blurb: 'The machines the recipes are painted onto.' },
    ],
  },
] as const

const COMMANDS: commandMenuC.Command[] = [
  { id: 'new-file', label: 'New File', group: 'File', shortcut: '⌘N' },
  { id: 'open-file', label: 'Open File…', group: 'File', keywords: ['find'], shortcut: '⌘O' },
  { id: 'toggle-theme', label: 'Toggle Theme', group: 'View', keywords: ['dark', 'light'] },
  { id: 'go-to-line', label: 'Go to Line…', group: 'Navigate', shortcut: '⌃G' },
]

export interface State {
  context: contextMenuC.ContextMenuState
  menubar: menubarC.MenubarState
  navMenu: navMenuC.NavMenuState
  palette: commandMenuC.CommandMenuState
  /** What the palette last executed — the demo's stand-in for a real side
   * effect, so the `execute` effect is visibly consumed rather than dropped. */
  lastCommand: string | null
}

export type Msg =
  | { type: 'context'; msg: contextMenuC.ContextMenuMsg }
  | { type: 'menubar'; msg: menubarC.MenubarMsg }
  | { type: 'navMenu'; msg: navMenuC.NavMenuMsg }
  | { type: 'palette'; msg: commandMenuC.CommandMenuMsg }

export const init = (): [State, never[]] => [
  {
    context: contextMenuC.init({
      items: CONTEXT_ITEMS.map((i) => ({ value: i.value, kind: 'action' as const })),
    }),
    menubar: menubarC.init({
      menus: MENUBAR_MENUS.map((m) => ({
        id: m.id,
        items: m.items.map((i) => ({ value: i.value, kind: 'action' as const })),
      })),
    }),
    navMenu: navMenuC.init({
      // `items` is the roving tab stop's candidate list in DOCUMENT order. Only
      // the top-level triggers are candidates here: the panel links are real
      // `<a>`s and take their own place in the tab order.
      items: NAV_ITEMS.map((n) => n.id),
    }),
    palette: commandMenuC.init({ commands: COMMANDS, open: true }),
    lastCommand: null,
  },
  [],
]

export function update(state: State, msg: Msg): [State, never[]] {
  switch (msg.type) {
    case 'context':
      return [{ ...state, context: contextMenuC.update(state.context, msg.msg)[0] }, []]
    case 'menubar':
      return [{ ...state, menubar: menubarC.update(state.menubar, msg.msg)[0] }, []]
    case 'navMenu':
      return [{ ...state, navMenu: navMenuC.update(state.navMenu, msg.msg)[0] }, []]
    case 'palette': {
      const [palette, effects] = commandMenuC.update(state.palette, msg.msg)
      // The machine never performs IO — `execute` is data, and running it is the
      // consumer's job. This demo has no app-level effect channel, so it is
      // consumed right here into state rather than emitted and dropped.
      const ran = effects.find((e) => e.type === 'execute')
      return [
        {
          ...state,
          // The palette is a permanently-open panel in this page rather than a
          // ⌘K dialog, so an executed command must not close it — there is no
          // trigger on the page to reopen it from.
          palette: { ...palette, open: true },
          lastCommand:
            ran === undefined
              ? state.lastCommand
              : (COMMANDS.find((c) => c.id === ran.commandId)?.label ?? ran.commandId),
        },
        [],
      ]
    }
  }
}

export function view(state: Signal<State>, send: Send<Msg>): readonly Mountable[] {
  const ctxSend = (m: contextMenuC.ContextMenuMsg): void => send({ type: 'context', msg: m })
  const barSend = (m: menubarC.MenubarMsg): void => send({ type: 'menubar', msg: m })
  const navSend = (m: navMenuC.NavMenuMsg): void => send({ type: 'navMenu', msg: m })
  const palSend = (m: commandMenuC.CommandMenuMsg): void => send({ type: 'palette', msg: m })

  const ctx = contextMenuC.connect(state.at('context'), ctxSend, { id: 'demo-context' })
  const bar = menubarC.connect(state.at('menubar'), barSend, { id: 'demo-menubar' })
  const navm = navMenuC.connect(state.at('navMenu'), navSend, { id: 'demo-nav' })
  const pal = commandMenuC.connect(state.at('palette'), palSend, { id: 'demo-palette' })

  return [
    section(
      'Context Menu',
      'Right-click the surface. The menu is pointer-positioned, so it has no anchor — its nested-layer owner is the region that delivered the `contextmenu` event.',
      [
        div(
          {
            ...ctx.trigger,
            class:
              'grid h-24 place-items-center rounded-md border border-dashed text-sm text-muted-foreground',
          },
          [text('Right-click here')],
        ),
      ],
    ),
    contextMenuC.overlay({
      state: state.at('context'),
      send: ctxSend,
      parts: ctx,
      positionerClass: 'z-popover',
      content: () => [
        ContextMenuContent({ ...ctx.content }, [
          ...CONTEXT_ITEMS.map((i, index) => [
            ContextMenuItem({ ...ctx.item(i.value).item }, [
              text(i.label),
              ContextMenuShortcut([text(i.shortcut)]),
            ]),
            ...(index === 1 ? [ContextMenuSeparator({ ...ctx.separator() })] : []),
          ]).flat(),
        ]),
      ],
    }),

    section(
      'Menubar',
      'One machine owns the bar AND every dropped menu — `menu(id)` delegates a full menu bag per entry, so arrow keys walk between menus with one open.',
      [
        Menubar({ ...bar.root }, [
          ...MENUBAR_MENUS.map((m) =>
            MenubarTrigger({ ...bar.menuTrigger(m.id) }, [text(m.label)]),
          ),
        ]),
      ],
    ),
    ...MENUBAR_MENUS.map((m) => {
      const menu = bar.menu(m.id)
      return menubarC.overlay({
        state: state.at('menubar'),
        send: barSend,
        menuId: m.id,
        parts: menu,
        positionerClass: 'z-popover',
        content: () => [
          MenubarContent({ ...menu.content }, [
            ...m.items
              .map((i, index) => [
                MenubarItem({ ...menu.item(i.value).item }, [
                  text(i.label),
                  MenubarShortcut([text(i.shortcut)]),
                ]),
                ...(index === 0 && m.items.length > 2
                  ? [MenubarSeparator({ ...menu.separator() })]
                  : []),
              ])
              .flat(),
          ]),
        ],
      })
    }),

    section(
      'Navigation Menu',
      'A `nav` landmark with disclosure buttons — NOT menubar/menu roles, because site navigation is not an application menu. Panels render inline, so the root sets `data-viewport="false"`.',
      [
        NavigationMenu({ 'data-viewport': 'false', class: 'w-full max-w-none justify-start' }, [
          nav({ ...navm.root }, [
            NavigationMenuList({ class: 'justify-start' }, [
              ...NAV_ITEMS.map((n) => {
                const item = navm.item(n.id, { isBranch: true })
                return li({ class: 'relative' }, [
                  NavigationMenuTrigger({ ...item.trigger }, [
                    text(n.label),
                    NavigationMenuIndicator([ChevronDownIcon({ class: 'size-3' })]),
                  ]),
                  NavigationMenuContent({ ...item.content, class: 'md:w-[22rem]' }, [
                    ul({ class: 'grid gap-1' }, [
                      ...n.links.map((l) =>
                        li([
                          NavigationMenuLink({ href: '#' }, [
                            span({ class: 'font-medium' }, [text(l.label)]),
                            span({ class: 'text-muted-foreground' }, [text(l.blurb)]),
                          ]),
                        ]),
                      ),
                    ]),
                  ]),
                ])
              }),
            ]),
          ]),
        ]),
      ],
    ),

    section(
      'Command',
      "shadcn wraps `cmdk`; this is `@llui/components/patterns/command-menu`, which filters, ranks recents to the top and emits `execute` as DATA — running it is the consumer's job. Shown inline rather than in its ⌘K dialog.",
      [
        Command({ class: 'rounded-md border' }, [
          CommandInputWrapper([
            CommandInput({ ...pal.combobox.input, placeholder: 'Type a command…' }),
          ]),
          CommandList({ ...pal.combobox.content }, [
            each(state.at('palette').at('filteredGroups'), {
              key: (g: commandMenuC.CommandGroup) => g.label,
              render: (g: Signal<commandMenuC.CommandGroup>) => {
                const group = g.peek()
                return [
                  CommandGroup([
                    CommandGroupLabel([text(group.label === '' ? 'Other' : group.label)]),
                    ...group.commands.map((c) =>
                      CommandItem({ ...pal.combobox.item(c.id).item }, [
                        text(c.label),
                        ...(c.shortcut === undefined ? [] : [CommandShortcut([text(c.shortcut)])]),
                      ]),
                    ),
                  ]),
                ]
              },
            }),
            // The part publishes `data-empty` but does NOT hide itself, so the
            // empty state is the consumer's to toggle — and left untoggled it
            // reads "No commands found." above a full list. Toggled in CSS
            // rather than with `show`, because `role="status"` is a live region
            // and unmounting/remounting one does not announce reliably.
            CommandEmpty({ ...pal.empty, class: 'hidden data-empty:block' }, [
              text('No commands found.'),
            ]),
          ]),
        ]),
        div({ class: 'text-xs text-muted-foreground' }, [
          text('Last run: '),
          span({ class: 'font-medium text-foreground' }, [
            text(state.at('lastCommand').map((c) => c ?? '—')),
          ]),
        ]),
      ],
    ),
  ]
}
