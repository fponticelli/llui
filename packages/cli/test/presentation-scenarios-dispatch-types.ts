// Compiled by `pnpm --filter @llui/cli check` (tsconfig includes `test/`); never executed.
//
// `dispatchScenarioSelection` is the protocol's ONE typed hand-off from a resolved selection to
// the family renderer adapter registered for its scenario id. Every family renderer used to do
// this with a pair of casts (`(adapter as Adapter<unknown>)(host, input, { scenarioId:
// scenarioId as XScenarioId, … })`), which checked nothing: a map whose `component:menu` adapter
// took a SELECT input compiled, and so did handing the menu adapter a dialog case. The helper
// checks the adapter MAP against the catalog's own definitions instead, per scenario id, and
// calls the right adapter with no cast (the correlated-union pattern: a generic scenario id
// indexing one mapped type for both the adapter and the input).
//
// Every POSITIVE assertion is a plain call/assignment or an `Assert<Equal<…>>` that must compile;
// `@ts-expect-error` is used only for the NEGATIVE gates, each paired with a passing control.
import type { ProductContract } from '../src/product-contract-types.js'
import {
  bindScenarioAdapters,
  compileScenarioFamily,
  dispatchScenarioSelection,
  resolveScenarioSelection,
  type PresentationScenarioAdapter,
  type PresentationScenarioAdapterBinding,
  type PresentationScenarioAdapterContext,
  type PresentationScenarioAdapters,
  type PresentationScenarioCaseInput,
  type PresentationScenarioJsonSnapshot,
  type ResolvedPresentationScenarioSelection,
} from '../src/presentation-scenarios.js'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Assert<Value extends true> = Value

declare const contract: ProductContract
declare const host: { readonly id: string }

const definitions = {
  'component:dialog': {
    defaultCaseId: 'open',
    cases: [
      { id: 'open', label: 'Open', input: { open: true, title: 'Delete?' }, environmentAxes: [] },
      {
        id: 'closed',
        label: 'Closed',
        input: { open: false, title: 'Delete?' },
        environmentAxes: ['motion'],
      },
    ],
  },
  'component:menu': {
    defaultCaseId: 'items',
    cases: [
      {
        id: 'items',
        label: 'Items',
        input: { items: ['Open', 'Save'] },
        environmentAxes: ['direction'],
      },
    ],
  },
} as const

const catalog = compileScenarioFamily(contract, 'menus-overlays', definitions)
const resolved = resolveScenarioSelection(contract, catalog, {
  productId: 'dialog',
  path: 'baseline',
})

// ─── The per-id input type is the scenario's own compiled case inputs ───────────────────────

type DialogInput = PresentationScenarioCaseInput<typeof definitions, 'component:dialog'>
type MenuInput = PresentationScenarioCaseInput<typeof definitions, 'component:menu'>
type _DialogInput = Assert<
  Equal<
    DialogInput,
    | { readonly open: true; readonly title: 'Delete?' }
    | { readonly open: false; readonly title: 'Delete?' }
  >
>
type _MenuInput = Assert<Equal<MenuInput, { readonly items: readonly ['Open', 'Save'] }>>

// ─── A family's real adapter shape: declared inputs WIDER than the literal cases ────────────

interface DialogCaseInput {
  readonly open: boolean
  readonly title: string
}
interface MenuCaseInput {
  readonly items: readonly string[]
}
interface Disposable {
  dispose(): void
}
type FamilyScenarioId = keyof typeof definitions
interface FamilyContext {
  readonly scenarioId: FamilyScenarioId
  readonly caseId: string
}
type FamilyAdapter<Input> = (
  target: { readonly id: string },
  input: Input,
  context: FamilyContext,
) => Disposable

const dialogAdapter: FamilyAdapter<DialogCaseInput> = (_target, input) => ({
  dispose: () => void input.title,
})
const menuAdapter: FamilyAdapter<MenuCaseInput> = (_target, input) => ({
  dispose: () => void input.items,
})
const adapters = {
  'component:dialog': dialogAdapter,
  'component:menu': menuAdapter,
} as const

// Host and Result are INFERRED from the map (no annotation needed at the call site).
const dispatched = dispatchScenarioSelection(catalog, adapters, resolved, host, {})
type _Dispatched = Assert<Equal<typeof dispatched, Disposable>>
void dispatched

// The map type itself accepts the family map (every adapter accepts its scenario's inputs).
const typedMap: PresentationScenarioAdapters<
  typeof definitions,
  { readonly id: string },
  Disposable
> = adapters
void typedMap

// A PARTIAL map is allowed (a path may not draw every scenario); a missing adapter is a
// runtime `missing-adapter` failure, never an unchecked call.
dispatchScenarioSelection(catalog, { 'component:dialog': dialogAdapter }, resolved, host, {})

// ─── NEGATIVE: a wrong input type for an id is a compile error ──────────────────────────────

