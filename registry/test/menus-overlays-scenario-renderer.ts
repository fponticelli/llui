/**
 * The registry menus/overlays renderer (#265 finding #1/#2, part 2 of 2).
 *
 * Every adapter drives the REAL machine (`init`/`update`) through
 * `connect`/`overlay`, exactly like `menus-overlays-baseline-renderer.ts`, but
 * paints the result with the REAL registry skins (`registry/llui/ui/*`)
 * instead of bare `div`/`button`/`text`. Shares only catalog PROTOCOL data
 * (`MENUS_OVERLAYS_DEFINITIONS`, `compileMenusOverlaysCatalog`,
 * `resolveScenarioSelection`) with the baseline side — never DOM, CSS,
 * selectors, Mountables or runtime helpers, per this issue's own split.
 *
 * This replaces `menus-overlays.fixture.ts`'s fabricated string-template
 * renderer (`registryMenusOverlaysRenderers`), which echoed case labels into
 * hand-rolled markup rather than driving real reducers — the exact defect
 * this issue's history rejected on the baseline side (#265 finding #1/#2,
 * part 1's header doc). `renderMenuTree`/`registryMachineTable`-style reuse
 * mirrors `navigation-data-scenario-renderer.ts`'s pattern (#264).
 */
import {
  component,
  div,
  each,
  input,
  li,
  mountApp,
  show,
  span,
  text,
  type Mountable,
  type Send,
  type Signal,
} from '@llui/dom'
import type { ProductContract } from '@llui/cli'
import {
  dispatchScenarioSelection,
  resolveScenarioSelection,
  type PresentationScenarioEnvironment,
} from '@llui/cli/presentation-scenarios'
import * as dialog from '../../packages/components/src/components/dialog.js'
import * as alertDialog from '../../packages/components/src/components/alert-dialog.js'
import * as drawer from '../../packages/components/src/components/drawer.js'
import * as hoverCard from '../../packages/components/src/components/hover-card.js'
import * as popover from '../../packages/components/src/components/popover.js'
import * as tooltip from '../../packages/components/src/components/tooltip.js'
import * as menu from '../../packages/components/src/components/menu.js'
import type {
  MenuItemPartsOf,
  MenuCheckItemPartsOf,
  MenuSubTriggerPartsOf,
  MenuSubContentPartsOf,
} from '../../packages/components/src/components/menu-machine.js'
import * as contextMenu from '../../packages/components/src/components/context-menu.js'
import * as menubar from '../../packages/components/src/components/menubar.js'
import * as navigationMenu from '../../packages/components/src/components/navigation-menu.js'
import * as select from '../../packages/components/src/components/select.js'
import * as combobox from '../../packages/components/src/components/combobox.js'
import * as toast from '../../packages/components/src/components/toast.js'
import * as toolbar from '../../packages/components/src/components/toolbar.js'
import * as commandMenu from '../../packages/components/src/patterns/command-menu.js'
import * as confirmDialog from '../../packages/components/src/patterns/confirm-dialog.js'
import * as searchableSelect from '../../packages/components/src/patterns/searchable-select.js'
import { Button } from '../llui/ui/button'
import {
  AlertDialogBackdrop,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitleText,
} from '../llui/ui/alert-dialog'
import {
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../llui/ui/dialog'
import {
  DrawerBackdrop,
  DrawerContent,
  DrawerDescription,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
} from '../llui/ui/drawer'
import { HoverCardArrow, HoverCardContent } from '../llui/ui/hover-card'
import { PopoverArrow, PopoverContent } from '../llui/ui/popover'
import { TooltipArrow, TooltipContent } from '../llui/ui/tooltip'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemIndicator,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '../llui/ui/dropdown-menu'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuItemIndicator,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '../llui/ui/context-menu'
import { Menubar, MenubarContent, MenubarTrigger } from '../llui/ui/menubar'
import {
  DropdownMenuItem as MenubarItem,
  DropdownMenuCheckboxItem as MenubarCheckboxItem,
  DropdownMenuItemIndicator as MenubarItemIndicator,
} from '../llui/ui/dropdown-menu'
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuIndicator,
  NavigationMenuIndicatorArrow,
  NavigationMenuIndicatorTrack,
  NavigationMenuList,
  NavigationMenuTrigger,
} from '../llui/ui/navigation-menu'
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectTrigger,
  SelectValue,
} from '../llui/ui/select'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../llui/ui/command'
import {
  ComboboxContent,
  ComboboxItem,
  ComboboxLiveRegion,
  ComboboxTrigger,
} from '../llui/ui/combobox'
import { Toast, ToastClose, ToastDescription, ToastRegion, ToastTitle } from '../llui/ui/sonner'
import { Toolbar, ToolbarGroup, ToolbarSeparator } from '../llui/ui/toolbar'
import { CheckIcon, ChevronDownIcon, XIcon } from '../llui/ui/icons'
import type {
  MenusOverlaysCatalog,
  MenusOverlaysDefinitions,
  MenusOverlaysJoinedScenario,
  DialogLikeCaseInput,
  DrawerCaseInput,
  FloatingPresenceCaseInput,
  TooltipCaseInput,
  MenuCaseInput,
  ContextMenuCaseInput,
  MenubarCaseInput,
  NavigationMenuCaseInput,
  SelectCaseInput,
  ComboboxCaseInput,
  ToastCaseInput,
  ToolbarCaseInput,
  CommandMenuCaseInput,
  ConfirmDialogCaseInput,
  MenuItemCaseInput,
  MenusOverlaysDefinitionScenarioId,
} from '../../packages/components/test/styles/menus-overlays-scenarios.js'

export interface Disposable {
  dispose(): void
}

export interface RenderContext {
  readonly scenarioId: MenusOverlaysDefinitionScenarioId
  readonly caseId: string
  readonly environment: PresentationScenarioEnvironment
}

