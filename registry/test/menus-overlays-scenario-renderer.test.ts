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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProductContractSchema } from '@llui/cli'
import {
  compileMenusOverlaysCatalog,
  joinMenusOverlaysScenarios,
  applicableMenusOverlaysScenarios,
  MENUS_OVERLAYS_DEFINITIONS,
  type MenusOverlaysDefinitionScenarioId,
} from '../../packages/components/test/styles/menus-overlays-scenarios'
import {
  REGISTRY_ADAPTERS,
  mountRegistryMenusOverlaysScenarios,
  type Disposable,
  type RenderContext,
} from './menus-overlays-scenario-renderer'
import { DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT } from '@llui/cli/presentation-scenarios'
import type { PresentationScenarioEnvironment } from '@llui/cli/presentation-scenarios'

const ROOT = resolve(import.meta.dirname, '../..')
const registry = JSON.parse(readFileSync(resolve(ROOT, 'registry/registry.json'), 'utf8')) as {
  productContract?: unknown
}
const contract = ProductContractSchema.parse(registry.productContract)
const catalog = compileMenusOverlaysCatalog(contract)
const joined = joinMenusOverlaysScenarios(catalog, contract)
const applicable = applicableMenusOverlaysScenarios(joined, 'registryTailwind')

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
      const adapter = REGISTRY_ADAPTERS[scenarioId as keyof typeof REGISTRY_ADAPTERS]
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

  const UNCHANGED = Symbol('unchanged')

  const ENUM_CYCLES: Record<string, readonly string[]> = {
    presence: ['opening', 'open', 'closing', 'closed'],
    side: ['top', 'right', 'bottom', 'left'],
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
    if (value === null) return UNCHANGED
    if (Array.isArray(value)) {
      if (value.length === 0) return UNCHANGED
      if (typeof value[0] === 'string') return value.slice(0, -1)
      return UNCHANGED
    }
    return UNCHANGED
  }

  it('every case field this renderer supports materially changes real output, or is documented as insensitive', () => {
    const hitAllowances = new Set<string>()
    for (const [scenarioId, definition] of Object.entries(MENUS_OVERLAYS_DEFINITIONS)) {
      const adapter = REGISTRY_ADAPTERS[scenarioId as keyof typeof REGISTRY_ADAPTERS]
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
      const adapter = REGISTRY_ADAPTERS[scenarioId as keyof typeof REGISTRY_ADAPTERS]
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
