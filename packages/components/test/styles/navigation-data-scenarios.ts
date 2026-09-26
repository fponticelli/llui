export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject
export interface JsonObject {
  readonly [key: string]: JsonValue
}

export type ForcedColorCue =
  | 'outline-selection'
  | 'underline-current'
  | 'status-error'
  | 'series-distinction'
  | 'orientation'

export type NavigationDataPath = 'baseline' | 'registryTailwind'
export type PresentationMode = 'styled' | 'partial' | 'composed' | 'styleless' | 'not-applicable'

export type ScenarioEnvironmentAxis =
  | { readonly axis: 'theme'; readonly value: 'light' | 'dark' }
  | { readonly axis: 'direction'; readonly value: 'ltr' | 'rtl' }
  | { readonly axis: 'motion'; readonly value: 'no-preference' | 'reduce' }
  | { readonly axis: 'viewport'; readonly value: 280 | 640 | 1024 }
  | { readonly axis: 'forcedColors'; readonly value: 'none' | 'active' }

export interface NavigationDataScenarioCase {
  readonly id: string
  readonly label: string
  readonly input: Readonly<JsonObject>
  readonly environmentAxes: readonly ScenarioEnvironmentAxis[]
}

export interface NavigationDataScenarioDefinition {
  readonly defaultCaseId: string
  readonly cases: readonly NavigationDataScenarioCase[]
  readonly forcedColorCue?: ForcedColorCue
}

export interface CopiedArtifact {
  readonly name: string
  readonly artifactKind: string
  readonly displayName?: string
  readonly styling: {
    readonly baseline: boolean
    readonly registryTailwind: boolean
    readonly styleless: boolean
  }
}

export interface NavigationDataContractEntry {
  readonly name: string
  readonly displayName: string
  readonly scenarioId: string
  readonly machine: { readonly kind: 'public' | 'none' }
  readonly copiedArtifacts: readonly CopiedArtifact[]
  readonly presentation: {
    readonly family: string
    readonly baseline: { readonly mode: PresentationMode; readonly rationale?: string }
    readonly registryTailwind: { readonly mode: PresentationMode; readonly rationale?: string }
  }
}

export interface NavigationDataScenario extends NavigationDataScenarioDefinition {
  readonly productId: string
  readonly displayName: string
  readonly scenarioId: string
  readonly copiedArtifacts: readonly CopiedArtifact[]
  readonly presentation: NavigationDataContractEntry['presentation']
}

const axis = {
  dark: { axis: 'theme', value: 'dark' },
  rtl: { axis: 'direction', value: 'rtl' },
  reduce: { axis: 'motion', value: 'reduce' },
  narrow: { axis: 'viewport', value: 280 },
  medium: { axis: 'viewport', value: 640 },
  wide: { axis: 'viewport', value: 1024 },
  forced: { axis: 'forcedColors', value: 'active' },
} as const satisfies Record<string, ScenarioEnvironmentAxis>

const caseOf = (
  id: string,
  label: string,
  input: Readonly<JsonObject>,
  environmentAxes: readonly ScenarioEnvironmentAxis[] = [],
): NavigationDataScenarioCase => ({ id, label, input, environmentAxes })

const define = (
  defaultCaseId: string,
  cases: readonly NavigationDataScenarioCase[],
  forcedColorCue?: ForcedColorCue,
): NavigationDataScenarioDefinition => ({
  defaultCaseId,
  cases,
  ...(forcedColorCue === undefined ? {} : { forcedColorCue }),
})

/**
 * Family-owned semantic inputs keyed by ProductContract scenario id. Product
 * membership, labels, path coverage, and copied artifacts are projected from
 * ProductContract below; this object never acts as a second product catalog.
 */
