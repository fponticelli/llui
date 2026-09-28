/**
 * The navigation-data family's typed field mutations, shared by both
 * dimension harnesses (`navigation-data-baseline-renderer.test.ts` here and
 * `registry/test/navigation-data-scenario-renderer.test.ts`) — the same case
 * inputs drive both paths' adapters, so one table serves both.
 *
 * Every field of every case-input type has exactly one mutator, and every
 * mutator returns a value of that field's own type (`scenario-field-mutations.ts`
 * explains why). Closed string unions CYCLE to the next real member in
 * declaration order — a blind string-append would produce a value outside the
 * union (`'closed-mutated'`), which an adapter's `if/else` chain treats
 * identically to one of the real members, silently defeating the mutation.
 */
import { expect } from 'vitest'
import type {
  DisclosureCaseInput,
  NavigationDataInputs,
  NavigationDataScenarioId,
  TableCaseInput,
} from './navigation-data-scenarios'
import {
  addAbsentFrom,
  appendDistinctText,
  appendNextNumber,
  appendText,
  cycle,
  flip,
  orNull,
  plus,
  UNCHANGED,
  type FamilyFieldMutators,
  type FieldMutators,
  type Mutated,
} from './scenario-field-mutations'

const disclosure: FieldMutators<DisclosureCaseInput> = {
  label: appendText,
  content: appendText,
  state: cycle(['closed', 'open', 'closing']),
  disabled: flip,
}

const density = cycle(['comfortable', 'compact'])
const orientation = cycle(['horizontal', 'vertical'])
const shift = plus(7)

/** `maxVisible` gates a THRESHOLD (breadcrumbs collapse only once the trail's
 * item count exceeds it), not a monotonic quantity, and every fixture trail is
 * a fixed 2 items — `+7` never crosses that boundary from either side. This
 * forces it to the OPPOSITE side of the 2-item boundary. */
const acrossCollapseThreshold = (original: number): Mutated<number> => {
  const mutated = original <= 1 ? original + 5 : 1
  return mutated === original ? UNCHANGED : mutated
}

/** A `selection ⊆ rows` membership set: a synthetic id names no rendered row,
 * so the mutation adds a real row that is not yet selected. */
const selectAnotherRow = (
  selection: readonly string[],
  input: TableCaseInput,
): Mutated<readonly string[]> => {
  const additional = input.rows.find((row) => !selection.includes(row))
  return additional === undefined ? UNCHANGED : [...selection, additional]
}

