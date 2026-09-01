import type { ProductContract, ProductEntry } from '../../packages/cli/src/product-contract.js'
import type { ToastPlacement, ToastType } from '../../packages/components/src/components/toast.js'

export const MENUS_OVERLAYS_ENVIRONMENT_AXES = {
  theme: ['light', 'dark'],
  direction: ['ltr', 'rtl'],
  motion: ['full', 'reduced'],
  viewport: ['wide', 'narrow'],
  forcedColors: [false, true],
} as const

export type MenusOverlaysEnvironmentAxis = keyof typeof MENUS_OVERLAYS_ENVIRONMENT_AXES
export type MenusOverlaysPresence = 'opening' | 'open' | 'closing' | 'closed'
export type MenusOverlaysPhysicalSide = 'top' | 'right' | 'bottom' | 'left'

export interface MenusOverlaysScenarioContent {
  /** Accessible/visible name used by the real component surface. */
  readonly label: string
  /** Supporting copy rendered by the surface, live region, or description part. */
  readonly detail: string
}

/**
 * Family-local semantic payload. A field is present only when the product has
 * that capability, and both independent adapters must consume every present
 * leaf as component state, ARIA, visible content, or geometry. Environment is
 * orthogonal and therefore lives on the case rather than in this payload.
 */
export interface MenusOverlaysCaseInput {
  readonly presence?: MenusOverlaysPresence
  readonly modal?: boolean
  readonly side?: MenusOverlaysPhysicalSide
  readonly edge?: MenusOverlaysPhysicalSide
  readonly items?: {
    readonly highlighted?: boolean
    readonly selected?: boolean
    readonly checked?: boolean
    readonly disabled?: boolean
    readonly destructive?: boolean
    readonly nested?: boolean
  }
  readonly asyncStatus?: 'loading' | 'empty' | 'error'
  readonly toastType?: ToastType
  readonly toastPlacement?: ToastPlacement
  readonly orientation?: 'horizontal' | 'vertical'
  /** Dedicated containment stress. Absent from ordinary product cases. */
  readonly overflow?: { readonly itemCount: number }
  readonly content: MenusOverlaysScenarioContent
}

type MenusOverlaysCaseSeed = Omit<MenusOverlaysCaseInput, 'content'>

export interface MenusOverlaysScenarioCase {
  readonly id: string
  readonly label: string
  readonly input: MenusOverlaysCaseInput
  readonly environmentAxes: readonly MenusOverlaysEnvironmentAxis[]
}

export interface MenusOverlaysUnsupportedCase {
  readonly id: string
  readonly rationale: string
}

interface MenusOverlaysScenarioCaseDefinition {
  readonly id: string
  readonly label: string
  readonly input: MenusOverlaysCaseSeed
  readonly environmentAxes: readonly MenusOverlaysEnvironmentAxis[]
}

interface MenusOverlaysScenarioDefinition {
  readonly defaultCaseId: string
  readonly cases: readonly MenusOverlaysScenarioCaseDefinition[]
  readonly unsupportedCases: readonly MenusOverlaysUnsupportedCase[]
}

const SURFACE_AXES = ['theme', 'forcedColors'] as const
const DIRECTIONAL_SURFACE_AXES = ['theme', 'direction', 'forcedColors'] as const
const FLOATING_AXES = ['theme', 'motion', 'forcedColors'] as const
const DIRECTIONAL_FLOATING_AXES = ['theme', 'direction', 'motion', 'forcedColors'] as const
const MODAL_AXES = ['theme', 'direction', 'motion', 'forcedColors'] as const
const MOTION_AXES = ['motion'] as const

const overflowCase = (
  input: MenusOverlaysCaseSeed,
): readonly [MenusOverlaysScenarioCaseDefinition] => [
  {
    id: 'overflow',
    label: 'Overflow containment',
    input: { ...input, overflow: { itemCount: 24 } },
    environmentAxes: ['viewport'],
  },
]

const fourPhaseUnsupported = [
  {
    id: 'closed',
    rationale:
      'The closed phase is intentionally unmounted after the exit end event, so it has no retained gallery surface.',
  },
] as const

const synchronousSelectionUnsupported = [
  {
    id: 'opening',
    rationale:
      'The machine publishes open/closed synchronously; an optional consumer transition can defer mounting but is not machine state.',
  },
  {
    id: 'closing',
    rationale:
      'The machine publishes open/closed synchronously; an optional consumer transition can defer unmounting but is not machine state.',
  },
] as const