export const navigationDataScenarios = {
  'component:accordion': define('closed', [
    caseOf('closed', 'Closed item', { state: 'closed', label: 'Account settings' }, [axis.rtl]),
    caseOf(
      'open',
      'Open item',
      { state: 'open', label: 'Account settings', content: 'Profile details' },
      [axis.reduce],
    ),
    caseOf(
      'closing',
      'Retained closing item',
      { state: 'closing', label: 'Account settings', content: 'Profile details' },
      [axis.reduce],
    ),
    caseOf('disabled', 'Disabled item', {
      state: 'closed',
      disabled: true,
      label: 'Archived settings',
    }),
  ]),
  'component:avatar': define('loaded', [
    caseOf('loading', 'Loading image', { state: 'loading', label: 'Ada Lovelace' }),
    caseOf('loaded', 'Loaded image', {
      state: 'loaded',
      label: 'Ada Lovelace',
      imageAlt: 'Ada Lovelace',
      density: 'comfortable',
    }),
    caseOf('fallback', 'Initials fallback', {
      state: 'fallback',
      label: 'Ada Lovelace',
      initials: 'AL',
    }),
    caseOf('compact', 'Compact avatar', {
      state: 'fallback',
      label: 'Ada Lovelace',
      initials: 'AL',
      density: 'compact',
    }),
  ]),
  'component:breadcrumbs': define(
    'default',
    [
      caseOf('default', 'Breadcrumb trail', { state: 'default', label: 'Projects' }, [axis.rtl]),
      caseOf('current', 'Current page', { state: 'current', label: 'Alignment', current: true }, [
        axis.dark,
        axis.forced,
      ]),
      caseOf('collapsed', 'Collapsed ancestors', { state: 'collapsed', label: 'More ancestors' }),
      caseOf('overflow', 'Long page name', {
        state: 'overflow',
        label: 'A very long current page name that must truncate',
      }),
    ],
    'underline-current',
  ),
  'component:carousel': define('default', [
    caseOf('default', 'First slide', { state: 'default', label: 'Slide 1', index: 0 }, [
      axis.rtl,
      axis.narrow,
      axis.medium,
      axis.wide,
    ]),
    caseOf('active', 'Selected indicator', {
      state: 'active',
      label: 'Slide 2',
      index: 1,
      selected: true,
    }),
    caseOf('dragging', 'Pointer drag', { state: 'dragging', label: 'Slide 2', dragOffset: 48 }, [
      axis.reduce,
    ]),
    caseOf('disabled', 'Disabled controls', {
      state: 'disabled',
      label: 'Slide 2',
      disabled: true,
    }),
  ]),
  'component:chart': define(
    'default',
    [
      caseOf(
        'default',
        'Six data series (three bar, three area)',
        {
          state: 'default',
          label: 'Quarterly revenue',
          series: ['Bar A', 'Bar B', 'Bar C', 'Area A', 'Area B', 'Area C'],
        },
        [axis.dark, axis.forced],
      ),
      caseOf('active', 'Active series', {
        state: 'active',
        label: 'Revenue',
        activeSeries: 'Revenue',
      }),
      caseOf('dimmed', 'Dimmed series', { state: 'dimmed', label: 'Forecast', dimmed: true }),
      caseOf('empty', 'Empty chart', { state: 'empty', label: 'No chart data', rows: [] }),
    ],
    'series-distinction',
  ),
  'component:collapsible': define('closed', [
    caseOf('closed', 'Closed details', { state: 'closed', label: 'Details' }),
    caseOf(
      'open',
      'Open details',
      { state: 'open', label: 'Details', content: 'Expanded content' },
      [axis.reduce],
    ),
    caseOf(
      'closing',
      'Retained closing details',
      { state: 'closing', label: 'Details', content: 'Expanded content' },
      [axis.reduce],
    ),
    caseOf('disabled', 'Disabled details', { state: 'closed', label: 'Details', disabled: true }),
  ]),
  'component:marquee': define('running', [
    caseOf(
      'running',
      'Running row',
      { state: 'running', label: 'Release updates', items: ['Alpha', 'Beta'] },
      [axis.rtl, axis.reduce],
    ),
    caseOf('paused', 'Paused row', { state: 'paused', label: 'Release updates', paused: true }),
    caseOf('vertical', 'Vertical column', {
      state: 'vertical',
      label: 'Release updates',
      axis: 'vertical',
    }),
    caseOf('disabled', 'Disabled motion', {
      state: 'disabled',
      label: 'Release updates',
      disabled: true,
    }),
  ]),
  'component:meter': define(
    'neutral',
    [
      caseOf('neutral', 'Neutral value', { state: 'neutral', label: 'Storage', value: 42 }, [
        axis.rtl,
      ]),
      caseOf('optimal', 'Optimal value', { state: 'optimal', label: 'Storage', value: 28 }),
      caseOf('suboptimal', 'Suboptimal value', {
        state: 'suboptimal',
        label: 'Storage',
        value: 68,
      }),
      caseOf('critical', 'Critical value', { state: 'critical', label: 'Storage', value: 92 }, [
        axis.dark,
        axis.forced,
      ]),
    ],
    'series-distinction',
  ),
  'component:pagination': define(
    'default',
    [
      caseOf(
        'default',
        'Page controls',
        { state: 'default', label: 'Pagination', page: 1, count: 10 },
        [axis.rtl, axis.narrow],
      ),
      caseOf(
        'current',
        'Current page',
        { state: 'current', label: 'Page 2', page: 2, current: true },
        [axis.dark, axis.forced],
      ),
      caseOf('ellipsis', 'Collapsed page range', { state: 'ellipsis', label: 'More pages' }),
      caseOf('disabled', 'Boundary disabled', {
        state: 'disabled',
        label: 'Previous page',
        disabled: true,
      }),
    ],
    'outline-selection',
  ),
  'component:progress': define('loading', [
    caseOf('loading', 'Upload progress', { state: 'loading', label: 'Uploading', value: 60 }),
    caseOf('complete', 'Completed progress', { state: 'complete', label: 'Complete', value: 100 }),
    caseOf(
      'indeterminate',
      'Indeterminate progress',
      { state: 'indeterminate', label: 'Loading' },
      [axis.reduce],
    ),
  ]),
  'component:sparkline': define(
    'default',
    [
      caseOf(
        'default',
        'Trend series',
        { state: 'default', label: 'Weekly trend', values: [4, 9, 6, 12] },
        [axis.dark, axis.forced],
      ),
      caseOf('stale', 'Stale series', { state: 'stale', label: 'Weekly trend', stale: true }),
      caseOf('above', 'Above threshold', { state: 'above', label: 'Above target', value: 12 }),
      caseOf('below', 'Below threshold', { state: 'below', label: 'Below target', value: 4 }),
    ],
    'series-distinction',
  ),
  'component:steps': define(
    'current',
    [
      caseOf('pending', 'Pending step', { state: 'pending', label: 'Review' }),
      caseOf('current', 'Current step', { state: 'current', label: 'Configure', current: true }, [
        axis.rtl,
        axis.dark,
        axis.forced,
      ]),
      caseOf('completed', 'Completed step', {
        state: 'completed',
        label: 'Account',
        complete: true,
      }),
      caseOf(
        'error',
        'Failed step',
        { state: 'error', label: 'Payment', error: 'Payment failed' },
        [axis.forced],
      ),
      caseOf('disabled', 'Disabled step', { state: 'disabled', label: 'Publish', disabled: true }),
    ],
    'status-error',
  ),
  'component:table': define(
    'default',
    [
      caseOf(
        'default',
        'Data grid',
        {
          state: 'default',
          label: 'Projects',
          columns: ['Name', 'Status'],
          rows: ['Alpha', 'Beta'],
          density: 'comfortable',
        },
        [axis.rtl, axis.narrow],
      ),
      caseOf('selected', 'Selected row', { state: 'selected', label: 'Alpha', selected: true }, [
        axis.dark,
        axis.forced,
      ]),
      caseOf('sorted', 'Sorted column', { state: 'sorted', label: 'Name', sort: 'ascending' }),
      caseOf('empty', 'Empty rows', { state: 'empty', label: 'No projects', rows: [] }),
      caseOf('disabled', 'Disabled row', { state: 'disabled', label: 'Archived', disabled: true }),
      caseOf('compact', 'Compact data grid', {
        state: 'default',
        label: 'Projects',
        columns: ['Name', 'Status'],
        rows: ['Alpha', 'Beta'],
        density: 'compact',
      }),
    ],
    'outline-selection',
  ),
  'component:tabs': define(
    'active',
    [
      caseOf('inactive', 'Inactive tab', { state: 'inactive', label: 'Summary' }),
      caseOf('active', 'Active tab', { state: 'active', label: 'Details', selected: true }, [
        axis.rtl,
        axis.dark,
        axis.forced,
      ]),
      caseOf('disabled', 'Disabled tab', { state: 'inactive', label: 'History', disabled: true }),
      caseOf('vertical', 'Vertical tabs', {
        state: 'active',
        label: 'Details',
        orientation: 'vertical',
      }),
    ],
    'outline-selection',
  ),
  'component:toc': define(
    'default',
    [
      caseOf('default', 'Document outline', { state: 'default', label: 'Overview' }, [axis.rtl]),
      caseOf('current', 'Current section', { state: 'current', label: 'API', current: true }, [
        axis.dark,
        axis.forced,
      ]),
      caseOf('collapsed', 'Collapsed branch', {
        state: 'collapsed',
        label: 'Guides',
        expanded: false,
      }),
      caseOf('expanded', 'Expanded branch', { state: 'expanded', label: 'Guides', expanded: true }),
    ],
    'underline-current',
  ),
  'component:tree-view': define(
    'collapsed',
    [
      caseOf(
        'collapsed',
        'Collapsed branch',
        { state: 'collapsed', label: 'src', expanded: false },
        [axis.rtl],
      ),
      caseOf('expanded', 'Expanded branch', { state: 'expanded', label: 'src', expanded: true }),
      caseOf(
        'selected',
        'Selected item',
        { state: 'selected', label: 'index.ts', selected: true },
        [axis.dark, axis.forced],
      ),
      caseOf('loading', 'Loading branch', { state: 'loading', label: 'packages', busy: true }),
      caseOf('disabled', 'Disabled item', { state: 'disabled', label: 'archive', disabled: true }),
    ],
    'outline-selection',
  ),
  'pattern:data-table': define(
    'populated',
    [
      caseOf('loading', 'Loading data', {
        state: 'loading',
        label: 'Loading projects',
        busy: true,
      }),
      caseOf('empty', 'No results', { state: 'empty', label: 'No results', rows: [] }),
      caseOf(
        'error',
        'Load failed',
        { state: 'error', label: 'Could not load', error: 'Could not load' },
        [axis.dark, axis.forced],
      ),
      caseOf(
        'populated',
        'Loaded rows',
        {
          state: 'populated',
          label: 'Projects',
          rows: ['Alpha', 'Beta'],
          density: 'comfortable',
        },
        [axis.narrow],
      ),
      caseOf('compact', 'Compact loaded rows', {
        state: 'populated',
        label: 'Projects',
        rows: ['Alpha', 'Beta'],
        density: 'compact',
      }),
    ],
    'status-error',
  ),
  'registry:alert': define('default', [
    caseOf('default', 'Information alert', {
      state: 'default',
      title: 'Saved',
      description: 'Changes are live',
    }),
    caseOf('destructive', 'Error alert', {
      state: 'destructive',
      title: 'Sync failed',
      description: 'Try again',
      error: true,
    }),
  ]),
  'registry:badge': define('default', [
    caseOf('default', 'Default badge', { state: 'default', label: 'Stable' }),
    caseOf('secondary', 'Secondary badge', { state: 'secondary', label: 'Preview' }),
    caseOf('destructive', 'Destructive badge', { state: 'destructive', label: 'Failed' }),
    caseOf('outline', 'Outline badge', { state: 'outline', label: 'Draft' }),
  ]),
  'registry:card': define('default', [
    caseOf('default', 'Content card', { state: 'default', title: 'Release', description: 'Ready' }),
    caseOf('with-action', 'Card with action', {
      state: 'with-action',
      title: 'Release',
      actionLabel: 'Open',
    }),
    caseOf('divided', 'Divided card', {
      state: 'divided',
      title: 'Release',
      sections: ['Summary', 'Details'],
    }),
  ]),
  'registry:chip': define('default', [
    caseOf('default', 'Default chip', { state: 'default', label: 'Lab' }),
    caseOf('categorical', 'Categorical chip', {
      state: 'categorical',
      label: 'Design',
      hue: 188.5,
    }),
  ]),
  'registry:empty': define('default', [
    caseOf('default', 'Empty collection', {
      state: 'default',
      title: 'Nothing here',
      description: 'Create the first item',
    }),
    caseOf('with-action', 'Empty collection action', {
      state: 'with-action',
      title: 'Nothing here',
      actionLabel: 'Add item',
    }),
  ]),
  'registry:item': define('default', [
    caseOf('default', 'Content item', {
      state: 'default',
      title: 'Deployment',
      description: 'Completed',
      density: 'comfortable',
    }),
    caseOf('interactive', 'Interactive item', {
      state: 'interactive',
      title: 'Deployment',
      interactive: true,
    }),
    caseOf('muted', 'Muted item', { state: 'muted', title: 'Deployment', muted: true }),
    caseOf('compact', 'Compact content item', {
      state: 'default',
      title: 'Deployment',
      description: 'Completed',
      density: 'compact',
    }),
  ]),
  'registry:kbd': define('single', [
    caseOf('single', 'Single key', { state: 'single', keys: ['K'] }),
    caseOf('chord', 'Keyboard chord', { state: 'chord', keys: ['Meta', 'K'] }),
  ]),
  'registry:separator': define(
    'horizontal',
    [
      caseOf(
        'horizontal',
        'Horizontal separator',
        { state: 'horizontal', orientation: 'horizontal' },
        [axis.forced],
      ),
      caseOf('vertical', 'Vertical separator', { state: 'vertical', orientation: 'vertical' }, [
        axis.forced,
      ]),
      caseOf('semantic', 'Semantic separator', {
        state: 'semantic',
        orientation: 'horizontal',
        decorative: false,
      }),
    ],
    'orientation',
  ),
  'registry:skeleton': define('loading', [
    caseOf('loading', 'Loading placeholder', { state: 'loading', label: 'Loading content' }, [
      axis.reduce,
    ]),
  ]),
  'registry:spinner': define('loading', [
    caseOf('loading', 'Loading spinner', { state: 'loading', label: 'Loading' }, [axis.reduce]),
  ]),
  'registry:typography': define('body', [
    caseOf('headings', 'Heading hierarchy', { state: 'headings', title: 'Navigation data' }),
    caseOf('body', 'Body copy', { state: 'body', text: 'Readable body content' }, [axis.rtl]),
    caseOf(
      'code',
      'Long code token',
      { state: 'code', code: 'veryLongUnbrokenIdentifierThatMustRemainLocallyScrollable' },
      [axis.narrow],
    ),
    caseOf('quote', 'Block quotation', { state: 'quote', text: 'Clarity over cleverness' }),
  ]),
  'registry:sidebar': define('expanded', [
    caseOf(
      'expanded',
      'Expanded sidebar',
      {
        state: 'expanded',
        label: 'Workspace',
        current: 'Overview',
        density: 'comfortable',
      },
      [axis.rtl],
    ),
    caseOf('compact', 'Compact sidebar navigation', {
      state: 'expanded',
      label: 'Workspace',
      current: 'Overview',
      density: 'compact',
    }),
    caseOf('collapsed', 'Collapsed sidebar', { state: 'collapsed', label: 'Workspace' }),
    caseOf('offcanvas', 'Off-canvas sidebar', { state: 'offcanvas', label: 'Workspace' }, [
      axis.narrow,
    ]),
    caseOf('mobile', 'Mobile sidebar', { state: 'mobile', label: 'Workspace', open: true }, [
      axis.narrow,
    ]),
  ]),
} as const satisfies Record<string, NavigationDataScenarioDefinition>

