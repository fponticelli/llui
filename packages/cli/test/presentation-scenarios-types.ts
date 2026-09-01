import type { ProductContract } from '../src/product-contract-types.js'
import {
  compileScenarioFamily,
  resolveScenarioSelection,
  type CompiledPresentationScenario,
  type PresentationScenarioDefinitions,
  type PresentationScenarioJsonSnapshot,
  type ResolvedPresentationScenarioSelection,
} from '../src/presentation-scenarios.js'

declare const contract: ProductContract

const definitions = {
  'component:dialog': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open',
        input: { kind: 'dialog' as const, open: true as const },
        environmentAxes: ['motion'],
      },
      {
        id: 'closed',
        label: 'Closed',
        input: { kind: 'dialog' as const, open: false as const },
        environmentAxes: [],
      },
    ],
  },
  'component:menu': {
    defaultCaseId: 'items',
    cases: [
      {
        id: 'items',
        label: 'Items',
        input: { kind: 'menu' as const, items: ['Open', 'Save'] as const },
        environmentAxes: ['direction'],
      },
    ],
  },
} as const

const compiled = compileScenarioFamily(contract, 'menus-overlays', definitions)
type Scenario = (typeof compiled)['scenarios'][number]
type DialogScenario = Extract<Scenario, { readonly scenarioId: 'component:dialog' }>
type MenuScenario = Extract<Scenario, { readonly scenarioId: 'component:menu' }>

declare const dialogScenario: DialogScenario
declare const menuScenario: MenuScenario

const dialogDefault: 'open' = dialogScenario.defaultCaseId
const menuDefault: 'items' = menuScenario.defaultCaseId
const dialogInput: { readonly kind: 'dialog'; readonly open: true | false } =
  dialogScenario.cases[0]!.input
const menuInput: { readonly kind: 'menu'; readonly items: readonly ['Open', 'Save'] } =
  menuScenario.cases[0]!.input
void [dialogDefault, menuDefault, dialogInput, menuInput]

// @ts-expect-error defaults remain correlated to their scenario discriminator
const wrongDefault: 'items' = dialogScenario.defaultCaseId
// @ts-expect-error a menu case cannot be assigned to the dialog scenario's case union
const wrongCase: DialogScenario['cases'][number] = menuScenario.cases[0]!
void [wrongDefault, wrongCase]

const resolved = resolveScenarioSelection(contract, compiled, {
  productId: 'dialog',
  path: 'baseline',
})
if (resolved.scenarioId === 'component:dialog') {
  const input: { readonly kind: 'dialog'; readonly open: true | false } = resolved.case.input
  void input
  // @ts-expect-error narrowing the scenario discriminator excludes menu input
  const menu: { readonly kind: 'menu' } = resolved.case.input
  void menu
  if (resolved.case.id === 'open') {
    const open: true = resolved.case.input.open
    void open
    // @ts-expect-error case id retains its input correlation
    const closed: false = resolved.case.input.open
    void closed
  }
} else {
  const input: { readonly kind: 'menu'; readonly items: readonly ['Open', 'Save'] } =
    resolved.case.input
  void input
}

type ExplicitScenario = CompiledPresentationScenario<typeof definitions>
type ExplicitResolved = ResolvedPresentationScenarioSelection<typeof definitions>
declare const explicitScenario: ExplicitScenario
declare const explicitResolved: ExplicitResolved
const scenarioId: 'component:dialog' | 'component:menu' = explicitScenario.scenarioId
const resolvedId: 'component:dialog' | 'component:menu' = explicitResolved.scenarioId
void [scenarioId, resolvedId]

declare const serializedDefinitions: unknown
declare const serializedCatalog: unknown
declare const serializedSelection: unknown
const erasedCatalog = compileScenarioFamily(contract, 'menus-overlays', serializedDefinitions)
const erasedResolved = resolveScenarioSelection(contract, serializedCatalog, serializedSelection)
const erasedScenarioId: string = erasedCatalog.scenarios[0]!.scenarioId
const erasedResolvedId: string = erasedResolved.scenarioId
void [erasedScenarioId, erasedResolvedId]

const mutableDefinitions = {
  'component:dialog': {
    defaultCaseId: 'open',
    cases: [
      {
        id: 'open',
        label: 'Open',
        input: { nested: { enabled: true, labels: ['Ada'] } },
        environmentAxes: ['motion'],
        copiedArtifactNames: ['dialog'],
      },
    ],
  },
} satisfies PresentationScenarioDefinitions

const mutableCatalog = compileScenarioFamily(contract, 'menus-overlays', mutableDefinitions)
const mutableCase = mutableCatalog.scenarios[0]!.cases[0]!
// @ts-expect-error emitted JSON arrays are recursively readonly without requiring `as const`
mutableCase.input.nested.labels.push('Grace')
// @ts-expect-error emitted JSON objects are recursively readonly without requiring `as const`
mutableCase.input.nested.enabled = false
// @ts-expect-error emitted environment axes are normalized to readonly arrays
mutableCase.environmentAxes.push('theme')
// @ts-expect-error emitted copied-artifact targets are normalized to readonly arrays
mutableCase.copiedArtifactNames!.push('sheet')

const mutableResolved = resolveScenarioSelection(contract, mutableCatalog, {
  productId: 'dialog',
  path: 'baseline',
})
// @ts-expect-error resolver cases retain the catalog's recursive readonly snapshot
mutableResolved.case.input.nested.labels.push('Lin')

type ExplicitMutableSnapshot = PresentationScenarioJsonSnapshot<{
  nested: { labels: string[] }
}>
declare const explicitMutableSnapshot: ExplicitMutableSnapshot
// @ts-expect-error the exported snapshot helper is recursively readonly
explicitMutableSnapshot.nested.labels.push('mutation')