const openMenuInput = {
  presence: 'open',
  side: 'bottom',
  items: {
    highlighted: true,
    checked: true,
    disabled: true,
    destructive: true,
    nested: true,
  },
} as const satisfies MenusOverlaysCaseSeed

const openSelectionInput = {
  presence: 'open',
  side: 'bottom',
  items: { highlighted: true, selected: true, disabled: true },
} as const satisfies MenusOverlaysCaseSeed

const floatingPresenceCases = (
  openLabel: string,
  axes: readonly MenusOverlaysEnvironmentAxis[] = FLOATING_AXES,
): readonly MenusOverlaysScenarioCaseDefinition[] => [
  {
    id: 'open',
    label: openLabel,
    input: { presence: 'open', side: 'bottom' },
    environmentAxes: axes,
  },
  {
    id: 'opening',
    label: 'Opening',
    input: { presence: 'opening', side: 'bottom' },
    environmentAxes: MOTION_AXES,
  },
  {
    id: 'closing',
    label: 'Closing',
    input: { presence: 'closing', side: 'bottom' },
    environmentAxes: MOTION_AXES,
  },
  ...overflowCase({ presence: 'open', side: 'bottom' }),
]

/**
 * Explicit behavior keyed by ProductContract scenario identity. This is not a
 * second inventory: projection below rejects missing and extra keys against
 * the canonical contract before either renderer can consume it.
 */