/** Same contract as the baseline renderer's identical type: an adapter
 * renders ONE typed, product-specific input through the real
 * machine -> connect -> overlay -> registry-skin composition, so a
 * dimension-mutation test can call it directly with a hand-mutated input. */
export type Adapter<Input> = (host: HTMLElement, input: Input, ctx: RenderContext) => Disposable

function applyEnvironmentAttrs(
  host: HTMLElement,
  environment: PresentationScenarioEnvironment,
): void {
  host.setAttribute('dir', environment.direction)
  host.dataset.theme = environment.theme
  host.dataset.viewport = environment.viewport
  host.dataset.forcedColors = environment.forcedColors
}

function mountMachine<S, M extends { type: string }, E extends { type: string } = never>(
  host: HTMLElement,
  ctx: RenderContext,
  name: string,
  initial: () => S,
  update: (state: S, msg: M) => [S, E[]],
  view: (state: Signal<S>, send: Send<M>) => Mountable | readonly Mountable[],
): Disposable {
  applyEnvironmentAttrs(host, ctx.environment)
  return mountApp(
    host,
    component<S, M, E>({
      name,
      init: () => [initial(), []],
      update,
      view: ({ state, send }) => {
        const rendered = view(state, send)
        return Array.isArray(rendered) ? rendered : [rendered]
      },
    }),
  )
}

/** The part-bag shape every menu-like surface (dropdown menu, context menu,
 * menubar's dropped panels) shares for items/checkbox items — the same
 * structural shape `examples/registry-demo/src/sections/menus.ts`'s
 * `MenuTreeParts` documents, kept local here since this renderer's item
 * fixture is flat (never a real submenu tree) except for the ONE synthetic
 * submenu `nestedOpen` adds. */
interface ItemRecipes {
  Item: typeof DropdownMenuItem
  CheckboxItem: typeof DropdownMenuCheckboxItem
  ItemIndicator: typeof DropdownMenuItemIndicator
}

const DROPDOWN_ITEM_RECIPES: ItemRecipes = {
  Item: DropdownMenuItem,
  CheckboxItem: DropdownMenuCheckboxItem,
  ItemIndicator: DropdownMenuItemIndicator,
}
const CONTEXT_ITEM_RECIPES: ItemRecipes = {
  Item: ContextMenuItem,
  CheckboxItem: ContextMenuCheckboxItem,
  ItemIndicator: ContextMenuItemIndicator,
}
const MENUBAR_ITEM_RECIPES: ItemRecipes = {
  Item: MenubarItem,
  CheckboxItem: MenubarCheckboxItem,
  ItemIndicator: MenubarItemIndicator,
}

/** Renders one item in a real menu-tree part bag, by real `kind` — never a
 * fabricated "destructive" flag (see the baseline renderer's identical
 * comment). A checkbox item's indicator is gated on the item's OWN
 * `aria-checked` signal, never rendered unconditionally, so a mutation that
 * flips `checked` is visible in the published markup. */
/** The structural subset of a menu-tree part bag every scope (`menu`,
 * `context-menu`, `menubar`'s delegated `menu()`) shares, generic over the
 * scope's own `data-scope` literal — never a same-shape-different-literal
 * cast (`as unknown as menu.MenuParts`, #265 LOW). `ContextMenuParts` and
 * `menu.MenuParts` both come from the same `menu-machine.ts` factories, so
 * this is the real common type rather than a widened one. */
interface MenuLikeParts<Scope extends string> {
  item: (value: string) => MenuItemPartsOf<Scope>
  checkboxItem: (value: string) => MenuCheckItemPartsOf<Scope>
  subTrigger: (value: string) => MenuSubTriggerPartsOf<Scope>
  subContent: (value: string) => MenuSubContentPartsOf<Scope>
}

function renderMenuItems<Scope extends string>(
  parts: MenuLikeParts<Scope>,
  items: readonly MenuItemCaseInput[],
  recipes: ItemRecipes,
): Mountable[] {
  return items.map((item) => {
    if (item.kind === 'checkbox') {
      const checkParts = parts.checkboxItem(item.value)
      return recipes.CheckboxItem({ ...checkParts.item }, [
        show(
          checkParts.item['aria-checked'].map((v) => v === 'true'),
          () => [recipes.ItemIndicator([CheckIcon({ class: 'size-4' })])],
        ),
        text(item.label),
      ])
    }
    const itemParts = parts.item(item.value)
    return recipes.Item({ ...itemParts.item }, [text(item.label)])
  })
}

// ---------------------------------------------------------------------------
// component:alert-dialog / component:dialog — shared DialogState shape.

/** The real machine state a dialog-like case's `presence` names: an
 * 'opening'/'closing' case drives a REAL transition, gated by
 * `skipAnimations`; 'open'/'closed' seed the final status directly. */
function seedDialogLike(
  machine: typeof dialog | typeof alertDialog,
  input: DialogLikeCaseInput,
): dialog.DialogState {
  if (input.presence === 'opening')
    return machine.update(machine.init({ open: false, skipAnimations: input.skipAnimations }), {
      type: 'open',
    })[0]
  if (input.presence === 'closing')
    return machine.update(machine.init({ open: true, skipAnimations: input.skipAnimations }), {
      type: 'close',
    })[0]
  return machine.init({ open: input.presence !== 'closed', skipAnimations: input.skipAnimations })
}

