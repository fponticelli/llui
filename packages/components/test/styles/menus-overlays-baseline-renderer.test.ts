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
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProductContractSchema } from '@llui/cli'
import {
  compileMenusOverlaysCatalog,
  joinMenusOverlaysScenarios,
  MENUS_OVERLAYS_DEFINITIONS,
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
    'component:menu/open.skipAnimations':
      'presence rests at "open"; only a transition reads this flag',
    'component:menu/submenu-open.skipAnimations':
      'presence rests at "open"; only a transition reads this flag',
    'component:menu/overflow.skipAnimations':
      'presence rests at "open"; only a transition reads this flag',
    'component:tooltip/open.animated':
      'presence rests at "open"; only a transition reads this flag',
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

  it('every case field this renderer supports materially changes real output, or is documented as insensitive', () => {
    const hitAllowances = new Set<string>()
    for (const [scenarioId, definition] of Object.entries(MENUS_OVERLAYS_DEFINITIONS)) {
      const adapter = BASELINE_ADAPTERS[scenarioId as keyof typeof BASELINE_ADAPTERS]
      const typedAdapter = adapter as (
        h: HTMLElement,
        input: unknown,
        ctx: RenderContext,
      ) => Disposable
      for (const scenarioCase of definition.cases) {
        const ctx: RenderContext = {
          scenarioId: scenarioId as MenusOverlaysDefinitionScenarioId,
          caseId: scenarioCase.id,
          environment: DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
        }
        const baseline = mountFor(typedAdapter, scenarioCase.input, ctx).projection

        for (const field of Object.keys(scenarioCase.input as Record<string, unknown>)) {
          if (SKIPPED_FIELDS.has(field)) continue
          if (
            SKIPPED_FIELDS_PER_SCENARIO[scenarioId as MenusOverlaysDefinitionScenarioId]?.has(field)
          )
            continue
          const originalValue = (scenarioCase.input as Record<string, unknown>)[field]
          const mutatedValue = mutateFieldValue(field, originalValue)
          if (mutatedValue === UNCHANGED) continue
          const mutatedInput = { ...scenarioCase.input, [field]: mutatedValue }
          const mutated = mountFor(typedAdapter, mutatedInput, ctx).projection
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
    for (const key of Object.keys(INSENSITIVE_DIMENSIONS)) {
      expect(hitAllowances.has(key), `unused allowance: ${key}`).toBe(true)
    }
  })

  it('a case declaring an environment axis materially changes the mount host attribute for that axis', () => {
    for (const [scenarioId, definition] of Object.entries(MENUS_OVERLAYS_DEFINITIONS)) {
      const adapter = BASELINE_ADAPTERS[scenarioId as keyof typeof BASELINE_ADAPTERS]
      const typedAdapter = adapter as (
        h: HTMLElement,
        input: unknown,
        ctx: RenderContext,
      ) => Disposable
      for (const scenarioCase of definition.cases) {
        for (const axis of scenarioCase.environmentAxes) {
          const mutatedEnvironment: PresentationScenarioEnvironment = {
            ...DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
            ...(axis === 'direction' ? { direction: 'rtl' } : {}),
            ...(axis === 'theme' ? { theme: 'dark' } : {}),
            ...(axis === 'viewport' ? { viewport: 'narrow' } : {}),
            ...(axis === 'forcedColors' ? { forcedColors: 'active' } : {}),
            ...(axis === 'motion' ? { motion: 'reduced' } : {}),
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
  })
})
