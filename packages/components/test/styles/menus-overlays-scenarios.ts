/**
 * The ONE menus/overlays family module (#265 finding #1/#2, part 1 of 2; #270
 * protocol; mirrors the accepted #264 navigation-data pattern).
 *
 * `MENUS_OVERLAYS_DEFINITIONS` owns every semantic case for the 17
 * menus-overlays ProductContract products, keyed by `scenarioId`. Each case's
 * `input` is typed, product-specific JSON mirroring the product's REAL
 * `init()`/state fields — never a generic `{label, detail}` bag. This is the
 * correction the #265 review history names directly: three prior candidates
 * were rejected because "the purported shared scenarios are metadata only"
 * and adapters were fabricated string templates rather than real
 * machine -> connect -> overlay compositions driven by this data.
 *
 * `compileScenarioFamily` performs the exact join against ProductContract at
 * compile time: a missing or stale scenarioId is a thrown
 * `PresentationScenarioError`, not a silent gap.
 *
 * Reachable presence lifecycles are per the review's own split, not a
 * uniform four-phase assumption:
 *  - Four-phase (`opening`/`open`/`closing`/`closed`, `closed` unmounted —
 *    same rationale as #264's disclosure products): alert-dialog, context-menu,
 *    dialog, drawer, hover-card, menu, popover, tooltip, command-menu,
 *    confirm-dialog.
 *  - Mounted-open plus optional structural retention (open/closed only, no
 *    animated exit): select, combobox, menubar, searchable-select — these
 *    machines publish `open: boolean` synchronously with no `status` field.
 *  - Indicator-only presence: navigation-menu — content itself is
 *    synchronously shown/hidden; only its retained indicator has a transition.
 *  - No presence at all: toolbar — persistently mounted, no disclosure surface.
 *
 * This module owns only PROTOCOL data (case `input`/`environmentAxes`).
 * Renderer adapters (real reducers/connect/overlay compositions) live
 * separately in `menus-overlays-baseline-renderer.ts`, kept OUT of this file
 * per the shared protocol's own "renderer adapters live in each app as
 * separate maps" rule — and per this issue's part-1 scope, this module is
 * designed so a future registry-side renderer (part 2) can consume the exact
 * same compiled catalog without a second classification.
 *
 * The legacy metadata-only projection this module used to carry at the
 * bottom of the file (`menusOverlaysScenarios`/
 * `MENUS_OVERLAYS_SCENARIO_DEFINITIONS`/`MenusOverlaysCaseInput`/etc., plus
 * the static-HTML `registry/test/menus-overlays.fixture.ts` and
 * `menus-overlays-baseline.fixture.ts` it fed) was DELETED in part 3: the
 * real per-product baseline and registry renderers above are now the only
 * consumers, driven live in real Chromium by
 * `menus-overlays-live-render.browser.test.ts` — see that file's header for
 * why a static-HTML/`page.setContent` projection was rejected.
 */
import {
  compileScenarioFamily,
  resolveScenarioSelection,
  type CompiledPresentationScenarioFamily,
  type PresentationScenarioEnvironmentAxis,
  type PresentationScenarioEnvironment,
  type ResolvedPresentationScenarioSelection,
} from '@llui/cli/presentation-scenarios'
import type { ProductContract, ProductEntry } from '@llui/cli'
import type { ToastType, ToastPlacement } from '../../src/components/toast.js'
import type { SelectionMode } from '../../src/components/select.js'
import type { AsyncStatus } from '../../src/components/combobox.js'

// Individual named consts, never a `Record`-typed lookup object — see
// navigation-data-scenarios.ts's identical comment for why: indexing a type
// with an index signature widens every property read to `T | undefined`
// under `noUncheckedIndexedAccess`, silently poisoning `environmentAxes`.
const AX = {
  theme: ['theme'] as readonly PresentationScenarioEnvironmentAxis[],
  dir: ['direction'] as readonly PresentationScenarioEnvironmentAxis[],
  motion: ['motion'] as readonly PresentationScenarioEnvironmentAxis[],
  narrow: ['viewport'] as readonly PresentationScenarioEnvironmentAxis[],
  forced: ['forcedColors'] as readonly PresentationScenarioEnvironmentAxis[],
  surface: ['theme', 'forcedColors'] as readonly PresentationScenarioEnvironmentAxis[],
  dirSurface: [
    'theme',
    'direction',
    'forcedColors',
  ] as readonly PresentationScenarioEnvironmentAxis[],
  floating: ['theme', 'motion', 'forcedColors'] as readonly PresentationScenarioEnvironmentAxis[],
  dirFloating: [
    'theme',
    'direction',
    'motion',
    'forcedColors',
  ] as readonly PresentationScenarioEnvironmentAxis[],
  modal: [
    'theme',
    'direction',
    'motion',
    'forcedColors',
  ] as readonly PresentationScenarioEnvironmentAxis[],
  none: [] as readonly PresentationScenarioEnvironmentAxis[],
}

