import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

  it('every case field and environment axis a case declares materially changes this renderer real output (#264 item D)', () => {
    const host = render()
    void host
    const hitAllowances = new Set<string>()
    for (const [scenarioId, definition] of Object.entries(NAVIGATION_DATA_DEFINITIONS)) {
      const adapter = BASELINE_ADAPTERS[scenarioId as keyof typeof BASELINE_ADAPTERS]
      if (adapter === undefined) continue // registry-only atom: not resolvable on baseline
      for (const scenarioCase of definition.cases) {
        const baseHost = document.createElement('div')
        const baseHandle = (
          adapter as (h: HTMLElement, input: unknown, ctx: unknown) => Disposable
        )(baseHost, scenarioCase.input, { scenarioId, caseId: scenarioCase.id, environment: {} })
        const baseline = baseHost.innerHTML
        baseHandle.dispose()

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
          const mutHost = document.createElement('div')
          const mutHandle = (
            adapter as (h: HTMLElement, input: unknown, ctx: unknown) => Disposable
          )(mutHost, mutatedInput, { scenarioId, caseId: scenarioCase.id, environment: {} })
          const mutated = mutHost.innerHTML
          mutHandle.dispose()
          const key = `${scenarioId}/${scenarioCase.id}.${field}`
          if (mutated === baseline) {
            const reason = INSENSITIVE_DIMENSIONS[key]
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
    expect(Object.keys(INSENSITIVE_DIMENSIONS).filter((key) => !hitAllowances.has(key))).toEqual([])
  })
})

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
