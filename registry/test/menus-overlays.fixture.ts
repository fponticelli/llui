import { component, div, mountApp, text, type Mountable } from '@llui/dom'
import {
  AlertDialogBackdrop,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitleText,
} from '../llui/ui/alert-dialog'
import { ComboboxContent, ComboboxItem, ComboboxTrigger } from '../llui/ui/combobox'
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '../llui/ui/command'
import {
  ContextMenuContent,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '../llui/ui/context-menu'
import { DialogBackdrop, DialogClose, DialogContent, DialogHeader } from '../llui/ui/dialog'
import {
  DrawerBackdrop,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '../llui/ui/drawer'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemIndicator,
  DropdownMenuShortcut,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '../llui/ui/dropdown-menu'
import { HoverCardArrow, HoverCardContent } from '../llui/ui/hover-card'
import {
  Menubar,
  MenubarContent,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from '../llui/ui/menubar'
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuIndicator,
  NavigationMenuIndicatorArrow,
  NavigationMenuIndicatorTrack,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  NavigationMenuViewport,
  NavigationMenuViewportPositioner,
} from '../llui/ui/navigation-menu'
import { PopoverArrow, PopoverContent } from '../llui/ui/popover'
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectTrigger,
  SelectValue,
} from '../llui/ui/select'
import { SheetBackdrop, SheetClose, SheetContent } from '../llui/ui/sheet'
import { Toast, ToastClose, ToastDescription, ToastRegion, ToastTitle } from '../llui/ui/sonner'
import { Toolbar, ToolbarGroup, ToolbarGroupLabel, ToolbarSeparator } from '../llui/ui/toolbar'
import { TooltipArrow, TooltipContent } from '../llui/ui/tooltip'
import type {
  MenusOverlaysCaseInput,
  MenusOverlaysScenario,
  MenusOverlaysScenarioCase,
  MenusOverlaysScenarioId,
} from '../../scripts/lib/menus-overlays-scenarios'

/**
 * Renderer bindings only. ProductContract supplies the authoritative inventory
 * and order; the test rejects either a missing binding or a parallel extra.
 */
type RegistryRenderer = (
  scenario: MenusOverlaysScenario,
  scenarioCase: MenusOverlaysScenarioCase,
) => Mountable

export const registryMenusOverlaysRenderers = {
  'component:alert-dialog': (_scenario, scenarioCase) =>
    div([
      AlertDialogBackdrop(stateProps(scenarioCase.input, 'alert-dialog-backdrop')),
      AlertDialogContent(stateProps(scenarioCase.input, 'alert-dialog-content'), [
        AlertDialogHeader({ id: 'registry-alert-dialog-header' }, [
          AlertDialogTitleText({ id: 'registry-alert-dialog-header-label', class: 'w-full' }, [
            text(scenarioCase.input.content.label),
          ]),
        ]),
        ...semanticCopy(scenarioCase.input),
      ]),
    ]),
  'component:combobox': (_scenario, scenarioCase) =>
    div([
      ComboboxTrigger({ id: 'registry-combobox-trigger' }),
      ComboboxContent(
        {
          ...stateProps(scenarioCase.input, 'combobox-content'),
          'data-side': scenarioCase.input.side ?? 'bottom',
          'data-status': scenarioCase.input.asyncStatus ?? 'idle',
          'aria-busy': scenarioCase.input.asyncStatus === 'loading' ? 'true' : undefined,
        },
        [
          ...semanticCopy(scenarioCase.input),
          ...selectionItems(scenarioCase.input, 'combobox'),
          ...asyncFeedback(scenarioCase.input, 'combobox'),
        ],
      ),
    ]),
  'pattern:command-menu': (_scenario, scenarioCase) =>
    Command(
      {
        id: 'registry-command-surface',
        'data-state': presence(scenarioCase.input),
        role: 'dialog',
        'aria-modal': String(scenarioCase.input.modal),
      },
      [
        CommandList({ id: 'registry-command-list' }, [
          ...semanticCopy(scenarioCase.input),
          CommandGroup([
            ...(scenarioCase.input.items?.highlighted
              ? [
                  CommandItem({ id: 'registry-command-highlighted', 'data-highlighted': '' }, [
                    text(stateLabel(scenarioCase.input, 'highlighted')),
                    CommandShortcut({ id: 'registry-command-shortcut' }, [text('⌘K')]),
                  ]),
                ]
              : []),
            ...(scenarioCase.input.items?.disabled
              ? [
                  CommandItem({ id: 'registry-command-disabled', 'data-disabled': '' }, [
                    text(stateLabel(scenarioCase.input, 'disabled')),
                  ]),
                ]
              : []),
            ...asyncFeedback(scenarioCase.input, 'command'),
          ]),
        ]),
      ],
    ),
  'pattern:confirm-dialog': (_scenario, scenarioCase) =>
    DialogContent(
      {
        ...stateProps(scenarioCase.input, 'confirm-dialog-content'),
        role: 'alertdialog',
        'aria-modal': String(scenarioCase.input.modal),
      },
      [
        ...semanticCopy(scenarioCase.input),
        ...(scenarioCase.input.items?.destructive
          ? [
              div({ id: 'registry-confirm-dialog-destructive', 'data-variant': 'destructive' }, [
                text(stateLabel(scenarioCase.input, 'destructive')),
              ]),
            ]
          : []),
      ],
    ),
  'component:context-menu': (_scenario, scenarioCase) =>
    ContextMenuContent(
      {
        ...stateProps(scenarioCase.input, 'context-menu-content'),
        'data-side': scenarioCase.input.side ?? 'bottom',
      },
      [
        ...semanticCopy(scenarioCase.input),
        ...menuItems(scenarioCase.input, 'context-menu'),
        ...(scenarioCase.input.items?.nested
          ? [
              ContextMenuSubTrigger(
                {
                  id: 'registry-context-menu-subtrigger',
                  role: 'menuitem',
                  'aria-haspopup': 'menu',
                },
                [text(stateLabel(scenarioCase.input, 'nested'))],
              ),
              ContextMenuSubContent(
                {
                  ...stateProps(scenarioCase.input, 'context-menu-subcontent'),
                  'data-side': scenarioCase.input.side ?? 'bottom',
                  role: 'menu',
                },
                [text(scenarioCase.input.content.detail)],
              ),
            ]
          : []),
      ],
    ),
  'component:dialog': (_scenario, scenarioCase) =>
    div([
      DialogBackdrop(stateProps(scenarioCase.input, 'dialog-backdrop')),
      DialogContent(
        {
          ...stateProps(scenarioCase.input, 'dialog-content'),
          role: 'dialog',
          'aria-modal': String(scenarioCase.input.modal),
        },
        [
          DialogHeader({ id: 'registry-dialog-header' }, [
            div({ id: 'registry-dialog-header-label', class: 'w-full' }, [
              text(scenarioCase.input.content.label),
            ]),
          ]),
          ...semanticCopy(scenarioCase.input),
          DialogClose({ id: 'registry-dialog-close', 'aria-label': 'Close' }),
        ],
      ),
    ]),
  'component:drawer': (_scenario, scenarioCase) =>
    div([
      DrawerBackdrop(stateProps(scenarioCase.input, 'drawer-backdrop')),
      DrawerContent(
        {
          ...stateProps(scenarioCase.input, 'drawer-content'),
          'data-side': scenarioCase.input.edge ?? 'right',
        },
        [
          DrawerHeader({ id: 'registry-drawer-header' }, [
            DrawerTitle({ id: 'registry-drawer-header-label', class: 'w-full' }, [
              text(scenarioCase.input.content.label),
            ]),
            DrawerDescription([text(scenarioCase.input.content.detail)]),
          ]),
          ...semanticCopy(scenarioCase.input),
          DrawerClose({ id: 'registry-drawer-close', 'aria-label': 'Close' }),
        ],
      ),
      SheetBackdrop(stateProps(scenarioCase.input, 'sheet-backdrop')),
      SheetContent(
        {
          ...stateProps(scenarioCase.input, 'sheet-content'),
          'data-side': scenarioCase.input.edge ?? 'right',
        },
        [
          ...semanticCopy(scenarioCase.input),
          SheetClose({ id: 'registry-sheet-close', 'aria-label': 'Close' }),
        ],
      ),
    ]),
  'component:hover-card': (_scenario, scenarioCase) =>
    HoverCardContent(
      {
        ...stateProps(scenarioCase.input, 'hover-card-content'),
        'data-side': scenarioCase.input.side ?? 'bottom',
      },
      [...semanticCopy(scenarioCase.input), HoverCardArrow({ id: 'registry-hover-card-arrow' })],
    ),
  'component:menu': (_scenario, scenarioCase) =>
    DropdownMenuContent(
      {
        ...stateProps(scenarioCase.input, 'menu-content'),
        'data-side': scenarioCase.input.side ?? 'bottom',
      },
      [
        ...semanticCopy(scenarioCase.input),
        ...menuItems(scenarioCase.input, 'menu'),
        ...(scenarioCase.input.items?.nested
          ? [
              DropdownMenuSubTrigger(
                { id: 'registry-menu-subtrigger', role: 'menuitem', 'aria-haspopup': 'menu' },
                [text(stateLabel(scenarioCase.input, 'nested'))],
              ),
              DropdownMenuSubContent(
                {
                  ...stateProps(scenarioCase.input, 'menu-subcontent'),
                  'data-side': scenarioCase.input.side ?? 'bottom',
                  role: 'menu',
                },
                [DropdownMenuItem([text(scenarioCase.input.content.detail)])],
              ),
            ]
          : []),
      ],
    ),
  'component:menubar': (_scenario, scenarioCase) =>
    Menubar({ id: 'registry-menubar' }, [
      MenubarTrigger({ id: 'registry-menubar-trigger', 'data-highlighted': '' }, [
        text(scenarioCase.input.content.label),
      ]),
      MenubarContent(
        {
          ...stateProps(scenarioCase.input, 'menubar-content'),
          'data-side': scenarioCase.input.side ?? 'bottom',
        },
        [
          ...semanticCopy(scenarioCase.input),
          ...menuItems(scenarioCase.input, 'menubar'),
          ...(scenarioCase.input.items?.nested
            ? [
                MenubarSubTrigger(
                  {
                    id: 'registry-menubar-subtrigger',
                    role: 'menuitem',
                    'aria-haspopup': 'menu',
                  },
                  [text(stateLabel(scenarioCase.input, 'nested'))],
                ),
                MenubarSubContent(
                  {
                    ...stateProps(scenarioCase.input, 'menubar-subcontent'),
                    'data-side': scenarioCase.input.side ?? 'bottom',
                    role: 'menu',
                  },
                  [text(scenarioCase.input.content.detail)],
                ),
              ]
            : []),
        ],
      ),
    ]),
  'component:navigation-menu': (_scenario, scenarioCase) =>
    NavigationMenu(
      {
        id: 'registry-navigation-menu',
        'data-viewport': 'false',
        'aria-label': scenarioCase.input.content.label,
      },
      [
        NavigationMenuList([
          NavigationMenuTrigger(
            { id: 'registry-navigation-trigger', 'data-state': presence(scenarioCase.input) },
            [text(scenarioCase.input.content.label)],
          ),
          NavigationMenuContent(stateProps(scenarioCase.input, 'navigation-content'), [
            ...semanticCopy(scenarioCase.input),
            ...(scenarioCase.input.items?.selected
              ? [
                  NavigationMenuLink({ id: 'registry-navigation-link', 'data-active': 'true' }, [
                    text(stateLabel(scenarioCase.input, 'selected')),
                  ]),
                ]
              : []),
            ...(scenarioCase.input.items?.nested
              ? [
                  NavigationMenuLink({ id: 'registry-navigation-nested', href: '#' }, [
                    text(stateLabel(scenarioCase.input, 'nested')),
                  ]),
                ]
              : []),
          ]),
        ]),
        NavigationMenuIndicator([
          NavigationMenuIndicatorTrack(
            {
              id: 'registry-nav-indicator-track',
              'data-state': presence(scenarioCase.input) === 'open' ? 'visible' : 'hidden',
            },
            [NavigationMenuIndicatorArrow()],
          ),
        ]),
        NavigationMenuViewportPositioner([
          NavigationMenuViewport(stateProps(scenarioCase.input, 'navigation-viewport'), [
            ...semanticCopy(scenarioCase.input),
          ]),
        ]),
      ],
    ),
  'component:popover': (_scenario, scenarioCase) =>
    PopoverContent(
      {
        ...stateProps(scenarioCase.input, 'popover-content'),
        'data-side': scenarioCase.input.side ?? 'bottom',
      },
      [...semanticCopy(scenarioCase.input), PopoverArrow({ id: 'registry-popover-arrow' })],
    ),
  'pattern:searchable-select': (_scenario, scenarioCase) =>
    PopoverContent(
      {
        ...stateProps(scenarioCase.input, 'searchable-select-content'),
        'data-side': scenarioCase.input.side ?? 'bottom',
        'data-status': scenarioCase.input.asyncStatus ?? 'idle',
        'aria-busy': scenarioCase.input.asyncStatus === 'loading' ? 'true' : undefined,
      },
      [
        ...semanticCopy(scenarioCase.input),
        Command([
          CommandList({ id: 'registry-searchable-list' }, [
            ...selectionItems(scenarioCase.input, 'searchable-select'),
            ...asyncFeedback(scenarioCase.input, 'searchable-select'),
          ]),
        ]),
      ],
    ),
  'component:select': (_scenario, scenarioCase) =>
    div([
      SelectTrigger({ id: 'registry-select-trigger' }, [
        SelectValue([text(scenarioCase.input.content.label)]),
      ]),
      SelectContent(
        {
          ...stateProps(scenarioCase.input, 'select-content'),
          'data-side': scenarioCase.input.side ?? 'bottom',
        },
        [...semanticCopy(scenarioCase.input), ...selectionItems(scenarioCase.input, 'select')],
      ),
    ]),
  'component:toast': (_scenario, scenarioCase) =>
    ToastRegion(
      {
        id: 'registry-toast-region',
        role: 'region',
        'aria-label': scenarioCase.input.content.label,
        'data-placement': scenarioCase.input.toastPlacement,
      },
      [toast(scenarioCase)],
    ),
  'component:toolbar': (_scenario, scenarioCase) =>
    Toolbar({ id: 'registry-toolbar', 'data-orientation': scenarioCase.input.orientation }, [
      ...semanticCopy(scenarioCase.input),
      ToolbarGroup([
        ToolbarGroupLabel([text(scenarioCase.input.content.label)]),
        ToolbarSeparator({
          'data-orientation': scenarioCase.input.orientation,
        }),
        ...(scenarioCase.input.items?.disabled
          ? [
              div({ id: 'registry-toolbar-disabled', 'data-disabled': '' }, [
                text(stateLabel(scenarioCase.input, 'disabled')),
              ]),
            ]
          : []),
      ]),
    ]),
  'component:tooltip': (_scenario, scenarioCase) =>
    TooltipContent(
      {
        ...stateProps(scenarioCase.input, 'tooltip-content'),
        'data-side': scenarioCase.input.side ?? 'bottom',
      },
      [...semanticCopy(scenarioCase.input), TooltipArrow({ id: 'registry-tooltip-arrow' })],
    ),
} satisfies Record<MenusOverlaysScenarioId, RegistryRenderer>

function presence(input: MenusOverlaysCaseInput): 'opening' | 'open' | 'closing' | 'closed' {
  if (input.presence === undefined) {
    throw new Error('Renderer requested presence for a case without it.')
  }
  return input.presence
}

function stateProps(input: MenusOverlaysCaseInput, name: string) {
  const state = presence(input)
  return {
    id: `registry-${name}`,
    'data-state': state,
    hidden: state === 'closed' ? true : undefined,
  }
}

function semanticCopy(input: MenusOverlaysCaseInput): Mountable[] {
  const overflow = input.overflow
  const overflowToken = `${input.content.label.replaceAll(' ', '-')}-unbroken-`.repeat(40)
  return [
    div({ 'data-scenario-copy': '', 'aria-label': input.content.detail, class: 'min-w-0' }, [
      div({ 'data-scenario-label': '' }, [text(input.content.label)]),
      div({ 'data-scenario-detail': '' }, [text(input.content.detail)]),
      ...(overflow === undefined
        ? []
        : [
            div({ 'data-overflow-stress': '', class: 'min-w-0 wrap-break-word' }, [
              div({ 'data-overflow-token': '' }, [text(overflowToken)]),
              ...Array.from({ length: overflow.itemCount }, (_, index) =>
                div({ 'data-overflow-item': String(index) }, [
                  text(`${input.content.label} overflow item ${index + 1}`),
                ]),
              ),
            ]),
          ]),
    ]),
  ]
}

function stateLabel(input: MenusOverlaysCaseInput, state: string): string {
  return `${input.content.label} ${state}`
}

function asyncFeedback(input: MenusOverlaysCaseInput, prefix: string): Mountable[] {
  switch (input.asyncStatus) {
    case undefined:
      return []
    case 'loading':
      return [
        div(
          {
            id: `registry-${prefix}-loading`,
            role: 'status',
            'aria-live': 'polite',
            'aria-busy': 'true',
          },
          [text(`${input.content.detail} Loading.`)],
        ),
      ]
    case 'empty':
      return [
        div({ id: `registry-${prefix}-empty`, role: 'status', 'aria-live': 'polite' }, [
          text(`${input.content.detail} No results.`),
        ]),
      ]
    case 'error':
      return [
        div({ id: `registry-${prefix}-error`, role: 'alert', 'aria-live': 'assertive' }, [
          text(`${input.content.detail} Loading failed.`),
        ]),
      ]
  }
}

function selectionItems(
  input: MenusOverlaysCaseInput,
  prefix: 'combobox' | 'searchable-select' | 'select',
): Mountable[] {
  const { items } = input
  if (items === undefined) return []
  const item = (props: Record<string, string>, state: string, children: Mountable[] = []) => {
    const content = [text(stateLabel(input, state)), ...children]
    return prefix === 'select' ? SelectItem(props, content) : ComboboxItem(props, content)
  }
  return [
    ...(items.highlighted
      ? [item({ id: `registry-${prefix}-highlighted`, 'data-highlighted': '' }, 'highlighted')]
      : []),
    ...(items.selected
      ? [
          item(
            { id: `registry-${prefix}-selected`, 'aria-selected': 'true' },
            'selected',
            prefix === 'select' ? [SelectItemIndicator({ id: 'registry-select-indicator' })] : [],
          ),
        ]
      : []),
    ...(items.disabled
      ? [item({ id: `registry-${prefix}-disabled`, 'data-disabled': '' }, 'disabled')]
      : []),
  ]
}

function menuItems(input: MenusOverlaysCaseInput, prefix: string): Mountable[] {
  const items = input.items ?? {}
  const rendered = [
    DropdownMenuItem({ id: `registry-${prefix}-item` }, [text(input.content.label)]),
    items.highlighted
      ? DropdownMenuItem({ id: `registry-${prefix}-highlighted`, 'data-highlighted': '' }, [
          text(stateLabel(input, 'highlighted')),
        ])
      : null,
    items.checked
      ? DropdownMenuCheckboxItem({ id: `registry-${prefix}-checked`, 'aria-checked': 'true' }, [
          DropdownMenuItemIndicator({ id: `registry-${prefix}-indicator` }),
          text(stateLabel(input, 'checked')),
        ])
      : null,
    items.disabled
      ? DropdownMenuItem({ id: `registry-${prefix}-disabled`, 'data-disabled': '' }, [
          text(stateLabel(input, 'disabled')),
        ])
      : null,
    items.destructive
      ? DropdownMenuItem({ id: `registry-${prefix}-destructive`, 'data-variant': 'destructive' }, [
          text(stateLabel(input, 'destructive')),
          DropdownMenuShortcut({ id: `registry-${prefix}-shortcut` }, [text('⌘K')]),
        ])
      : null,
  ]
  return rendered.filter((item): item is Mountable => item !== null)
}

function toast(scenarioCase: MenusOverlaysScenarioCase): Mountable {
  const variant = scenarioCase.input.toastType
  const placement = scenarioCase.input.toastPlacement
  if (variant === undefined || placement === undefined) {
    throw new Error('Toast case requires toastType and toastPlacement.')
  }
  return Toast(
    {
      id: `registry-toast-${variant}`,
      variant,
      role: variant === 'error' ? 'alert' : 'status',
      'aria-live': variant === 'error' ? 'assertive' : 'polite',
      'data-type': variant,
      'data-state': presence(scenarioCase.input),
    },
    [
      div({ class: 'min-w-0' }, [
        ToastTitle([text(scenarioCase.input.content.label)]),
        ToastDescription([text(scenarioCase.input.content.detail)]),
        ...semanticCopy(scenarioCase.input),
      ]),
      ToastClose({ 'aria-label': 'Close' }),
    ],
  )
}

function namespaceIds(root: HTMLElement, suffix: string): void {
  const replacements = new Map<string, string>()
  for (const element of root.querySelectorAll<HTMLElement>('[id]')) {
    const prior = element.id
    const next = `${prior}--${suffix}`
    replacements.set(prior, next)
    element.id = next
  }
  for (const attribute of [
    'for',
    'aria-controls',
    'aria-labelledby',
    'aria-describedby',
    'aria-activedescendant',
  ]) {
    for (const element of root.querySelectorAll<HTMLElement>(`[${attribute}]`)) {
      const value = element.getAttribute(attribute)!
      element.setAttribute(
        attribute,
        value
          .split(' ')
          .map((token) => replacements.get(token) ?? token)
          .join(' '),
      )
    }
  }
}

export async function renderRegistryMenusOverlays(
  scenarios: readonly MenusOverlaysScenario[],
): Promise<{
  html: string
  renderedProductIds: string[]
  renderedCaseKeys: string[]
  dispose: () => void
}> {
  const host = document.createElement('div')
  document.body.append(host)
  const app = mountApp(
    host,
    component<null, never, never>({
      name: 'RegistryMenusOverlaysFixture',
      init: () => [null, []],
      update: (state) => [state, []],
      view: () =>
        scenarios.flatMap((scenario) => {
          const renderer = registryMenusOverlaysRenderers[scenario.scenarioId]
          return scenario.cases.map((scenarioCase) =>
            div(
              {
                'data-registry-product': scenario.productId,
                'data-scenario-id': scenario.scenarioId,
                'data-case-id': scenarioCase.id,
                'data-default-case': String(scenarioCase.id === scenario.defaultCaseId),
                'data-environment-axes': scenarioCase.environmentAxes.join(' '),
              },
              [renderer(scenario, scenarioCase)],
            ),
          )
        }),
    }),
  )

  await new Promise((resolve) => setTimeout(resolve, 0))
  for (const wrapper of host.querySelectorAll<HTMLElement>(
    '[data-registry-product][data-default-case="false"]',
  )) {
    namespaceIds(wrapper, wrapper.dataset['caseId']!)
  }
  const renderedProductIds = scenarios.map(({ productId }) => productId)
  const renderedCaseKeys = [
    ...host.querySelectorAll<HTMLElement>('[data-scenario-id][data-case-id]'),
  ].map((element) => `${element.dataset['scenarioId']}:${element.dataset['caseId']}`)
  return {
    html: host.innerHTML,
    renderedProductIds,
    renderedCaseKeys,
    dispose: () => {
      app.dispose()
      host.remove()
    },
  }
}