export type MenusOverlaysPresence = 'opening' | 'open' | 'closing' | 'closed'

// ---------------------------------------------------------------------------
// Real per-product typed case inputs. Every field mirrors a real
// `init()`/state field of the machine named in `machineImport` for that
// scenarioId (verified against `packages/components/src/components/*.ts` /
// `src/patterns/*.ts`).

/** component:alert-dialog, component:dialog — real `DialogState`/`DialogInit`. */
export interface DialogLikeCaseInput {
  readonly presence: MenusOverlaysPresence
  readonly skipAnimations: boolean
  readonly modal?: boolean
  readonly title: string
  readonly description: string
}

/** component:drawer — real `DrawerState`/`DrawerInit` plus its `side` prop. */
export interface DrawerCaseInput {
  readonly presence: MenusOverlaysPresence
  readonly skipAnimations: boolean
  readonly side: 'top' | 'right' | 'bottom' | 'left'
  readonly title: string
  readonly description: string
}

/** component:hover-card, component:popover — real `PopoverState`-shaped machines. */
export interface FloatingPresenceCaseInput {
  readonly presence: MenusOverlaysPresence
  readonly skipAnimations: boolean
  readonly placement: FloatingPlacement
  readonly label: string
}

/** component:tooltip — real `TooltipState`/`TooltipInit` (`animated`, not `skipAnimations`). */
export interface TooltipCaseInput {
  readonly presence: MenusOverlaysPresence
  readonly animated: boolean
  readonly placement: FloatingPlacement
  readonly label: string
}

export type FloatingPlacement =
  | 'top'
  | 'top-start'
  | 'top-end'
  | 'bottom'
  | 'bottom-start'
  | 'bottom-end'
  | 'left'
  | 'left-start'
  | 'left-end'
  | 'right'
  | 'right-start'
  | 'right-end'

/** Real `MenuNode` shape (`kind`/`disabled`) — no invented "destructive"
 * field: upstream skins style a destructive row by VALUE (a view/skin
 * choice), never by machine state, so this case-input carries only fields
 * `menu-machine.ts`'s `MenuNode` actually has. */
export type MenuItemCaseInput = {
  readonly value: string
  readonly label: string
  readonly kind: 'action' | 'checkbox'
  readonly disabled: boolean
}

/** component:menu — real `MenuState`/`MenuInit`. */
export interface MenuCaseInput {
  readonly presence: MenusOverlaysPresence
  readonly skipAnimations: boolean
  readonly placement: FloatingPlacement
  readonly items: readonly MenuItemCaseInput[]
  readonly highlighted: string | null
  readonly checked: readonly string[]
  readonly nestedOpen: boolean
}

/** component:context-menu — real `ContextMenuState` (`x`/`y` virtual anchor). */
export interface ContextMenuCaseInput {
  readonly presence: MenusOverlaysPresence
  readonly skipAnimations: boolean
  readonly x: number
  readonly y: number
  readonly items: readonly MenuItemCaseInput[]
  readonly highlighted: string | null
  readonly nestedOpen: boolean
}

export type MenubarMenuCaseInput = {
  readonly id: string
  readonly label: string
  readonly disabled?: boolean
  readonly items: readonly MenuItemCaseInput[]
}

/** component:menubar — real `MenubarState`/`MenubarInit` (no `status`; synchronous open/closed). */
export interface MenubarCaseInput {
  readonly menus: readonly MenubarMenuCaseInput[]
  readonly open: string | null
  readonly focused: string | null
}

/** component:navigation-menu — real `NavMenuState`/`NavMenuInit`. */
export type NavigationMenuBranchCaseInput = {
  readonly id: string
  readonly label: string
}

export interface NavigationMenuCaseInput {
  readonly open: readonly string[]
  readonly focused: string | null
  readonly branches: readonly NavigationMenuBranchCaseInput[]
  readonly disabled: boolean
}

/** component:select — real `SelectState`/`SelectInit`. */
export interface SelectCaseInput {
  readonly open: boolean
  readonly value: readonly string[]
  readonly items: readonly string[]
  readonly disabledItems: readonly string[]
  readonly highlightedValue: string | null
  readonly selectionMode: SelectionMode
}

/** component:combobox, pattern:searchable-select — real `ComboboxState`/`ComboboxInit`. */
export interface ComboboxCaseInput {
  readonly open: boolean
  readonly value: readonly string[]
  readonly inputValue: string
  readonly items: readonly string[]
  readonly disabledItems: readonly string[]
  readonly highlightedValue: string | null
  readonly status: AsyncStatus
}

/** component:toast — real `Toast`/`ToasterState` published fields. */
export interface ToastCaseInput {
  readonly toastType: ToastType
  readonly title: string
  readonly description: string
  readonly placement: ToastPlacement
  readonly closing: boolean
  readonly animated: boolean
  readonly dismissable: boolean
}

