import { describe, expect, expectTypeOf, it } from 'vitest'
import { ProductContractSchema, type ProductContract } from '../src/product-contract'
import {
  DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
  compileScenarioFamily,
  PresentationScenarioError,
  resolveScenarioSelection,
  type CompiledPresentationScenarioFamily,
  type PresentationScenarioDefinitions,
} from '../src/presentation-scenarios'

const styled = { mode: 'styled' as const }
const registryStyling = {
  baseline: false,
  registryTailwind: true,
  styleless: false,
}

function product(name: string, family: 'forms-controls' | 'menus-overlays' = 'menus-overlays') {
  return {
    name,
    displayName: `${name} display name that must stay in ProductContract`,
    category: 'controls' as const,
    artifactKind: 'machine' as const,
    machine: { kind: 'public' as const, importPath: `@llui/components/${name}` },
    copiedArtifacts: [
      {
        name,
        artifactKind: 'skin' as const,
        styling: registryStyling,
      },
    ],
    styling: { baseline: true, registryTailwind: true, styleless: true },
    presentation: { family, baseline: styled, registryTailwind: styled },
    scenarioId: `component:${name}`,
  }
}

function contract(): ProductContract {
  return ProductContractSchema.parse({
    version: 2,
    entries: [product('dialog'), product('switch', 'forms-controls'), product('menu')],
    aliases: [],
  })
}

