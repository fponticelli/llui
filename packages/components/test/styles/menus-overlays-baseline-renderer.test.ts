/**
 * Dimension tests for the real baseline menus-overlays renderer (#265
 * finding #1/#2, part 1 of 2). Mirrors
 * `navigation-data-baseline-renderer.test.ts`'s discipline (#264 review
 * items 2/3/D): a raw `innerHTML` diff is vacuous in two directions at
 * once — a renderer-added echo of the very field being mutated can make an
 * adapter that is genuinely insensitive to a field look sensitive, and an
 * unrelated non-determinism (a module-level counter) can make two identical
 * mounts look different. `projectPublishedState` reads only the
 * PRODUCT-PUBLISHED surface (`data-part`-carrying elements' own
 * `data-*`/`aria-*`/`role`/text/class), never a renderer wrapper attribute.
 */
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProductContractSchema } from '@llui/cli'
import {
  compileMenusOverlaysCatalog,
  joinMenusOverlaysScenarios,
  MENUS_OVERLAYS_DEFINITIONS,
  FLOATING_PLACEMENT_PROBES,
  type MenusOverlaysDefinitionScenarioId,
} from './menus-overlays-scenarios.js'
import {
  BASELINE_ADAPTERS,
  mountBaselineMenusOverlaysScenarios,
  type Disposable,
  type RenderContext,
} from './menus-overlays-baseline-renderer.js'
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
} from './menus-overlays-field-assertions.js'

const ROOT = resolve(import.meta.dirname, '../../../..')
const registry = JSON.parse(readFileSync(resolve(ROOT, 'registry/registry.json'), 'utf8')) as {
  productContract?: unknown
}
const contract = ProductContractSchema.parse(registry.productContract)
const catalog = compileMenusOverlaysCatalog(contract)
const joined = joinMenusOverlaysScenarios(catalog, contract)