function dialogLikeAdapter(
  machine: typeof dialog | typeof alertDialog,
  isAlert: boolean,
): Adapter<DialogLikeCaseInput> {
  return (host, input, ctx) =>
    mountMachine(
      host,
      ctx,
      'dialog-like',
      () => seedDialogLike(machine, input),
      machine.update,
      (state, send) => {
        const parts = machine.connect(state, send, { id: 'rd', modal: input.modal })
        const Content = isAlert ? AlertDialogContent : DialogContent
        const Backdrop = isAlert ? AlertDialogBackdrop : DialogBackdrop
        const Title = isAlert ? AlertDialogTitleText : DialogTitle
        return [
          Button({ ...parts.trigger, variant: 'outline' }, [text('Open')]),
          machine.overlay({
            target: host,
            state,
            send,
            parts,
            positionerClass: 'contents',
            content: () => [
              Backdrop({ ...parts.backdrop }),
              Content({ ...parts.content }, [
                isAlert
                  ? AlertDialogHeader([
                      Title({ ...parts.title }, [text(input.title)]),
                      DialogDescription({ ...parts.description }, [text(input.description)]),
                    ])
                  : DialogTitle({ ...parts.title }, [text(input.title)]),
                ...(isAlert
                  ? []
                  : [DialogDescription({ ...parts.description }, [text(input.description)])]),
                ...(isAlert ? [] : [DialogClose({ ...parts.closeTrigger, 'aria-label': 'Close' })]),
                DialogFooter([
                  Button({ ...parts.closeTrigger, variant: 'outline' }, [text('Cancel')]),
                  Button({ ...parts.closeTrigger, variant: isAlert ? 'destructive' : 'default' }, [
                    text(isAlert ? 'Delete' : 'Save'),
                  ]),
                ]),
              ]),
            ],
          }),
        ]
      },
    )
}

interface NestedDialogState {
  readonly outer: dialog.DialogState
  readonly inner: dialog.DialogState
}
/** Routed by `type`: which of the two machines the message is for. */
type NestedDialogMsg = { readonly type: 'outer' | 'inner'; readonly msg: dialog.DialogMsg }

/**
 * `component:dialog/nested` (#265 finding 2): a second modal dialog opened
 * from INSIDE the first — two real machines with their own ids, the inner
 * trigger inside the outer content, both portaled to the case host. Both are
 * open, so the inner one is the top modal layer. Mirrors the baseline
 * renderer's `nestedDialogAdapter`, painted with the registry skin.
 */
function nestedDialogAdapter(
  host: HTMLElement,
  input: DialogLikeCaseInput,
  nestedTitle: string,
  ctx: RenderContext,
): Disposable {
  return mountMachine<NestedDialogState, NestedDialogMsg>(
    host,
    ctx,
    'nested-dialog',
    () => ({
      outer: seedDialogLike(dialog, input),
      inner: dialog.init({ open: true, skipAnimations: true }),
    }),
    (state, { type, msg }) => {
      const [next] = dialog.update(state[type], msg)
      return [{ ...state, [type]: next }, []]
    },
    (state, send) => {
      const sendTo =
        (level: 'outer' | 'inner'): Send<dialog.DialogMsg> =>
        (msg) =>
          send({ type: level, msg })
      const outer = dialog.connect(state.at('outer'), sendTo('outer'), {
        id: 'rd',
        modal: input.modal,
      })
      const inner = dialog.connect(state.at('inner'), sendTo('inner'), {
        id: 'rd-nested',
        modal: true,
        // The confirmation renders a title and no description (#268 audit).
        hasDescription: false,
      })
      return [
        Button({ ...outer.trigger, variant: 'outline' }, [text('Open')]),
        dialog.overlay({
          target: host,
          state: state.at('outer'),
          send: sendTo('outer'),
          parts: outer,
          positionerClass: 'contents',
          content: () => [
            DialogBackdrop({ ...outer.backdrop }),
            DialogContent({ ...outer.content }, [
              DialogTitle({ ...outer.title }, [text(input.title)]),
              DialogDescription({ ...outer.description }, [text(input.description)]),
              DialogFooter([
                Button({ ...inner.trigger, variant: 'destructive' }, [text('Discard')]),
                Button({ ...outer.closeTrigger, variant: 'outline' }, [text('Close')]),
              ]),
              dialog.overlay({
                target: host,
                state: state.at('inner'),
                send: sendTo('inner'),
                parts: inner,
                positionerClass: 'contents',
                content: () => [
                  DialogBackdrop({ ...inner.backdrop }),
                  DialogContent({ ...inner.content }, [
                    DialogTitle({ ...inner.title }, [text(nestedTitle)]),
                    DialogFooter([
                      Button({ ...inner.closeTrigger, variant: 'outline' }, [text('Keep editing')]),
                    ]),
                  ]),
                ],
              }),
            ]),
          ],
        }),
      ]
    },
  )
}

const alertDialogAdapter = dialogLikeAdapter(alertDialog, true)
const plainDialogAdapter = dialogLikeAdapter(dialog, false)
const dialogAdapter: Adapter<DialogLikeCaseInput> = (host, input, ctx) =>
  input.nested === undefined
    ? plainDialogAdapter(host, input, ctx)
    : nestedDialogAdapter(host, input, input.nested, ctx)

// ---------------------------------------------------------------------------
// component:drawer — Drawer skin covers all four `data-side` values.

const drawerAdapter: Adapter<DrawerCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'drawer',
    () => {
      if (input.presence === 'opening')
        return drawer.update(drawer.init({ open: false, skipAnimations: input.skipAnimations }), {
          type: 'open',
        })[0]
      if (input.presence === 'closing')
        return drawer.update(drawer.init({ open: true, skipAnimations: input.skipAnimations }), {
          type: 'close',
        })[0]
      return drawer.init({
        open: input.presence !== 'closed',
        skipAnimations: input.skipAnimations,
      })
    },
    drawer.update,
    (state, send) => {
      const parts = drawer.connect(state, send, { id: 'rdr', side: input.side })
      return [
        Button({ ...parts.trigger, variant: 'outline' }, [text('Open')]),
        drawer.overlay({
          target: host,
          state,
          send,
          parts,
          positionerClass: 'fixed inset-0 z-dialog flex',
          content: () => [
            DrawerBackdrop({ ...parts.backdrop }),
            DrawerContent({ ...parts.content }, [
              DrawerHandle(),
              DrawerHeader([
                DrawerTitle({ ...parts.title }, [text(input.title)]),
                DrawerDescription({ ...parts.description }, [text(input.description)]),
              ]),
            ]),
          ],
        }),
      ]
    },
  )

