import { div, each, li, nav, show, span, text, ul } from '@llui/dom'
import type { Mountable, Send, Signal } from '@llui/dom'
import * as contextMenuC from '@llui/components/context-menu'
import * as menubarC from '@llui/components/menubar'
import * as navMenuC from '@llui/components/navigation-menu'
import * as commandMenuC from '@llui/components/patterns/command-menu'
import * as comboboxC from '@llui/components/combobox'
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
  CommandItem,
  CommandList,
  CommandShortcut,
} from '../components/ui/command'
import {
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxItem,
  ComboboxList,
  ComboboxLiveRegion,
  ComboboxTrigger,
} from '../components/ui/combobox'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
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

const FRAMEWORKS = ['LLui', 'Svelte', 'Solid', 'Qwik', 'Lit', 'Vue']

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
  combobox: comboboxC.ComboboxState
  /** What the palette last executed — the demo's stand-in for a real side
   * effect, so the `execute` effect is visibly consumed rather than dropped. */
  lastCommand: string | null
}

export type Msg =
  | { type: 'context'; msg: contextMenuC.ContextMenuMsg }
  | { type: 'menubar'; msg: menubarC.MenubarMsg }
  | { type: 'navMenu'; msg: navMenuC.NavMenuMsg }
  | { type: 'palette'; msg: commandMenuC.CommandMenuMsg }
  | { type: 'combobox'; msg: comboboxC.ComboboxMsg }

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
    combobox: comboboxC.init({ items: FRAMEWORKS }),
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
    case 'combobox':
      return [{ ...state, combobox: comboboxC.update(state.combobox, msg.msg)[0] }, []]
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
  const cbSend = (m: comboboxC.ComboboxMsg): void => send({ type: 'combobox', msg: m })
  const cb = comboboxC.connect(state.at('combobox'), cbSend, { id: 'demo-combobox' })
  const { text: liveText, ...liveAttrs } = cb.liveRegion

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
      'Combobox',
      'shadcn ships no `combobox.tsx` — its docs compose Popover + Command, so these ARE the Command recipes under Combobox names. The listbox is never focused: the input keeps focus and drives the highlight through `aria-activedescendant`.',
      [
        // A plain `div`, NOT `ComboboxRoot`. That recipe is `Command` — a full
        // palette SURFACE (`h-full w-full flex-col overflow-hidden rounded-md
        // bg-popover`) meant for the dropdown panel, not for a labelled field.
        // Its `overflow-hidden` CLIPS the input's focus ring on three sides:
        // the input's bottom edge coincides with the wrapper's, so left, right
        // and bottom are cut and only the segment above the input survives —
        // rendering as a thick dark band along the top of the field whenever it
        // is focused, which is always, since the control is driven by typing.
        // It is a clip, not a border, which is why chasing borders and offsets
        // twice found nothing.
        div({ ...cb.root, class: 'max-w-xs' }, [
          Label({ for: cb.input.id, class: 'mb-1.5 block' }, [text('Framework')]),
          // The trigger is `absolute top-0 right-0`, so it anchors to the
          // nearest positioned ancestor — which must be a box containing ONLY
          // the input. Making the whole root `relative` (label included) floats
          // the chevron up beside the label instead of into the field.
          div({ class: 'relative' }, [
            Input({ ...cb.input, placeholder: 'Search frameworks…', class: 'pr-9' }),
            ComboboxTrigger({ ...cb.trigger }, [ChevronDownIcon({ class: 'size-4' })]),
          ]),
          // Announces the result count as the query changes. Without it a
          // screen-reader user gets no feedback that typing did anything.
          //
          // `liveRegion.text` is a Signal for the region's CHILD, not an
          // attribute — spreading the whole bag emits a literal `text="…"`
          // attribute and announces nothing, which is the failure this shape
          // avoids.
          ComboboxLiveRegion({ ...liveAttrs }, [text(liveText)]),
        ]),
      ],
    ),
    comboboxC.overlay({
      state: state.at('combobox'),
      send: cbSend,
      parts: cb,
      positionerClass: 'z-popover',
      // The default 4px offset collides with the input's FOCUS RING. The ring is
      // `ring-[3px]` and draws OUTSIDE the border, so at 4px it stops 1px short
      // of the panel's own 1px border: field and list merge into one thick fuzzy
      // band along the top of the list, visible only while the input is focused
      // — which is always, since this combobox is driven by typing.
      //
      // shadcn never meets this because its Combobox puts the input INSIDE the
      // popover, so there is one surface and one ring. Here the input must stay
      // outside (the machine keeps focus on it and anchors the list to it), so
      // the gap has to clear the ring instead.
      offset: 10,
      content: () => [
        ComboboxContent({ ...cb.content }, [
          ComboboxList([
            // The `p-1` GROUP wrapper is not optional padding. `ComboboxList`
            // has no padding of its own, so items rendered straight into it sit
            // flush against the panel's border — and a highlighted first item's
            // `bg-accent` block then merges with the 1px top border into one
            // thick dark edge. That is the "heavy top border" this looked like,
            // not the focus ring. shadcn never shows it because every item in
            // its Command lives inside a `CommandGroup`, which is exactly this
            // recipe under another name.
            ComboboxGroup([
              each(state.at('combobox').at('filteredItems'), {
                key: (v: string) => v,
                render: (v: Signal<string>) => {
                  const value = v.peek()
                  return [ComboboxItem({ ...cb.item(value).item }, [text(value)])]
                },
              }),
            ]),
          ]),
          // Same asymmetry as the palette, the other way round: `combobox`'s
          // `empty` part is a bare marker with NO state, so it is toggled from
          // the filtered list rather than from a `data-empty` flag.
          show(
            state
              .at('combobox')
              .at('filteredItems')
              .map((f) => f.length === 0),
            () => [ComboboxEmpty({ ...cb.empty }, [text('No framework found.')])],
          ),
        ]),
      ],
    }),

    section(
      'Command',
      "shadcn wraps `cmdk`; this is `@llui/components/patterns/command-menu`, which filters, ranks recents to the top and emits `execute` as DATA — running it is the consumer's job. Shown inline rather than in its ⌘K dialog.",
      [
        Command({ class: 'rounded-md border' }, [
          CommandInput({ ...pal.combobox.input, placeholder: 'Type a command…' }),
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
