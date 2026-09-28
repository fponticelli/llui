/**
 * The baseline menus/overlays renderer (#265 finding #1/#2, part 1 of 2).
 *
 * Every adapter drives the REAL machine (`init`/`update`) through `connect`/
 * `overlay` (or, where the product has no overlay split, its own composed
 * `view`), exactly mirroring the `packages/components/test/components/*.
 * integration.test.ts` mount idiom. Presence transitions
 * (`opening`/`closing`) are reached by sending the REAL `open`/`close`
 * message with `skipAnimations`/`animated` set so the reducer lands on the
 * intermediate status — never by hand-writing `status` into the seeded
 * state, mirroring `navigation-data-baseline-renderer.ts`'s disclosure
 * adapters (#264 item C).
 *
 * This is the correction the #265 review history names directly: three
 * prior candidates fabricated string-template adapters that echoed case
 * labels rather than driving real reducers, and were rejected as
 * "metadata only" / "raw innerHTML comparison is vacuous".
 */
import {
  component,
  mountApp,
  button,
  div,
  h2,
  input,
  p,
  section,
  span,
  text,
  type Mountable,
  type Send,
  type Signal,
} from '@llui/dom'
import type { ProductContract } from '@llui/cli'
import type { PresentationScenarioEnvironment } from '@llui/cli/presentation-scenarios'
import { resolveScenarioSelection } from './menus-overlays-scenarios.js'
import * as dialog from '../../src/components/dialog.js'
import * as alertDialog from '../../src/components/alert-dialog.js'
import * as drawer from '../../src/components/drawer.js'
import * as hoverCard from '../../src/components/hover-card.js'
import * as popover from '../../src/components/popover.js'
import * as tooltip from '../../src/components/tooltip.js'
import * as menu from '../../src/components/menu.js'
import type {
  MenuItemPartsOf,
  MenuCheckItemPartsOf,
  MenuSubTriggerPartsOf,
  MenuSubContentPartsOf,
} from '../../src/components/menu-machine.js'
import * as contextMenu from '../../src/components/context-menu.js'
import * as menubar from '../../src/components/menubar.js'
import * as navigationMenu from '../../src/components/navigation-menu.js'
import * as select from '../../src/components/select.js'
import * as combobox from '../../src/components/combobox.js'
import * as toast from '../../src/components/toast.js'
import * as toolbar from '../../src/components/toolbar.js'
import * as commandMenu from '../../src/patterns/command-menu.js'
import * as confirmDialog from '../../src/patterns/confirm-dialog.js'
import * as searchableSelect from '../../src/patterns/searchable-select.js'
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
} from './menus-overlays-scenarios.js'

export interface Disposable {
  dispose(): void
}

export interface RenderContext {
  readonly scenarioId: MenusOverlaysDefinitionScenarioId
  readonly caseId: string
  readonly environment: PresentationScenarioEnvironment
}

/** An adapter renders ONE typed, product-specific input through the real
 * machine -> connect -> overlay composition. It never reads case/environment
 * data beyond what `RenderContext` states, so a dimension-mutation test can
 * call it directly with a hand-mutated `input` and observe the same real
 * output a resolved selection would have produced. */
export type Adapter<Input> = (host: HTMLElement, input: Input, ctx: RenderContext) => Disposable

/** Same rationale as `navigation-data-baseline-renderer.ts:applyEnvironmentAttrs`. */
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

/** Renders one item in a real menu-tree part bag (`menu`/`context-menu`/
 * `menubar`'s delegated `menu()`), by real `kind` — never a fabricated
 * "destructive" flag; a skin choosing to style one item destructively does
 * so by VALUE, which is a presentational, non-machine-state choice this
 * renderer leaves to `registry` skins (part 2). */