// ---------------------------------------------------------------------------
// component:hover-card / component:popover — shared PopoverState shape.

const hoverCardAdapter: Adapter<FloatingPresenceCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'hover-card',
    () => {
      if (input.presence === 'opening')
        return hoverCard.update(
          hoverCard.init({ open: false, skipAnimations: input.skipAnimations }),
          { type: 'show' },
        )[0]
      if (input.presence === 'closing')
        return hoverCard.update(
          hoverCard.init({ open: true, skipAnimations: input.skipAnimations }),
          {
            type: 'hide',
          },
        )[0]
      return hoverCard.init({
        open: input.presence !== 'closed',
        skipAnimations: input.skipAnimations,
      })
    },
    hoverCard.update,
    (state, send) => {
      const parts = hoverCard.connect(state, send, { id: 'rf' })
      return [
        Button({ ...parts.trigger, variant: 'ghost' }, [text('Trigger')]),
        hoverCard.overlay({
          target: host,
          state,
          send,
          parts,
          placement: input.placement,
          positionerClass: 'z-popover',
          arrowSelector: "[data-part='arrow']",
          content: () => [
            HoverCardContent({ ...parts.content }, [
              text(input.label),
              HoverCardArrow({ ...parts.arrow }),
            ]),
          ],
        }),
      ]
    },
  )

const popoverAdapter: Adapter<FloatingPresenceCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'popover',
    () => {
      if (input.presence === 'opening')
        return popover.update(popover.init({ open: false, skipAnimations: input.skipAnimations }), {
          type: 'open',
        })[0]
      if (input.presence === 'closing')
        return popover.update(popover.init({ open: true, skipAnimations: input.skipAnimations }), {
          type: 'close',
        })[0]
      return popover.init({
        open: input.presence !== 'closed',
        skipAnimations: input.skipAnimations,
      })
    },
    popover.update,
    (state, send) => {
      const parts = popover.connect(state, send, { id: 'rf' })
      return [
        Button({ ...parts.trigger, variant: 'outline' }, [text('Trigger')]),
        popover.overlay({
          target: host,
          state,
          send,
          parts,
          placement: input.placement,
          positionerClass: 'z-popover',
          arrowSelector: "[data-part='arrow']",
          content: () => [
            PopoverContent({ ...parts.content }, [
              // The content is a named dialog: `aria-labelledby` names the
              // title part, so the title must be rendered (#268 audit).
              div({ ...parts.title }, [text(input.label)]),
              PopoverArrow({ ...parts.arrow }),
            ]),
          ],
        }),
      ]
    },
  )

// ---------------------------------------------------------------------------
// component:tooltip — real `animated` flag, not `skipAnimations`.

const tooltipAdapter: Adapter<TooltipCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'tooltip',
    () => {
      if (input.presence === 'opening')
        return tooltip.update(tooltip.init({ open: false, animated: input.animated }), {
          type: 'show',
        })[0]
      if (input.presence === 'closing')
        return tooltip.update(tooltip.init({ open: true, animated: input.animated }), {
          type: 'hide',
        })[0]
      return tooltip.init({ open: input.presence !== 'closed', animated: input.animated })
    },
    tooltip.update,
    (state, send) => {
      const parts = tooltip.connect(state, send, { id: 'rt' })
      return [
        Button({ ...parts.trigger, variant: 'ghost' }, [text('Hover')]),
        tooltip.overlay({
          target: host,
          state,
          send,
          parts,
          placement: input.placement,
          positionerClass: 'z-tooltip',
          arrowSelector: "[data-part='arrow']",
          content: () => [
            TooltipContent({ ...parts.content }, [
              text(input.label),
              TooltipArrow({ ...parts.arrow }),
            ]),
          ],
        }),
      ]
    },
  )

// ---------------------------------------------------------------------------
// component:menu

const SUBMENU_VALUE = '__submenu'
const SUBMENU_CHILD_VALUE = '__submenu-item'

const menuAdapter: Adapter<MenuCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'menu',
    () => {
      const items: menu.MenuItem[] = [
        ...input.items.map((item) => ({
          value: item.value,
          kind: item.kind,
          disabled: item.disabled,
        })),
        ...(input.nestedOpen
          ? [
              {
                value: SUBMENU_VALUE,
                kind: 'action' as const,
                children: [{ value: SUBMENU_CHILD_VALUE, kind: 'action' as const }],
              },
            ]
          : []),
      ]
      const seedOpts = { items, checked: [...input.checked], skipAnimations: input.skipAnimations }
      let state =
        input.presence === 'opening'
          ? menu.update(menu.init({ ...seedOpts, open: false }), { type: 'open' })[0]
          : input.presence === 'closing'
            ? menu.update(menu.init({ ...seedOpts, open: true }), { type: 'close' })[0]
            : menu.init({ ...seedOpts, open: input.presence !== 'closed' })
      if (input.highlighted !== null && input.presence !== 'closed') {
        state = menu.update(state, { type: 'highlight', level: '', value: input.highlighted })[0]
      }
      if (input.nestedOpen && input.presence === 'open') {
        state = menu.update(state, { type: 'openSub', value: SUBMENU_VALUE })[0]
      }
      return state
    },
    menu.update,
    (state, send) => {
      const parts = menu.connect(state, send, { id: 'rm' })
      return [
        Button({ ...parts.trigger, variant: 'outline' }, [text('Open menu ▾')]),
        parts.directionSync,
        menu.overlay({
          target: host,
          state,
          send,
          parts,
          placement: input.placement,
          positionerClass: 'z-popover',
          content: () => [
            DropdownMenuContent({ ...parts.content }, [
              ...renderMenuItems(parts, input.items, DROPDOWN_ITEM_RECIPES),
              ...(input.nestedOpen
                ? [
                    DropdownMenuSubTrigger({ ...parts.subTrigger(SUBMENU_VALUE) }, [text('More')]),
                    menu.subOverlay({
                      value: SUBMENU_VALUE,
                      state,
                      parts,
                      target: host,
                      content: () => [
                        DropdownMenuSubContent({ ...parts.subContent(SUBMENU_VALUE) }, [
                          DropdownMenuItem({ ...parts.item(SUBMENU_CHILD_VALUE).item }, [
                            text('Submenu item'),
                          ]),
                        ]),
                      ],
                    }),
                  ]
                : []),
            ]),
          ],
        }),
      ]
    },
  )