/** component:toolbar — real `ToolbarState`/`ToolbarInit`. No presence: persistently mounted. */
export interface ToolbarCaseInput {
  readonly items: readonly string[]
  readonly disabledItems: readonly string[]
  readonly orientation: 'horizontal' | 'vertical'
}

/** pattern:command-menu — real `CommandMenuState`/`CommandMenuInit`. */
export interface CommandMenuCaseInput {
  readonly open: boolean
  readonly commands: readonly { readonly id: string; readonly label: string }[]
  readonly query: string
}

/** pattern:confirm-dialog — real `ConfirmDialogState`/`ConfirmDialogInit`. */
export interface ConfirmDialogCaseInput {
  readonly open: boolean
  readonly title: string
  readonly description: string
  readonly destructive: boolean
}

// Every element below is deliberately given the SAME set of keys (never an
// optional key present on one element and absent on another): a
// heterogeneous-shape array literal infers a per-element UNION type that
// `compileScenarioFamily`'s JSON-index-signature check rejects even when
// every element is genuinely JSON-plain — measured directly against this
// file's own shapes before this comment was written.
const overflowMenuItems = (count: number): readonly MenuItemCaseInput[] =>
  Array.from({ length: count }, (_, index) => ({
    value: `item-${index}`,
    label: `Item ${index}`,
    kind: 'action' as const,
    disabled: false,
  }))

const baseMenuItems: readonly MenuItemCaseInput[] = [
  { value: 'copy', label: 'Copy', kind: 'action', disabled: false },
  { value: 'paste', label: 'Paste', kind: 'action', disabled: true },
  { value: 'bold', label: 'Bold', kind: 'checkbox', disabled: false },
]

/**
 * The placements every floating product is proven at in real Chromium (#265
 * G2): all four SIDES, and all three ALIGNMENTS (center, start, end). Only
 * `bottom-end` declares the `direction` axis — `@floating-ui/core` mirrors the
 * inline-axis alignment of a top/bottom placement under RTL, while a side and
 * a left/right placement's block-axis alignment are direction-invariant.
 */
export const FLOATING_PLACEMENT_PROBES = ['top', 'right-start', 'bottom-end', 'left'] as const

/** One `placement-<placement>` case per {@link FLOATING_PLACEMENT_PROBES}
 * entry, each the product's own open `base` input at that placement. */
function placementCases<Input extends { readonly placement: FloatingPlacement }>(base: Input) {
  return FLOATING_PLACEMENT_PROBES.map((placement) => ({
    id: `placement-${placement}`,
    label: `Placement ${placement}`,
    input: { ...base, placement },
    environmentAxes: placement === 'bottom-end' ? AX.dir : AX.none,
  }))
}

/**
 * Family-owned definitions keyed by ProductContract `scenarioId`, joined
 * against `compileScenarioFamily`'s exactness check below.
 */
