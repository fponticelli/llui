// Compiled by `pnpm --filter @llui/cli check` (tsconfig includes `test/`); never executed.
//
// The typed compile path is EXACT against the family's ProductContract scenario ids. Those ids
// reach the type system as a literal `PresentationScenarioFamilyIds` descriptor (in this repo, the
// generated `packages/components/test/styles/presentation-scenario-ids.ts`), and the definitions'
// keys must equal them — no key missing, no key extra — so the catalog's `scenarioId` union is
// provably the set of scenarios the catalog carries.
//
// It closes a hole that was not just unprovable but UNSOUND: an object with MORE keys is
// assignable, with no cast, to a definitions type with fewer (width subtyping). Keyed only by the
// definitions' own type, `compileScenarioFamily` accepted such a value, runtime validation passed
// it (the hidden key is a real scenario of the family), and the returned union omitted a
// scenario the catalog carried. Keyed by the family's ids, the narrowed type is MISSING that id,
// which is a compile error; and the runtime cross-checks the descriptor against the contract, so
// a descriptor that omits a contract scenario throws instead of typing it away.
//
// Every positive assertion must compile; each `@ts-expect-error` gate is paired with a passing
// control of the same spelling, so a gate cannot pass merely because the shape is rejected
// outright.
import type { ProductContract } from '../src/product-contract-types.js'
import {
  compileScenarioFamily,
  resolveScenarioSelection,
  type CompiledPresentationScenarioFamily,
  type PresentationScenarioDefinition,
  type PresentationScenarioFamilyIds,
} from '../src/presentation-scenarios.js'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Assert<Value extends true> = Value

declare const contract: ProductContract

const MENUS_OVERLAYS = {
  family: 'menus-overlays',
  scenarioIds: ['component:dialog', 'component:menu'],
} as const satisfies PresentationScenarioFamilyIds

const dialog = {
  defaultCaseId: 'open',
  cases: [{ id: 'open', label: 'Open', input: { open: true }, environmentAxes: ['motion'] }],
} as const
const menu = {
  defaultCaseId: 'items',
  cases: [{ id: 'items', label: 'Items', input: { items: ['Open'] }, environmentAxes: [] }],
} as const

// ─── Exact keys compile, and the returned union IS the family's ids ─────────────────────────

const catalog = compileScenarioFamily(contract, MENUS_OVERLAYS, {
  'component:dialog': dialog,
  'component:menu': menu,
})
type CatalogIds = (typeof catalog)['scenarios'][number]['scenarioId']
type _CatalogIdsAreTheFamilyIds = Assert<
  Equal<CatalogIds, (typeof MENUS_OVERLAYS)['scenarioIds'][number]>
>
const resolved = resolveScenarioSelection(contract, catalog, {
  productId: 'dialog',
  path: 'baseline',
})
type _ResolvedIdsAreTheFamilyIds = Assert<
  Equal<(typeof resolved)['scenarioId'], 'component:dialog' | 'component:menu'>
>
// Key ORDER is irrelevant: exactness is about the key SET.
compileScenarioFamily(contract, MENUS_OVERLAYS, {
  'component:menu': menu,
  'component:dialog': dialog,
})

// ─── A missing key is a compile error ───────────────────────────────────────────────────────

// @ts-expect-error `component:menu` is a scenario of the family, so it must be defined
compileScenarioFamily(contract, MENUS_OVERLAYS, { 'component:dialog': dialog })

// ─── An extra key is a compile error ────────────────────────────────────────────────────────

compileScenarioFamily(contract, MENUS_OVERLAYS, {
  'component:dialog': dialog,
  'component:menu': menu,
  // @ts-expect-error `component:tooltip` is not a scenario of the family
  'component:tooltip': dialog,
})
const withStale = { 'component:dialog': dialog, 'component:menu': menu, 'component:x': dialog }
// @ts-expect-error an extra key held in a variable (no excess-property check) is still rejected
compileScenarioFamily(contract, MENUS_OVERLAYS, withStale)

// ─── The width-subtyping hole: a NARROWED type hides a real scenario ────────────────────────

// This assignment is legal TypeScript with no cast — width subtyping — and is exactly the value
// that used to type-check, validate, and come back as a catalog whose union omitted
// `component:menu` while it carried it. Now the narrowed TYPE is missing a family id.
const both = { 'component:dialog': dialog, 'component:menu': menu }
const narrowed: { readonly 'component:dialog': typeof dialog } = both
// @ts-expect-error the narrowed type omits `component:menu`, which the family declares
compileScenarioFamily(contract, MENUS_OVERLAYS, narrowed)
// Control: the same narrowed type against a family that genuinely has only the dialog compiles —
// and the runtime rejects the hidden `component:menu` key as stale (presentation-scenarios.test.ts).
const DIALOG_ONLY = {
  family: 'menus-overlays',
  scenarioIds: ['component:dialog'],
} as const satisfies PresentationScenarioFamilyIds
const dialogOnly = compileScenarioFamily(contract, DIALOG_ONLY, narrowed)
type _DialogOnlyIds = Assert<
  Equal<(typeof dialogOnly)['scenarios'][number]['scenarioId'], 'component:dialog'>
>

// ─── Non-literal ids or keys cannot type an exact catalog ───────────────────────────────────

declare const erasedIds: PresentationScenarioFamilyIds
// @ts-expect-error `string` scenario ids prove nothing; decode through `decodeScenarioFamily`
compileScenarioFamily(contract, erasedIds, { 'component:dialog': dialog, 'component:menu': menu })

declare const recordDefinitions: Readonly<Record<string, PresentationScenarioDefinition>>
// @ts-expect-error `string`-keyed definitions may carry any key; they are never exact
compileScenarioFamily(contract, MENUS_OVERLAYS, recordDefinitions)

// The exact typed catalog is still a subtype of the erased one.
const erased: CompiledPresentationScenarioFamily = catalog
void [erased, resolved, dialogOnly]