export const MENUS_OVERLAYS_SCENARIO_DEFINITIONS = {
  'component:alert-dialog': {
    defaultCaseId: 'open',
    cases: [
      { id: 'open', label: 'Open modal', input: { presence: 'open' }, environmentAxes: MODAL_AXES },
      {
        id: 'opening',
        label: 'Opening',
        input: { presence: 'opening' },
        environmentAxes: MOTION_AXES,
      },
      {
        id: 'closing',
        label: 'Closing',
        input: { presence: 'closing' },
        environmentAxes: MOTION_AXES,
      },
      ...overflowCase({ presence: 'open' }),
    ],
    unsupportedCases: fourPhaseUnsupported,
  },
  'component:combobox': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open options',
        input: openSelectionInput,
        environmentAxes: DIRECTIONAL_SURFACE_AXES,
      },
      {
        id: 'loading',
        label: 'Loading options',
        input: { presence: 'open', side: 'bottom', asyncStatus: 'loading' },
        environmentAxes: SURFACE_AXES,
      },
      {
        id: 'empty',
        label: 'No options',
        input: { presence: 'open', side: 'bottom', asyncStatus: 'empty' },
        environmentAxes: SURFACE_AXES,
      },
      {
        id: 'error',
        label: 'Load error',
        input: { presence: 'open', side: 'bottom', asyncStatus: 'error' },
        environmentAxes: SURFACE_AXES,
      },
      { id: 'closed', label: 'Closed trigger', input: { presence: 'closed' }, environmentAxes: [] },
      ...overflowCase({ presence: 'open', side: 'bottom' }),
    ],
    unsupportedCases: synchronousSelectionUnsupported,
  },
  'component:context-menu': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open virtual menu',
        input: openMenuInput,
        environmentAxes: DIRECTIONAL_FLOATING_AXES,
      },
      {
        id: 'opening',
        label: 'Opening',
        input: { presence: 'opening', side: 'bottom' },
        environmentAxes: MOTION_AXES,
      },
      {
        id: 'closing',
        label: 'Closing',
        input: { presence: 'closing', side: 'bottom' },
        environmentAxes: MOTION_AXES,
      },
      ...overflowCase({ presence: 'open', side: 'bottom' }),
    ],
    unsupportedCases: fourPhaseUnsupported,
  },
  'component:dialog': {
    defaultCaseId: 'modal',
    cases: [
      {
        id: 'modal',
        label: 'Open modal',
        input: { presence: 'open', modal: true },
        environmentAxes: MODAL_AXES,
      },
      {
        id: 'non-modal',
        label: 'Open non-modal',
        input: { presence: 'open', modal: false },
        environmentAxes: DIRECTIONAL_SURFACE_AXES,
      },
      {
        id: 'opening',
        label: 'Opening',
        input: { presence: 'opening', modal: true },
        environmentAxes: MOTION_AXES,
      },
      {
        id: 'closing',
        label: 'Closing',
        input: { presence: 'closing', modal: true },
        environmentAxes: MOTION_AXES,
      },
      ...overflowCase({ presence: 'open', modal: true }),
    ],
    unsupportedCases: fourPhaseUnsupported,
  },
  'component:drawer': {
    defaultCaseId: 'right',
    cases: [
      {
        id: 'right',
        label: 'Right drawer',
        input: { presence: 'open', edge: 'right' },
        environmentAxes: MODAL_AXES,
      },
      {
        id: 'left',
        label: 'Left drawer',
        input: { presence: 'open', edge: 'left' },
        environmentAxes: ['direction'],
      },
      {
        id: 'opening',
        label: 'Opening',
        input: { presence: 'opening', edge: 'right' },
        environmentAxes: MOTION_AXES,
      },
      {
        id: 'closing',
        label: 'Closing',
        input: { presence: 'closing', edge: 'right' },
        environmentAxes: MOTION_AXES,
      },
      ...overflowCase({ presence: 'open', edge: 'right' }),
    ],
    unsupportedCases: fourPhaseUnsupported,
  },
  'component:hover-card': {
    defaultCaseId: 'open',
    cases: floatingPresenceCases('Open card'),
    unsupportedCases: fourPhaseUnsupported,
  },
  'component:menu': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open menu states',
        input: openMenuInput,
        environmentAxes: DIRECTIONAL_FLOATING_AXES,
      },
      {
        id: 'opening',
        label: 'Opening',
        input: { presence: 'opening', side: 'bottom' },
        environmentAxes: MOTION_AXES,
      },
      {
        id: 'closing',
        label: 'Closing',
        input: { presence: 'closing', side: 'bottom' },
        environmentAxes: MOTION_AXES,
      },
      ...overflowCase({ presence: 'open', side: 'bottom', items: { nested: true } }),
    ],
    unsupportedCases: fourPhaseUnsupported,
  },
  'component:menubar': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open menubar menu',
        input: openMenuInput,
        environmentAxes: DIRECTIONAL_SURFACE_AXES,
      },
      {
        id: 'closed',
        label: 'Closed menubar',
        input: { presence: 'closed' },
        environmentAxes: [],
      },
      ...overflowCase({ presence: 'open', side: 'bottom' }),
    ],
    unsupportedCases: synchronousSelectionUnsupported,
  },
  'component:navigation-menu': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open branch',
        input: { presence: 'open', items: { selected: true, nested: true } },
        environmentAxes: DIRECTIONAL_SURFACE_AXES,
      },
      {
        id: 'closed',
        label: 'Closed branch',
        input: { presence: 'closed' },
        environmentAxes: [],
      },
      ...overflowCase({ presence: 'open' }),
    ],
    unsupportedCases: [
      {
        id: 'vertical',
        rationale:
          'The navigation-menu API implements the horizontal disclosure pattern and exposes no orientation option.',
      },
      {
        id: 'opening-or-closing-content',
        rationale:
          'Navigation content is synchronously hidden/open; only its retained indicator has a transition lifecycle.',
      },
    ],
  },
  'component:popover': {
    defaultCaseId: 'open',
    cases: floatingPresenceCases('Open popover'),
    unsupportedCases: fourPhaseUnsupported,
  },
  'component:select': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open options',
        input: openSelectionInput,
        environmentAxes: DIRECTIONAL_SURFACE_AXES,
      },
      { id: 'closed', label: 'Closed trigger', input: { presence: 'closed' }, environmentAxes: [] },
      ...overflowCase({ presence: 'open', side: 'bottom' }),
    ],
    unsupportedCases: synchronousSelectionUnsupported,
  },
  'component:toast': {
    defaultCaseId: 'success',
    cases: [
      ...(['info', 'success', 'warning', 'error', 'loading', 'custom'] as const).map(
        (toastType) => ({
          id: toastType,
          label: `${toastType[0]!.toUpperCase()}${toastType.slice(1)} toast`,
          input: { presence: 'open' as const, toastType, toastPlacement: 'bottom-end' as const },
          environmentAxes: toastType === 'success' ? DIRECTIONAL_SURFACE_AXES : [],
        }),
      ),
      ...(['top', 'top-start', 'top-end', 'bottom', 'bottom-start'] as const).map(
        (toastPlacement) => ({
          id: `placement-${toastPlacement}`,
          label: `${toastPlacement} placement`,
          input: { presence: 'open' as const, toastType: 'info' as const, toastPlacement },
          environmentAxes: toastPlacement.includes('-') ? (['direction'] as const) : [],
        }),
      ),
      {
        id: 'closing',
        label: 'Closing toast',
        input: { presence: 'closing', toastType: 'info', toastPlacement: 'bottom-end' },
        environmentAxes: MOTION_AXES,
      },
      ...overflowCase({ presence: 'open', toastType: 'info', toastPlacement: 'bottom-end' }),
    ],
    unsupportedCases: [
      {
        id: 'opening',
        rationale: 'Toasts are born open; the machine only retains the animated closing phase.',
      },
      {
        id: 'closed',
        rationale: 'A toast is removed from the queue when its closing end event settles.',
      },
    ],
  },
  'component:toolbar': {
    defaultCaseId: 'horizontal',
    cases: [
      {
        id: 'horizontal',
        label: 'Horizontal toolbar',
        input: { items: { disabled: true }, orientation: 'horizontal' },
        environmentAxes: SURFACE_AXES,
      },
      {
        id: 'vertical',
        label: 'Vertical toolbar',
        input: { items: { disabled: true }, orientation: 'vertical' },
        environmentAxes: [],
      },
      ...overflowCase({ orientation: 'horizontal' }),
    ],
    unsupportedCases: [
      {
        id: 'presence-lifecycle',
        rationale:
          'A toolbar is persistently mounted and has no disclosure surface or presence state.',
      },
    ],
  },
  'component:tooltip': {
    defaultCaseId: 'open',
    cases: floatingPresenceCases('Open tooltip'),
    unsupportedCases: fourPhaseUnsupported,
  },
  'pattern:command-menu': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open commands',
        input: { presence: 'open', modal: true, items: { disabled: true } },
        environmentAxes: DIRECTIONAL_SURFACE_AXES,
      },
      {
        id: 'empty',
        label: 'No matching commands',
        input: { presence: 'open', modal: true, asyncStatus: 'empty' },
        environmentAxes: SURFACE_AXES,
      },
      {
        id: 'closed',
        label: 'Closed palette',
        input: { presence: 'closed', modal: true },
        environmentAxes: [],
      },
      ...overflowCase({ presence: 'open', modal: true }),
    ],
    unsupportedCases: [
      {
        id: 'loading-or-error',
        rationale:
          'The command-menu pattern filters an in-memory command list and exposes no async loading/error state.',
      },
      {
        id: 'highlighted-command',
        rationale:
          'The composed command-menu state does not retain a roving highlighted command; Enter executes its first enabled filtered command.',
      },
      {
        id: 'opening-or-closing',
        rationale:
          'The composed dialog currently receives a boolean open state and uses the synchronous default lifecycle.',
      },
    ],
  },
  'pattern:confirm-dialog': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Destructive confirmation',
        input: { presence: 'open', modal: true, items: { destructive: true } },
        environmentAxes: DIRECTIONAL_SURFACE_AXES,
      },
      {
        id: 'closed',
        label: 'Closed confirmation',
        input: { presence: 'closed', modal: true },
        environmentAxes: [],
      },
      ...overflowCase({ presence: 'open', modal: true }),
    ],
    unsupportedCases: [
      {
        id: 'opening-or-closing',
        rationale:
          'The convenience pattern composes the dialog with a boolean open state and the synchronous default lifecycle.',
      },
    ],
  },
  'pattern:searchable-select': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open searchable options',
        input: openSelectionInput,
        environmentAxes: DIRECTIONAL_SURFACE_AXES,
      },
      {
        id: 'loading',
        label: 'Loading options',
        input: { presence: 'open', side: 'bottom', asyncStatus: 'loading' },
        environmentAxes: SURFACE_AXES,
      },
      {
        id: 'empty',
        label: 'No results',
        input: { presence: 'open', side: 'bottom', asyncStatus: 'empty' },
        environmentAxes: SURFACE_AXES,
      },
      {
        id: 'error',
        label: 'Load error',
        input: { presence: 'open', side: 'bottom', asyncStatus: 'error' },
        environmentAxes: SURFACE_AXES,
      },
      { id: 'closed', label: 'Closed trigger', input: { presence: 'closed' }, environmentAxes: [] },
      ...overflowCase({ presence: 'open', side: 'bottom' }),
    ],
    unsupportedCases: synchronousSelectionUnsupported,
  },
} as const satisfies Record<string, MenusOverlaysScenarioDefinition>