export const MENUS_OVERLAYS_DEFINITIONS = {
  'component:alert-dialog': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open modal',
        input: {
          presence: 'open',
          skipAnimations: true,
          title: 'Delete file?',
          description: 'This action cannot be undone.',
        } satisfies DialogLikeCaseInput,
        environmentAxes: AX.modal,
      },
      {
        id: 'opening',
        label: 'Opening',
        input: {
          presence: 'opening',
          skipAnimations: false,
          title: 'Delete file?',
          description: 'This action cannot be undone.',
        } satisfies DialogLikeCaseInput,
        environmentAxes: AX.motion,
      },
      {
        id: 'closing',
        label: 'Closing',
        input: {
          presence: 'closing',
          skipAnimations: false,
          title: 'Delete file?',
          description: 'This action cannot be undone.',
        } satisfies DialogLikeCaseInput,
        environmentAxes: AX.motion,
      },
    ],
  },
  'component:dialog': {
    defaultCaseId: 'modal',
    cases: [
      {
        id: 'modal',
        label: 'Open modal',
        input: {
          presence: 'open',
          skipAnimations: true,
          modal: true,
          title: 'Edit profile',
          description: 'Update your account details.',
        } satisfies DialogLikeCaseInput,
        environmentAxes: AX.modal,
      },
      {
        id: 'non-modal',
        label: 'Open non-modal',
        input: {
          presence: 'open',
          skipAnimations: true,
          modal: false,
          title: 'Edit profile',
          description: 'Update your account details.',
        } satisfies DialogLikeCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'opening',
        label: 'Opening',
        input: {
          presence: 'opening',
          skipAnimations: false,
          modal: true,
          title: 'Edit profile',
          description: 'Update your account details.',
        } satisfies DialogLikeCaseInput,
        environmentAxes: AX.motion,
      },
      {
        id: 'closing',
        label: 'Closing',
        input: {
          presence: 'closing',
          skipAnimations: false,
          modal: true,
          title: 'Edit profile',
          description: 'Update your account details.',
        } satisfies DialogLikeCaseInput,
        environmentAxes: AX.motion,
      },
    ],
  },
  'component:drawer': {
    defaultCaseId: 'right',
    cases: [
      {
        id: 'right',
        label: 'Right drawer',
        input: {
          presence: 'open',
          skipAnimations: true,
          side: 'right',
          title: 'Cart',
          description: 'Review your items.',
        } satisfies DrawerCaseInput,
        environmentAxes: AX.modal,
      },
      {
        id: 'left',
        label: 'Left drawer',
        input: {
          presence: 'open',
          skipAnimations: true,
          side: 'left',
          title: 'Navigation',
          description: 'Browse sections.',
        } satisfies DrawerCaseInput,
        environmentAxes: AX.dir,
      },
      {
        id: 'top',
        label: 'Top drawer',
        input: {
          presence: 'open',
          skipAnimations: true,
          side: 'top',
          title: 'Notice',
          description: 'A short banner drawer.',
        } satisfies DrawerCaseInput,
        environmentAxes: AX.none,
      },
      {
        id: 'bottom',
        label: 'Bottom drawer',
        input: {
          presence: 'open',
          skipAnimations: true,
          side: 'bottom',
          title: 'Sheet',
          description: 'A bottom sheet drawer.',
        } satisfies DrawerCaseInput,
        environmentAxes: AX.none,
      },
      {
        id: 'opening',
        label: 'Opening',
        input: {
          presence: 'opening',
          skipAnimations: false,
          side: 'right',
          title: 'Cart',
          description: 'Review your items.',
        } satisfies DrawerCaseInput,
        environmentAxes: AX.motion,
      },
      {
        id: 'closing',
        label: 'Closing',
        input: {
          presence: 'closing',
          skipAnimations: false,
          side: 'right',
          title: 'Cart',
          description: 'Review your items.',
        } satisfies DrawerCaseInput,
        environmentAxes: AX.motion,
      },
    ],
  },
  'component:hover-card': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open card',
        input: {
          presence: 'open',
          skipAnimations: true,
          placement: 'bottom',
          label: '@franco',
        } satisfies FloatingPresenceCaseInput,
        environmentAxes: AX.floating,
      },
      {
        id: 'opening',
        label: 'Opening',
        input: {
          presence: 'opening',
          skipAnimations: false,
          placement: 'bottom',
          label: '@franco',
        } satisfies FloatingPresenceCaseInput,
        environmentAxes: AX.motion,
      },
      {
        id: 'closing',
        label: 'Closing',
        input: {
          presence: 'closing',
          skipAnimations: false,
          placement: 'bottom',
          label: '@franco',
        } satisfies FloatingPresenceCaseInput,
        environmentAxes: AX.motion,
      },
      ...placementCases({
        presence: 'open',
        skipAnimations: true,
        placement: 'bottom',
        label: '@franco',
      } satisfies FloatingPresenceCaseInput),
    ],
  },
  'component:popover': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open popover',
        input: {
          presence: 'open',
          skipAnimations: true,
          placement: 'bottom',
          label: 'Dimensions',
        } satisfies FloatingPresenceCaseInput,
        environmentAxes: AX.floating,
      },
      {
        id: 'top-start',
        label: 'Top-start placement',
        input: {
          presence: 'open',
          skipAnimations: true,
          placement: 'top-start',
          label: 'Dimensions',
        } satisfies FloatingPresenceCaseInput,
        environmentAxes: AX.dir,
      },
      {
        // Unlike `top-start` (flush with the trigger's start edge, offset
        // 0 either way since the content is wider than the trigger button
        // and the start edges coincide), `top-end` gives a genuinely
        // NON-ZERO LTR offset: the content's END edge is flush with the
        // trigger's end edge, and the content is wider than the trigger, so
        // its start (left, in LTR) edge sits well left of the trigger's own.
        // Exercised by the live-render RTL mirror test, which needs a
        // non-zero LTR offset to prove an exact mirrored geometry rather
        // than a vacuous "some offset changed sign or vanished" check.
        id: 'top-end',
        label: 'Top-end placement',
        input: {
          presence: 'open',
          skipAnimations: true,
          placement: 'top-end',
          label: 'Dimensions',
        } satisfies FloatingPresenceCaseInput,
        environmentAxes: AX.dir,
      },
      {
        id: 'opening',
        label: 'Opening',
        input: {
          presence: 'opening',
          skipAnimations: false,
          placement: 'bottom',
          label: 'Dimensions',
        } satisfies FloatingPresenceCaseInput,
        environmentAxes: AX.motion,
      },
      {
        id: 'closing',
        label: 'Closing',
        input: {
          presence: 'closing',
          skipAnimations: false,
          placement: 'bottom',
          label: 'Dimensions',
        } satisfies FloatingPresenceCaseInput,
        environmentAxes: AX.motion,
      },
      {
        // Trigger mounts flush against the top of the page (the live-render
        // host is the first element appended to `document.body`), so a
        // `'top'` preference has no room above it at all — real floating-ui
        // collision detection must FLIP the resolved side to `'bottom'`.
        // Kills a `flip`-removed mutation of `attachFloating`
        // (packages/interactions/src/floating.ts): without flip middleware
        // the content renders off the top of the viewport at a negative y
        // instead.
        id: 'flip-required',
        label: 'Collision: flip required',
        input: {
          presence: 'open',
          skipAnimations: true,
          placement: 'top',
          label: 'Dimensions',
        } satisfies FloatingPresenceCaseInput,
        environmentAxes: AX.floating,
      },
      {
        // CENTERED (no start/end suffix): the content is centered on the
        // trigger's own center, which sits near the viewport's left edge
        // (the live-render host mounts flush against `document.body`), so
        // with a viewport this narrow the content overflows the LEFT edge.
        // There IS room below the trigger, so flip must NOT fire (the side
        // stays `'bottom'`) — and, unlike a `-start`/`-end` case, floating-ui
        // has no ALIGNMENT to swap to as a fallback for a centered
        // placement, so only the shift middleware can keep the content
        // on-screen. Kills a `shift`-removed mutation of `attachFloating`
        // (packages/interactions/src/floating.ts ~:199): without shift the
        // content overflows the viewport's left edge with the side
        // unchanged.
        id: 'shift-required',
        label: 'Collision: shift required',
        input: {
          presence: 'open',
          skipAnimations: true,
          placement: 'bottom',
          label:
            'An extremely long popover content label that will not fit inside a narrow viewport',
        } satisfies FloatingPresenceCaseInput,
        environmentAxes: AX.narrow,
      },
      ...placementCases({
        presence: 'open',
        skipAnimations: true,
        placement: 'bottom',
        label: 'Dimensions',
      } satisfies FloatingPresenceCaseInput),
    ],
  },
  'component:tooltip': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open tooltip',
        input: {
          presence: 'open',
          animated: false,
          placement: 'top',
          label: 'Save',
        } satisfies TooltipCaseInput,
        environmentAxes: AX.floating,
      },
      {
        id: 'opening',
        label: 'Opening',
        input: {
          presence: 'opening',
          animated: true,
          placement: 'top',
          label: 'Save',
        } satisfies TooltipCaseInput,
        environmentAxes: AX.motion,
      },
      {
        id: 'closing',
        label: 'Closing',
        input: {
          presence: 'closing',
          animated: true,
          placement: 'top',
          label: 'Save',
        } satisfies TooltipCaseInput,
        environmentAxes: AX.motion,
      },
      // Long enough to wrap under the 20rem cap: the probe needs the content
      // to differ from its anchor by >= 8px on BOTH axes, or a wrong
      // alignment would land inside the geometry tolerance.
      ...placementCases({
        presence: 'open',
        animated: false,
        placement: 'top',
        label: 'Save the document to disk and keep every open editor tab exactly where it was',
      } satisfies TooltipCaseInput),
    ],
  },
  'component:menu': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open menu states',
        input: {
          presence: 'open',
          skipAnimations: true,
          placement: 'bottom-start',
          items: baseMenuItems,
          highlighted: 'copy',
          checked: ['bold'],
          nestedOpen: false,
        } satisfies MenuCaseInput,
        environmentAxes: AX.dirFloating,
      },
      {
        id: 'submenu-open',
        label: 'Open with submenu',
        input: {
          presence: 'open',
          skipAnimations: true,
          placement: 'bottom-start',
          items: baseMenuItems,
          highlighted: 'copy',
          checked: ['bold'],
          nestedOpen: true,
        } satisfies MenuCaseInput,
        environmentAxes: AX.dir,
      },
      {
        id: 'opening',
        label: 'Opening',
        input: {
          presence: 'opening',
          skipAnimations: false,
          placement: 'bottom-start',
          items: baseMenuItems,
          highlighted: null,
          checked: [],
          nestedOpen: false,
        } satisfies MenuCaseInput,
        environmentAxes: AX.motion,
      },
      {
        id: 'closing',
        label: 'Closing',
        input: {
          presence: 'closing',
          skipAnimations: false,
          placement: 'bottom-start',
          items: baseMenuItems,
          highlighted: null,
          checked: [],
          nestedOpen: false,
        } satisfies MenuCaseInput,
        environmentAxes: AX.motion,
      },
      {
        id: 'overflow',
        label: 'Overflow containment',
        input: {
          presence: 'open',
          skipAnimations: true,
          placement: 'bottom-start',
          items: overflowMenuItems(24),
          highlighted: null,
          checked: [],
          nestedOpen: false,
        } satisfies MenuCaseInput,
        environmentAxes: AX.narrow,
      },
      // One wide entry, so the content is clearly wider than its trigger
      // (see the tooltip's probe above for why).
      ...placementCases({
        presence: 'open',
        skipAnimations: true,
        placement: 'bottom-start',
        items: [
          ...baseMenuItems,
          {
            value: 'export',
            label: 'Export as a portable document',
            kind: 'action',
            disabled: false,
          },
        ],
        highlighted: 'copy',
        checked: ['bold'],
        nestedOpen: false,
      } satisfies MenuCaseInput),
    ],
  },
  'component:context-menu': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open virtual menu',
        input: {
          presence: 'open',
          skipAnimations: true,
          x: 240,
          y: 160,
          items: baseMenuItems,
          highlighted: 'copy',
          nestedOpen: false,
        } satisfies ContextMenuCaseInput,
        environmentAxes: AX.dirFloating,
      },
      {
        id: 'edge-anchor',
        label: 'Viewport-edge anchor',
        input: {
          presence: 'open',
          skipAnimations: true,
          x: 4,
          y: 4,
          items: baseMenuItems,
          highlighted: null,
          nestedOpen: false,
        } satisfies ContextMenuCaseInput,
        environmentAxes: AX.narrow,
      },
      {
        id: 'submenu-open',
        label: 'Open with submenu',
        input: {
          presence: 'open',
          skipAnimations: true,
          x: 240,
          y: 160,
          items: baseMenuItems,
          highlighted: 'copy',
          nestedOpen: true,
        } satisfies ContextMenuCaseInput,
        environmentAxes: AX.dir,
      },
      {
        id: 'opening',
        label: 'Opening',
        input: {
          presence: 'opening',
          skipAnimations: false,
          x: 240,
          y: 160,
          items: baseMenuItems,
          highlighted: null,
          nestedOpen: false,
        } satisfies ContextMenuCaseInput,
        environmentAxes: AX.motion,
      },
      {
        id: 'closing',
        label: 'Closing',
        input: {
          presence: 'closing',
          skipAnimations: false,
          x: 240,
          y: 160,
          items: baseMenuItems,
          highlighted: null,
          nestedOpen: false,
        } satisfies ContextMenuCaseInput,
        environmentAxes: AX.motion,
      },
    ],
  },
  'component:menubar': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open menubar menu',
        input: {
          menus: [
            { id: 'file', label: 'File', items: baseMenuItems, disabled: false },
            { id: 'edit', label: 'Edit', items: baseMenuItems, disabled: true },
          ],
          open: 'file',
          focused: 'file',
        } satisfies MenubarCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'closed',
        label: 'Closed menubar',
        input: {
          menus: [
            { id: 'file', label: 'File', items: baseMenuItems, disabled: false },
            { id: 'edit', label: 'Edit', items: baseMenuItems, disabled: true },
          ],
          open: null,
          focused: null,
        } satisfies MenubarCaseInput,
        environmentAxes: AX.none,
      },
    ],
  },
  'component:navigation-menu': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open branch',
        input: {
          open: ['products'],
          focused: 'products',
          branches: [
            { id: 'products', label: 'Products' },
            { id: 'docs', label: 'Docs' },
          ],
          disabled: false,
        } satisfies NavigationMenuCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'closed',
        label: 'Closed branch',
        input: {
          open: [],
          focused: null,
          branches: [
            { id: 'products', label: 'Products' },
            { id: 'docs', label: 'Docs' },
          ],
          disabled: false,
        } satisfies NavigationMenuCaseInput,
        environmentAxes: AX.none,
      },
    ],
  },
  'component:select': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open single-select',
        input: {
          open: true,
          value: ['apple'],
          items: ['apple', 'banana', 'cherry'],
          disabledItems: ['cherry'],
          highlightedValue: 'banana',
          selectionMode: 'single',
        } satisfies SelectCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'multiple',
        label: 'Open multi-select',
        input: {
          open: true,
          value: ['apple', 'banana'],
          items: ['apple', 'banana', 'cherry'],
          disabledItems: [],
          highlightedValue: 'cherry',
          selectionMode: 'multiple',
        } satisfies SelectCaseInput,
        environmentAxes: AX.none,
      },
      {
        id: 'closed',
        label: 'Closed trigger',
        input: {
          open: false,
          value: ['apple'],
          items: ['apple', 'banana', 'cherry'],
          disabledItems: [],
          highlightedValue: null,
          selectionMode: 'single',
        } satisfies SelectCaseInput,
        environmentAxes: AX.none,
      },
    ],
  },
  'component:combobox': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open options',
        input: {
          open: true,
          value: ['apple'],
          inputValue: 'ap',
          items: ['apple', 'apricot', 'banana'],
          disabledItems: [],
          highlightedValue: 'apple',
          status: 'loaded',
        } satisfies ComboboxCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'loading',
        label: 'Loading options',
        input: {
          open: true,
          value: [],
          inputValue: 'ap',
          items: [],
          disabledItems: [],
          highlightedValue: null,
          status: 'loading',
        } satisfies ComboboxCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'stale-results',
        label: 'Stale results while revalidating',
        input: {
          open: true,
          value: [],
          inputValue: 'apr',
          items: ['apple', 'apricot'],
          disabledItems: [],
          highlightedValue: 'apple',
          status: 'loading',
        } satisfies ComboboxCaseInput,
        environmentAxes: AX.none,
      },
      {
        id: 'error',
        label: 'Load error',
        input: {
          open: true,
          value: [],
          inputValue: 'ap',
          items: [],
          disabledItems: [],
          highlightedValue: null,
          status: 'error',
        } satisfies ComboboxCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'closed',
        label: 'Closed trigger',
        input: {
          open: false,
          value: ['apple'],
          inputValue: '',
          items: ['apple', 'apricot', 'banana'],
          disabledItems: [],
          highlightedValue: null,
          status: 'idle',
        } satisfies ComboboxCaseInput,
        environmentAxes: AX.none,
      },
    ],
  },
  'component:toast': {
    defaultCaseId: 'success',
    cases: [
      ...(['info', 'success', 'warning', 'error', 'loading', 'custom'] as const).map(
        (toastType) => ({
          id: toastType,
          label: `${toastType[0]!.toUpperCase()}${toastType.slice(1)} toast`,
          input: {
            toastType,
            title: `${toastType[0]!.toUpperCase()}${toastType.slice(1)}`,
            description: `A ${toastType} toast notification.`,
            placement: 'bottom-end' as const,
            closing: false,
            animated: false,
            dismissable: true,
          } satisfies ToastCaseInput,
          // Every ToastType case supports theme/forced-colors (#265 task
          // item 2 — per-type contrast is measured in light, dark, AND
          // forced colors, not only the default case); `success` additionally
          // supports direction (its own dedicated placement/RTL coverage).
          environmentAxes: toastType === 'success' ? AX.dirSurface : AX.surface,
        }),
      ),
      ...(['top', 'top-start', 'top-end', 'bottom', 'bottom-start', 'bottom-end'] as const).map(
        (placement) => ({
          id: `placement-${placement}`,
          label: `${placement} placement`,
          input: {
            toastType: 'info' as const,
            title: 'Notice',
            description: 'Positioned toast.',
            placement,
            closing: false,
            animated: false,
            dismissable: true,
          } satisfies ToastCaseInput,
          environmentAxes: placement.includes('-') ? AX.dir : AX.none,
        }),
      ),
      {
        id: 'closing',
        label: 'Closing toast',
        input: {
          toastType: 'info',
          title: 'Notice',
          description: 'Dismissing…',
          placement: 'bottom-end',
          closing: true,
          animated: true,
          dismissable: true,
        } satisfies ToastCaseInput,
        environmentAxes: AX.motion,
      },
      {
        id: 'undismissable',
        label: 'Non-dismissable toast',
        input: {
          toastType: 'loading',
          title: 'Uploading…',
          description: 'Please wait.',
          placement: 'bottom-end',
          closing: false,
          animated: false,
          dismissable: false,
        } satisfies ToastCaseInput,
        environmentAxes: AX.none,
      },
    ],
  },
  'component:toolbar': {
    defaultCaseId: 'horizontal',
    cases: [
      {
        id: 'horizontal',
        label: 'Horizontal toolbar',
        input: {
          items: ['bold', 'italic', 'underline'],
          disabledItems: ['underline'],
          orientation: 'horizontal',
        } satisfies ToolbarCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'vertical',
        label: 'Vertical toolbar',
        input: {
          items: ['bold', 'italic', 'underline'],
          disabledItems: ['underline'],
          orientation: 'vertical',
        } satisfies ToolbarCaseInput,
        environmentAxes: AX.none,
      },
    ],
  },
  'pattern:command-menu': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open commands',
        input: {
          open: true,
          commands: [
            { id: 'new-file', label: 'New File' },
            { id: 'open-file', label: 'Open File' },
          ],
          query: '',
        } satisfies CommandMenuCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'empty',
        label: 'No matching commands',
        input: {
          open: true,
          commands: [
            { id: 'new-file', label: 'New File' },
            { id: 'open-file', label: 'Open File' },
          ],
          query: 'zzz-no-match',
        } satisfies CommandMenuCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'closed',
        label: 'Closed palette',
        input: {
          open: false,
          commands: [
            { id: 'new-file', label: 'New File' },
            { id: 'open-file', label: 'Open File' },
          ],
          query: '',
        } satisfies CommandMenuCaseInput,
        environmentAxes: AX.none,
      },
    ],
  },
  'pattern:confirm-dialog': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Destructive confirmation',
        input: {
          open: true,
          title: 'Delete project?',
          description: 'This will permanently delete the project.',
          destructive: true,
        } satisfies ConfirmDialogCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'closed',
        label: 'Closed confirmation',
        input: {
          open: false,
          title: 'Delete project?',
          description: 'This will permanently delete the project.',
          destructive: true,
        } satisfies ConfirmDialogCaseInput,
        environmentAxes: AX.none,
      },
    ],
  },
  'pattern:searchable-select': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open searchable options',
        input: {
          open: true,
          value: ['apple'],
          inputValue: 'ap',
          items: ['apple', 'apricot', 'banana'],
          disabledItems: [],
          highlightedValue: 'apple',
          status: 'loaded',
        } satisfies ComboboxCaseInput,
        environmentAxes: AX.dirSurface,
      },
      {
        id: 'loading',
        label: 'Loading options',
        input: {
          open: true,
          value: [],
          inputValue: 'ap',
          items: [],
          disabledItems: [],
          highlightedValue: null,
          status: 'loading',
        } satisfies ComboboxCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'error',
        label: 'Load error',
        input: {
          open: true,
          value: [],
          inputValue: 'ap',
          items: [],
          disabledItems: [],
          highlightedValue: null,
          status: 'error',
        } satisfies ComboboxCaseInput,
        environmentAxes: AX.surface,
      },
      {
        id: 'closed',
        label: 'Closed trigger',
        input: {
          open: false,
          value: ['apple'],
          inputValue: '',
          items: ['apple', 'apricot', 'banana'],
          disabledItems: [],
          highlightedValue: null,
          status: 'idle',
        } satisfies ComboboxCaseInput,
        environmentAxes: AX.none,
      },
    ],
  },
} as const

