// Compiled by `pnpm --filter @llui/cli check` (tsconfig includes `test/`); never executed.
//
// A family's TYPED catalog (the `compileScenarioFamily` result over an `as const` definitions
// literal) must be a SUBTYPE of the ERASED catalog (`CompiledPresentationScenarioFamily` with its
// default argument), so a consumer that handles every family generically — the component
// gallery — can hold typed catalogs in one `readonly CompiledPresentationScenarioFamily[]`
// without casts and without re-decoding each family's definitions. It must stay a subtype
// WITHOUT the typed side losing anything: literal case ids, literal copied-artifact names,
// literal axes and the scenario/case correlation all remain checked.
//
// Every POSITIVE assertion here is a plain assignment or an `Assert<Equal<…>>` that must compile;
// `@ts-expect-error` is used only for the NEGATIVE gates, each paired with a passing control.
import type { ProductContract } from '../src/product-contract-types.js'
import {
  compileScenarioFamily,
  resolveScenarioSelection,
  type CompiledPresentationScenario,
  type CompiledPresentationScenarioCase,
  type CompiledPresentationScenarioFamily,
  type PresentationScenarioDefinitions,
  type ResolvedPresentationScenarioSelection,
} from '../src/presentation-scenarios.js'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Assert<Value extends true> = Value

declare const contract: ProductContract

// Mixed on purpose: within ONE scenario, one case names its copied artifacts and one does not.
// A case that omits the optional `copiedArtifactNames` key is exactly the shape that used to
// degrade the compiled field to `Readonly<{}>` and break assignability to the erased catalog.
const datePickerDefinitions = {
  'component:date-picker': {
    defaultCaseId: 'single',
    cases: [
      { id: 'single', label: 'Single', input: { months: 1 }, environmentAxes: ['theme'] },
      {
        id: 'two-months',
        label: 'Two months',
        input: { months: 2 },
        environmentAxes: ['viewport', 'direction'],
        copiedArtifactNames: ['calendar'],
      },
    ],
  },
  'component:editable': {
    defaultCaseId: 'preview',
    cases: [{ id: 'preview', label: 'Preview', input: { value: 'Plan' }, environmentAxes: [] }],
  },
} as const

// A second family whose EVERY case omits `copiedArtifactNames` (the common shape: no family
// before specialized-tools named one at all).
const dialogDefinitions = {
  'component:dialog': {
    defaultCaseId: 'open',
    cases: [{ id: 'open', label: 'Open', input: { open: true }, environmentAxes: ['motion'] }],
  },
} as const

const datePickerCatalog = compileScenarioFamily(
  contract,
  'specialized-tools',
  datePickerDefinitions,
)
const dialogCatalog = compileScenarioFamily(contract, 'menus-overlays', dialogDefinitions)

// ─── Erasure: typed ⊂ erased, with no cast ──────────────────────────────────────────────────

const erasedDatePicker: CompiledPresentationScenarioFamily = datePickerCatalog
const erasedDialog: CompiledPresentationScenarioFamily = dialogCatalog
// The gallery's actual shape: a heterogeneous list of typed families held as erased catalogs.
const galleryCatalogs: readonly CompiledPresentationScenarioFamily[] = [
  datePickerCatalog,
  dialogCatalog,
]
// …and at each nested level the gallery reads through.
const erasedScenario: CompiledPresentationScenario = datePickerCatalog.scenarios[0]!
const erasedCase: CompiledPresentationScenarioCase = datePickerCatalog.scenarios[0]!.cases[0]!
void [erasedDatePicker, erasedDialog, galleryCatalogs, erasedScenario, erasedCase]

// For EVERY definitions type, not just these two literals: erasure is a property of the
// protocol's types, so it must hold generically too — a family-agnostic helper can accept any
// typed catalog and hand back the erased one without knowing its definitions.
function eraseCatalog<Definitions extends PresentationScenarioDefinitions>(
  catalog: CompiledPresentationScenarioFamily<Definitions>,
): CompiledPresentationScenarioFamily {
  return catalog
}
void eraseCatalog(datePickerCatalog)