function renderMenuItems<Scope extends string>(
  parts: MenuLikeParts<Scope>,
  items: readonly MenuItemCaseInput[],
): Mountable[] {
  return items.map((item) => {
    if (item.kind === 'checkbox') {
      const checkParts = parts.checkboxItem(item.value)
      return div({ ...checkParts.item }, [text(item.label)])
    }
    const itemParts = parts.item(item.value)
    return div({ ...itemParts.item }, [text(item.label)])
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
): Adapter<DialogLikeCaseInput> {
  return (host, input, ctx) =>
    mountMachine(
      host,
      ctx,
      'dialog-like',
      () => seedDialogLike(machine, input),
      machine.update,
      (state, send) => {
        const parts = machine.connect(state, send, { id: 'd', modal: input.modal })
        return [
          button({ ...parts.trigger }, [text('Open')]),
          machine.overlay({
            target: host,
            state,
            send,
            parts,
            // `backdrop` BEFORE `content` — the equal-z-index-plus-DOM-order
            // stacking contract `menus-overlays.css` documents (#265 finding
            // 4), proven on real pixels in `modal-stacking.browser.test.ts`.
            content: () => [
              div({ ...parts.backdrop }),
              div({ ...parts.content }, [
                h2({ ...parts.title }, [text(input.title)]),
                p({ ...parts.description }, [text(input.description)]),
                button({ ...parts.closeTrigger }, [text('Close')]),
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
 * open, so the inner one is the top modal layer.
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
        id: 'd',
        modal: input.modal,
      })
      const inner = dialog.connect(state.at('inner'), sendTo('inner'), {
        id: 'd-nested',
        modal: true,
        // The confirmation renders a title and no description (#268 audit).
        hasDescription: false,
      })
      return [
        button({ ...outer.trigger }, [text('Open')]),
        dialog.overlay({
          target: host,
          state: state.at('outer'),
          send: sendTo('outer'),
          parts: outer,
          content: () => [
            div({ ...outer.backdrop }),
            div({ ...outer.content }, [
              h2({ ...outer.title }, [text(input.title)]),
              p({ ...outer.description }, [text(input.description)]),
              button({ ...inner.trigger }, [text('Discard')]),
              button({ ...outer.closeTrigger }, [text('Close')]),
              dialog.overlay({
                target: host,
                state: state.at('inner'),
                send: sendTo('inner'),
                parts: inner,
                content: () => [
                  div({ ...inner.backdrop }),
                  div({ ...inner.content }, [
                    h2({ ...inner.title }, [text(nestedTitle)]),
                    button({ ...inner.closeTrigger }, [text('Keep editing')]),
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

const alertDialogAdapter = dialogLikeAdapter(alertDialog)
const plainDialogAdapter = dialogLikeAdapter(dialog)
const dialogAdapter: Adapter<DialogLikeCaseInput> = (host, input, ctx) =>
  input.nested === undefined
    ? plainDialogAdapter(host, input, ctx)
    : nestedDialogAdapter(host, input, input.nested, ctx)

// ---------------------------------------------------------------------------
// component:drawer

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
      const parts = drawer.connect(state, send, { id: 'dr', side: input.side })
      return [
        button({ ...parts.trigger }, [text('Open')]),
        drawer.overlay({
          target: host,
          state,
          send,
          parts,
          // `backdrop` BEFORE `content` — same stacking contract as dialog.
          content: () => [
            div({ ...parts.backdrop }),
            div({ ...parts.content }, [
              h2({ ...parts.title }, [text(input.title)]),
              p({ ...parts.description }, [text(input.description)]),
              button({ ...parts.closeTrigger }, [text('Close')]),
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
          {
            type: 'show',
          },
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
      const parts = hoverCard.connect(state, send, { id: 'f' })
      return [
        button({ ...parts.trigger }, [text('Trigger')]),
        hoverCard.overlay({
          target: host,
          state,
          send,
          parts,
          placement: input.placement,
          content: () => [div({ ...parts.content }, [text(input.label)])],
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
      const parts = popover.connect(state, send, { id: 'f' })
      return [
        button({ ...parts.trigger }, [text('Trigger')]),
        popover.overlay({
          target: host,
          state,
          send,
          parts,
          placement: input.placement,
          arrowSelector: "[data-part='arrow']",
          // The content is a named dialog: `aria-labelledby` names the title
          // part, so the title must be rendered (#268 audit).
          content: () => [
            div({ ...parts.content }, [
              div({ ...parts.title }, [text(input.label)]),
              div({ ...parts.arrow }),
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
      const parts = tooltip.connect(state, send, { id: 't' })
      return [
        button({ ...parts.trigger }, [text('Hover')]),
        tooltip.overlay({
          target: host,
          state,
          send,
          parts,
          placement: input.placement,
          content: () => [div({ ...parts.content }, [text(input.label)])],
        }),
      ]
    },
  )

// ---------------------------------------------------------------------------
// component:menu

/** Synthetic value for the ONE submenu this renderer adds when `nestedOpen`
 * asks for one — structural rendering fixture, not case data (mirrors how
 * `navigation-data-scenarios.ts` keeps shared fixture SHAPE out of case
 * inputs). Real machine state: a `MenuNode` with `children`, opened via the
 * real `openSub` message. */
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
          ? menu.update(menu.init({ ...seedOpts, open: false }), {
              type: 'open',
            })[0]
          : input.presence === 'closing'
            ? menu.update(menu.init({ ...seedOpts, open: true }), {
                type: 'close',
              })[0]
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
      const parts = menu.connect(state, send, { id: 'm' })
      return [
        button({ ...parts.trigger }, [text('Open menu')]),
        parts.directionSync,
        menu.overlay({
          target: host,
          state,
          send,
          parts,
          placement: input.placement,
          content: () => [
            div({ ...parts.content }, [
              ...renderMenuItems(parts, input.items),
              ...(input.nestedOpen
                ? [
                    div({ ...parts.subTrigger(SUBMENU_VALUE) }, [text('More')]),
                    menu.subOverlay({
                      value: SUBMENU_VALUE,
                      state,
                      parts,
                      target: host,
                      content: () => [
                        div({ ...parts.subContent(SUBMENU_VALUE) }, [
                          div({ ...parts.item(SUBMENU_CHILD_VALUE).item }, [text('Submenu item')]),
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
      const parts = contextMenu.connect(state, send, { id: 'cm' })
      return [
        div({ ...parts.trigger }, [text('Right-click target')]),
        contextMenu.overlay({
          target: host,
          state,
          send,
          parts,
          content: () => [
            div({ ...parts.content }, [
              ...renderMenuItems(parts, input.items),
              ...(input.nestedOpen
                ? [
                    div({ ...parts.subTrigger(SUBMENU_VALUE) }, [text('More')]),
                    contextMenu.subOverlay({
                      value: SUBMENU_VALUE,
                      state,
                      parts,
                      target: host,
                      content: () => [
                        div({ ...parts.subContent(SUBMENU_VALUE) }, [
                          div({ ...parts.item(SUBMENU_CHILD_VALUE).item }, [text('Submenu item')]),
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
      const parts = menubar.connect(state, send, { id: 'mb' })
      return [
        div(
          { ...parts.root },
          input.menus.map((m) => button({ ...parts.menuTrigger(m.id) }, [text(m.label)])),
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
            content: () => [div({ ...menuParts.content }, renderMenuItems(menuParts, m.items))],
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
      const parts = navigationMenu.connect(state, send, { id: 'nav' })
      return [
        div({ ...parts.root }, [
          ...input.branches.map((branch) => {
            const item = parts.item(branch.id, { isBranch: true })
            return div([
              button({ ...item.trigger }, [text(branch.label)]),
              div({ ...item.content }, [text(`${branch.label} panel`)]),
            ])
          }),
          div({ ...parts.indicator }),
        ]),
        parts.directionSync,
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
      const parts = select.connect(state, send, { id: 's' })
      return [
        // role="combobox" takes no name from its content (#268 audit).
        button({ ...parts.trigger, 'aria-label': 'Fruit' }, [text('Select')]),
        select.overlay({
          target: host,
          state,
          send,
          parts,
          content: () => [
            div(
              { ...parts.content },
              input.items.map((value) => div({ ...parts.item(value).item }, [text(value)])),
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
      const parts = combobox.connect(state, send, { id: 'cb' })
      // Hidden only when SETTLED empty: a loading listbox stays exposed, since
      // `aria-busy` is how it announces the load (and permits it no options).
      const empty = caseInput.items.length === 0 && caseInput.status !== 'loading'
      return [
        input({ ...parts.input, 'aria-label': 'Fruit' }),
        combobox.overlay({
          target: host,
          state,
          send,
          parts,
          // A listbox owns only options: with nothing to list it is HIDDEN
          // (still the element `aria-controls` names) and the empty state is
          // its sibling (#268 audit).
          content: () => [
            div(
              { ...parts.content, hidden: empty },
              caseInput.items.map((value) => div({ ...parts.item(value).item }, [text(value)])),
            ),
            ...(empty ? [div({ ...parts.empty }, [text('No results')])] : []),
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
      const parts = searchableSelect.connect(state, send, { id: 'ss' })
      // Hidden only when SETTLED empty: a loading listbox stays exposed, since
      // `aria-busy` is how it announces the load (and permits it no options).
      const empty = caseInput.items.length === 0 && caseInput.status !== 'loading'
      // The popup box carries the presence attributes; the LISTBOX inside it
      // owns only options — the filter field sits above it, the empty state
      // beside it (#268 audit: the field used to sit inside the listbox and
      // the options outside it).
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
        button({ ...parts.trigger, 'aria-label': 'Fruit' }, [text('Searchable select')]),
        searchableSelect.overlay({
          target: host,
          state,
          send,
          parts,
          content: () => [
            div({ ...popup }, [
              input({ ...parts.input, 'aria-label': 'Filter fruit' }),
              div(
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
                caseInput.items.map((value) => div({ ...parts.item(value).item }, [text(value)])),
              ),
              ...(empty ? [div({ ...parts.empty }, [text('No results')])] : []),
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
        section({ ...parts.region }, [
          ...state.peek().toasts.map((t) => {
            const toastSig = state.map((s) => s.toasts.find((x) => x.id === t.id) ?? t)
            const itemParts = parts.toast(toastSig)
            return div({ ...itemParts.root }, [
              ...toastTypeIcons(),
              h2({ ...itemParts.title }, [text(t.title ?? '')]),
              p({ ...itemParts.description }, [text(t.description ?? '')]),
              ...(t.dismissable ? [button({ ...itemParts.closeTrigger }, [text('Dismiss')])] : []),
            ])
          }),
        ]),
      ]
    },
  )

// Every ToastType's own glyph, always mounted (six per toast row) and shown
// only under its own `data-type` via the CSS in menus-overlays.css — never
// resolved once from `t.type` in JS, so a mounted `update` patching `type`
// swaps the visible glyph reactively with no rebuild (#265).
const TOAST_TYPE_GLYPHS: Record<string, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  error: '✕',
  loading: '⟳',
  custom: '✦',
}

function toastTypeIcons(): Mountable[] {
  return Object.entries(TOAST_TYPE_GLYPHS).map(([type, glyph]) =>
    span(
      {
        'data-scope': 'toast',
        'data-part': 'type-icon',
        'data-icon': type,
        'aria-hidden': 'true',
      },
      [text(glyph)],
    ),
  )
}

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
      const parts = toolbar.connect(state, send, { id: 'tb' })
      return div(
        { ...parts.root },
        input.items.map((value) => button({ ...parts.item(value).root }, [text(value)])),
      )
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
      const parts = commandMenu.connect(state, send, { id: 'cmd' })
      // A named dialog (its title), a labelled search field, and a listbox
      // that owns only options — the empty-state `status` sits beside it
      // (#268 audit).
      return [
        button({ ...parts.dialog.trigger }, [text('Open command menu')]),
        dialog.overlay({
          target: host,
          state: state.map((s) => ({ open: s.open })),
          send: (m) => {
            if (m.type === 'close') send({ type: 'close' })
          },
          parts: parts.dialog,
          content: () => [
            div({ ...parts.dialog.content }, [
              h2({ ...parts.dialog.title }, [text('Command palette')]),
              div({ ...parts.combobox.root }, [
                input({ ...parts.combobox.input, 'aria-labelledby': parts.dialog.title.id }),
              ]),
              div(
                { ...parts.combobox.content },
                caseInput.commands.map((c) =>
                  div({ ...parts.combobox.item(c.id).item }, [text(c.label)]),
                ),
              ),
              div({ ...parts.empty }, [text('No commands match')]),
            ]),
          ],
        }),
      ]
    },
  )

// ---------------------------------------------------------------------------
// pattern:confirm-dialog — single composed `view()`.

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
    // `confirmDialog.view()` composes `dialog.connect`/`dialog.overlay`
    // internally (see `patterns/confirm-dialog.ts`) but does not expose a
    // `target` option, so its content always portals to the document body —
    // outside this renderer's per-case `host`. Reproduced inline here with
    // `target: host` added, using the SAME real `dialogConnect`/`dialogOverlay`
    // composition `view()` itself performs (never a fabricated stand-in).
    (state, send) => {
      const parts = dialog.connect(
        state.map((s) => ({ open: s.open })),
        () => {
          /* unused — buttons dispatch confirm-dialog messages directly */
        },
        { id: 'confirm', role: 'alertdialog', closeLabel: 'Cancel' },
      )
      return [
        dialog.overlay({
          target: host,
          state: state.map((s) => ({ open: s.open })),
          send: (m) => {
            if (m.type === 'close') send({ type: 'cancel' })
          },
          parts,
          content: () => [
            div({ ...parts.content, class: 'confirm-dialog' }, [
              h2({ ...parts.title }, [text(state.map((s) => s.title))]),
              p({ ...parts.description }, [text(state.map((s) => s.description))]),
              button(
                {
                  type: 'button',
                  class: 'btn btn-secondary',
                  onClick: () => send({ type: 'cancel' }),
                },
                [text(state.map((s) => s.cancelLabel))],
              ),
              button(
                {
                  type: 'button',
                  class: state.map((s) => (s.destructive ? 'btn btn-danger' : 'btn btn-primary')),
                  onClick: () => send({ type: 'confirm' }),
                },
                [text(state.map((s) => s.confirmLabel))],
              ),
            ]),
          ],
          closeOnOutsideClick: false,
        }),
      ]
    },
  )

/** Adapters for every one of the 17 menus-overlays ProductContract scenarios. */
export const BASELINE_ADAPTERS = {
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

function renderResolvedBaseline(
  host: HTMLElement,
  scenarioId: string,
  caseId: string,
  input: unknown,
  environment: PresentationScenarioEnvironment,
): Disposable {
  const adapter = BASELINE_ADAPTERS[scenarioId as keyof typeof BASELINE_ADAPTERS]
  if (adapter === undefined) {
    throw new Error(`No baseline adapter registered for menus-overlays scenario ${scenarioId}`)
  }
  return (adapter as Adapter<unknown>)(host, input, {
    scenarioId: scenarioId as MenusOverlaysDefinitionScenarioId,
    caseId,
    environment,
  })
}

function assertBindings(scenarios: readonly MenusOverlaysJoinedScenario[]): void {
  const scenarioIds = scenarios.map(({ scenarioId }) => scenarioId).sort()
  const bindingIds = Object.keys(BASELINE_ADAPTERS).sort()
  if (JSON.stringify(scenarioIds) !== JSON.stringify(bindingIds)) {
    throw new Error(
      `Baseline menus-overlays renderer bindings do not match applicable ProductContract scenarios: expected ${scenarioIds.join(', ')}; received ${bindingIds.join(', ')}`,
    )
  }
}

export function mountBaselineMenusOverlaysScenarios(
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
        path: 'baseline',
      })
      const host = document.createElement('section')
      host.id = `baseline-${scenario.productId}${
        scenarioCase.id === scenario.defaultCaseId ? '' : `--${scenarioCase.id}`
      }`
      host.dataset.scenarioRenderer = 'baseline'
      host.dataset.scenarioProduct = scenario.productId
      host.dataset.scenarioId = scenario.scenarioId
      host.dataset.scenarioCase = scenarioCase.id
      container.append(host)
      handles.push(
        renderResolvedBaseline(
          host,
          resolved.scenarioId,
          resolved.case.id,
          resolved.case.input,
          resolved.environment,
        ),
      )
    }
  }
  return {
    dispose: () => {
      for (const handle of handles) handle.dispose()
    },
  }
}

export { span }
