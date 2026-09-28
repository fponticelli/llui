import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
  type PresentationScenarioEnvironment,
  type PresentationScenarioEnvironmentAxis,
} from '@llui/cli/presentation-scenarios'
import { loadProductContract } from '../../packages/components/test/styles/navigation-data-contract-source'
import {
  applicableNavigationDataScenarios,
  compileNavigationDataCatalog,
  DENSITY_APPLICABLE_PRODUCT_IDS,
  densityRationale,
  joinNavigationDataScenarios,
  NAVIGATION_DATA_CASES,
  NAVIGATION_DATA_DEFINITIONS,
  type NavigationDataInputs,
  type NavigationDataJoinedScenario,
  type NavigationDataScenarioId,
} from '../../packages/components/test/styles/navigation-data-scenarios'
import {
  NAVIGATION_DATA_FIELD_MUTATORS,
  NAVIGATION_DATA_TARGETED_CHECKS,
} from '../../packages/components/test/styles/navigation-data-field-mutations'
import {
  isDeclaredField,
  mutateField,
  UNCHANGED,
  type ScenarioCaseOf,
} from '../../packages/components/test/styles/scenario-field-mutations'
import {
  REGISTRY_ADAPTERS,
  mountRegistryNavigationDataScenarios,
  type Adapter,
  type Disposable,
  type RenderContext,
} from './navigation-data-scenario-renderer'

const contract = loadProductContract()
const catalog = compileNavigationDataCatalog(contract)
const joined = joinNavigationDataScenarios(catalog, contract)
const scenarios = applicableNavigationDataScenarios(joined, 'registryTailwind')
const entryByProduct = new Map(contract.entries.map((entry) => [entry.name, entry]))
const scenarioIds = catalog.scenarios.map(({ scenarioId }) => scenarioId)

/** The adapter map viewed per scenario id at that id's input type; the
 * assignment checks every adapter against its scenario's declared input. */
const ADAPTERS: {
  readonly [Id in NavigationDataScenarioId]: Adapter<NavigationDataInputs[Id]>
} = REGISTRY_ADAPTERS

