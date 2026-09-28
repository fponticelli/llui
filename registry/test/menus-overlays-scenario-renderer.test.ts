/**
 * Dimension tests for the real registry menus-overlays renderer (#265 finding
 * #1/#2, part 2 of 2). Mirrors
 * `menus-overlays-baseline-renderer.test.ts`'s discipline exactly (#264
 * review items 2/3/D, restated in part 1's header doc): a raw `innerHTML`
 * diff is vacuous in two directions at once, so `projectPublishedState` reads
 * only the PRODUCT-PUBLISHED surface (`data-part`-carrying elements' own
 * `data-*`/`aria-*`/`role`/text/class), never a renderer wrapper attribute —
 * and never the registry skin's decorative Tailwind classes either, since
 * those are covered by `tailwind-classes.test.ts`/`registry-attrs.test.ts`,
 * not this one.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadProductContract } from '../../packages/components/test/styles/navigation-data-contract-source'
import {
  compileMenusOverlaysCatalog,
  joinMenusOverlaysScenarios,
  applicableMenusOverlaysScenarios,
  MENUS_OVERLAYS_CASES,
  MENUS_OVERLAYS_DEFINITIONS,
  FLOATING_PLACEMENT_PROBES,
  type MenusOverlaysDefinitionScenarioId,
  type MenusOverlaysInputs,
} from '../../packages/components/test/styles/menus-overlays-scenarios'
import {
  REGISTRY_ADAPTERS,
  mountRegistryMenusOverlaysScenarios,
  type Adapter,
  type RenderContext,
} from './menus-overlays-scenario-renderer'
import { DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT } from '@llui/cli/presentation-scenarios'
import type { PresentationScenarioEnvironment } from '@llui/cli/presentation-scenarios'
import {
  fieldAssertionFor,
  GEOMETRY_ALLOWLIST,
  ENV_AXIS_PROOFS,
  NESTED_ITEM_FIELD_ASSERTIONS,
  NESTED_MENUBAR_MENU_FIELD_ASSERTIONS,
  type FieldAssertion,
  type FieldAssertionContext,
} from '../../packages/components/test/styles/menus-overlays-field-assertions'
import {
  CONTEXT_MENU_ITEMS,
  MENUBAR_FIRST_MENU_ITEMS,
  MENUBAR_MENUS,
  MENUS_OVERLAYS_FIELD_MUTATORS,
  MENU_ITEMS,
  type NestedElements,
} from '../../packages/components/test/styles/menus-overlays-field-mutations'
import {
  isDeclaredField,
  mutateField,
  UNCHANGED,
  type ScenarioCaseOf,
} from '../../packages/components/test/styles/scenario-field-mutations'

const contract = loadProductContract()
const catalog = compileMenusOverlaysCatalog(contract)
const joined = joinMenusOverlaysScenarios(catalog, contract)
const applicable = applicableMenusOverlaysScenarios(joined, 'registryTailwind')
const scenarioIds = catalog.scenarios.map(({ scenarioId }) => scenarioId)

/** The adapter map viewed per scenario id at that id's input type; the
 * assignment checks every adapter against its scenario's declared input. */
const ADAPTERS: {
  readonly [Id in MenusOverlaysDefinitionScenarioId]: Adapter<MenusOverlaysInputs[Id]>
} = REGISTRY_ADAPTERS

