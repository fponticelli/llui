import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
  type PresentationScenarioEnvironment,
  type PresentationScenarioEnvironmentAxis,
} from '@llui/cli/presentation-scenarios'
import { loadProductContract } from './navigation-data-contract-source'
import {
  applicableNavigationDataScenarios,
  compileNavigationDataCatalog,
  DENSITY_APPLICABLE_PRODUCT_IDS,
  densityRationale,
  joinNavigationDataScenarios,
  NAVIGATION_DATA_DEFINITIONS,
  type NavigationDataJoinedScenario,
} from './navigation-data-scenarios'
import {
  BASELINE_ADAPTERS,
  mountBaselineNavigationDataScenarios,
  type Disposable,
  type RenderContext,
} from './navigation-data-baseline-renderer'

const contract = loadProductContract()
const catalog = compileNavigationDataCatalog(contract)
const joined = joinNavigationDataScenarios(catalog, contract)
const scenarios = applicableNavigationDataScenarios(joined, 'baseline')
const entryByProduct = new Map(contract.entries.map((entry) => [entry.name, entry]))

function publicParts(productId: string): string[] {
  const files =
    productId === 'data-table'
      ? [
          '../../src/patterns/data-table.ts',
          '../../src/components/table.ts',
          '../../src/components/pagination.ts',
        ]
      : [`../../src/components/${productId}.ts`]
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

describe('baseline navigation/data scenario renderer', () => {
  let mounted: Disposable | undefined

  const render = (candidate: readonly NavigationDataJoinedScenario[] = scenarios): HTMLElement => {
    const host = document.createElement('div')
    document.body.append(host)
    mounted = mountBaselineNavigationDataScenarios(host, contract, catalog, candidate)
    return host
  }

  afterEach(() => {
    mounted?.dispose()
    mounted = undefined
    document.body.replaceChildren()
  })

  it('renders every applicable semantic case with its canonical markers', () => {
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

  it('routes every public machine part through the product composition, across its cases', () => {
    // Aggregated across ALL of a scenario's cases, not just its default one:
    // a part can be genuinely CONDITIONAL (breadcrumbs' ellipsis only renders
    // once the real `visibleItems()` projection collapses the trail, which
    // the default case's `maxVisible` does not trigger) rather than dead
    // markup that always used to render regardless of state.
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
      // And the 'open'/'closed' cases must NOT collapse into the same state as
      // 'closing' — the review gap this closes.
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

  it('consumes every applicable compact-density case on the live skinned root, and no other product ever renders one', () => {
    const host = render()
    const compact = [...host.querySelectorAll<HTMLElement>('[data-scenario-case="compact"]')]
    const compactProductIds = compact.map((node) => node.dataset.scenarioProduct).sort()
    // Baseline path excludes item/sidebar (registry-only), so its density set
    // is a subset of the protocol's full density-applicable list.
    expect(compactProductIds).toEqual(
      DENSITY_APPLICABLE_PRODUCT_IDS.filter((id) => scenarios.some((s) => s.productId === id)),
    )
    for (const scenarioRoot of compact) {
      expect(
        scenarioRoot.querySelector<HTMLElement>('[data-density="compact"]'),
        scenarioRoot.dataset.scenarioId,
      ).not.toBeNull()
    }

    // The N/A rationale is falsifiable: every OTHER rendered product must
    // never publish `[data-density]` anywhere in ANY of its cases.
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
      mountBaselineNavigationDataScenarios(document.body, contract, catalog, scenarios.slice(1)),
    ).toThrow(/bindings do not match applicable ProductContract scenarios/i)
  })

  // #264 review (item 2): the dimension-mutation test used to compare raw
  // `innerHTML`, which is vacuous in two directions at once — a module-level
  // counter rendered into the DOM (icon()'s old `data-icon="i<N>"` marker,
  // since fixed) makes two IDENTICAL mounts differ, so "the output changed"
  // proved nothing; and a renderer-added WRAPPER echo of the very field being
  // mutated (removed from this file's adapters in this same pass) makes an
  // adapter that is genuinely INSENSITIVE to a field look sensitive, since the
  // echo alone always differs. `projectPublishedState` reads only the
  // PRODUCT-PUBLISHED surface: `data-part`/`data-scope`-carrying elements'
  // own `data-*`/`aria-*`/`role`/text (a `data-part` node's descendants are
  // walked too if the whole product carries none, which is the machine-free
  // registry-atom shape), plus the mount host's own environment attributes.
  // It deliberately does NOT read `id` (a stable, case-derived string, never a
  // product signal). `class` IS read — most registry recipes publish state
  // via `data-*` per this package's own convention, but a shadcn-ported
  // component (Alert's `default`/`destructive`) can be PURELY a Tailwind
  // variant class with no parallel `data-*` attribute at all, and excluding
  // `class` entirely made that case look falsely insensitive. Reading `class`
  // does not reopen the wrapper-echo hole item (e) closed: every echo removed
  // there was a `data-*` attribute bolted onto a plain wrapper carrying no
  // `data-part`, never a class, and (per the negative-probe test below) such
  // a wrapper is excluded from this walk regardless of which attribute it
  // carries.
  // `style` is included for the rare adapter (chip) that encodes real,
  // product-specific state as a CSS custom property (`--chip-hue`) rather
  // than a `data-*` attribute — there is no other channel for it.
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

  function mountFor(
    adapter: (h: HTMLElement, input: unknown, ctx: RenderContext) => Disposable,
    input: unknown,
    ctx: RenderContext,
  ): { host: HTMLElement; projection: string } {
    const host = document.createElement('div')
    const handle = adapter(host, input, ctx)
    const projection = projectPublishedState(host)
    handle.dispose()
    return { host, projection }
  }

  it('projectPublishedState is deterministic: two identical mounts of the same case project identically (#264 item 2b)', () => {
    for (const [scenarioId, definition] of Object.entries(NAVIGATION_DATA_DEFINITIONS)) {
      const adapter = BASELINE_ADAPTERS[scenarioId as keyof typeof BASELINE_ADAPTERS]
      if (adapter === undefined) continue
      for (const scenarioCase of definition.cases) {
        const ctx: RenderContext = {
          scenarioId: scenarioId as RenderContext['scenarioId'],
          caseId: scenarioCase.id,
          environment: DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
        }
        const typedAdapter = adapter as (
          h: HTMLElement,
          input: unknown,
          ctx: RenderContext,
        ) => Disposable
        const first = mountFor(typedAdapter, scenarioCase.input, ctx)
        const second = mountFor(typedAdapter, scenarioCase.input, ctx)
        expect(second.projection, `${scenarioId}/${scenarioCase.id}`).toBe(first.projection)
      }
    }
  })

  it('projectPublishedState ignores a wrapper-level echo attribute the adapter itself never published (#264 item 2d, negative probe)', () => {
    // A synthetic stand-in for exactly the bug item 2 found: a renderer
    // wrapping real output in an element carrying a `data-*` attribute that
    // merely ECHOES a mutated field, rather than the product publishing it.
    // `projectPublishedState` only reads attributes off `[data-part]`
    // elements (or, lacking any, every element) — a plain, unrelated wrapper
    // div is excluded either way, so adding this decoy must NOT register as a
    // difference. If this probe ever starts failing, the projection has
    // regressed to trusting renderer-added markup again.
    const scenarioId = 'component:accordion'
    const definition = NAVIGATION_DATA_DEFINITIONS[scenarioId]
    const scenarioCase = definition.cases[0]!
    const adapter = BASELINE_ADAPTERS[scenarioId]
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

  it('every case field and environment axis a case declares materially changes this renderer real output (#264 item D)', () => {
    const hitAllowances = new Set<string>()
    for (const [scenarioId, definition] of Object.entries(NAVIGATION_DATA_DEFINITIONS)) {
      const adapter = BASELINE_ADAPTERS[scenarioId as keyof typeof BASELINE_ADAPTERS]
      if (adapter === undefined) continue // registry-only atom: not resolvable on baseline
      const typedAdapter = adapter as (
        h: HTMLElement,
        input: unknown,
        ctx: RenderContext,
      ) => Disposable
      for (const scenarioCase of definition.cases) {
        const baseCtx: RenderContext = {
          scenarioId: scenarioId as RenderContext['scenarioId'],
          caseId: scenarioCase.id,
          environment: DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
        }
        const baseline = mountFor(typedAdapter, scenarioCase.input, baseCtx).projection

        for (const field of Object.keys(scenarioCase.input as Record<string, unknown>)) {
          const originalValue = (scenarioCase.input as Record<string, unknown>)[field]
          const mutatedValue = mutateFieldValue(
            scenarioId,
            field,
            originalValue,
            scenarioCase.input as Record<string, unknown>,
          )
          if (mutatedValue === UNCHANGED) continue
          const mutatedInput = { ...scenarioCase.input, [field]: mutatedValue }
          const mutated = mountFor(typedAdapter, mutatedInput, baseCtx).projection
          const key = `${scenarioId}/${scenarioCase.id}.${field}`
          if (mutated === baseline) {
            const reason = INSENSITIVE_DIMENSIONS[key]
            expect(reason, key).toBeDefined()
            hitAllowances.add(key)
            continue
          }
          expect(mutated, key).not.toBe(baseline)
        }

        // Environment axes (#264 item 2f/5): only the axes THIS case declares
        // support for are exercised, mirroring `resolveScenarioSelection`'s
        // own validation that an unsupported axis override is rejected.
        for (const axis of scenarioCase.environmentAxes) {
          const mutatedEnvironment: PresentationScenarioEnvironment = {
            ...DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
            [axis]: ENV_AXIS_ALTERNATE[axis],
          }
          const mutated = mountFor(typedAdapter, scenarioCase.input, {
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
      }
    }
    // Closed at the OTHER end too: an allowance nothing above actually hit
    // means either the field/case it names no longer exists, or a prior fix
    // made the dimension sensitive again — either way it must be removed
    // rather than silently keep excusing a combination that no longer needs it.
    expect(
      [
        ...Object.keys(INSENSITIVE_DIMENSIONS),
        ...Object.keys(INSENSITIVE_ENVIRONMENT_DIMENSIONS),
      ].filter((key) => !hitAllowances.has(key)),
    ).toEqual([])
  })
})

/** The `full`/`light`/`ltr`/`wide`/`none` default's opposite per axis, used to
 * mutate exactly one environment axis at a time. */
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

/**
 * Environment-axis counterpart to `INSENSITIVE_DIMENSIONS` below: every entry
 * names a `scenarioId/caseId.env:axis` combination whose case declares that
 * axis (so the loop above reaches it) but whose adapter has no real, honest
 * hook to gate on it. `direction`/`theme`/`viewport`/`forcedColors` never
 * appear here — `applyEnvironmentAttrs` makes every product universally
 * sensitive to those four via the mount host's own attributes. Only `motion`
 * needs allowances: `animated` is wired for accordion/collapsible (the only
 * two machines with that option), and every other product declaring a
 * motion-varying case has no motion-conditional option at all — its
 * animation, where it has one, is pure CSS with nothing for a jsdom-level
 * projection to observe (real transition/animation behavior is covered by
 * the browser-level tests instead).
 */
const INSENSITIVE_ENVIRONMENT_DIMENSIONS: Readonly<Record<string, string>> = {
  'component:accordion/open.env:motion':
    "the 'open' case's settled state does not depend on `animated` — only a MID-TRANSITION phase does, and `open` has already finished transitioning; component:accordion/closing.env:motion is where `animated` is genuinely observed.",
  'component:collapsible/open.env:motion':
    "same as accordion: the 'open' case's settled state does not depend on `animated`, only the 'closing' case's does.",
  'component:carousel/dragging.env:motion':
    'carousel.ts has no motion-conditional option; the drag-follow animation is CSS transition/transform, not gated by any init flag.',
  'component:progress/indeterminate.env:motion':
    "progress.ts's indeterminate animation is a pure CSS keyframe on the range part; there is no init option to gate it structurally.",
  // skeleton/spinner are registry-only (not-applicable on the baseline path)
  // and never reach this loop here — their motion allowance lives in
  // registry/test/navigation-data-scenario-renderer.test.ts instead.
}

/**
 * Documented, keyed-with-a-reason exceptions to the dimension-mutation rule
 * above — never a silent skip. Each names a `scenarioId/caseId.field` whose
 * mutated value is STRUCTURALLY unable to move this case's rendered output,
 * not merely one that happens not to today. Checked in BOTH directions: the
 * test above requires every allowance to actually be hit (never excuse a
 * field the mutation loop never reached), and requires every hit to be
 * allowed (never silently accept a newly-insensitive field).
 */
const INSENSITIVE_DIMENSIONS: Readonly<Record<string, string>> = {
  'component:carousel/active.loop':
    "loop only changes prev/next's disabled state at a boundary slide; this case's index (1 of 3) is not one — component:carousel/disabled covers the boundary.",
  'component:carousel/dragging.loop':
    "same as 'active': index 1 of 3 is not a boundary slide, so loop has nothing to gate here.",
  'component:marquee/disabled.running':
    'marquee.ts:isRunning() is `running && !disabled` — once disabled is true, running can never make it play.',
  'component:tree-view/disabled.busy':
    "tree-view.ts:update() early-returns on `loadingStart` whenever `state.disabled` is true (a handful of structural messages are the only exceptions) — a disabled tree can never actually enter the loading state, so this case's `busy` has nothing to flip.",
  'component:steps/completed.completed':
    'steps.ts:statusOf checks `current` before `completed`, and this case already has completed=[0,1] with current=2 over a 3-step fixture (indices 0-2) — the only index left to add IS current, whose status always wins regardless of also being in `completed`.',
}

const UNCHANGED = Symbol('unchanged')

/** Fields whose string value is a closed, machine-meaningful enum rather than
 * freeform text — a blind string-append mutation produces a value outside the
 * union (e.g. `'closed-mutated'`), which every adapter's `if/else` chain
 * treats identically to one of the real members, silently defeating the
 * mutation. Cycling to the NEXT real member keeps every mutation well-typed
 * AND meaningful. */
const KNOWN_ENUM_CYCLES: Readonly<Record<string, readonly string[]>> = {
  state: ['closed', 'open', 'closing'],
  status: ['loading', 'loaded', 'error'],
  density: ['comfortable', 'compact'],
  orientation: ['horizontal', 'vertical'],
  direction: ['left', 'right', 'up', 'down'],
  variant: ['default', 'outline', 'muted', 'secondary', 'destructive'],
  value: ['summary', 'details'],
  phase: ['loading', 'error', 'populated'],
}

/** Numeric fields whose blind `+7` would not reliably move the rendered
 * output: `maxVisible` gates a THRESHOLD (breadcrumbs collapse only once the
 * trail's item count exceeds it), not a monotonic quantity, and every fixture
 * trail is a fixed 2 items — `+7` never crosses that boundary from either
 * side. The override forces it to the OPPOSITE side of the 2-item boundary. */
const KNOWN_NUMERIC_OVERRIDES: Readonly<Record<string, (original: number) => number>> = {
  maxVisible: (original) => (original <= 1 ? original + 5 : 1),
}

/** Fields whose array value is a membership SET drawn from a fixed, small
 * real-id domain (a `selection ⊆ rows` sibling field, or a domain the
 * ADAPTER'S OWN fixture hardcodes, like tabs' two fixed ids) — a synthetic id
 * the generic mutator invents (`'alpha-extra'`) names no rendered row/tab/toc
 * entry, so adding it to the set is invisible. The override instead adds a
 * real, currently-absent member of that domain. Keyed by
 * `scenarioId.field` because the SAME field name (`expanded`) names a
 * different fixed domain on `component:toc` vs `component:tree-view`. */
const KNOWN_CONTEXTUAL_ARRAY_OVERRIDES: Readonly<
  Record<string, (input: Record<string, unknown>) => readonly string[] | typeof UNCHANGED>
> = {
  'component:table.selection': (input) => {
    const rows = input['rows'] as readonly string[]
    const selection = input['selection'] as readonly string[]
    const additional = rows.find((row) => !selection.includes(row))
    return additional === undefined ? UNCHANGED : [...selection, additional]
  },
  'component:tabs.disabledItems': (input) =>
    addAbsentFrom(['summary', 'details'], input['disabledItems'] as readonly string[]),
  'component:toc.expanded': (input) =>
    addAbsentFrom(['overview', 'api'], input['expanded'] as readonly string[]),
  // Only 'src' is a BRANCH in this fixture (`index` is a leaf, passed `false`
  // for `isBranch` in the adapter) — 'src' is the only id whose membership in
  // `expanded` has anything to toggle, so it is the only candidate; once
  // already present, UNCHANGED (correctly skipped, not allowlisted) rather
  // than adding the meaningless leaf id.
  'component:tree-view.expanded': (input) =>
    addAbsentFrom(['src'], input['expanded'] as readonly string[]),
  'component:tree-view.selected': (input) =>
    addAbsentFrom(['src', 'index'], input['selected'] as readonly string[]),
}

function addAbsentFrom(
  domain: readonly string[],
  current: readonly string[],
): readonly string[] | typeof UNCHANGED {
  const additional = domain.find((id) => !current.includes(id))
  return additional === undefined ? UNCHANGED : [...current, additional]
}

/** Produce a materially different, still well-typed value for a dimension
 * field so the test above can assert the rendered output actually moved. */
function mutateFieldValue(
  scenarioId: string,
  field: string,
  value: unknown,
  input: Record<string, unknown>,
): unknown {
  const contextual = KNOWN_CONTEXTUAL_ARRAY_OVERRIDES[`${scenarioId}.${field}`]
  if (contextual !== undefined) return contextual(input)
  if (typeof value === 'string') {
    const cycle = KNOWN_ENUM_CYCLES[field]
    if (cycle !== undefined) {
      const next = cycle[(cycle.indexOf(value) + 1) % cycle.length]!
      return next === value ? UNCHANGED : next
    }
    return value.length === 0 ? 'mutated' : `${value}-mutated`
  }
  if (typeof value === 'boolean') return !value
  if (typeof value === 'number') {
    const override = KNOWN_NUMERIC_OVERRIDES[field]
    const mutated = override === undefined ? value + 7 : override(value)
    return mutated === value ? UNCHANGED : mutated
  }
  if (value === null) return UNCHANGED // nullable axis fields are covered by their sibling cases
  if (Array.isArray(value)) {
    if (value.length === 0) return UNCHANGED
    // A membership SET (`completed: number[]` checked via `.includes()`) is
    // unaffected by a duplicate of an element it already contains — the
    // mutation must add a value that is PROVABLY absent, never repeat one.
    if (typeof value[0] === 'number') {
      const numbers = value as number[]
      return [...numbers, Math.max(...numbers) + 1]
    }
    if (typeof value[0] === 'string') {
      const strings = value as string[]
      let candidate = `${strings[strings.length - 1]}-extra`
      while (strings.includes(candidate)) candidate += '-extra'
      return [...strings, candidate]
    }
    return [...value, value[value.length - 1]]
  }
  return UNCHANGED
}