function publicParts(productId: string): string[] {
  const files =
    productId === 'data-table'
      ? [
          '../../packages/components/src/patterns/data-table.ts',
          '../../packages/components/src/components/table.ts',
          '../../packages/components/src/components/pagination.ts',
        ]
      : [`../../packages/components/src/components/${productId}.ts`]
  return [
    ...new Set(
      files.flatMap((file) =>
        [
          ...readFileSync(resolve(import.meta.dirname, file), 'utf8').matchAll(
            /['"]data-part['"]:\s*['"]([^'"]+)['"]/g,
          ),
        ].map(([, part]) => part!),
      ),
    ),
  ].sort()
}

describe('registry navigation/data scenario renderer', () => {
  let mounted: Disposable | undefined

  const render = (candidate: readonly NavigationDataJoinedScenario[] = scenarios): HTMLElement => {
    const host = document.createElement('div')
    document.body.append(host)
    mounted = mountRegistryNavigationDataScenarios(host, contract, catalog, candidate)
    return host
  }

  afterEach(() => {
    mounted?.dispose()
    mounted = undefined
    document.body.replaceChildren()
  })

  it('renders every applicable semantic case with canonical markers', () => {
    const host = render()
    const markers = [
      ...host.querySelectorAll<HTMLElement>('[data-scenario-id][data-scenario-case]'),
    ]
      .map((node) => `${node.dataset.scenarioId}:${node.dataset.scenarioCase}`)
      .sort()
    const expected = scenarios
      .flatMap((scenario) =>
        scenario.cases.map((scenarioCase) => `${scenario.scenarioId}:${scenarioCase.id}`),
      )
      .sort()

    expect(markers).toEqual(expected)
  })

  it('routes every public machine part through the product skin composition, across its cases', () => {
    const host = render()
    for (const scenario of scenarios) {
      if (entryByProduct.get(scenario.productId)?.machine.kind !== 'public') continue
      const roots = [
        ...host.querySelectorAll<HTMLElement>(`[data-scenario-id="${scenario.scenarioId}"]`),
      ]
      const rendered = [
        ...new Set(
          roots.flatMap((root) =>
            [...root.querySelectorAll<HTMLElement>('[data-part]')].map(
              (node) => node.dataset.part!,
            ),
          ),
        ),
      ]
      expect(rendered, scenario.productId).toEqual(
        expect.arrayContaining(publicParts(scenario.productId)),
      )
    }
  })

  it('renders the accordion and collapsible closing case with the retained exit still visible', () => {
    const host = render()
    for (const scenarioId of ['component:accordion', 'component:collapsible']) {
      const root = host.querySelector<HTMLElement>(
        `[data-scenario-id="${scenarioId}"][data-scenario-case="closing"]`,
      )!
      const closingContent = root.querySelector<HTMLElement>('[data-state="closing"]')
      expect(closingContent, scenarioId).not.toBeNull()
      expect(closingContent!.getAttribute('aria-hidden'), scenarioId).toBe('true')
      expect(closingContent!.hasAttribute('inert'), scenarioId).toBe(true)
      const openRoot = host.querySelector<HTMLElement>(
        `[data-scenario-id="${scenarioId}"][data-scenario-case="open"]`,
      )!
      expect(openRoot.querySelector('[data-state="closing"]'), scenarioId).toBeNull()
      const closedRoot = host.querySelector<HTMLElement>(
        `[data-scenario-id="${scenarioId}"][data-scenario-case="closed"]`,
      )!
      expect(closedRoot.querySelector('[data-state="closing"]'), scenarioId).toBeNull()
    }
  })

  // avatar/table/data-table are machine-backed and publish a real
  // `data-density` attribute via `connect({ density })`; item/sidebar are
  // registry-only presentational atoms with no machine to publish one at
  // all (#264 review item 2e removed the decorative `data-density` echo
  // those two adapters used to bolt on) — their real, product-published
  // compact signal is the size-variant class their own recipe emits.
  const COMPACT_SIGNAL_CLASS: Readonly<Record<string, string>> = {
    item: 'gap-2.5',
    sidebar: 'h-7',
  }

  function hasCompactSignal(scenarioRoot: HTMLElement, productId: string): boolean {
    const compactClass = COMPACT_SIGNAL_CLASS[productId]
    if (compactClass !== undefined) {
      // A raw `.` in a Tailwind fraction class (`gap-2.5`) is not a valid
      // unescaped CSS selector token, so this walks `classList` directly
      // rather than building a selector string.
      return [...scenarioRoot.querySelectorAll<HTMLElement>('*')].some((node) =>
        node.classList.contains(compactClass),
      )
    }
    return scenarioRoot.querySelector<HTMLElement>('[data-density="compact"]') !== null
  }

  it('consumes every applicable compact-density case on the live skinned root, and no other product ever renders one', () => {
    const host = render()
    const compact = [...host.querySelectorAll<HTMLElement>('[data-scenario-case="compact"]')]
    const compactProductIds = compact.map((node) => node.dataset.scenarioProduct).sort()
    expect(compactProductIds).toEqual(DENSITY_APPLICABLE_PRODUCT_IDS)
    for (const scenarioRoot of compact) {
      expect(
        hasCompactSignal(scenarioRoot, scenarioRoot.dataset.scenarioProduct!),
        scenarioRoot.dataset.scenarioId,
      ).toBe(true)
    }

    for (const scenario of scenarios) {
      if (DENSITY_APPLICABLE_PRODUCT_IDS.includes(scenario.productId)) continue
      const root = host.querySelectorAll<HTMLElement>(`[data-scenario-id="${scenario.scenarioId}"]`)
      for (const caseRoot of root) {
        expect(caseRoot.querySelector('[data-density]'), scenario.productId).toBeNull()
      }
      const entry = entryByProduct.get(scenario.productId)!
      expect(densityRationale(entry)).toContain(entry.displayName)
    }
  })

  it('fails closed when renderer bindings drift from ProductContract applicability', () => {
    expect(() =>
      mountRegistryNavigationDataScenarios(document.body, contract, catalog, scenarios.slice(1)),
    ).toThrow(/bindings do not match applicable ProductContract scenarios/i)
  })

  // See the baseline renderer test's identical comment for the full
  // rationale (#264 item 2): only the product-published surface counts,
  // never raw innerHTML.
  const PLAIN_STATE_ATTRS = new Set([
    'alt',
    'href',
    'disabled',
    'placeholder',
    'title',
    'value',
    'style',
  ])

  function projectPublishedState(host: HTMLElement): string {
    const envFacts = ['dir', 'data-theme', 'data-viewport', 'data-forced-colors']
      .map((attr) => `${attr}=${host.getAttribute(attr) ?? ''}`)
      .join(',')
    const partNodes = [...host.querySelectorAll<HTMLElement>('[data-part]')]
    const nodes = partNodes.length > 0 ? partNodes : [...host.querySelectorAll<HTMLElement>('*')]
    const facts = nodes.map((node) => {
      const attrs = Array.from(node.attributes)
        .filter(
          (attr) =>
            attr.name.startsWith('data-') ||
            attr.name.startsWith('aria-') ||
            attr.name === 'role' ||
            attr.name === 'class' ||
            PLAIN_STATE_ATTRS.has(attr.name),
        )
        .map((attr) => `${attr.name}=${attr.value}`)
        .sort()
      const text = [...node.childNodes]
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent ?? '')
        .join('')
        .trim()
      return `${node.tagName}|${attrs.join(',')}|${text}`
    })
    return `env:${envFacts}||${facts.join(';')}`
  }

  function mountFor<Input>(
    adapter: Adapter<Input>,
    input: Input,
    ctx: RenderContext,
  ): { host: HTMLElement; projection: string } {
    const host = document.createElement('div')
    const handle = adapter(host, input, ctx)
    const projection = projectPublishedState(host)
    handle.dispose()
    return { host, projection }
  }

  /** One scenario's own adapter and cases, at that scenario's input type — see
   * the baseline renderer test's identical helper. */
  function eachCase<Id extends NavigationDataScenarioId>(
    scenarioId: Id,
    visit: (
      adapter: Adapter<NavigationDataInputs[Id]>,
      scenarioCase: ScenarioCaseOf<NavigationDataInputs[Id]>,
      ctx: RenderContext,
    ) => void,
  ): void {
    const adapter = ADAPTERS[scenarioId]
    for (const scenarioCase of NAVIGATION_DATA_CASES[scenarioId].cases) {
      visit(adapter, scenarioCase, {
        scenarioId,
        caseId: scenarioCase.id,
        environment: DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
      })
    }
  }

  it('projectPublishedState is deterministic: two identical mounts of the same case project identically (#264 item 2b)', () => {
    for (const scenarioId of scenarioIds) {
      eachCase(scenarioId, (adapter, scenarioCase, ctx) => {
        const first = mountFor(adapter, scenarioCase.input, ctx)
        const second = mountFor(adapter, scenarioCase.input, ctx)
        expect(second.projection, `${scenarioId}/${scenarioCase.id}`).toBe(first.projection)
      })
    }
  })

  it('projectPublishedState ignores a wrapper-level echo attribute the adapter itself never published (#264 item 2d, negative probe)', () => {
    const scenarioId = 'pattern:data-table'
    const definition = NAVIGATION_DATA_DEFINITIONS[scenarioId]
    const scenarioCase = definition.cases.find((c) => c.id === 'populated')!
    const adapter = REGISTRY_ADAPTERS[scenarioId]
    const ctx: RenderContext = {
      scenarioId,
      caseId: scenarioCase.id,
      environment: DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
    }
    const plainHost = document.createElement('div')
    const plainHandle = adapter(plainHost, scenarioCase.input, ctx)
    const plainProjection = projectPublishedState(plainHost)
    plainHandle.dispose()

    const decoyHost = document.createElement('div')
    const decoyHandle = adapter(decoyHost, scenarioCase.input, ctx)
    decoyHost.setAttribute('data-mutation-probe-echo', 'DECOY-VALUE-that-would-differ-per-mutation')
    const decoyProjection = projectPublishedState(decoyHost)
    decoyHandle.dispose()

    expect(decoyProjection).toBe(plainProjection)
  })

  function checkDimensions<Id extends NavigationDataScenarioId>(
    scenarioId: Id,
    hitAllowances: Set<string>,
  ): void {
    const mutators = NAVIGATION_DATA_FIELD_MUTATORS[scenarioId]
    const targetedChecks = NAVIGATION_DATA_TARGETED_CHECKS[scenarioId]
    eachCase(scenarioId, (adapter, scenarioCase, baseCtx) => {
      const baseline = mountFor(adapter, scenarioCase.input, baseCtx).projection

      for (const field of Object.keys(scenarioCase.input)) {
        const key = `${scenarioId}/${scenarioCase.id}.${field}`
        if (!isDeclaredField(mutators, field)) throw new Error(`${key} has no declared mutator`)
        const mutation = mutateField(mutators, scenarioCase.input, field)
        if (mutation === UNCHANGED) continue
        // See the baseline renderer test: a generic projection diff can be
        // masked by a renderer-added echo, so a known machine-published
        // attribute is asserted directly as well.
        const targetedCheck = targetedChecks?.[field]
        if (targetedCheck !== undefined) {
          const targetHost = document.createElement('div')
          const targetHandle = adapter(targetHost, mutation.input, baseCtx)
          targetedCheck(targetHost, mutation.input)
          targetHandle.dispose()
        }
        const mutated = mountFor(adapter, mutation.input, baseCtx).projection
        if (mutated === baseline) {
          const reason = INSENSITIVE_DIMENSIONS[key]
          expect(reason, key).toBeDefined()
          hitAllowances.add(key)
          continue
        }
        expect(mutated, key).not.toBe(baseline)
      }

      for (const axis of scenarioCase.environmentAxes) {
        const mutatedEnvironment: PresentationScenarioEnvironment = {
          ...DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
          [axis]: ENV_AXIS_ALTERNATE[axis],
        }
        const mutated = mountFor(adapter, scenarioCase.input, {
          ...baseCtx,
          environment: mutatedEnvironment,
        }).projection
        const key = `${scenarioId}/${scenarioCase.id}.env:${axis}`
        if (mutated === baseline) {
          const reason = INSENSITIVE_ENVIRONMENT_DIMENSIONS[key]
          expect(reason, key).toBeDefined()
          hitAllowances.add(key)
          continue
        }
        expect(mutated, key).not.toBe(baseline)
      }
    })
  }

  it('every case field and environment axis a case declares materially changes this renderer real output (#264 item D)', () => {
    const hitAllowances = new Set<string>()
    for (const scenarioId of scenarioIds) checkDimensions(scenarioId, hitAllowances)
    expect(
      [
        ...Object.keys(INSENSITIVE_DIMENSIONS),
        ...Object.keys(INSENSITIVE_ENVIRONMENT_DIMENSIONS),
      ].filter((key) => !hitAllowances.has(key)),
    ).toEqual([])
  })
})

const ENV_AXIS_ALTERNATE: Readonly<
  Record<
    PresentationScenarioEnvironmentAxis,
    PresentationScenarioEnvironment[PresentationScenarioEnvironmentAxis]
  >
> = {
  theme: 'dark',
  direction: 'rtl',
  motion: 'reduced',
  viewport: 'narrow',
  forcedColors: 'active',
}

/** See the baseline renderer test's identical table for the full reasoning.
 * `direction`/`theme`/`viewport`/`forcedColors` never appear here (universal
 * via the mount host's own attributes); only `motion` needs allowances. */
const INSENSITIVE_ENVIRONMENT_DIMENSIONS: Readonly<Record<string, string>> = {
  'component:accordion/open.env:motion':
    "the 'open' case's settled state does not depend on `animated` — only a MID-TRANSITION phase does.",
  'component:collapsible/open.env:motion':
    "same as accordion: the 'open' case's settled state does not depend on `animated`.",
  'component:carousel/dragging.env:motion':
    'carousel.ts has no motion-conditional option; the drag-follow animation is CSS transition/transform.',
  'component:progress/indeterminate.env:motion':
    "progress.ts's indeterminate animation is a pure CSS keyframe; there is no init option to gate it.",
  'registry:skeleton/loading.env:motion':
    'skeleton is machine-free (presentational-only); its shimmer is pure CSS animation with no machine option to gate.',
  'registry:spinner/loading.env:motion':
    'spinner is machine-free (presentational-only); its spin is pure CSS animation with no machine option to gate.',
}

/** Same structural exceptions as the baseline renderer's identical dimension-
 * mutation test (see its own comments for the full reasoning) — the registry
 * skin composes the SAME real machines, so the same facts about their
 * reducers/fixtures apply verbatim. */
const INSENSITIVE_DIMENSIONS: Readonly<Record<string, string>> = {
  // A prior version of this comment claimed `loop` was NOT a no-op here,
  // reasoning from a raw-`innerHTML` comparison that was itself unreliable
  // (#264 review item 2) — `canGoNext`/`canGoPrev` are `current < count-1 ||
  // loop` / `current > 0 || loop`; at this case's index 1 of 3, both sides of
  // the `||` besides `loop` are already true, so `loop` cannot move either
  // trigger's real `disabled` state. Same allowance as the baseline renderer.
  'component:carousel/active.loop':
    "loop only changes prev/next's disabled state at a boundary slide; this case's index (1 of 3) is not one — component:carousel/disabled covers the boundary.",
  'component:carousel/dragging.loop':
    "same as 'active': index 1 of 3 is not a boundary slide, so loop has nothing to gate here.",
  'component:marquee/disabled.running':
    'marquee.ts:isRunning() is `running && !disabled` — once disabled is true, running can never make it play.',
  'component:steps/completed.completed':
    'steps.ts:statusOf checks `current` before `completed`, and this case already has completed=[0,1] with current=2 over a 3-step fixture — the only index left to add IS current, whose status always wins.',
  'component:tree-view/disabled.busy':
    'tree-view.ts:update() early-returns on `loadingStart` whenever `state.disabled` is true — a disabled tree can never actually enter the loading state.',
}
