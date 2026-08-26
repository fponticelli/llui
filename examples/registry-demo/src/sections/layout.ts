import { div, span, text, type Mountable, type Send, type Signal } from '@llui/dom'
import * as collapsibleC from '@llui/components/collapsible'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInner,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from '../components/ui/sidebar'
import { buttonVariants } from '../components/ui/button'
import { FolderIcon, LayoutDashboardIcon, SettingsIcon } from '../components/ui/icons'
import { section } from './shared'

export interface State {
  open: collapsibleC.CollapsibleState
}
export type Msg = { type: 'sidebar'; msg: collapsibleC.CollapsibleMsg }

export const init = (): [State, never[]] => [{ open: collapsibleC.init({ open: true }) }, []]

export function update(state: State, msg: Msg): [State, never[]] {
  return [{ ...state, open: collapsibleC.update(state.open, msg.msg)[0] }, []]
}

// The icon is not decoration: collapsed to the rail the button is `size-8` with
// `overflow-hidden`, so a text-only item renders as a clipped word. Upstream's
// `[&>span:last-child]:truncate` clips the label AROUND an icon.
const NAV = [
  { label: 'Dashboard', icon: LayoutDashboardIcon, badge: null },
  { label: 'Projects', icon: FolderIcon, badge: '12' },
  { label: 'Settings', icon: SettingsIcon, badge: null },
] as const

export function view(state: Signal<State>, send: Send<Msg>): readonly Mountable[] {
  const c = collapsibleC.connect(state.at('open'), (m) => send({ type: 'sidebar', msg: m }), {
    id: 'demo-sidebar',
  })
  // The sidebar ships NO state of its own — its presentation is driven by four
  // attributes on the root. Here they come from a `collapsible` slice, which is
  // the point: the open flag lives with the rest of the app's state rather than
  // in a component-local context.
  const open = state.at('open').at('open')

  return [
    section(
      'Sidebar',
      'Presentation only — `data-state`, `data-collapsible`, `data-variant` and `data-side` on the root drive every descendant through the group/peer names. The open flag is an ordinary slice of app state.',
      [
        div({ class: 'h-72 overflow-hidden rounded-lg border' }, [
          // The real Sidebar positions its panel `fixed` and reserves space with
          // a sibling gap — a whole-PAGE contract that cannot be honoured inside
          // a bounded demo box. The width is therefore driven by
          // `--sidebar-width`, which is shadcn's own escape hatch (it sets these
          // inline on the provider) and is what every `w-(--sidebar-width)` in
          // the recipes reads. The collapse below is real, not simulated.
          //
          // A warning for whoever measures this next, because it cost hours: a
          // Chrome tab whose `document.visibilityState` is `'hidden'` PAUSES CSS
          // transitions, and `getComputedStyle` there returns the value the
          // property is STUCK at rather than the one the cascade says it should
          // have. Measured that way this panel looked like it ignored `width`
          // outright — 224px in both states, while the custom property and every
          // `data-` attribute updated correctly — and `min-w-0`, switching to
          // `basis-`, and dropping the transition each looked like the fix.
          // None of it was real: with nothing mid-flight, the plain
          // `w-(--sidebar-width)` below goes 224px ↔ 48px and `min-w-0` changes
          // nothing. Before believing ANY computed-style result about an
          // animated property, check `document.visibilityState` and transition a
          // scratch element between two literal colours — a plain red→blue
          // transition freezes at red in a hidden tab, which is the two-line
          // probe that settles it.
          SidebarProvider(
            {
              class: 'h-full min-h-0',
              'style.--sidebar-width': open.map((o) => (o ? '14rem' : '3rem')),
            },
            [
              Sidebar(
                {
                  'data-state': open.map((o) => (o ? 'expanded' : 'collapsed')),
                  'data-collapsible': open.map((o) => (o ? '' : 'icon')),
                  'data-variant': 'sidebar',
                  'data-side': 'left',
                  class:
                    'block w-(--sidebar-width) shrink-0 overflow-hidden transition-[width] duration-200',
                },
                [
                  SidebarInner({ class: 'border-r' }, [
                    SidebarHeader([
                      div(
                        {
                          class:
                            'truncate px-2 text-sm font-semibold group-data-[collapsible=icon]:hidden',
                        },
                        [text('Acme Inc')],
                      ),
                    ]),
                    SidebarSeparator(),
                    SidebarContent([
                      SidebarGroup([
                        SidebarGroupLabel([text('Platform')]),
                        SidebarMenu(
                          NAV.map((item) =>
                            SidebarMenuItem([
                              // `data-size` is not decoration: the badge positions
                              // itself from `peer-data-[size=…]/menu-button:top-…`,
                              // so without it it falls to its static position.
                              SidebarMenuButton(
                                {
                                  'data-size': 'default',
                                  'data-active': item.label === 'Projects' ? 'true' : undefined,
                                },
                                [item.icon(), span({ class: 'truncate' }, [text(item.label)])],
                              ),
                              ...(item.badge !== null
                                ? [SidebarMenuBadge([text(item.badge)])]
                                : []),
                            ]),
                          ),
                        ),
                        SidebarMenuSub([
                          SidebarMenuSubItem([
                            SidebarMenuSubButton({ href: '#', 'data-active': 'true' }, [
                              text('Overview'),
                            ]),
                          ]),
                          SidebarMenuSubItem([
                            SidebarMenuSubButton({ href: '#' }, [text('Activity')]),
                          ]),
                        ]),
                      ]),
                    ]),
                    SidebarFooter([
                      div(
                        {
                          class:
                            'truncate px-2 text-xs text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden',
                        },
                        [text('v0.15.0')],
                      ),
                    ]),
                  ]),
                ],
              ),
              SidebarInset({ class: 'p-4' }, [
                div({ class: 'flex items-center gap-3' }, [
                  // `SidebarTrigger` IS a <button>; borrow the Button's look via
                  // `buttonVariants` rather than nesting one inside it. `w-auto`
                  // because the trigger defaults to shadcn's `size-7` icon square,
                  // whose WIDTH would otherwise clip a text label.
                  SidebarTrigger(
                    {
                      ...c.trigger,
                      class: `${buttonVariants({ variant: 'outline', size: 'sm' })} w-auto`,
                    },
                    [text('Toggle')],
                  ),
                  span({ class: 'text-sm text-muted-foreground' }, [
                    text('Collapses to the icon rail.'),
                  ]),
                ]),
              ]),
            ],
          ),
        ]),
      ],
    ),
  ]
}