function isVisuallyApplicable(mode: PresentationMode): boolean {
  return mode === 'styled' || mode === 'partial' || mode === 'composed'
}

export function projectNavigationDataScenarios(
  entries: readonly NavigationDataContractEntry[],
  definitions: Readonly<Record<string, NavigationDataScenarioDefinition>> = navigationDataScenarios,
): NavigationDataScenario[] {
  const family = entries.filter(({ presentation }) => presentation.family === 'navigation-data')
  const canonicalScenarioIds = new Set(family.map(({ scenarioId }) => scenarioId))

  for (const entry of family) {
    if (definitions[entry.scenarioId] === undefined) {
      throw new Error(
        `Missing navigation/data scenario definition ${entry.scenarioId} for ${entry.name}`,
      )
    }
  }
  for (const scenarioId of Object.keys(definitions)) {
    if (!canonicalScenarioIds.has(scenarioId)) {
      throw new Error(`Unknown navigation/data scenario definition ${scenarioId}`)
    }
  }

  return family.map((entry) => {
    const definition = definitions[entry.scenarioId]!
    const caseIds = definition.cases.map(({ id }) => id)
    if (definition.cases.length === 0) {
      throw new Error(`Navigation/data scenario ${entry.scenarioId} has no cases`)
    }
    if (new Set(caseIds).size !== caseIds.length) {
      throw new Error(`Navigation/data scenario ${entry.scenarioId} has duplicate case ids`)
    }
    if (!caseIds.includes(definition.defaultCaseId)) {
      throw new Error(
        `Navigation/data scenario ${entry.scenarioId} default case ${definition.defaultCaseId} does not exist`,
      )
    }

    const hasDensityCases = definition.cases.some(
      ({ input }) => input['density'] === 'comfortable' || input['density'] === 'compact',
    )
    const cases = definition.cases.map((scenarioCase) => ({
      ...scenarioCase,
      input: {
        ...scenarioCase.input,
        ...(!hasDensityCases && scenarioCase.id === definition.defaultCaseId
          ? {
              density: 'not-applicable' as const,
              densityRationale: `${entry.displayName} has no collection-density input; its target size and information hierarchy remain invariant while viewport cases own spatial adaptation.`,
            }
          : {}),
        contract: {
          productId: entry.name,
          displayName: entry.displayName,
          copiedArtifacts: entry.copiedArtifacts.map(({ name }) => name),
        },
      },
    }))

    return {
      productId: entry.name,
      displayName: entry.displayName,
      scenarioId: entry.scenarioId,
      copiedArtifacts: entry.copiedArtifacts,
      presentation: entry.presentation,
      ...definition,
      cases,
    }
  })
}