// ---------------------------------------------------------------------------
// component:context-menu — real virtual (x, y) anchor via `openAt`.

const contextMenuAdapter: Adapter<ContextMenuCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'context-menu',
    () => {
      const items: contextMenu.ContextMenuItem[] = [
        ...input.items.map((item) => ({
          value: item.value,
          kind: item.kind,
          disabled: item.disabled,
        })),
        ...(input.nestedOpen
          ? [
              {
                value: SUBMENU_VALUE,
                kind: 'action' as const,
                children: [{ value: SUBMENU_CHILD_VALUE, kind: 'action' as const }],
              },
            ]
          : []),
      ]
      let state = contextMenu.init({ items, skipAnimations: input.skipAnimations })
      if (input.presence !== 'closed') {
        state = contextMenu.update(state, { type: 'openAt', x: input.x, y: input.y })[0]
      }
      if (input.presence === 'closing') {
        state = contextMenu.update(state, { type: 'close' })[0]
      }
      if (input.highlighted !== null && input.presence !== 'closed') {
        state = contextMenu.update(state, {
          type: 'highlight',
          level: '',
          value: input.highlighted,
        })[0]
      }
      if (input.nestedOpen && input.presence === 'open') {
        state = contextMenu.update(state, { type: 'openSub', value: SUBMENU_VALUE })[0]
      }
      return state
    },
    contextMenu.update,
    (state, send) => {
      const parts = contextMenu.connect(state, send, { id: 'rcm' })
      return [
        div(
          {
            ...parts.trigger,
            class:
              'grid h-24 place-items-center rounded-md border border-dashed text-sm text-muted-foreground',
          },
          [text('Right-click target')],
        ),
        contextMenu.overlay({
          target: host,
          state,
          send,
          parts,
          positionerClass: 'z-popover',
          content: () => [
            ContextMenuContent({ ...parts.content }, [
              ...renderMenuItems(parts, input.items, CONTEXT_ITEM_RECIPES),
              ...(input.nestedOpen
                ? [
                    ContextMenuSubTrigger({ ...parts.subTrigger(SUBMENU_VALUE) }, [text('More')]),
                    contextMenu.subOverlay({
                      value: SUBMENU_VALUE,
                      state,
                      parts,
                      target: host,
                      content: () => [
                        ContextMenuSubContent({ ...parts.subContent(SUBMENU_VALUE) }, [
                          ContextMenuItem({ ...parts.item(SUBMENU_CHILD_VALUE).item }, [
                            text('Submenu item'),
                          ]),
                        ]),
                      ],
                    }),
                  ]
                : []),
            ]),
          ],
        }),
      ]
    },
  )

// ---------------------------------------------------------------------------
// component:menubar — synchronous open/closed, no `status`.

const menubarAdapter: Adapter<MenubarCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'menubar',
    () => {
      let state = menubar.init({
        menus: input.menus.map((m) => ({
          id: m.id,
          items: m.items.map((item) => ({
            value: item.value,
            kind: item.kind,
            disabled: item.disabled,
          })),
          disabled: m.disabled,
        })),
        focused: input.focused,
      })
      if (input.open !== null) {
        state = menubar.update(state, { type: 'openMenu', id: input.open })[0]
      }
      return state
    },
    menubar.update,
    (state, send) => {
      const parts = menubar.connect(state, send, { id: 'rmb' })
      return [
        Menubar(
          { ...parts.root },
          input.menus.map((m) => MenubarTrigger({ ...parts.menuTrigger(m.id) }, [text(m.label)])),
        ),
        parts.directionSync,
        ...input.menus.map((m) => {
          const menuParts = parts.menu(m.id)
          return menubar.overlay({
            target: host,
            state,
            send,
            menuId: m.id,
            parts: menuParts,
            positionerClass: 'z-popover',
            content: () => [
              MenubarContent(
                { ...menuParts.content },
                renderMenuItems(menuParts, m.items, MENUBAR_ITEM_RECIPES),
              ),
            ],
          })
        }),
      ]
    },
  )

// ---------------------------------------------------------------------------
// component:navigation-menu — indicator-only presence.