interface SelectCaseInput {
  readonly value: readonly string[]
}
const selectAdapter: FamilyAdapter<SelectCaseInput> = (_target, input) => ({
  dispose: () => void input.value,
})
const swapped = { 'component:dialog': dialogAdapter, 'component:menu': selectAdapter } as const
// @ts-expect-error the menu adapter's declared input does not accept the menu case inputs
dispatchScenarioSelection(catalog, swapped, resolved, host, {})
// …and on the map type directly, with its passing control above (`typedMap`).
// @ts-expect-error same gate through the published map type
const swappedMap: PresentationScenarioAdapters<
  typeof definitions,
  { readonly id: string },
  Disposable
> = swapped
void swappedMap

// The two adapters crossed over: each one's input is the OTHER scenario's.
const crossed = { 'component:dialog': menuAdapter, 'component:menu': dialogAdapter } as const
// @ts-expect-error each adapter is handed a scenario it cannot render
dispatchScenarioSelection(catalog, crossed, resolved, host, {})

// A narrower literal than the cases carry is rejected too: `closed` has `open: false`.
const openOnly: FamilyAdapter<{ readonly open: true; readonly title: string }> = () => ({
  dispose: () => {},
})
// @ts-expect-error the dialog scenario also has a closed case
dispatchScenarioSelection(catalog, { 'component:dialog': openOnly }, resolved, host, {})

// ─── The context carries the LITERAL scenario id of the adapter it is handed to ─────────────

const literalContext: PresentationScenarioAdapter<
  typeof definitions,
  'component:menu',
  { readonly id: string },
  number
> = (_target, input, context) => {
  type _Id = Assert<Equal<(typeof context)['scenarioId'], 'component:menu'>>
  type _Input = Assert<Equal<typeof input, MenuInput>>
  return input.items.length + context.caseId.length
}
void literalContext

// A context that expects a DIFFERENT scenario id than the key it is registered under.
const wrongId = {
  'component:dialog': (
    _target: { readonly id: string },
    _input: DialogCaseInput,
    _context: PresentationScenarioAdapterContext<'component:menu'>,
  ) => 0,
}
// @ts-expect-error the dialog adapter would be told it renders the menu scenario
dispatchScenarioSelection(catalog, wrongId, resolved, host, {})

// ─── Extra context: typed, required when declared, and never a protocol key ─────────────────

const withArtifacts = {
  'component:dialog': (
    _target: { readonly id: string },
    _input: DialogCaseInput,
    context: PresentationScenarioAdapterContext & {
      readonly copiedArtifactNames: readonly string[] | undefined
    },
  ) => context.copiedArtifactNames?.length ?? 0,
}
const withExtra: number = dispatchScenarioSelection(catalog, withArtifacts, resolved, host, {
  copiedArtifactNames: ['dialog'],
})
void withExtra
// @ts-expect-error the adapter needs `copiedArtifactNames`, and the extra omits it
dispatchScenarioSelection(catalog, withArtifacts, resolved, host, {})
// @ts-expect-error an extra may not shadow a protocol-owned context key
dispatchScenarioSelection(catalog, adapters, resolved, host, { caseId: 'forged' })

// ─── A selection from ANOTHER family's catalog is rejected ──────────────────────────────────

const otherDefinitions = {
  'component:tabs': {
    defaultCaseId: 'first',
    cases: [{ id: 'first', label: 'First', input: { value: 'a' }, environmentAxes: [] }],
  },
} as const
const otherCatalog = compileScenarioFamily(contract, 'navigation-data', otherDefinitions)
const otherResolved = resolveScenarioSelection(contract, otherCatalog, {
  productId: 'tabs',
  path: 'baseline',
})
// @ts-expect-error a tabs selection cannot be dispatched through the menus-overlays map
dispatchScenarioSelection(catalog, adapters, otherResolved, host, {})

// ─── Erasure: a typed map binds to the family-agnostic surface with no cast ─────────────────

const binding = bindScenarioAdapters(catalog, adapters)
type _Binding = Assert<
  Equal<typeof binding, PresentationScenarioAdapterBinding<{ readonly id: string }, Disposable>>
>
// The gallery's actual shape: heterogeneous families held as ONE erased binding type.
const bindings: readonly PresentationScenarioAdapterBinding<{ readonly id: string }, Disposable>[] =
  [
    binding,
    bindScenarioAdapters(otherCatalog, {
      'component:tabs': (_target: { readonly id: string }, input: { readonly value: string }) => ({
        dispose: () => void input.value,
      }),
    }),
  ]
void bindings
const prepared = binding.prepare(contract, { productId: 'menu', path: 'baseline' })
const erasedSelection: ResolvedPresentationScenarioSelection = prepared.selection
const erasedInput: PresentationScenarioJsonSnapshot = prepared.selection.case.input
const rendered: Disposable = prepared.render(host, {})
void [erasedSelection, erasedInput, rendered]
// @ts-expect-error binding checks the map against the catalog exactly like dispatch does
bindScenarioAdapters(catalog, swapped)