// A typed resolution is likewise a subtype of the erased resolution.
const typedResolved = resolveScenarioSelection(contract, datePickerCatalog, {
  productId: 'date-picker',
  path: 'baseline',
})
const erasedResolved: ResolvedPresentationScenarioSelection = typedResolved
void erasedResolved

// ─── The typed side keeps every literal ─────────────────────────────────────────────────────

type DatePickerScenario = Extract<
  (typeof datePickerCatalog)['scenarios'][number],
  { readonly scenarioId: 'component:date-picker' }
>
type DatePickerCase = DatePickerScenario['cases'][number]
type TwoMonthsCase = Extract<DatePickerCase, { readonly id: 'two-months' }>
type SingleCase = Extract<DatePickerCase, { readonly id: 'single' }>

// Literal artifact names survive inference, exactly — not widened to `readonly string[]`,
// not degraded to `Readonly<{}>`. A case that declares them carries them as a REQUIRED field.
type _TwoMonthsNames = Assert<Equal<TwoMonthsCase['copiedArtifactNames'], readonly ['calendar']>>
// A case that omits them reads as `undefined`: it declares no artifact restriction, and the
// type says so instead of inventing an empty object type.
type _SingleNames = Assert<Equal<SingleCase['copiedArtifactNames'], undefined>>
// Reading through the scenario's whole case union yields the precise union.
type _UnionNames = Assert<
  Equal<DatePickerCase['copiedArtifactNames'], readonly ['calendar'] | undefined>
>
// Literal ids and axes remain exact.
type _CaseIds = Assert<Equal<DatePickerCase['id'], 'single' | 'two-months'>>
type _TwoMonthsAxes = Assert<
  Equal<TwoMonthsCase['environmentAxes'], readonly ['viewport', 'direction']>
>
type _DefaultCaseId = Assert<Equal<DatePickerScenario['defaultCaseId'], 'single'>>

declare const twoMonths: TwoMonthsCase
declare const single: SingleCase
const calendarOnly: readonly ['calendar'] = twoMonths.copiedArtifactNames // passing control
// @ts-expect-error a literal artifact name is checked, not widened to string
const wrongArtifact: readonly ['sheet'] = twoMonths.copiedArtifactNames
// @ts-expect-error a case that declares no copied artifacts does not claim any
const phantomArtifacts: readonly string[] = single.copiedArtifactNames
void [calendarOnly, wrongArtifact, phantomArtifacts]

// Narrowing on the case id still correlates to that case's own artifact names.
declare const someCase: DatePickerCase
if (someCase.id === 'two-months') {
  const names: readonly ['calendar'] = someCase.copiedArtifactNames
  void names
}

// Erasing loses nothing on the typed value itself — the typed catalog is unchanged by being
// ALSO assignable to the erased one.
const typedStill: 'component:date-picker' | 'component:editable' =
  datePickerCatalog.scenarios[0]!.scenarioId
// @ts-expect-error the typed catalog's scenario ids remain a closed literal union
const notAScenario: 'component:dialog' = datePickerCatalog.scenarios[0]!.scenarioId
void [typedStill, notAScenario]

// The erased catalog does NOT flow back into the typed one: erasure is one-way.
declare const serializedCatalog: CompiledPresentationScenarioFamily
// @ts-expect-error an erased catalog is not a typed catalog
const retyped: typeof datePickerCatalog = serializedCatalog
void retyped

// Nor is erasure bought with a covariance claim on `Definitions` (an `out` annotation would make
// every assignment above compile too). A definitions type with MORE scenarios is a SUBTYPE of
// one with fewer, but its catalog carries a scenario id the smaller catalog's discriminant union
// does not have, so its catalog must NOT be assignable to the smaller one's.
type DatePickerOnly = Pick<typeof datePickerDefinitions, 'component:date-picker'>
const datePickerOnlyDefinitions: DatePickerOnly = datePickerDefinitions // passing control
// @ts-expect-error a catalog with an extra scenario id is not a catalog of the smaller family
const narrowedCatalog: CompiledPresentationScenarioFamily<DatePickerOnly> = datePickerCatalog
void [datePickerOnlyDefinitions, narrowedCatalog]
