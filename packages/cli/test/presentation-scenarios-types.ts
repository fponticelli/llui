import type { ProductContract } from '../src/product-contract-types.js'
import {
  compileScenarioFamily,
  decodeScenarioFamily,
  decodeScenarioSelection,
  resolveScenarioSelection,
  type CompiledPresentationScenario,
  type PresentationScenarioCase,
  type PresentationScenarioDefinitions,
  type PresentationScenarioEnvironmentAxis,
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
// #270 finding 3: compileScenarioFamily/resolveScenarioSelection have no `unknown` fallthrough —
// an untyped/serialized boundary decodes through decodeScenarioFamily/decodeScenarioSelection
// below instead. Short names keep each call on one line so prettier cannot separate the
// `@ts-expect-error` directive from the line it applies to.
// @ts-expect-error see above
const rejected1 = compileScenarioFamily(contract, 'menus-overlays', serializedDefinitions)
// @ts-expect-error see above
const rejected2 = resolveScenarioSelection(contract, serializedCatalog, serializedSelection)
void [rejected1, rejected2]
const erasedCatalog = decodeScenarioFamily(contract, 'menus-overlays', serializedDefinitions)
const erasedResolved = decodeScenarioSelection(contract, serializedCatalog, serializedSelection)
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

// #270 finding 3: with no `unknown` fallthrough, an invalid TYPED literal is a compile error at
// compileScenarioFamily's only remaining (statically-known) overload, rather than silently
// falling through to the erased `unknown` shape.
const extraCaseFieldDefinitions = {
  'component:dialog': {
    defaultCaseId: 'open',
    cases: [{ id: 'open', label: 'Open', input: null, environmentAxes: [], render: () => 'x' }],
  },
}
// @ts-expect-error an extra field on a case is rejected, not silently accepted as renderer data
compileScenarioFamily(contract, 'menus-overlays', extraCaseFieldDefinitions)

// `as const` on BOTH the control and the gate: without it, `environmentAxes: ['theme']` infers
// as plain `string[]`, which fails to compile for EVERY value (valid or not) — a bare
// `@ts-expect-error` on the non-const spelling proves nothing about 'sepia' specifically (#270
// finding 4, round two: the original gate was vacuous this way, measured against this exact
// control).
const validAxisDefinitions = {
  'component:dialog': {
    defaultCaseId: 'open',
    cases: [{ id: 'open', label: 'Open', input: null, environmentAxes: ['theme'] }],
  },
} as const
compileScenarioFamily(contract, 'menus-overlays', validAxisDefinitions) // passing control

const unknownAxisDefinitions = {
  'component:dialog': {
    defaultCaseId: 'open',
    cases: [{ id: 'open', label: 'Open', input: null, environmentAxes: ['sepia'] }],
  },
} as const
// @ts-expect-error an unknown environmentAxes value is rejected — the control above proves this
// fails because 'sepia' is invalid, not merely because the array is a non-const literal
compileScenarioFamily(contract, 'menus-overlays', unknownAxisDefinitions)

// #270 finding 4, round two: `keyof` a UNION type is the INTERSECTION of its members' keys, so an
// excess field on only ONE arm of a union-typed cases array used to be invisible to the
// exactness check entirely (TypeScript distributes `Case extends X ? ... : never` over a naked
// union `Case`, so the bad arm's `never` result silently vanishes via `T | never === T` — this
// compiled with NO error before the fix). `UnionKeys` (see `ExactCase` in the source) closes it
// by distributing `keyof` itself instead, which surfaces a key that exists on only one member.
type UnionCaseBase = {
  readonly id: string
  readonly label: string
  readonly input: null
  readonly environmentAxes: readonly PresentationScenarioEnvironmentAxis[]
}
type UnionCaseWithExtra = UnionCaseBase & { readonly render: () => string }
declare const unionCases: readonly (UnionCaseBase | UnionCaseWithExtra)[]
const unionCaseDefinitions = {
  'component:dialog': { defaultCaseId: 'open', cases: unionCases },
}
// @ts-expect-error an excess field on only one arm of a union-typed cases array is still rejected
compileScenarioFamily(contract, 'menus-overlays', unionCaseDefinitions)

// #270 finding 4, round two: a KNOWN, undocumented-until-now residual gap — once a value is
// WIDENED to (or simply annotated as) `PresentationScenarioCase`, its excess fields are
// STRUCTURALLY invisible to any type-level exactness check: `keyof widened` equals
// `keyof PresentationScenarioCase` exactly, because TypeScript's structural type system does not
// track "this value used to have more properties before it was widened." No conditional or
// mapped-type trick can recover that information — it is simply gone from the static type. This
// is NOT specific to unions; it is the general form of the same problem, and it is why the
// runtime `exactFields` check in `decodeCase` remains the actual backstop regardless of how
// the caller's static types are shaped. See README's "Compile-time exactness has known limits"
// for the user-facing statement of this gap, and
// `test/presentation-scenarios-boundaries.test.ts`'s "rejects extra source-case fields" tests for
// the runtime rejection that still applies.
const rawWidenedCase = {
  id: 'open',
  label: 'Open',
  input: null,
  environmentAxes: [] as readonly PresentationScenarioEnvironmentAxis[],
  render: () => 'x',
}
const widenedCase: PresentationScenarioCase = rawWidenedCase
// Compiles — this is the documented gap above, not a `@ts-expect-error` gate: widening to the
// interface type erases the excess field from what the type system can see.
compileScenarioFamily(contract, 'menus-overlays', {
  'component:dialog': { defaultCaseId: 'open', cases: [widenedCase] },
})

const functionInputDefinitions = {
  'component:dialog': {
    defaultCaseId: 'open',
    cases: [
      { id: 'open', label: 'Open', input: { onClick: () => undefined }, environmentAxes: [] },
    ],
  },
}
// @ts-expect-error a function in `input` is rejected — PresentationScenarioJson excludes it
compileScenarioFamily(contract, 'menus-overlays', functionInputDefinitions)