export type MenusOverlaysScenarioId = keyof typeof MENUS_OVERLAYS_SCENARIO_DEFINITIONS

export interface MenusOverlaysScenario {
  readonly productId: string
  readonly scenarioId: MenusOverlaysScenarioId
  readonly displayName: string
  readonly artifactKind: ProductEntry['artifactKind']
  readonly machineImport: string | null
  readonly presentation: ProductEntry['presentation']
  readonly defaultCaseId: string
  readonly cases: readonly MenusOverlaysScenarioCase[]
  readonly unsupportedCases: readonly MenusOverlaysUnsupportedCase[]
  readonly copiedArtifacts: readonly { readonly name: string; readonly scenarioId: string }[]
}

function contentFor(
  entry: ProductEntry,
  scenarioCase: MenusOverlaysScenarioCaseDefinition,
): MenusOverlaysScenarioContent {
  return {
    label: `${entry.displayName}: ${scenarioCase.label}`,
    detail: `Semantic ${scenarioCase.id} presentation for ${entry.scenarioId}.`,
  }
}

export interface MenusOverlaysScenarioSet {
  readonly family: 'menus-overlays'
  readonly environmentAxes: typeof MENUS_OVERLAYS_ENVIRONMENT_AXES
  readonly scenarios: readonly MenusOverlaysScenario[]
  readonly byScenarioId: Readonly<Record<MenusOverlaysScenarioId, MenusOverlaysScenario>>
}