describe('baseline menus-overlays scenario renderer', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('mounts every one of the 17 products across every declared case with no throw', () => {
    const handle = mountBaselineMenusOverlaysScenarios(document.body, contract, catalog, joined)
    const sections = document.querySelectorAll('[data-scenario-renderer="baseline"]')
    const totalCases = joined.reduce((sum, s) => sum + s.cases.length, 0)
    expect(sections.length).toBe(totalCases)
    handle.dispose()
  })

  it('fails closed when renderer bindings drift from ProductContract applicability', () => {
    expect(() =>
      mountBaselineMenusOverlaysScenarios(document.body, contract, catalog, joined.slice(1)),
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
      // A controlled `<input>`'s live VALUE is a DOM property, not an HTML
      // attribute — `.value` only reflects the initial default value, so a
      // reactive `value` binding (combobox's filter input) is invisible to
      // an attribute-only walk. Read the live property for input elements.
      const liveValue = node instanceof HTMLInputElement ? `#value=${node.value}` : ''
      return `${node.tagName}|${attrs.join(',')}|${text}|${liveValue}`
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

  it('projectPublishedState is deterministic: two identical mounts of the same case project identically', () => {
    for (const [scenarioId, definition] of Object.entries(MENUS_OVERLAYS_DEFINITIONS)) {
      const adapter = BASELINE_ADAPTERS[scenarioId as keyof typeof BASELINE_ADAPTERS]
      for (const scenarioCase of definition.cases) {
        const ctx: RenderContext = {
          scenarioId: scenarioId as MenusOverlaysDefinitionScenarioId,
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

  it('projectPublishedState ignores a wrapper-level echo attribute the adapter itself never published (negative probe)', () => {
    const scenarioId = 'component:dialog'
    const definition = MENUS_OVERLAYS_DEFINITIONS[scenarioId]
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

  /**
   * A dimension this renderer is honestly insensitive to, keyed
   * `scenarioId/caseId.field`, WITH A REASON — never a bare allowlist. A
   * field's mutation may be muted for a genuinely real structural reason
   * (e.g. `skipAnimations` on a case already resolved to `closed`, where
   * nothing is mounted to observe it) or because this renderer's minimal
   * markup does not yet surface a field part 2's registry skin will (a
   * known residue, named as such).
   */
  const INSENSITIVE_DIMENSIONS: Record<string, string> = {
    // `skipAnimations`/`animated` only affect the TRANSITION taken to reach a
    // status, never the RESTING published status once reached (real
    // `presenceOpen`/`presenceClose` semantics): a case whose presence is
    // already resting at 'open' (never entering an 'opening'/'closing'
    // transition in this renderer) is genuinely insensitive to it.
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
    // context-menu's adapter derives status from `skipAnimations` alone
    // (real `statusOnOpen`), never from a redundant explicit branch on this
    // label field — mutating `presence` from 'opening' to 'open' with
    // `skipAnimations` unchanged reaches the identical real status.
    'component:context-menu/opening.presence':
      'status is derived from skipAnimations, not a redundant explicit branch on this label',
    // Real menubar fallback (menubar.ts): the bar carries exactly one tab
    // stop — the focused trigger, or the FIRST ENABLED menu when `focused`
    // no longer names one. The default case's `focused` already names the
    // first enabled menu ('file'), so mutating it to an unknown id falls
    // back to the identical tab stop.
    'component:menubar/open.focused':
      'falls back to the first enabled menu, which is already the case default',
    // Same fallback shape one component over (#145 in navigation-menu.ts):
    // a `focused` id absent from the roving membership list falls back to
    // the first eligible entry, which is already the case default.
    'component:navigation-menu/open.focused':
      'falls back to the first eligible branch, which is already the case default',
    // Closed trigger: the listbox/list content is not mounted at all, so a
    // field that only affects the open content's markup is unobservable.
    'component:select/closed.items': 'content is unmounted while closed',
    'component:select/closed.selectionMode': 'content is unmounted while closed',
    'component:combobox/closed.items': 'content is unmounted while closed',
    // This minimal renderer shows no dedicated "selected value" display part
    // for combobox — only the filter `input`'s own `inputValue`; `value`
    // (the selection ids) is published only via a selected item's own
    // `aria-selected`, which is content and therefore unmounted while closed.
    'component:combobox/closed.value':
      'content is unmounted while closed; no separate value display',
    'component:combobox/closed.status': 'content (incl. empty-state) is unmounted while closed',
    'pattern:searchable-select/closed.value':
      'content is unmounted while closed; no separate value display',
    'pattern:searchable-select/closed.status':
      'content (incl. empty-state) is unmounted while closed',
    'pattern:searchable-select/closed.inputValue': 'content is unmounted while closed',
    'pattern:command-menu/closed.query': 'dialog content is unmounted while closed',
    // The real confirm-dialog view() (patterns/confirm-dialog.ts) renders
    // its confirm button's class WITHOUT a `data-part` attribute, so once
    // any other node in the tree carries `data-part` (content/title/
    // description do) this walk restricts itself to `[data-part]` nodes and
    // never visits the plain confirm/cancel buttons at all.
    'pattern:confirm-dialog/open.destructive':
      'the real view() renders this class on a non-data-part node',
    'pattern:confirm-dialog/closed.title': 'content is unmounted while closed',
    'pattern:confirm-dialog/closed.description': 'content is unmounted while closed',
    'pattern:confirm-dialog/closed.destructive': 'content is unmounted while closed',
    'pattern:searchable-select/closed.items': 'content is unmounted while closed',
  }

  /**
   * Fields `mutateFieldValue` never mutates at all, with a reason — the
   * structural counterpart to `INSENSITIVE_DIMENSIONS` above (which
   * documents a mutation that WAS applied but produced no diff for a
   * specific reason). `placement`/`x`/`y` drive `attachFloating`'s REAL
   * layout measurement (ResizeObserver + a real `getBoundingClientRect`),
   * which jsdom never performs — every element measures a zero rect
   * regardless of the requested placement/anchor, so mutating these here
   * would only ever produce a false "insensitive" or a coincidentally-true
   * "sensitive" reading. This is the documented residue this part-1 pass
   * leaves for a real-Chromium geometry probe (collision flip/shift,
   * virtual anchor position, arrow side) in a later pass.
   */
  const SKIPPED_FIELDS = new Set(['placement', 'x', 'y'])

  /** Scenario-scoped field skips — same rationale as `SKIPPED_FIELDS`, but
   * for a field name that is NOT globally structural (e.g. `animated` IS
   * real, observable machine state for tooltip's opening/closing cases). */
  const SKIPPED_FIELDS_PER_SCENARIO: Partial<
    Record<MenusOverlaysDefinitionScenarioId, ReadonlySet<string>>
  > = {
    // Toast's `animated` only matters at the closing->end transition
    // (whether an animationEnd is awaited before removal), which this
    // renderer's single-toast seed never drives past 'closing' — see
    // `mountFor`, which always disposes synchronously after one mount.
    'component:toast': new Set(['animated']),
  }

  function mutateFieldValue(field: string, value: unknown): unknown | typeof UNCHANGED {
    if (typeof value === 'string') {
      const cycle = ENUM_CYCLES[field]
      if (cycle !== undefined) {
        const next = cycle[(cycle.indexOf(value) + 1) % cycle.length]!
        return next === value ? UNCHANGED : next
      }
      return value.length === 0 ? 'mutated' : `${value}-mutated`
    }
    if (typeof value === 'boolean') return !value
    if (typeof value === 'number') return value + 7
    if (value === null) return UNCHANGED // nullable fields are covered by their own sibling cases
    if (Array.isArray(value)) {
      if (value.length === 0) return UNCHANGED
      if (typeof value[0] === 'string') return value.slice(0, -1)
      return UNCHANGED // arrays of objects (menu items, menubar menus, …): structural, not scalar
    }
    return UNCHANGED
  }

  const UNCHANGED = Symbol('unchanged')

  const ENUM_CYCLES: Record<string, readonly string[]> = {
    presence: ['opening', 'open', 'closing', 'closed'],
    side: ['top', 'right', 'bottom', 'left'],
    edge: ['top', 'right', 'bottom', 'left'],
    placement: [
      'top',
      'top-start',
      'top-end',
      'bottom',
      'bottom-start',
      'bottom-end',
      'left',
      'left-start',
      'left-end',
      'right',
      'right-start',
      'right-end',
    ],
    toastType: ['info', 'success', 'warning', 'error', 'loading', 'custom'],
    orientation: ['horizontal', 'vertical'],
    selectionMode: ['single', 'multiple'],
    status: ['idle', 'loading', 'loaded', 'error'],
    kind: ['action', 'checkbox'],
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

  type TypedAdapter = (h: HTMLElement, input: unknown, ctx: RenderContext) => Disposable

  function mountFacts(adapter: TypedAdapter, input: unknown, ctx: RenderContext): Set<string> {
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

  function mountFactsForDataValue(
    adapter: TypedAdapter,
    input: unknown,
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
    ctxFor: (input: Record<string, unknown>) => FieldAssertionContext,
    baseInput: Record<string, unknown>,
    mutatedInput: Record<string, unknown>,
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
   * `menus[0].items`) against `NESTED_ITEM_FIELD_ASSERTIONS` — the fields
   * the top-level loop below structurally cannot reach, since
   * `mutateFieldValue` declines every array of objects as "structural, not
   * scalar" (deliberately: a whole-array mutation is ambiguous about WHICH
   * element changed). */
  function checkNestedItemFields(
    scenarioId: string,
    caseId: string,
    arrayLabel: string,
    items: readonly Record<string, unknown>[] | undefined,
    buildMutatedInput: (mutatedFirst: Record<string, unknown>) => Record<string, unknown>,
    baseInput: Record<string, unknown>,
    dataValueKey: string,
    adapter: TypedAdapter,
    ctx: RenderContext,
  ): void {
    if (!Array.isArray(items) || items.length === 0) return
    const first = items[0]!
    // `select`/`combobox`/`toolbar`'s `items` is `readonly string[]` — a
    // plain scalar array, not array-of-objects. Nothing here applies to it.
    if (typeof first !== 'object' || first === null) return
    const dataValue = String(first[dataValueKey])
    for (const [field, assertion] of Object.entries(NESTED_ITEM_FIELD_ASSERTIONS)) {
      if (!(field in first)) continue
      const originalValue = first[field]
      const mutatedValue = mutateFieldValue(field, originalValue)
      if (mutatedValue === UNCHANGED) continue
      const mutatedInput = buildMutatedInput({ ...first, [field]: mutatedValue })
      const baseNodeFacts = mountFactsForDataValue(adapter, baseInput, ctx, dataValue)
      const mutatedNodeFacts = mountFactsForDataValue(adapter, mutatedInput, ctx, dataValue)
      const key = `${scenarioId}/${caseId}.${arrayLabel}[0].${field}`
      assertExact(
        key,
        assertion,
        originalValue,
        mutatedValue,
        baseNodeFacts,
        mutatedNodeFacts,
        (input) => ({ scenarioId, caseId, input }),
        baseInput,
        mutatedInput,
      )
    }
  }

  it('every declared case field materially changes the specific machine-published fact FIELD_ASSERTIONS names for it, or is documented as insensitive/geometry-only', () => {
    const hitAllowances = new Set<string>()
    const usedGeometryAllowances = new Set<string>()
    for (const [scenarioId, definition] of Object.entries(MENUS_OVERLAYS_DEFINITIONS)) {
      const adapter = BASELINE_ADAPTERS[scenarioId as keyof typeof BASELINE_ADAPTERS]
      const typedAdapter = adapter as TypedAdapter
      for (const scenarioCase of definition.cases) {
        const ctx: RenderContext = {
          scenarioId: scenarioId as MenusOverlaysDefinitionScenarioId,
          caseId: scenarioCase.id,
          environment: DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
        }
        const input = scenarioCase.input as Record<string, unknown>
        const baseFacts = mountFacts(typedAdapter, input, ctx)

        for (const field of Object.keys(input)) {
          const key = `${scenarioId}/${scenarioCase.id}.${field}`
          const skippedGlobally = SKIPPED_FIELDS.has(field)
          const skippedPerScenario =
            SKIPPED_FIELDS_PER_SCENARIO[scenarioId as MenusOverlaysDefinitionScenarioId]?.has(
              field,
            ) ?? false
          if (skippedGlobally || skippedPerScenario) {
            if (skippedGlobally) {
              const reason = GEOMETRY_ALLOWLIST[field]
              expect(
                reason,
                `${field} is globally skipped with no geometry allowance`,
              ).toBeDefined()
              usedGeometryAllowances.add(field)
            }
            continue
          }
          const originalValue = input[field]
          const mutatedValue = mutateFieldValue(field, originalValue)
          if (mutatedValue === UNCHANGED) continue
          const mutatedInput = { ...input, [field]: mutatedValue }
          const mutatedFacts = mountFacts(typedAdapter, mutatedInput, ctx)

          if (setsEqual(baseFacts, mutatedFacts)) {
            const reason = INSENSITIVE_DIMENSIONS[key]
            expect(reason, key).toBeDefined()
            hitAllowances.add(key)
            continue
          }

          const assertion = fieldAssertionFor(scenarioId, scenarioCase.id, field)
          expect(assertion, `no FIELD_ASSERTION registered for ${key}`).toBeDefined()
          assertExact(
            key,
            assertion!,
            originalValue,
            mutatedValue,
            baseFacts,
            mutatedFacts,
            (i) => ({ scenarioId, caseId: scenarioCase.id, input: i }),
            input,
            mutatedInput,
          )
        }

        checkNestedItemFields(
          scenarioId,
          scenarioCase.id,
          'items',
          input.items as readonly Record<string, unknown>[] | undefined,
          (mutatedFirst) => ({
            ...input,
            items: [mutatedFirst, ...(input.items as readonly Record<string, unknown>[]).slice(1)],
          }),
          input,
          'value',
          typedAdapter,
          ctx,
        )

        const menus = input.menus as readonly Record<string, unknown>[] | undefined
        if (Array.isArray(menus) && menus.length > 0) {
          const firstMenu = menus[0]!
          const menuDataValue = String(firstMenu.id)
          for (const [field, assertion] of Object.entries(NESTED_MENUBAR_MENU_FIELD_ASSERTIONS)) {
            if (!(field in firstMenu)) continue
            const originalValue = firstMenu[field]
            const mutatedValue = mutateFieldValue(field, originalValue)
            if (mutatedValue === UNCHANGED) continue
            const mutatedInput = {
              ...input,
              menus: [{ ...firstMenu, [field]: mutatedValue }, ...menus.slice(1)],
            }
            const baseNodeFacts = mountFactsForDataValue(typedAdapter, input, ctx, menuDataValue)
            const mutatedNodeFacts = mountFactsForDataValue(
              typedAdapter,
              mutatedInput,
              ctx,
              menuDataValue,
            )
            const key = `${scenarioId}/${scenarioCase.id}.menus[0].${field}`
            assertExact(
              key,
              assertion,
              originalValue,
              mutatedValue,
              baseNodeFacts,
              mutatedNodeFacts,
              (i) => ({ scenarioId, caseId: scenarioCase.id, input: i }),
              input,
              mutatedInput,
            )
          }

          // A menu's own item nodes are only MOUNTED while that specific
          // menu is the currently open one (`menubar.ts`'s `data-state`-gated
          // content) — the 'closed' case's `open: null` unmounts every
          // menu's content entirely, so an item field mutation here has no
          // node to observe at all. Skip rather than fail: this is a
          // structural precondition, not the field being insensitive.
          if (input.open === firstMenu.id) {
            checkNestedItemFields(
              scenarioId,
              scenarioCase.id,
              'menus[0].items',
              firstMenu.items as readonly Record<string, unknown>[] | undefined,
              (mutatedFirstItem) => ({
                ...input,
                menus: [
                  {
                    ...firstMenu,
                    items: [
                      mutatedFirstItem,
                      ...(firstMenu.items as readonly Record<string, unknown>[]).slice(1),
                    ],
                  },
                  ...menus.slice(1),
                ],
              }),
              input,
              'value',
              typedAdapter,
              ctx,
            )
          }
        }
      }
    }
    for (const key of Object.keys(INSENSITIVE_DIMENSIONS)) {
      expect(hitAllowances.has(key), `unused allowance: ${key}`).toBe(true)
    }
    for (const field of SKIPPED_FIELDS) {
      expect(usedGeometryAllowances.has(field), `unused geometry allowance: ${field}`).toBe(true)
    }
  })

  /** The titles of the real `it(...)` calls in a test file — parsed, so a
   * commented-out test or a title quoted in prose never counts. A generated
   * per-case title is its template text, `${…}` included. */
  function liveTestTitles(file: string): string[] {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest)
    const titles: string[] = []
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'it'
      ) {
        const title = node.arguments[0]
        if (title !== undefined && ts.isStringLiteralLike(title)) titles.push(title.text)
        else if (title !== undefined && ts.isTemplateExpression(title)) {
          titles.push(title.getText(source).slice(1, -1))
        }
      }
      node.forEachChild(visit)
    }
    visit(source)
    return titles
  }

  it('every live proof names a test that exists, by its exact title, in its file', () => {
    const proofs = [
      ...Object.values(GEOMETRY_ALLOWLIST),
      ...Object.values(ENV_AXIS_PROOFS),
    ].flatMap(({ proofs }) => proofs)
    // Exact, not a floor: a floor would not notice a proof file silently
    // dropping out of the table.
    expect(new Set(proofs.map(({ file }) => file)).size).toBe(3)
    for (const { file, test } of proofs) {
      expect(liveTestTitles(resolve(ROOT, file)), file).toContain(test)
    }
  })

  /** Every axis reflected as a host attribute (`direction`/`theme`/
   * `viewport`/`forcedColors`) is asserted exactly here — the adapter's own
   * WIRING. What the axis does to the PRODUCT is proven live, per
   * `ENV_AXIS_PROOFS`, which every declared axis must have; `motion` writes
   * no host attribute at all (it is a media query), so only its live proof
   * applies. */
  it('a case declaring an environment axis materially changes the exact mount host attribute for that axis, or is documented as unobservable in jsdom', () => {
    const usedAxisAllowances = new Set<string>()
    for (const [scenarioId, definition] of Object.entries(MENUS_OVERLAYS_DEFINITIONS)) {
      const adapter = BASELINE_ADAPTERS[scenarioId as keyof typeof BASELINE_ADAPTERS]
      const typedAdapter = adapter as TypedAdapter
      for (const scenarioCase of definition.cases) {
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
          const ctx: RenderContext = {
            scenarioId: scenarioId as MenusOverlaysDefinitionScenarioId,
            caseId: scenarioCase.id,
            environment: mutatedEnvironment,
          }
          const host = document.createElement('div')
          const handle = typedAdapter(host, scenarioCase.input, ctx)
          if (axis === 'direction') expect(host.getAttribute('dir')).toBe('rtl')
          if (axis === 'theme') expect(host.dataset.theme).toBe('dark')
          if (axis === 'viewport') expect(host.dataset.viewport).toBe('narrow')
          if (axis === 'forcedColors') expect(host.dataset.forcedColors).toBe('active')
          handle.dispose()
        }
      }
    }
    expect([...usedAxisAllowances].sort()).toEqual(Object.keys(ENV_AXIS_PROOFS).sort())
  })
})