const navigationMenuAdapter: Adapter<NavigationMenuCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'navigation-menu',
    () =>
      navigationMenu.init({
        open: [...input.open],
        focused: input.focused,
        items: input.branches.map((b) => b.id),
        disabled: input.disabled,
      }),
    navigationMenu.update,
    (state, send) => {
      const parts = navigationMenu.connect(state, send, { id: 'rnav' })
      return [
        NavigationMenu({ ...parts.root, 'data-viewport': 'false' }, [
          parts.directionSync,
          NavigationMenuList(
            input.branches.map((branch) => {
              const item = parts.item(branch.id, { isBranch: true })
              // A list item, as upstream's NavigationMenuItem and the registry
              // demo render it — a `div` here made the `ul` own non-items
              // (#268 audit).
              return li({ class: 'relative' }, [
                NavigationMenuTrigger({ ...item.trigger }, [
                  text(branch.label),
                  NavigationMenuIndicator([ChevronDownIcon({ class: 'size-3' })]),
                ]),
                NavigationMenuContent({ ...item.content }, [text(`${branch.label} panel`)]),
              ])
            }),
          ),
          NavigationMenuIndicatorTrack({ ...parts.indicator }, [NavigationMenuIndicatorArrow()]),
        ]),
      ]
    },
  )

// ---------------------------------------------------------------------------
// component:select

const selectAdapter: Adapter<SelectCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'select',
    () => {
      let state = select.init({
        value: [...input.value],
        items: [...input.items],
        disabledItems: [...input.disabledItems],
        selectionMode: input.selectionMode,
      })
      if (input.open) state = select.update(state, { type: 'open' })[0]
      if (input.highlightedValue !== null) {
        state = select.update(state, { type: 'highlight', value: input.highlightedValue })[0]
      }
      return state
    },
    select.update,
    (state, send) => {
      const parts = select.connect(state, send, { id: 'rs' })
      return [
        // role="combobox" takes no name from its content (#268 audit).
        SelectTrigger({ ...parts.trigger, 'aria-label': 'Fruit' }, [
          SelectValue([text(parts.valueText)]),
        ]),
        select.overlay({
          target: host,
          state,
          send,
          parts,
          positionerClass: 'z-popover',
          content: () => [
            SelectContent(
              { ...parts.content },
              input.items.map((value) =>
                SelectItem({ ...parts.item(value).item }, [text(value), SelectItemIndicator()]),
              ),
            ),
          ],
        }),
      ]
    },
  )

// ---------------------------------------------------------------------------
// component:combobox / pattern:searchable-select — shared ComboboxState shape.

const comboboxAdapter: Adapter<ComboboxCaseInput> = (host, caseInput, ctx) =>
  mountMachine(
    host,
    ctx,
    'combobox',
    () => {
      let state = combobox.init({
        value: [...caseInput.value],
        inputValue: caseInput.inputValue,
        items: [...caseInput.items],
        disabledItems: [...caseInput.disabledItems],
      })
      if (caseInput.open) state = combobox.update(state, { type: 'open' })[0]
      if (caseInput.highlightedValue !== null) {
        state = combobox.update(state, { type: 'highlight', value: caseInput.highlightedValue })[0]
      }
      return { ...state, status: caseInput.status }
    },
    combobox.update,
    (state, send) => {
      const parts = combobox.connect(state, send, { id: 'rcb' })
      const { text: liveText, ...liveAttrs } = parts.liveRegion
      // Hidden only when SETTLED empty: a loading listbox stays exposed, since
      // `aria-busy` is how it announces the load (and permits it no options).
      const empty = caseInput.items.length === 0 && caseInput.status !== 'loading'
      // The popup box carries the presence attributes; the LISTBOX inside it
      // owns only options, and with nothing to list it is hidden and the
      // empty state is its sibling (#268 audit).
      const {
        role,
        id,
        'aria-labelledby': labelledBy,
        'aria-busy': busy,
        tabindex,
        ...popup
      } = parts.content
      return [
        div({ class: 'relative max-w-xs' }, [
          input({ ...parts.input, 'aria-label': 'Fruit', class: 'pr-9' }),
          ComboboxTrigger({ ...parts.trigger }, [ChevronDownIcon({ class: 'size-4' })]),
        ]),
        ComboboxLiveRegion({ ...liveAttrs }, [text(liveText)]),
        combobox.overlay({
          target: host,
          state,
          send,
          parts,
          positionerClass: 'z-popover',
          content: () => [
            ComboboxContent({ ...popup }, [
              div(
                {
                  role,
                  id,
                  'aria-labelledby': labelledBy,
                  'aria-busy': busy,
                  tabindex,
                  hidden: empty,
                  'data-scope': 'combobox',
                  'data-part': 'list',
                },
                caseInput.items.map((value) =>
                  ComboboxItem({ ...parts.item(value).item }, [text(value)]),
                ),
              ),
              ...(empty ? [CommandEmpty({ ...parts.empty }, [text('No results')])] : []),
            ]),
          ],
        }),
      ]
    },
  )

const searchableSelectAdapter: Adapter<ComboboxCaseInput> = (host, caseInput, ctx) =>
  mountMachine(
    host,
    ctx,
    'searchable-select',
    () => {
      let state = searchableSelect.init({
        value: [...caseInput.value],
        items: [...caseInput.items],
        disabledItems: [...caseInput.disabledItems],
      })
      state = {
        ...state,
        combobox: { ...state.combobox, status: caseInput.status, inputValue: caseInput.inputValue },
      }
      if (caseInput.open) state = searchableSelect.update(state, { type: 'open' })[0]
      if (caseInput.highlightedValue !== null) {
        state = {
          ...state,
          combobox: { ...state.combobox, highlightedValue: caseInput.highlightedValue },
        }
      }
      return state
    },
    searchableSelect.update,
    (state, send) => {
      const parts = searchableSelect.connect(state, send, { id: 'rss' })
      // Hidden only when SETTLED empty: a loading listbox stays exposed, since
      // `aria-busy` is how it announces the load (and permits it no options).
      const empty = caseInput.items.length === 0 && caseInput.status !== 'loading'
      // The popup box carries the presence attributes; the LISTBOX inside it
      // owns only options — the filter field sits above it, the empty state
      // beside it (#268 audit: the field used to sit inside the listbox).
      const {
        role,
        id,
        'aria-labelledby': labelledBy,
        'aria-busy': busy,
        'aria-multiselectable': multiselectable,
        tabindex,
        ...popup
      } = parts.content
      return [
        // role="combobox" takes no name from its content.
        SelectTrigger({ ...parts.trigger, 'aria-label': 'Fruit' }, [
          SelectValue([text(parts.triggerLabel)]),
        ]),
        searchableSelect.overlay({
          target: host,
          state,
          send,
          parts,
          positionerClass: 'z-popover',
          content: () => [
            SelectContent({ ...popup }, [
              CommandInput({
                ...parts.input,
                'aria-label': 'Filter fruit',
                placeholder: 'Filter…',
              }),
              CommandList(
                {
                  role,
                  id,
                  'aria-labelledby': labelledBy,
                  'aria-busy': busy,
                  'aria-multiselectable': multiselectable,
                  tabindex,
                  hidden: empty,
                  'data-scope': 'searchable-select',
                  'data-part': 'list',
                },
                caseInput.items.map((value) =>
                  SelectItem({ ...parts.item(value).item }, [text(value)]),
                ),
              ),
              ...(empty ? [CommandEmpty({ ...parts.empty }, [text('No results')])] : []),
            ]),
          ],
        }),
      ]
    },
  )

