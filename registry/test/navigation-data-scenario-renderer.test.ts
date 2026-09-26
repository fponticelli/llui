import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadProductContract } from '../../packages/components/test/styles/navigation-data-contract-source'
import {
  applicableNavigationDataScenarios,
  compileNavigationDataCatalog,
  DENSITY_APPLICABLE_PRODUCT_IDS,
  densityRationale,
  joinNavigationDataScenarios,
  NAVIGATION_DATA_DEFINITIONS,
  type NavigationDataJoinedScenario,
} from '../../packages/components/test/styles/navigation-data-scenarios'
import {
  REGISTRY_ADAPTERS,
  mountRegistryNavigationDataScenarios,
  type Disposable,
} from './navigation-data-scenario-renderer'

const contract = loadProductContract()
const catalog = compileNavigationDataCatalog(contract)
const joined = joinNavigationDataScenarios(catalog, contract)
const scenarios = applicableNavigationDataScenarios(joined, 'registryTailwind')
const entryByProduct = new Map(contract.entries.map((entry) => [entry.name, entry]))

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

  it('consumes every applicable compact-density case on the live skinned root, and no other product ever renders one', () => {
    const host = render()
    const compact = [...host.querySelectorAll<HTMLElement>('[data-scenario-case="compact"]')]
    const compactProductIds = compact.map((node) => node.dataset.scenarioProduct).sort()
    expect(compactProductIds).toEqual(DENSITY_APPLICABLE_PRODUCT_IDS)
    for (const scenarioRoot of compact) {
      expect(
        scenarioRoot.querySelector<HTMLElement>('[data-density="compact"]'),
        scenarioRoot.dataset.scenarioId,
      ).not.toBeNull()
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

  it('every case field a case declares materially changes this renderer real output (#264 item D)', () => {
    const host = render()
    void host
    const hitAllowances = new Set<string>()
    for (const [scenarioId, definition] of Object.entries(NAVIGATION_DATA_DEFINITIONS)) {
      const adapter = REGISTRY_ADAPTERS[scenarioId as keyof typeof REGISTRY_ADAPTERS]
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
    expect(Object.keys(INSENSITIVE_DIMENSIONS).filter((key) => !hitAllowances.has(key))).toEqual([])
  })
})

/** Same structural exceptions as the baseline renderer's identical dimension-
 * mutation test (see its own comments for the full reasoning) — the registry
 * skin composes the SAME real machines, so the same facts about their
 * reducers/fixtures apply verbatim. */
const INSENSITIVE_DIMENSIONS: Readonly<Record<string, string>> = {
  // Note: unlike the baseline renderer, the registry `CarouselPrevious`/
  // `CarouselNext` skin's rendered class differs by `data-disabled` in a way
  // that is NOT purely position-gated, so `loop` is NOT a no-op here at index
  // 1 of 3 — no allowance needed for `component:carousel/active.loop` or
  // `.../dragging.loop` on this path (asserted precisely by the closed-both-
  // ends check below: an unused allowance fails the build).
  'component:marquee/disabled.running':
    'marquee.ts:isRunning() is `running && !disabled` — once disabled is true, running can never make it play.',
  'component:steps/completed.completed':
    'steps.ts:statusOf checks `current` before `completed`, and this case already has completed=[0,1] with current=2 over a 3-step fixture — the only index left to add IS current, whose status always wins.',
  'component:tree-view/disabled.busy':
    'tree-view.ts:update() early-returns on `loadingStart` whenever `state.disabled` is true — a disabled tree can never actually enter the loading state.',
}

const UNCHANGED = Symbol('unchanged')

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

const KNOWN_NUMERIC_OVERRIDES: Readonly<Record<string, (original: number) => number>> = {
  maxVisible: (original) => (original <= 1 ? original + 5 : 1),
}

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
  if (value === null) return UNCHANGED
  if (Array.isArray(value)) {
    if (value.length === 0) return UNCHANGED
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