export const NAVIGATION_DATA_FIELD_MUTATORS: FamilyFieldMutators<NavigationDataInputs> = {
  'component:accordion': disclosure,
  'component:collapsible': disclosure,
  'component:avatar': {
    label: appendText,
    status: cycle(['loading', 'loaded', 'error']),
    initials: appendText,
    density,
  },
  'component:breadcrumbs': { currentLabel: appendText, maxVisible: acrossCollapseThreshold },
  'component:carousel': { index: shift, count: shift, loop: flip },
  'component:chart': {
    label: appendText,
    populated: flip,
    activeSeriesKey: orNull(appendText),
  },
  'component:marquee': {
    label: appendText,
    direction: cycle(['left', 'right', 'up', 'down']),
    running: flip,
    disabled: flip,
  },
  'component:meter': { label: appendText, value: shift },
  'component:pagination': { page: shift, total: shift, disabled: flip },
  'component:progress': { label: appendText, value: orNull(shift) },
  'component:sparkline': { label: appendText, nowOffsetDays: shift },
  'component:steps': {
    current: shift,
    completed: appendNextNumber,
    errorStep: orNull(shift),
    disabled: flip,
  },
  'component:table': {
    rows: appendDistinctText,
    selection: selectAnotherRow,
    sortColumnId: orNull(appendText),
    density,
    disabled: flip,
  },
  // Membership sets over the ADAPTER'S OWN fixed domains: a synthetic id names
  // no rendered tab/toc entry/tree node, so these add a real, absent member.
  'component:tabs': {
    value: cycle(['summary', 'details']),
    orientation,
    disabledItems: addAbsentFrom(['summary', 'details']),
  },
  'component:toc': { activeId: appendText, expanded: addAbsentFrom(['overview', 'api']) },
  // Only 'src' is a BRANCH in the tree fixture (`index` is a leaf), so it is
  // the only id whose `expanded` membership has anything to toggle.
  'component:tree-view': {
    expanded: addAbsentFrom(['src']),
    selected: addAbsentFrom(['src', 'index']),
    busy: flip,
    disabled: flip,
  },
  'pattern:data-table': {
    phase: cycle(['loading', 'error', 'populated']),
    rows: appendDistinctText,
    density,
  },
  'registry:chip': { label: appendText, hue: orNull(shift) },
  'registry:alert': {
    title: appendText,
    description: appendText,
    variant: cycle(['default', 'destructive']),
  },
  'registry:badge': {
    label: appendText,
    variant: cycle(['default', 'outline', 'secondary', 'destructive']),
  },
  'registry:card': {
    title: appendText,
    description: appendText,
    actionLabel: orNull(appendText),
    sections: appendDistinctText,
  },
  'registry:empty': {
    title: appendText,
    description: appendText,
    actionLabel: orNull(appendText),
  },
  'registry:item': {
    title: appendText,
    description: appendText,
    variant: cycle(['default', 'outline', 'muted']),
    density,
  },
  'registry:kbd': { keys: appendDistinctText },
  'registry:separator': { orientation, decorative: flip },
  'registry:skeleton': { label: appendText },
  'registry:spinner': { label: appendText },
  'registry:typography': { title: appendText, text: appendText, code: appendText },
  'registry:sidebar': {
    label: appendText,
    current: appendText,
    state: cycle(['expanded', 'collapsed', 'offcanvas', 'mobile']),
    density: cycle(['comfortable', 'compact', 'roomy']),
  },
}

/** A targeted assertion for one field of one scenario, at that scenario's
 * input type. */
export type NavigationDataTargetedChecks = {
  readonly [Id in NavigationDataScenarioId]?: {
    readonly [Field in keyof NavigationDataInputs[Id]]?: (
      host: HTMLElement,
      mutatedInput: NavigationDataInputs[Id],
    ) => void
  }
}

/**
 * Per-`scenarioId.field` targeted assertions against the ACTUAL
 * machine-published attribute/text, run alongside (never instead of) the
 * generic projection diff in both dimension harnesses. The generic diff is
 * fooled by a renderer-added echo of the mutated field on a real
 * `[data-part]` element — measured directly: the reviewer's mutation harness
 * added a `data-case-value` echo to `tabs`' root while simultaneously
 * breaking the `value` wiring, and the generic diff still "passed" because
 * the echo alone differs (#264 review item 3). Keying this off SPECIFIC part
 * attributes/text — `[data-part='table']`'s `aria-label` for chart, the
 * matching trigger's `aria-selected` / panel's `hidden` for tabs — cannot be
 * fooled the same way, because those are read off the exact node the
 * machine's own state drives, not an arbitrary echo elsewhere in the tree.
 */
export const NAVIGATION_DATA_TARGETED_CHECKS: NavigationDataTargetedChecks = {
  'component:chart': {
    label: (host, mutatedInput) => {
      const table = host.querySelector('[data-part="table"]')
      expect(table?.getAttribute('aria-label'), 'component:chart.label aria-label').toBe(
        mutatedInput.label,
      )
    },
  },
  'component:tabs': {
    value: (host, mutatedInput) => {
      const value = mutatedInput.value
      const trigger = host.querySelector(`[data-part="trigger"][data-value="${value}"]`)
      const panel = host.querySelector(`[data-part="panel"][data-value="${value}"]`)
      expect(trigger?.getAttribute('aria-selected'), 'component:tabs.value trigger').toBe('true')
      expect(panel?.hasAttribute('hidden'), 'component:tabs.value panel').toBe(false)
    },
  },
}