// ---------------------------------------------------------------------------
// component:toast — no overlay/portal; region + toast() delegated parts.

const toastAdapter: Adapter<ToastCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'toast',
    () => {
      let state = toast.init({ placement: input.placement, animated: input.animated })
      state = {
        ...state,
        toasts: [
          {
            id: 't1',
            type: input.toastType,
            title: input.title,
            description: input.description,
            duration: null,
            remainingMs: 0,
            dismissable: input.dismissable,
            status: input.closing ? 'closing' : 'open',
            pausedBy: [],
          },
        ],
      }
      return state
    },
    toast.update,
    (state, send) => {
      const parts = toast.connect(state, send, {})
      return [
        ToastRegion({ ...parts.region }, [
          ...state.peek().toasts.map((t) => {
            const toastSig = state.map((s) => s.toasts.find((x) => x.id === t.id) ?? t)
            const itemParts = parts.toast(toastSig)
            return Toast({ ...itemParts.root }, [
              div({ class: 'min-w-0' }, [
                ToastTitle({ ...itemParts.title }, [text(t.title ?? '')]),
                ToastDescription({ ...itemParts.description }, [text(t.description ?? '')]),
              ]),
              ...(t.dismissable
                ? [ToastClose({ ...itemParts.closeTrigger }, [XIcon({ class: 'size-4' })])]
                : []),
            ])
          }),
        ]),
      ]
    },
  )

// ---------------------------------------------------------------------------
// component:toolbar — no presence at all; persistently mounted.

const toolbarAdapter: Adapter<ToolbarCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'toolbar',
    () =>
      toolbar.init({
        items: [...input.items],
        disabledItems: [...input.disabledItems],
        orientation: input.orientation,
      }),
    toolbar.update,
    (state, send) => {
      const parts = toolbar.connect(state, send, { id: 'rtb' })
      // A group is `aria-labelledby` its label part, so the label is rendered
      // (visually hidden — the group is a grouping, not a heading; #268 audit).
      const group = parts.group('Formatting')
      return Toolbar({ ...parts.root }, [
        ToolbarGroup({ ...group.root }, [
          span({ ...group.label, class: 'sr-only' }, [text('Formatting')]),
          ...input.items.flatMap((value, index) => [
            ...(index > 0 ? [ToolbarSeparator({ ...parts.separator })] : []),
            Button({ ...parts.item(value).root, variant: 'ghost', size: 'sm' }, [text(value)]),
          ]),
        ]),
      ])
    },
  )

// ---------------------------------------------------------------------------
// pattern:command-menu — composed dialog + combobox.

const commandMenuAdapter: Adapter<CommandMenuCaseInput> = (host, caseInput, ctx) =>
  mountMachine(
    host,
    ctx,
    'command-menu',
    () => {
      let state = commandMenu.init({
        commands: caseInput.commands.map((c) => ({ id: c.id, label: c.label })),
        open: caseInput.open,
      })
      if (caseInput.query !== '')
        state = commandMenu.update(state, { type: 'setQuery', query: caseInput.query })[0]
      return state
    },
    commandMenu.update,
    (state, send) => {
      // shadcn's CommandDialog names itself with an sr-only title AND
      // description, so this palette renders both (#268 audit).
      const parts = commandMenu.connect(state, send, { id: 'rcmd', hasDescription: true })
      return [
        Button({ ...parts.dialog.trigger, variant: 'outline' }, [text('Open command menu')]),
        dialog.overlay({
          target: host,
          state: state.map((s) => ({ open: s.open })),
          send: (m) => {
            // The dialog's Escape (it claims the key before the input sees it)
            // follows the palette's cmdk rule: clear a query, then close.
            if (m.type === 'close') send({ type: 'escape' })
          },
          parts: parts.dialog,
          positionerClass: 'contents',
          content: () => [
            DialogBackdrop({ ...parts.dialog.backdrop }),
            DialogContent({ ...parts.dialog.content }, [
              DialogHeader({ class: 'sr-only' }, [
                DialogTitle({ ...parts.dialog.title }, [text('Command palette')]),
                DialogDescription({ ...parts.dialog.description }, [
                  text('Search for a command to run'),
                ]),
              ]),
              Command({}, [
                CommandInput({
                  ...parts.combobox.input,
                  'aria-labelledby': parts.dialog.title.id,
                  placeholder: 'Type a command…',
                }),
                // The machine's listbox owns only options (#268 audit): the
                // empty-state `status` sits beside it, not inside it.
                // It owns the machine's FILTERED commands, not the case's
                // seed list: a filtered-out command is not an option.
                CommandList({ ...parts.combobox.content }, [
                  CommandGroup([
                    each(state.at('filtered'), {
                      key: (c) => c.id,
                      render: (c) => {
                        // Keyed by id: the id is the row's identity for life.
                        const id = c.peek().id
                        return [
                          CommandItem({ ...parts.combobox.item(id).item }, [text(c.at('label'))]),
                        ]
                      },
                    }),
                  ]),
                ]),
                CommandEmpty({ ...parts.empty, class: 'hidden data-empty:block' }, [
                  text('No commands match'),
                ]),
              ]),
            ]),
          ],
        }),
      ]
    },
  )