describe('compileScenarioFamily', () => {
  it('joins definitions in canonical ProductContract order without copying product metadata', () => {
    const definitions = {
      'component:menu': {
        defaultCaseId: 'default',
        cases: [
          {
            id: 'default',
            label: 'Default',
            input: { items: ['Open', 'Save'] },
            environmentAxes: ['theme'],
          },
        ],
      },
      'component:dialog': {
        defaultCaseId: 'open',
        cases: [
          {
            id: 'open',
            label: 'Open',
            input: { open: true },
            environmentAxes: ['direction', 'motion'],
          },
        ],
      },
    } as const satisfies PresentationScenarioDefinitions

    const compiled = compileScenarioFamily(contract(), 'menus-overlays', definitions)

    expect(compiled).toEqual({
      version: 1,
      family: 'menus-overlays',
      scenarios: [
        {
          productId: 'dialog',
          scenarioId: 'component:dialog',
          defaultCaseId: 'open',
          cases: definitions['component:dialog'].cases,
        },
        {
          productId: 'menu',
          scenarioId: 'component:menu',
          defaultCaseId: 'default',
          cases: definitions['component:menu'].cases,
        },
      ],
    })
    expect(Object.keys(compiled.scenarios[0]!)).toEqual([
      'productId',
      'scenarioId',
      'defaultCaseId',
      'cases',
    ])
  })

  it('reports missing and stale definitions together in deterministic order', () => {
    const definition = {
      defaultCaseId: 'default',
      cases: [
        {
          id: 'default',
          label: 'Default',
          input: { open: false },
          environmentAxes: [],
        },
      ],
    } as const
    const definitions = {
      'component:menu': definition,
      'component:stale': definition,
    } as const satisfies PresentationScenarioDefinitions

    try {
      compileScenarioFamily(contract(), 'menus-overlays', definitions)
      expect.unreachable('invalid family definitions must throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PresentationScenarioError)
      expect(error).toMatchObject({
        code: 'invalid-definitions',
        issues: [
          'Missing definition for scenario "component:dialog" (product "dialog").',
          'Stale definition for scenario "component:stale".',
        ],
      })
    }
  })

  it('rejects invalid and duplicate case ids and a missing default case together', () => {
    const validDefinition = {
      defaultCaseId: 'default',
      cases: [
        {
          id: 'default',
          label: 'Default',
          input: null,
          environmentAxes: [],
        },
      ],
    } as const
    const definitions = {
      'component:dialog': {
        defaultCaseId: 'missing',
        cases: [
          { id: 'Open state', label: 'Invalid id', input: null, environmentAxes: [] },
          { id: 'open', label: 'Open', input: null, environmentAxes: [] },
          { id: 'open', label: 'Open again', input: null, environmentAxes: [] },
        ],
      },
      'component:menu': validDefinition,
    } as const satisfies PresentationScenarioDefinitions

    try {
      compileScenarioFamily(contract(), 'menus-overlays', definitions)
      expect.unreachable('invalid cases must throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PresentationScenarioError)
      expect(error).toMatchObject({
        code: 'invalid-definitions',
        issues: [
          'Default case "missing" does not exist in scenario "component:dialog".',
          'Duplicate case id "open" in scenario "component:dialog".',
          'Invalid case id "Open state" in scenario "component:dialog".',
        ],
      })
    }
  })

  it('requires every scenario to declare at least one case', () => {
    const definitions = {
      'component:dialog': { defaultCaseId: 'default', cases: [] },
      'component:menu': {
        defaultCaseId: 'default',
        cases: [{ id: 'default', label: 'Default', input: null, environmentAxes: [] }],
      },
    } as const satisfies PresentationScenarioDefinitions

    try {
      compileScenarioFamily(contract(), 'menus-overlays', definitions)
      expect.unreachable('an empty scenario must throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PresentationScenarioError)
      expect(error).toMatchObject({
        code: 'invalid-definitions',
        issues: [
          'Default case "default" does not exist in scenario "component:dialog".',
          'Scenario "component:dialog" must define at least one case.',
        ],
      })
    }
  })

  it('validates the default case id independently from case membership', () => {
    const definitions = {
      'component:dialog': {
        defaultCaseId: 'Open state',
        cases: [{ id: 'Open state', label: 'Open', input: { open: true }, environmentAxes: [] }],
      },
      'component:menu': {
        defaultCaseId: 'default',
        cases: [{ id: 'default', label: 'Default', input: null, environmentAxes: [] }],
      },
    } as const satisfies PresentationScenarioDefinitions

    try {
      compileScenarioFamily(contract(), 'menus-overlays', definitions)
      expect.unreachable('an invalid default case id must throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PresentationScenarioError)
      expect(error).toMatchObject({
        code: 'invalid-definitions',
        issues: [
          'Invalid case id "Open state" in scenario "component:dialog".',
          'Invalid default case id "Open state" in scenario "component:dialog".',
        ],
      })
    }
  })

  it('rejects empty labels and duplicate or unknown environment axes', () => {
    const definitions = {
      'component:dialog': {
        defaultCaseId: 'default',
        cases: [
          {
            id: 'default',
            label: '   ',
            input: null,
            environmentAxes: ['theme', 'theme', 'contrast'],
          },
        ],
      },
      'component:menu': {
        defaultCaseId: 'default',
        cases: [
          {
            id: 'default',
            label: 'Default',
            input: null,
            environmentAxes: [],
          },
        ],
      },
    } as unknown as PresentationScenarioDefinitions

    try {
      compileScenarioFamily(contract(), 'menus-overlays', definitions)
      expect.unreachable('invalid case metadata must throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PresentationScenarioError)
      expect(error).toMatchObject({
        code: 'invalid-definitions',
        issues: [
          'Case "default" in scenario "component:dialog" has an empty label.',
          'Case "default" in scenario "component:dialog" has duplicate environment axis "theme".',
          'Case "default" in scenario "component:dialog" has unknown environment axis "contrast".',
        ],
      })
    }
  })

  const cyclic: Record<string, unknown> = {}
  cyclic['self'] = cyclic

  const accessorInput = {}
  Object.defineProperty(accessorInput, 'dynamic', {
    enumerable: true,
    get: () => 'changes when read',
  })
  const hiddenInput = { visible: true }
  Object.defineProperty(hiddenInput, 'hidden', { value: true })
  const symbolInput = { visible: true }
  Object.defineProperty(symbolInput, Symbol('hidden'), { value: true, enumerable: true })
  const decoratedArray = Object.assign(['visible'], { extra: 'not serialized' })

  it.each([
    ['functions', () => undefined, '$.value', 'function values are not JSON-safe'],
    ['dates', new Date('2026-01-01T00:00:00.000Z'), '$.value', 'only plain objects are JSON-safe'],
    [
      'runtime objects',
      new (class RuntimeHandle {})(),
      '$.value',
      'only plain objects are JSON-safe',
    ],
    ['cycles', cyclic, '$.value.self', 'cyclic references are not JSON-safe'],
    ['NaN', Number.NaN, '$.value', 'numbers must be finite and preserve their JSON value'],
    [
      'infinity',
      Number.POSITIVE_INFINITY,
      '$.value',
      'numbers must be finite and preserve their JSON value',
    ],
    ['negative zero', -0, '$.value', 'numbers must be finite and preserve their JSON value'],
    ['accessors', accessorInput, '$.value.dynamic', 'accessor properties are not JSON-safe'],
    [
      'non-enumerable data',
      hiddenInput,
      '$.value.hidden',
      'non-enumerable properties are not JSON-safe',
    ],
    ['symbol keys', symbolInput, '$.value', 'symbol-keyed properties are not JSON-safe'],
    [
      'decorated arrays',
      decoratedArray,
      '$.value.extra',
      'non-index array properties are not JSON-safe',
    ],
  ])('rejects non-JSON scenario input: %s', (_name, value, path, reason) => {
    const definitions = {
      'component:dialog': {
        defaultCaseId: 'default',
        cases: [
          {
            id: 'default',
            label: 'Default',
            input: { value },
            environmentAxes: [],
          },
        ],
      },
      'component:menu': {
        defaultCaseId: 'default',
        cases: [
          {
            id: 'default',
            label: 'Default',
            input: null,
            environmentAxes: [],
          },
        ],
      },
    } as unknown as PresentationScenarioDefinitions

    try {
      compileScenarioFamily(contract(), 'menus-overlays', definitions)
      expect.unreachable('non-JSON input must throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PresentationScenarioError)
      expect(error).toMatchObject({
        code: 'invalid-definitions',
        issues: [
          `Invalid JSON input for case "default" in scenario "component:dialog" at ${path}: ${reason}.`,
        ],
      })
    }
  })

  it('snapshots valid inputs that survive structured clone and a stable JSON round trip', () => {
    const input = {
      title: 'Deterministic ✓',
      rows: ['Ada', 'Grace'],
      options: { loading: false, count: 2, empty: null },
    }
    const definition = {
      defaultCaseId: 'default',
      cases: [{ id: 'default', label: 'Default', input, environmentAxes: [] }],
    } as const
    const definitions = {
      'component:dialog': definition,
      'component:menu': {
        defaultCaseId: 'default',
        cases: [{ id: 'default', label: 'Default', input: null, environmentAxes: [] }],
      },
    } as const satisfies PresentationScenarioDefinitions

    const compiled = compileScenarioFamily(contract(), 'menus-overlays', definitions)
    const compiledInput = compiled.scenarios[0]!.cases[0]!.input
    input.rows.push('Mutation after compilation')

    const expected = {
      title: 'Deterministic ✓',
      rows: ['Ada', 'Grace'],
      options: { loading: false, count: 2, empty: null },
    }
    expect(compiledInput).toEqual(expected)
    expect(structuredClone(compiledInput)).toEqual(expected)
    const encoded = JSON.stringify(compiledInput)
    expect(JSON.parse(encoded)).toEqual(expected)
    expect(JSON.stringify(JSON.parse(encoded))).toBe(encoded)
  })

  it('retains the family-owned case union while emitting only protocol fields', () => {
    const drawerContract = ProductContractSchema.parse({
      version: 2,
      entries: [product('drawer')],
      aliases: [],
    })
    const definitions = {
      'component:drawer': {
        defaultCaseId: 'open',
        cases: [
          {
            id: 'open',
            label: 'Open',
            input: { state: 'open', focus: 'first' },
            environmentAxes: ['motion'],
            renderer: () => 'must stay family-local',
          },
          {
            id: 'closed',
            label: 'Closed',
            input: { state: 'closed' },
            environmentAxes: [],
          },
        ],
      },
    } as const

    const compiled = compileScenarioFamily(drawerContract, 'menus-overlays', definitions)
    const compiledCase = compiled.scenarios[0]!.cases[0]!

    expect(Object.keys(compiledCase)).toEqual(['id', 'label', 'input', 'environmentAxes'])
    expect(compiledCase).not.toHaveProperty('renderer')
    expectTypeOf(compiledCase.input).toEqualTypeOf<
      { readonly state: 'open'; readonly focus: 'first' } | { readonly state: 'closed' }
    >()
  })

  it('rejects copied-artifact targets not owned uniquely by the canonical product', () => {
    const drawer = {
      ...product('drawer'),
      copiedArtifacts: [
        {
          name: 'drawer',
          artifactKind: 'skin' as const,
          scenarioId: 'registry:drawer',
          styling: registryStyling,
        },
        {
          name: 'sheet',
          artifactKind: 'skin' as const,
          scenarioId: 'registry:sheet',
          styling: registryStyling,
        },
      ],
    }
    const drawerContract = ProductContractSchema.parse({
      version: 2,
      entries: [drawer],
      aliases: [],
    })
    const definitions = {
      'component:drawer': {
        defaultCaseId: 'open',
        cases: [
          {
            id: 'open',
            label: 'Open',
            input: { open: true },
            environmentAxes: [],
            copiedArtifactNames: ['sheet', 'sheet', 'unknown'],
          },
        ],
      },
    } as unknown as PresentationScenarioDefinitions

    try {
      compileScenarioFamily(drawerContract, 'menus-overlays', definitions)
      expect.unreachable('invalid copied-artifact targets must throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PresentationScenarioError)
      expect(error).toMatchObject({
        code: 'invalid-definitions',
        issues: [
          'Case "open" in scenario "component:drawer" has duplicate copied-artifact target "sheet".',
          'Case "open" in scenario "component:drawer" targets unknown copied artifact "unknown".',
        ],
      })
    }
  })
})

describe('resolveScenarioSelection', () => {
  it('uses the compiled default case and keeps copied-artifact resolution off the baseline path', () => {
    const definitions = {
      'component:dialog': {
        defaultCaseId: 'open',
        cases: [
          { id: 'closed', label: 'Closed', input: { open: false }, environmentAxes: [] },
          { id: 'open', label: 'Open', input: { open: true }, environmentAxes: [] },
        ],
      },
      'component:menu': {
        defaultCaseId: 'default',
        cases: [{ id: 'default', label: 'Default', input: null, environmentAxes: [] }],
      },
    } as const satisfies PresentationScenarioDefinitions
    const productContract = contract()
    const catalog = compileScenarioFamily(productContract, 'menus-overlays', definitions)

    const resolved = resolveScenarioSelection(productContract, catalog, {
      productId: 'dialog',
      path: 'baseline',
    })

    expect(resolved.case.id).toBe('open')
    expect(resolved).not.toHaveProperty('copiedArtifact')
  })

  it('resolves one case with composed environment defaults and its sole copied artifact', () => {
    const definitions = {
      'component:dialog': {
        defaultCaseId: 'open',
        cases: [
          {
            id: 'open',
            label: 'Open',
            input: { open: true },
            environmentAxes: ['theme', 'direction'],
          },
        ],
      },
      'component:menu': {
        defaultCaseId: 'default',
        cases: [
          {
            id: 'default',
            label: 'Default',
            input: null,
            environmentAxes: [],
          },
        ],
      },
    } as const satisfies PresentationScenarioDefinitions
    const productContract = contract()
    const catalog = compileScenarioFamily(productContract, 'menus-overlays', definitions)

    expect(
      resolveScenarioSelection(productContract, catalog, {
        productId: 'dialog',
        caseId: 'open',
        path: 'registryTailwind',
        environment: { theme: 'dark', direction: 'rtl' },
      }),
    ).toEqual({
      productId: 'dialog',
      scenarioId: 'component:dialog',
      case: catalog.scenarios[0]!.cases[0],
      path: 'registryTailwind',
      environment: {
        ...DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
        theme: 'dark',
        direction: 'rtl',
      },
      copiedArtifact: { name: 'dialog', scenarioId: 'component:dialog' },
    })
  })

  it.each([
    [
      'product',
      { productId: 'missing', caseId: 'open', path: 'baseline' as const },
      'unknown-product',
      'Unknown product "missing" in compiled family "menus-overlays".',
    ],
    [
      'case',
      { productId: 'dialog', caseId: 'missing', path: 'baseline' as const },
      'unknown-case',
      'Unknown case "missing" for product "dialog".',
    ],
  ])('rejects an unknown %s with a typed error', (_name, selection, code, issue) => {
    const definition = {
      defaultCaseId: 'open',
      cases: [{ id: 'open', label: 'Open', input: { open: true }, environmentAxes: [] }],
    } as const
    const definitions = {
      'component:dialog': definition,
      'component:menu': {
        defaultCaseId: 'default',
        cases: [{ id: 'default', label: 'Default', input: null, environmentAxes: [] }],
      },
    } as const satisfies PresentationScenarioDefinitions
    const productContract = contract()
    const catalog = compileScenarioFamily(productContract, 'menus-overlays', definitions)

    try {
      resolveScenarioSelection(productContract, catalog, selection)
      expect.unreachable('unknown selection must throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PresentationScenarioError)
      expect(error).toMatchObject({ code, issues: [issue] })
    }
  })

  it('rejects invalid catalog joins instead of dereferencing a stale ProductContract', () => {
    const definitions = {
      'component:dialog': {
        defaultCaseId: 'open',
        cases: [{ id: 'open', label: 'Open', input: null, environmentAxes: [] }],
      },
      'component:menu': {
        defaultCaseId: 'default',
        cases: [{ id: 'default', label: 'Default', input: null, environmentAxes: [] }],
      },
    } as const satisfies PresentationScenarioDefinitions
    const catalog = compileScenarioFamily(contract(), 'menus-overlays', definitions)
    const staleContract = ProductContractSchema.parse({
      version: 2,
      entries: [product('menu')],
      aliases: [],
    })

    try {
      resolveScenarioSelection(staleContract, catalog, {
        productId: 'dialog',
        path: 'baseline',
      })
      expect.unreachable('a stale catalog join must throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PresentationScenarioError)
      expect(error).toMatchObject({
        code: 'invalid-catalog',
        issues: ['Catalog contains stale scenario "component:dialog" for product "dialog".'],
      })
    }
  })

  it('validates serialized catalog version, family, identities, defaults, and cases', () => {
    const definitions = {
      'component:dialog': {
        defaultCaseId: 'open',
        cases: [{ id: 'open', label: 'Open', input: null, environmentAxes: [] }],
      },
      'component:menu': {
        defaultCaseId: 'default',
        cases: [{ id: 'default', label: 'Default', input: null, environmentAxes: [] }],
      },
    } as const satisfies PresentationScenarioDefinitions
    const productContract = contract()
    const catalog = compileScenarioFamily(productContract, 'menus-overlays', definitions)
    const dialogScenario = catalog.scenarios[0]!
    const menuScenario = catalog.scenarios[1]!
    const invalidCatalogs = [
      {
        catalog: { ...catalog, version: 2 },
        issues: ['Catalog version "2" is unsupported; expected 1.'],
      },
      {
        catalog: { ...catalog, family: 'unknown-family' },
        issues: ['Catalog family "unknown-family" has no ProductContract entries.'],
      },
      {
        catalog: { ...catalog, scenarios: [dialogScenario, dialogScenario] },
        issues: [
          'Catalog contains duplicate product "dialog".',
          'Catalog contains duplicate scenario "component:dialog".',
          'Catalog is missing scenario "component:menu" for product "menu".',
        ],
      },
      {
        catalog: { ...catalog, scenarios: [menuScenario, dialogScenario] },
        issues: [
          'Catalog scenario "component:dialog" for product "dialog" is out of canonical order at index 1.',
          'Catalog scenario "component:menu" for product "menu" is out of canonical order at index 0.',
        ],
      },
      {
        catalog: {
          ...catalog,
          scenarios: [
            {
              ...dialogScenario,
              defaultCaseId: 'missing',
              cases: [dialogScenario.cases[0]!, dialogScenario.cases[0]!],
            },
            {
              ...menuScenario,
              defaultCaseId: 'Default state',
              cases: [{ ...menuScenario.cases[0]!, id: 'Default state' }],
            },
          ],
        },
        issues: [
          'Default case "missing" does not exist in scenario "component:dialog".',
          'Duplicate case id "open" in scenario "component:dialog".',
          'Invalid case id "Default state" in scenario "component:menu".',
          'Invalid default case id "Default state" in scenario "component:menu".',
        ],
      },
    ]

    for (const { catalog: invalidCatalog, issues } of invalidCatalogs) {
      try {
        resolveScenarioSelection(productContract, invalidCatalog as unknown as typeof catalog, {
          productId: 'dialog',
          path: 'baseline',
        })
        expect.unreachable('an invalid serialized catalog must throw')
      } catch (error) {
        expect(error).toBeInstanceOf(PresentationScenarioError)
        expect(error).toMatchObject({ code: 'invalid-catalog', issues })
      }
    }
  })

  it('rejects unknown and ProductContract-inapplicable presentation paths', () => {
    const unavailable = {
      ...product('badge'),
      artifactKind: 'presentational' as const,
      machine: { kind: 'none' as const, reason: 'presentational' as const },
      copiedArtifacts: [
        {
          ...product('badge').copiedArtifacts[0]!,
          artifactKind: 'presentational' as const,
        },
      ],
      styling: { baseline: false, registryTailwind: true, styleless: false },
      presentation: {
        family: 'menus-overlays' as const,
        baseline: { mode: 'not-applicable' as const, rationale: 'No baseline artifact exists.' },
        registryTailwind: styled,
      },
    }
    const unavailableContract = ProductContractSchema.parse({
      version: 2,
      entries: [unavailable],
      aliases: [],
    })
    const catalog = compileScenarioFamily(unavailableContract, 'menus-overlays', {
      'component:badge': {
        defaultCaseId: 'default',
        cases: [{ id: 'default', label: 'Default', input: null, environmentAxes: [] }],
      },
    })
    const selections = [
      {
        selection: { productId: 'badge', path: 'gallery' },
        issue: 'Unknown presentation path "gallery".',
      },
      {
        selection: { productId: 'badge', path: 'baseline' },
        issue: 'Presentation path "baseline" is not applicable to product "badge".',
      },
    ]

    for (const { selection, issue } of selections) {
      try {
        resolveScenarioSelection(
          unavailableContract,
          catalog,
          selection as Parameters<typeof resolveScenarioSelection>[2],
        )
        expect.unreachable('an invalid presentation path must throw')
      } catch (error) {
        expect(error).toBeInstanceOf(PresentationScenarioError)
        expect(error).toMatchObject({ code: 'invalid-path', issues: [issue] })
      }
    }
  })

  it('rejects unknown values, axes, and unsupported environment overrides together', () => {
    const definitions = {
      'component:dialog': {
        defaultCaseId: 'open',
        cases: [
          {
            id: 'open',
            label: 'Open',
            input: { open: true },
            environmentAxes: ['theme'],
          },
        ],
      },
      'component:menu': {
        defaultCaseId: 'default',
        cases: [{ id: 'default', label: 'Default', input: null, environmentAxes: [] }],
      },
    } as const satisfies PresentationScenarioDefinitions
    const productContract = contract()
    const catalog = compileScenarioFamily(productContract, 'menus-overlays', definitions)

    try {
      resolveScenarioSelection(productContract, catalog, {
        productId: 'dialog',
        caseId: 'open',
        path: 'baseline',
        environment: { theme: 'sepia', motion: 'reduced', contrast: 'high' },
      } as unknown as Parameters<typeof resolveScenarioSelection>[2])
      expect.unreachable('invalid environment must throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PresentationScenarioError)
      expect(error).toMatchObject({
        code: 'invalid-environment',
        issues: [
          'Case "open" for product "dialog" does not support environment axis "motion".',
          'Environment axis "contrast" is unknown.',
          'Environment axis "theme" has unknown value "sepia".',
        ],
      })
    }
  })

  it('resolves an allowed copied-artifact target and rejects invalid target selections', () => {
    const drawerContract = ProductContractSchema.parse({
      version: 2,
      entries: [
        {
          ...product('drawer'),
          copiedArtifacts: [
            {
              name: 'drawer',
              artifactKind: 'skin',
              scenarioId: 'registry:drawer',
              styling: registryStyling,
            },
            {
              name: 'sheet',
              artifactKind: 'skin',
              scenarioId: 'registry:sheet',
              styling: registryStyling,
            },
          ],
        },
      ],
      aliases: [],
    })
    const catalog = compileScenarioFamily(drawerContract, 'menus-overlays', {
      'component:drawer': {
        defaultCaseId: 'open',
        cases: [
          {
            id: 'open',
            label: 'Open sheet',
            input: { open: true },
            environmentAxes: [],
            copiedArtifactNames: ['sheet'],
          },
        ],
      },
    })

    expect(
      resolveScenarioSelection(drawerContract, catalog, {
        productId: 'drawer',
        caseId: 'open',
        path: 'registryTailwind',
        copiedArtifact: 'sheet',
      }).copiedArtifact,
    ).toEqual({ name: 'sheet', scenarioId: 'registry:sheet' })
    expect(
      resolveScenarioSelection(drawerContract, catalog, {
        productId: 'drawer',
        caseId: 'open',
        path: 'registryTailwind',
      }).copiedArtifact,
    ).toEqual({ name: 'sheet', scenarioId: 'registry:sheet' })

    const invalid = [
      {
        selection: {
          productId: 'drawer',
          caseId: 'open',
          path: 'baseline' as const,
          copiedArtifact: 'sheet',
        },
        issue: 'Copied-artifact target "sheet" is invalid on the baseline path.',
      },
      {
        selection: {
          productId: 'drawer',
          caseId: 'open',
          path: 'registryTailwind' as const,
          copiedArtifact: 'unknown',
        },
        issue: 'Product "drawer" does not own copied artifact "unknown".',
      },
      {
        selection: {
          productId: 'drawer',
          caseId: 'open',
          path: 'registryTailwind' as const,
          copiedArtifact: 'drawer',
        },
        issue: 'Case "open" for product "drawer" does not support copied artifact "drawer".',
      },
    ]

    for (const { selection, issue } of invalid) {
      try {
        resolveScenarioSelection(drawerContract, catalog, selection)
        expect.unreachable('invalid copied-artifact selection must throw')
      } catch (error) {
        expect(error).toBeInstanceOf(PresentationScenarioError)
        expect(error).toMatchObject({ code: 'invalid-copied-artifact', issues: [issue] })
      }
    }
  })

  it('rejects unavailable and ambiguous implicit registry targets', () => {
    const ambiguousContract = ProductContractSchema.parse({
      version: 2,
      entries: [
        {
          ...product('picker'),
          copiedArtifacts: [
            {
              name: 'calendar',
              artifactKind: 'skin',
              scenarioId: 'registry:calendar',
              styling: registryStyling,
            },
            {
              name: 'date-picker',
              artifactKind: 'skin',
              scenarioId: 'registry:date-picker',
              styling: registryStyling,
            },
          ],
        },
      ],
      aliases: [],
    })
    const ambiguousCatalog = compileScenarioFamily(ambiguousContract, 'menus-overlays', {
      'component:picker': {
        defaultCaseId: 'default',
        cases: [{ id: 'default', label: 'Default', input: null, environmentAxes: [] }],
      },
    })
    const unavailableCatalog = compileScenarioFamily(ambiguousContract, 'menus-overlays', {
      'component:picker': {
        defaultCaseId: 'baseline-only',
        cases: [
          {
            id: 'baseline-only',
            label: 'Baseline only',
            input: null,
            environmentAxes: [],
            copiedArtifactNames: [],
          },
        ],
      },
    })
    const selections: readonly {
      catalog: CompiledPresentationScenarioFamily
      issue: string
    }[] = [
      {
        catalog: ambiguousCatalog,
        issue:
          'Case "default" for product "picker" has multiple eligible copied artifacts; select one explicitly: "calendar", "date-picker".',
      },
      {
        catalog: unavailableCatalog,
        issue:
          'Case "baseline-only" for product "picker" has no eligible copied artifact for the registryTailwind path.',
      },
    ]

    for (const { catalog, issue } of selections) {
      try {
        resolveScenarioSelection(ambiguousContract, catalog, {
          productId: 'picker',
          path: 'registryTailwind',
        })
        expect.unreachable('an unresolved registry target must throw')
      } catch (error) {
        expect(error).toBeInstanceOf(PresentationScenarioError)
        expect(error).toMatchObject({ code: 'invalid-copied-artifact', issues: [issue] })
      }
    }

    expect(
      resolveScenarioSelection(ambiguousContract, ambiguousCatalog, {
        productId: 'picker',
        path: 'registryTailwind',
        copiedArtifact: 'calendar',
      }).copiedArtifact,
    ).toEqual({ name: 'calendar', scenarioId: 'registry:calendar' })
  })
})