describe('registry menus-overlays scenario renderer', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('mounts every one of the 17 products across every declared case with no throw', () => {
    const handle = mountRegistryMenusOverlaysScenarios(document.body, contract, catalog, applicable)
    const sections = document.querySelectorAll('[data-scenario-renderer="registryTailwind"]')
    const totalCases = applicable.reduce((sum, s) => sum + s.cases.length, 0)
    expect(sections.length).toBe(totalCases)
    handle.dispose()
  })

  it('fails closed when renderer bindings drift from ProductContract applicability', () => {
    expect(() =>
      mountRegistryMenusOverlaysScenarios(document.body, contract, catalog, applicable.slice(1)),
    ).toThrow(/bindings do not match applicable ProductContract scenarios/i)
  })

  const PLAIN_STATE_ATTRS = new Set([
    'disabled',
    'placeholder',
    'title',
    'value',
    'style',
    'tabindex',
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
            PLAIN_STATE_ATTRS.has(attr.name),
        )
        .map((attr) => `${attr.name}=${attr.value}`)
        .sort()
      const text = [...node.childNodes]
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent ?? '')
        .join('')
        .trim()
      // Same rationale as the baseline test's identical read: a controlled
      // `<input>`'s live VALUE is a DOM property, invisible to an
      // attribute-only walk.
      const liveValue = node instanceof HTMLInputElement ? `#value=${node.value}` : ''
      return `${node.tagName}|${attrs.join(',')}|${text}|${liveValue}`
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

  /** One scenario's own adapter and cases, at that scenario's input type — the
   * correlation a plain `Object.entries` loop loses (see
   * `scenario-field-mutations.ts`). */
  function eachCase<Id extends MenusOverlaysDefinitionScenarioId>(
    scenarioId: Id,
    visit: (
      adapter: Adapter<MenusOverlaysInputs[Id]>,
      scenarioCase: ScenarioCaseOf<MenusOverlaysInputs[Id]>,
      ctx: RenderContext,
    ) => void,
  ): void {
    const adapter = ADAPTERS[scenarioId]
    for (const scenarioCase of MENUS_OVERLAYS_CASES[scenarioId].cases) {
      visit(adapter, scenarioCase, {
        scenarioId,
        caseId: scenarioCase.id,
        environment: DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
      })
    }
  }

  it('projectPublishedState is deterministic: two identical mounts of the same case project identically', () => {
    for (const scenarioId of scenarioIds) {
      eachCase(scenarioId, (adapter, scenarioCase, ctx) => {
        const first = mountFor(adapter, scenarioCase.input, ctx)
        const second = mountFor(adapter, scenarioCase.input, ctx)
        expect(second.projection, `${scenarioId}/${scenarioCase.id}`).toBe(first.projection)
      })
    }
  })

  it('projectPublishedState ignores a wrapper-level echo attribute the adapter itself never published (negative probe)', () => {
    const scenarioId = 'component:dialog'
    const definition = MENUS_OVERLAYS_DEFINITIONS[scenarioId]
    const scenarioCase = definition.cases[0]!
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

  /**
   * Same discipline as the baseline test's identical allowlist: a dimension
   * this renderer is honestly insensitive to, keyed `scenarioId/caseId.field`,
   * WITH A REASON — never a bare allowlist.
   */
  const INSENSITIVE_DIMENSIONS: Record<string, string> = {
    'component:alert-dialog/open.skipAnimations':
      'presence rests at "open"; only a transition reads this flag',
    'component:dialog/modal.skipAnimations':
      'presence rests at "open"; only a transition reads this flag',
    'component:dialog/nested.skipAnimations':
      'presence rests at "open"; only a transition reads this flag',
    'component:dialog/non-modal.skipAnimations':
      'presence rests at "open"; only a transition reads this flag',
    'component:drawer/right.skipAnimations':
      'presence rests at "open"; only a transition reads this flag',
    'component:drawer/left.skipAnimations':
      'presence rests at "open"; only a transition reads this flag',
    'component:drawer/top.skipAnimations':
      'presence rests at "open"; only a transition reads this flag',
    'component:drawer/bottom.skipAnimations':
      'presence rests at "open"; only a transition reads this flag',
    'component:hover-card/open.skipAnimations':
      'presence rests at "open"; only a transition reads this flag',
    'component:popover/open.skipAnimations':
      'presence rests at "open"; only a transition reads this flag',
    'component:popover/top-start.skipAnimations':
      'presence rests at "open"; only a transition reads this flag',
    'component:popover/top-end.skipAnimations':
      'presence rests at "open"; only a transition reads this flag',
    'component:popover/flip-required.skipAnimations':
      'presence rests at "open"; only a transition reads this flag',
    'component:popover/shift-required.skipAnimations':
      'presence rests at "open"; only a transition reads this flag',
    'component:menu/open.skipAnimations':
      'presence rests at "open"; only a transition reads this flag',
    'component:menu/submenu-open.skipAnimations':
      'presence rests at "open"; only a transition reads this flag',
    'component:menu/overflow.skipAnimations':
      'presence rests at "open"; only a transition reads this flag',
    'component:tooltip/open.animated':
      'presence rests at "open"; only a transition reads this flag',
    // The #265 G2 placement probes: every one is an open, resting case.
    ...Object.fromEntries(
      (
        [
          ['component:hover-card', 'skipAnimations'],
          ['component:popover', 'skipAnimations'],
          ['component:menu', 'skipAnimations'],
          ['component:tooltip', 'animated'],
        ] as const
      ).flatMap(([scenarioId, field]) =>
        FLOATING_PLACEMENT_PROBES.map((placement) => [
          `${scenarioId}/placement-${placement}.${field}`,
          'presence rests at "open"; only a transition reads this flag',
        ]),
      ),
    ),
    'component:context-menu/opening.presence':
      'status is derived from skipAnimations, not a redundant explicit branch on this label',
    'component:menubar/open.focused':
      'falls back to the first enabled menu, which is already the case default',
    'component:navigation-menu/open.focused':
      'falls back to the first eligible branch, which is already the case default',
    'component:select/closed.items': 'content is unmounted while closed',
    'component:select/closed.selectionMode': 'content is unmounted while closed',
    'component:combobox/closed.value':
      'content is unmounted while closed; no separate value display',
    'pattern:searchable-select/closed.value':
      'content is unmounted while closed; no separate value display',
    'pattern:searchable-select/closed.status':
      'content (incl. empty-state) is unmounted while closed',
    'pattern:searchable-select/closed.inputValue': 'content is unmounted while closed',
    'pattern:command-menu/closed.query': 'dialog content is unmounted while closed',
    // The registry skin renders the confirm/cancel buttons through `Button`,
    // which carries no `data-part` — same reasoning as the baseline test's
    // identical allowance, one layer further since `Button` never publishes
    // `data-part` for ANY of its variants.
    'pattern:confirm-dialog/open.destructive':
      'the registry skin renders this variant on a non-data-part Button',
    'pattern:confirm-dialog/closed.title': 'content is unmounted while closed',
    'pattern:confirm-dialog/closed.description': 'content is unmounted while closed',
    'pattern:confirm-dialog/closed.destructive': 'content is unmounted while closed',
    'pattern:searchable-select/closed.items': 'content is unmounted while closed',
  }

  const SKIPPED_FIELDS = new Set(['placement', 'x', 'y'])

  const SKIPPED_FIELDS_PER_SCENARIO: Partial<
    Record<MenusOverlaysDefinitionScenarioId, ReadonlySet<string>>
  > = {
    'component:toast': new Set(['animated']),
  }

  /** Stable per-node identifier used to NAMESPACE its facts: `data-value` (menu
   * items, menubar/nav-menu triggers, select/combobox options all carry one),
   * else `id`, else `data-part` (unique for a single-instance part), else the
   * tag name. Without this, a fact string is shared across every SIBLING
   * carrying the same value (e.g. two menu items both `aria-disabled=true`,
   * or a submenu child that stays `data-highlighted=''` regardless of the
   * ROOT-level highlight under test) and a flat Set of `attr=value` collapses
   * them into ONE token — so toggling ONE sibling to match another already
   * produces no new token at all, a false "insensitive" (#265 review: this is
   * the general form of the A5/A3/B7 survivors — the mutation is real but
   * indistinguishable from a sibling's existing state without node identity).
   */
  function nodeKey(node: HTMLElement): string {
    return (
      node.getAttribute('data-value') ?? node.id ?? node.getAttribute('data-part') ?? node.tagName
    )
  }

  /**
   * `nodeKey|attr=value` (or `nodeKey|text=…`/`nodeKey|#value=…`) tokens for
   * every published fact across the host's `[data-part]` subtree — the
   * structural counterpart to `projectPublishedState`'s per-node string,
   * built specifically so a field's mutation can be checked against a
   * SPECIFIC named attribute on a SPECIFIC node rather than "the whole
   * projection differs" (#265 review: `expect(mutated).not.toBe(baseline)`
   * is inadmissible on its own, and structurally cannot reach an
   * array-of-objects field like a menu item's own `disabled` — the exact
   * shape of survivors A3/A5/B7).
   */
  function factSet(host: HTMLElement): Set<string> {
    const partNodes = [...host.querySelectorAll<HTMLElement>('[data-part]')]
    const nodes = partNodes.length > 0 ? partNodes : [...host.querySelectorAll<HTMLElement>('*')]
    const facts = new Set<string>()
    for (const node of nodes) {
      const key = nodeKey(node)
      for (const attr of Array.from(node.attributes)) {
        if (
          attr.name.startsWith('data-') ||
          attr.name.startsWith('aria-') ||
          attr.name === 'role' ||
          PLAIN_STATE_ATTRS.has(attr.name)
        ) {
          facts.add(`${key}|${attr.name}=${attr.value}`)
        }
      }
      const text = [...node.childNodes]
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent ?? '')
        .join('')
        .trim()
      if (text.length > 0) facts.add(`${key}|text=${text}`)
      if (node instanceof HTMLInputElement) facts.add(`${key}|#value=${node.value}`)
    }
    return facts
  }

  function attrNameOf(fact: string): string {
    const bar = fact.lastIndexOf('|')
    const eq = fact.indexOf('=', bar + 1)
    return fact.slice(bar + 1, eq)
  }

  function changedAttrNames(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
    const names = new Set<string>()
    for (const fact of a) if (!b.has(fact)) names.add(attrNameOf(fact))
    for (const fact of b) if (!a.has(fact)) names.add(attrNameOf(fact))
    return names
  }

  /** An `expectedFacts` formula names a bare `attr=value` with no node
   * identity (it does not know which node the field addresses), so it is
   * checked as a SUFFIX against the node-keyed set — an exact `attr=value`
   * match on WHATEVER node carries it. */
  function hasFactSuffix(facts: ReadonlySet<string>, suffix: string): boolean {
    for (const fact of facts) if (fact === suffix || fact.endsWith(`|${suffix}`)) return true
    return false
  }

  function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    if (a.size !== b.size) return false
    for (const v of a) if (!b.has(v)) return false
    return true
  }

  function mountFacts<Input>(
    adapter: Adapter<Input>,
    input: Input,
    ctx: RenderContext,
  ): Set<string> {
    const host = document.createElement('div')
    const handle = adapter(host, input, ctx)
    const facts = factSet(host)
    handle.dispose()
    return facts
  }

  /** Facts for ONE node only, identified by its own `data-value` — needed
   * for a nested array-of-objects element (a menu item, a menubar trigger),
   * because the flat host-wide `factSet` folds every node's facts into one
   * Set: when a SIBLING item already carries the same fact (e.g. `paste` is
   * already `aria-disabled=true` in `baseMenuItems`), toggling `copy` to
   * match produces no NEW token in the flat set even though `copy` itself
   * plainly changed. Scoping to the specific node this field addresses is
   * what makes the exact-fact check correct regardless of sibling state. */
  function nodeFacts(node: HTMLElement): Set<string> {
    const facts = new Set<string>()
    for (const attr of Array.from(node.attributes)) {
      if (
        attr.name.startsWith('data-') ||
        attr.name.startsWith('aria-') ||
        attr.name === 'role' ||
        PLAIN_STATE_ATTRS.has(attr.name)
      ) {
        facts.add(`${attr.name}=${attr.value}`)
      }
    }
    const text = [...node.childNodes]
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent ?? '')
      .join('')
      .trim()
    if (text.length > 0) facts.add(`text=${text}`)
    return facts
  }

  function mountFactsForDataValue<Input>(
    adapter: Adapter<Input>,
    input: Input,
    ctx: RenderContext,
    dataValue: string,
  ): Set<string> {
    const host = document.createElement('div')
    const handle = adapter(host, input, ctx)
    const node = host.querySelector<HTMLElement>(`[data-value="${dataValue}"]`)
    const facts = node === null ? new Set<string>() : nodeFacts(node)
    handle.dispose()
    return facts
  }

  function assertExact(
    key: string,
    assertion: FieldAssertion,
    originalValue: unknown,
    mutatedValue: unknown,
    baseFacts: ReadonlySet<string>,
    mutatedFacts: ReadonlySet<string>,
    ctxFor: (input: object) => FieldAssertionContext,
    baseInput: object,
    mutatedInput: object,
  ): void {
    const changedNames = changedAttrNames(baseFacts, mutatedFacts)
    expect(
      assertion.attrNames.some((n) => changedNames.has(n)),
      `${key}: expected one of [${assertion.attrNames.join(', ')}] to change; changed attrs were [${[...changedNames].join(', ')}]`,
    ).toBe(true)
    if (assertion.expectedFacts === undefined) return
    for (const fact of assertion.expectedFacts(originalValue, ctxFor(baseInput))) {
      expect(hasFactSuffix(baseFacts, fact), `${key} baseline missing exact fact "${fact}"`).toBe(
        true,
      )
    }
    for (const fact of assertion.expectedFacts(mutatedValue, ctxFor(mutatedInput))) {
      expect(hasFactSuffix(mutatedFacts, fact), `${key} mutated missing exact fact "${fact}"`).toBe(
        true,
      )
    }
  }

  /** Checks the FIRST element of an array-of-objects field (`items`,
   * `menus`, `menus[0].items`) against its assertion table — the fields the
   * top-level loop below structurally cannot reach, since an array of objects
   * is never mutated whole (a whole-array mutation is ambiguous about WHICH
   * element changed). */
  function checkNestedFields<Input extends object, Element extends object>(
    scenarioId: MenusOverlaysDefinitionScenarioId,
    caseId: string,
    nested: NestedElements<Input, Element>,
    assertions: Readonly<Record<string, FieldAssertion>>,
    input: Input,
    adapter: Adapter<Input>,
    ctx: RenderContext,
  ): void {
    const first = nested.elements(input)[0]
    if (first === undefined) return
    const dataValue = nested.dataValue(first)
    for (const [field, assertion] of Object.entries(assertions)) {
      if (!Object.hasOwn(first, field)) continue
      const key = `${scenarioId}/${caseId}.${nested.label}[0].${field}`
      if (!isDeclaredField(nested.mutators, field))
        throw new Error(`${key} has no declared mutator`)
      const mutation = mutateField(nested.mutators, first, field)
      if (mutation === UNCHANGED) continue
      const mutatedInput = nested.withFirst(input, mutation.input)
      const baseNodeFacts = mountFactsForDataValue(adapter, input, ctx, dataValue)
      const mutatedNodeFacts = mountFactsForDataValue(adapter, mutatedInput, ctx, dataValue)
      assertExact(
        key,
        assertion,
        mutation.original,
        mutation.value,
        baseNodeFacts,
        mutatedNodeFacts,
        (i) => ({ scenarioId, caseId, input: i }),
        input,
        mutatedInput,
      )
    }
  }

  /** The nested array-of-objects fields each scenario reaches into. An `items`
   * or `menus` field holding objects on a scenario with no entry here fails
   * the test below, so a new such scenario cannot silently go unchecked. */
  const NESTED_CHECKS: {
    readonly [Id in MenusOverlaysDefinitionScenarioId]?: (
      input: MenusOverlaysInputs[Id],
      adapter: Adapter<MenusOverlaysInputs[Id]>,
      ctx: RenderContext,
    ) => void
  } = {
    'component:menu': (input, adapter, ctx) =>
      checkNestedFields(
        'component:menu',
        ctx.caseId,
        MENU_ITEMS,
        NESTED_ITEM_FIELD_ASSERTIONS,
        input,
        adapter,
        ctx,
      ),
    'component:context-menu': (input, adapter, ctx) =>
      checkNestedFields(
        'component:context-menu',
        ctx.caseId,
        CONTEXT_MENU_ITEMS,
        NESTED_ITEM_FIELD_ASSERTIONS,
        input,
        adapter,
        ctx,
      ),
    'component:menubar': (input, adapter, ctx) => {
      checkNestedFields(
        'component:menubar',
        ctx.caseId,
        MENUBAR_MENUS,
        NESTED_MENUBAR_MENU_FIELD_ASSERTIONS,
        input,
        adapter,
        ctx,
      )
      // A menu's own item nodes are only MOUNTED while that specific
      // menu is the currently open one (`menubar.ts`'s `data-state`-gated
      // content) — the 'closed' case's `open: null` unmounts every
      // menu's content entirely, so an item field mutation here has no
      // node to observe at all. Skip rather than fail: this is a
      // structural precondition, not the field being insensitive.
      const firstMenu = input.menus[0]
      if (firstMenu !== undefined && input.open === firstMenu.id) {
        checkNestedFields(
          'component:menubar',
          ctx.caseId,
          MENUBAR_FIRST_MENU_ITEMS,
          NESTED_ITEM_FIELD_ASSERTIONS,
          input,
          adapter,
          ctx,
        )
      }
    },
  }

  const NESTED_FIELD_NAMES = new Set(['items', 'menus'])

  function isObjectList(value: unknown): boolean {
    return Array.isArray(value) && value.some((element) => typeof element === 'object')
  }

  function checkFieldDimensions<Id extends MenusOverlaysDefinitionScenarioId>(
    scenarioId: Id,
    hitAllowances: Set<string>,
    usedGeometryAllowances: Set<string>,
  ): void {
    const mutators = MENUS_OVERLAYS_FIELD_MUTATORS[scenarioId]
    const nestedCheck = NESTED_CHECKS[scenarioId]
    eachCase(scenarioId, (adapter, scenarioCase, ctx) => {
      const input = scenarioCase.input
      const baseFacts = mountFacts(adapter, input, ctx)

      for (const field of Object.keys(input)) {
        const key = `${scenarioId}/${scenarioCase.id}.${field}`
        if (!isDeclaredField(mutators, field)) throw new Error(`${key} has no declared mutator`)
        if (NESTED_FIELD_NAMES.has(field) && isObjectList(input[field])) {
          expect(nestedCheck, `${key} holds objects but has no nested check`).toBeDefined()
        }
        const skippedGlobally = SKIPPED_FIELDS.has(field)
        const skippedPerScenario = SKIPPED_FIELDS_PER_SCENARIO[scenarioId]?.has(field) ?? false
        if (skippedGlobally || skippedPerScenario) {
          if (skippedGlobally) {
            const reason = GEOMETRY_ALLOWLIST[field]
            expect(reason, `${field} is globally skipped with no geometry allowance`).toBeDefined()
            usedGeometryAllowances.add(field)
          }
          continue
        }
        const mutation = mutateField(mutators, input, field)
        if (mutation === UNCHANGED) continue
        const mutatedFacts = mountFacts(adapter, mutation.input, ctx)

        if (setsEqual(baseFacts, mutatedFacts)) {
          const reason = INSENSITIVE_DIMENSIONS[key]
          expect(reason, key).toBeDefined()
          hitAllowances.add(key)
          continue
        }

        const assertion = fieldAssertionFor(scenarioId, scenarioCase.id, field)
        if (assertion === undefined) throw new Error(`no FIELD_ASSERTION registered for ${key}`)
        assertExact(
          key,
          assertion,
          mutation.original,
          mutation.value,
          baseFacts,
          mutatedFacts,
          (i) => ({ scenarioId, caseId: scenarioCase.id, input: i }),
          input,
          mutation.input,
        )
      }

      nestedCheck?.(input, adapter, ctx)
    })
  }

  it('every declared case field materially changes the specific machine-published fact FIELD_ASSERTIONS names for it, or is documented as insensitive/geometry-only', () => {
    const hitAllowances = new Set<string>()
    const usedGeometryAllowances = new Set<string>()
    for (const scenarioId of scenarioIds) {
      checkFieldDimensions(scenarioId, hitAllowances, usedGeometryAllowances)
    }
    for (const key of Object.keys(INSENSITIVE_DIMENSIONS)) {
      expect(hitAllowances.has(key), `unused allowance: ${key}`).toBe(true)
    }
    for (const field of SKIPPED_FIELDS) {
      expect(usedGeometryAllowances.has(field), `unused geometry allowance: ${field}`).toBe(true)
    }
  })

  it('a case declaring an environment axis materially changes the exact mount host attribute for that axis, or is documented as unobservable in jsdom', () => {
    const usedAxisAllowances = new Set<string>()
    for (const scenarioId of scenarioIds) {
      eachCase(scenarioId, (adapter, scenarioCase, baseCtx) => {
        for (const axis of scenarioCase.environmentAxes) {
          expect(ENV_AXIS_PROOFS[axis].proofs.length, axis).toBeGreaterThan(0)
          usedAxisAllowances.add(axis)
          if (axis === 'motion') continue
          const mutatedEnvironment: PresentationScenarioEnvironment = {
            ...DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
            ...(axis === 'direction' ? { direction: 'rtl' } : {}),
            ...(axis === 'theme' ? { theme: 'dark' } : {}),
            ...(axis === 'viewport' ? { viewport: 'narrow' } : {}),
            ...(axis === 'forcedColors' ? { forcedColors: 'active' } : {}),
          }
          const host = document.createElement('div')
          const handle = adapter(host, scenarioCase.input, {
            ...baseCtx,
            environment: mutatedEnvironment,
          })
          if (axis === 'direction') expect(host.getAttribute('dir')).toBe('rtl')
          if (axis === 'theme') expect(host.dataset.theme).toBe('dark')
          if (axis === 'viewport') expect(host.dataset.viewport).toBe('narrow')
          if (axis === 'forcedColors') expect(host.dataset.forcedColors).toBe('active')
          handle.dispose()
        }
      })
    }
    expect([...usedAxisAllowances].sort()).toEqual(Object.keys(ENV_AXIS_PROOFS).sort())
  })
})