export type ScenarioDensityProfile =
  | { readonly mode: 'applicable'; readonly caseIds: readonly string[] }
  | { readonly mode: 'not-applicable'; readonly rationale: string }

export function scenarioDensityProfile(scenario: NavigationDataScenario): ScenarioDensityProfile {
  const densityCases = scenario.cases.filter(
    ({ input }) => input['density'] === 'comfortable' || input['density'] === 'compact',
  )
  if (densityCases.length > 0) {
    const values = new Set(densityCases.map(({ input }) => input['density']))
    if (!values.has('comfortable') || !values.has('compact')) {
      throw new Error(
        `Navigation/data density scenario ${scenario.productId} needs comfortable and compact cases`,
      )
    }
    return { mode: 'applicable', caseIds: densityCases.map(({ id }) => id) }
  }

  const input = scenario.cases.find(({ id }) => id === scenario.defaultCaseId)?.input
  const rationale = input?.['densityRationale']
  if (
    input?.['density'] !== 'not-applicable' ||
    typeof rationale !== 'string' ||
    rationale.trim() === ''
  ) {
    throw new Error(`Navigation/data density scenario ${scenario.productId} needs an N/A rationale`)
  }
  return { mode: 'not-applicable', rationale }
}

export function applicableNavigationDataScenarios(
  scenarios: readonly NavigationDataScenario[],
  path: NavigationDataPath,
): NavigationDataScenario[] {
  return scenarios.filter(({ presentation }) => isVisuallyApplicable(presentation[path].mode))
}

export function scenarioEnvironmentProductIds<Axis extends ScenarioEnvironmentAxis['axis']>(
  scenarios: readonly NavigationDataScenario[],
  axisName: Axis,
  value: Extract<ScenarioEnvironmentAxis, { axis: Axis }>['value'],
): string[] {
  return scenarios
    .filter(({ cases }) =>
      cases.some(({ environmentAxes }) =>
        environmentAxes.some(({ axis, value: candidate }) =>
          axis === axisName ? candidate === value : false,
        ),
      ),
    )
    .map(({ productId }) => productId)
    .sort()
}

export function forcedColorScenarios(
  scenarios: readonly NavigationDataScenario[],
): { productId: string; cue: ForcedColorCue }[] {
  return scenarios
    .filter(({ cases }) =>
      cases.some(({ environmentAxes }) =>
        environmentAxes.some(({ axis, value }) => axis === 'forcedColors' && value === 'active'),
      ),
    )
    .map(({ productId, forcedColorCue }) => {
      if (forcedColorCue === undefined) {
        throw new Error(`Missing forced-colors cue for navigation/data scenario ${productId}`)
      }
      return { productId, cue: forcedColorCue }
    })
    .sort((left, right) => left.productId.localeCompare(right.productId))
}