export type MenusOverlaysDefinitions = typeof MENUS_OVERLAYS_DEFINITIONS
export type MenusOverlaysCatalog = CompiledPresentationScenarioFamily<MenusOverlaysDefinitions>
export type MenusOverlaysCompiledScenario = MenusOverlaysCatalog['scenarios'][number]
export type MenusOverlaysCompiledCase = MenusOverlaysCompiledScenario['cases'][number]
export type MenusOverlaysResolved = ResolvedPresentationScenarioSelection<MenusOverlaysDefinitions>
export type MenusOverlaysDefinitionScenarioId = keyof MenusOverlaysDefinitions & string

/** Compile the family catalog against a real ProductContract. Throws a
 * `PresentationScenarioError` if the contract's menus-overlays products and
 * this module's keys are not in exact agreement (missing or stale). */
export function compileMenusOverlaysCatalog(contract: ProductContract): MenusOverlaysCatalog {
  return compileScenarioFamily(contract, 'menus-overlays', MENUS_OVERLAYS_DEFINITIONS)
}

export { resolveScenarioSelection }
export type { PresentationScenarioEnvironment }

/** One menus-overlays scenario joined with its ProductContract entry — the
 * ergonomic shape a renderer file consumes alongside the compiled cases. */
export interface MenusOverlaysJoinedScenario {
  readonly productId: string
  readonly displayName: string
  readonly scenarioId: MenusOverlaysDefinitionScenarioId
  readonly defaultCaseId: string
  readonly cases: readonly MenusOverlaysCompiledCase[]
  readonly presentation: ProductEntry['presentation']
  readonly copiedArtifacts: ProductEntry['copiedArtifacts']
  readonly machine: ProductEntry['machine']
}