/** Project the canonical ProductContract into exact, renderer-independent cases. */
export function menusOverlaysScenarios(contract: ProductContract): MenusOverlaysScenarioSet {
  const entries = contract.entries.filter((entry) => entry.presentation.family === 'menus-overlays')
  const canonicalIds = entries.map(({ scenarioId }) => scenarioId)
  const definitionIds = Object.keys(MENUS_OVERLAYS_SCENARIO_DEFINITIONS)
  const missing = canonicalIds.filter((scenarioId) => !definitionIds.includes(scenarioId))
  const extras = definitionIds.filter((scenarioId) => !canonicalIds.includes(scenarioId))
  if (missing.length > 0 || extras.length > 0) {
    throw new Error(
      `Menus/overlays case coverage must exactly match ProductContract scenario IDs (missing: ${missing.join(', ') || 'none'}; extras: ${extras.join(', ') || 'none'}).`,
    )
  }

  const scenarios = entries.map((entry): MenusOverlaysScenario => {
    const scenarioId = entry.scenarioId as MenusOverlaysScenarioId
    const definition = MENUS_OVERLAYS_SCENARIO_DEFINITIONS[scenarioId]
    const caseIds = definition.cases.map(({ id }) => id)
    if (new Set(caseIds).size !== caseIds.length) {
      throw new Error(`${scenarioId}: case IDs must be unique.`)
    }
    if (!caseIds.includes(definition.defaultCaseId)) {
      throw new Error(`${scenarioId}: default case "${definition.defaultCaseId}" is unavailable.`)
    }
    const unsupportedIds = definition.unsupportedCases.map(({ id }) => id)
    if (new Set(unsupportedIds).size !== unsupportedIds.length) {
      throw new Error(`${scenarioId}: unsupported case IDs must be unique.`)
    }
    const overlap = unsupportedIds.filter((id) => caseIds.includes(id))
    if (overlap.length > 0) {
      throw new Error(
        `${scenarioId}: supported and unsupported cases overlap: ${overlap.join(', ')}.`,
      )
    }
    if (definition.unsupportedCases.some(({ rationale }) => rationale.trim().length === 0)) {
      throw new Error(`${scenarioId}: unsupported cases require a nonempty rationale.`)
    }
    return {
      productId: entry.name,
      scenarioId,
      displayName: entry.displayName,
      artifactKind: entry.artifactKind,
      machineImport: entry.machine.kind === 'public' ? entry.machine.importPath : null,
      presentation: entry.presentation,
      defaultCaseId: definition.defaultCaseId,
      cases: definition.cases.map((scenarioCase) => ({
        ...scenarioCase,
        input: { ...scenarioCase.input, content: contentFor(entry, scenarioCase) },
      })),
      unsupportedCases: definition.unsupportedCases,
      copiedArtifacts: entry.copiedArtifacts.map((artifact) => ({
        name: artifact.name,
        scenarioId: artifact.scenarioId ?? entry.scenarioId,
      })),
    }
  })

  return {
    family: 'menus-overlays',
    environmentAxes: MENUS_OVERLAYS_ENVIRONMENT_AXES,
    scenarios,
    byScenarioId: Object.fromEntries(
      scenarios.map((scenario) => [scenario.scenarioId, scenario]),
    ) as Record<MenusOverlaysScenarioId, MenusOverlaysScenario>,
  }
}