// ---------------------------------------------------------------------------
// pattern:confirm-dialog — hand-wired, exactly like the real
// `patterns.ts` demo (`confirmDialog.view()` hardcodes baseline class names,
// so a registry consumer wires `dialog.connect`/`dialog.overlay` itself).

const confirmDialogAdapter: Adapter<ConfirmDialogCaseInput> = (host, input, ctx) =>
  mountMachine(
    host,
    ctx,
    'confirm-dialog',
    () => {
      const seed = confirmDialog.init({
        title: input.title,
        description: input.description,
        destructive: input.destructive,
      })
      if (!input.open) return seed
      return confirmDialog.update(
        seed,
        confirmDialog.confirmDialog.openWith('confirm', {
          title: input.title,
          description: input.description,
          destructive: input.destructive,
        }),
      )[0]
    },
    confirmDialog.update,
    (state, send) => {
      const cfmDialog = dialog.connect(
        state.map((s) => ({ open: s.open })),
        () => {
          /* unused — buttons dispatch confirm-dialog messages directly */
        },
        { id: 'rconfirm', role: 'alertdialog' },
      )
      return [
        dialog.overlay({
          target: host,
          state: state.map((s) => ({ open: s.open })),
          send: (m) => {
            if (m.type === 'close') send({ type: 'cancel' })
          },
          parts: cfmDialog,
          positionerClass: 'contents',
          content: () => [
            DialogBackdrop({ ...cfmDialog.backdrop }),
            AlertDialogContent({ ...cfmDialog.content }, [
              AlertDialogHeader([
                AlertDialogTitleText({ ...cfmDialog.title }, [text(state.map((s) => s.title))]),
                DialogDescription({ ...cfmDialog.description }, [
                  text(state.map((s) => s.description)),
                ]),
              ]),
              DialogFooter([
                Button({ variant: 'outline', onClick: () => send({ type: 'cancel' }) }, [
                  text(state.map((s) => s.cancelLabel)),
                ]),
                Button(
                  {
                    variant: input.destructive ? 'destructive' : 'default',
                    onClick: () => send({ type: 'confirm' }),
                  },
                  [text(state.map((s) => s.confirmLabel))],
                ),
              ]),
            ]),
          ],
        }),
      ]
    },
  )

/** Adapters for every one of the 17 menus-overlays ProductContract scenarios. */
export const REGISTRY_ADAPTERS = {
  'component:alert-dialog': alertDialogAdapter,
  'component:dialog': dialogAdapter,
  'component:drawer': drawerAdapter,
  'component:hover-card': hoverCardAdapter,
  'component:popover': popoverAdapter,
  'component:tooltip': tooltipAdapter,
  'component:menu': menuAdapter,
  'component:context-menu': contextMenuAdapter,
  'component:menubar': menubarAdapter,
  'component:navigation-menu': navigationMenuAdapter,
  'component:select': selectAdapter,
  'component:combobox': comboboxAdapter,
  'component:toast': toastAdapter,
  'component:toolbar': toolbarAdapter,
  'pattern:command-menu': commandMenuAdapter,
  'pattern:confirm-dialog': confirmDialogAdapter,
  'pattern:searchable-select': searchableSelectAdapter,
} as const satisfies Record<MenusOverlaysDefinitionScenarioId, Adapter<never>>

function assertBindings(scenarios: readonly MenusOverlaysJoinedScenario[]): void {
  const scenarioIds = scenarios.map(({ scenarioId }) => scenarioId).sort()
  const bindingIds = Object.keys(REGISTRY_ADAPTERS).sort()
  if (JSON.stringify(scenarioIds) !== JSON.stringify(bindingIds)) {
    throw new Error(
      `Registry menus-overlays renderer bindings do not match applicable ProductContract scenarios: expected ${scenarioIds.join(', ')}; received ${bindingIds.join(', ')}`,
    )
  }
}

export function mountRegistryMenusOverlaysScenarios(
  container: HTMLElement,
  contract: ProductContract,
  catalog: MenusOverlaysCatalog,
  scenarios: readonly MenusOverlaysJoinedScenario[],
): Disposable {
  assertBindings(scenarios)
  const handles: Disposable[] = []
  for (const scenario of scenarios) {
    for (const scenarioCase of scenario.cases) {
      const resolved = resolveScenarioSelection<MenusOverlaysDefinitions>(contract, catalog, {
        productId: scenario.productId,
        caseId: scenarioCase.id,
        path: 'registryTailwind',
      })
      const host = document.createElement('section')
      host.id = `registry-${scenario.productId}${
        scenarioCase.id === scenario.defaultCaseId ? '' : `--${scenarioCase.id}`
      }`
      host.dataset.scenarioRenderer = 'registryTailwind'
      host.dataset.scenarioProduct = scenario.productId
      host.dataset.scenarioId = scenario.scenarioId
      host.dataset.scenarioCase = scenarioCase.id
      container.append(host)
      handles.push(dispatchScenarioSelection(catalog, REGISTRY_ADAPTERS, resolved, host, {}))
    }
  }
  return {
    dispose: () => {
      for (let index = handles.length - 1; index >= 0; index -= 1) handles[index]!.dispose()
    },
  }
}