export function joinMenusOverlaysScenarios(
  catalog: MenusOverlaysCatalog,
  contract: ProductContract,
): MenusOverlaysJoinedScenario[] {
  const entryByName = new Map(contract.entries.map((entry) => [entry.name, entry]))
  return catalog.scenarios.map((scenario) => {
    const entry = entryByName.get(scenario.productId)
    if (entry === undefined) {
      throw new Error(`No ProductContract entry named ${scenario.productId}`)
    }
    return {
      productId: scenario.productId,
      displayName: entry.displayName,
      scenarioId: scenario.scenarioId as MenusOverlaysDefinitionScenarioId,
      defaultCaseId: scenario.defaultCaseId,
      cases: scenario.cases,
      presentation: entry.presentation,
      copiedArtifacts: entry.copiedArtifacts,
      machine: entry.machine,
    }
  })
}

function isVisuallyApplicable(mode: string): boolean {
  return mode === 'styled' || mode === 'partial' || mode === 'composed'
}

export type MenusOverlaysPath = 'baseline' | 'registryTailwind'

export function applicableMenusOverlaysScenarios(
  joined: readonly MenusOverlaysJoinedScenario[],
  path: MenusOverlaysPath,
): MenusOverlaysJoinedScenario[] {
  return joined.filter(({ presentation }) => isVisuallyApplicable(presentation[path].mode))
}
