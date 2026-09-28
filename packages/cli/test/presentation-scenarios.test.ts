import { describe, expect, expectTypeOf, it } from 'vitest'
import { ProductContractSchema, type ProductContract } from '../src/product-contract'
import {
  DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
  bindScenarioAdapters,
  compileScenarioFamily,
  decodeScenarioFamily,
  decodeScenarioSelection,
  dispatchScenarioSelection,
  PresentationScenarioError,
  resolveScenarioSelection,
  type PresentationScenarioAdapterBinding,
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
          '$["component:dialog"]: missing definition for product "dialog".',
          '$["component:stale"]: stale definition for presentation family "menus-overlays".',
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
          '$["component:dialog"].cases[0].id: invalid case id "Open state".',
          '$["component:dialog"].cases[2].id: duplicate case id "open".',
          '$["component:dialog"].defaultCaseId: case "missing" does not exist.',
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
          '$["component:dialog"].cases: must define at least one case.',
          '$["component:dialog"].defaultCaseId: case "default" does not exist.',
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
          '$["component:dialog"].cases[0].id: invalid case id "Open state".',
          '$["component:dialog"].defaultCaseId: invalid case id "Open state".',
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
    }

    try {
      decodeScenarioFamily(contract(), 'menus-overlays', definitions)
      expect.unreachable('invalid case metadata must throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PresentationScenarioError)
      expect(error).toMatchObject({
        code: 'invalid-definitions',
        issues: [
          '$["component:dialog"].cases[0].environmentAxes[1]: duplicate environment axis "theme".',
          '$["component:dialog"].cases[0].environmentAxes[2]: unknown environment axis "contrast".',
          '$["component:dialog"].cases[0].label: must contain non-whitespace text.',
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
    ['dates', new Date('2026-01-01T00:00:00.000Z'), '$.value', 'must be a plain object'],
    ['runtime objects', new (class RuntimeHandle {})(), '$.value', 'must be a plain object'],
    ['cycles', cyclic, '$.value.self', 'cyclic references are not JSON-safe'],
    ['NaN', Number.NaN, '$.value', 'numbers must be finite and preserve their JSON value'],
    [
      'infinity',
      Number.POSITIVE_INFINITY,
      '$.value',
      'numbers must be finite and preserve their JSON value',
    ],
    ['negative zero', -0, '$.value', 'numbers must be finite and preserve their JSON value'],
    ['accessors', accessorInput, '$.value.dynamic', 'accessor properties are not supported'],
    [
      'non-enumerable data',
      hiddenInput,
      '$.value.hidden',
      'non-enumerable properties are not supported',
    ],
    ['symbol keys', symbolInput, '$.value', 'symbol-keyed properties are not supported'],
    [
      'decorated arrays',
      decoratedArray,
      '$.value.extra',
      'non-index array properties are not supported',
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
    }

    try {
      decodeScenarioFamily(contract(), 'menus-overlays', definitions)
      expect.unreachable('non-JSON input must throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PresentationScenarioError)
      expect(error).toMatchObject({
        code: 'invalid-definitions',
        issues: [`$["component:dialog"].cases[0].input${path.slice(1)}: ${reason}.`],
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

  it('snapshots JSON input objects as ordinary plain objects, not Object.create(null) (#270 finding 5)', () => {
    const definitions = {
      'component:dialog': {
        defaultCaseId: 'default',
        cases: [
          {
            id: 'default',
            label: 'Default',
            input: { title: 'Ordinary prototype', nested: { count: 1 } },
            environmentAxes: [],
          },
        ],
      },
      'component:menu': {
        defaultCaseId: 'default',
        cases: [{ id: 'default', label: 'Default', input: null, environmentAxes: [] }],
      },
    } as const satisfies PresentationScenarioDefinitions

    const compiled = compileScenarioFamily(contract(), 'menus-overlays', definitions)
    const input = compiled.scenarios[0]!.cases[0]!.input as {
      readonly title: string
      readonly nested: { readonly count: number }
    }

    // A null-prototype snapshot throws on both of these; an ordinary one does not.
    expect(() => `${input}`).not.toThrow()
    expect(`${input}`).toBe('[object Object]')
    expect(() => Object.prototype.hasOwnProperty.call(input, 'title')).not.toThrow()
    expect(Object.prototype.hasOwnProperty.call(input, 'title')).toBe(true)
    expect(Object.getPrototypeOf(input)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(input.nested)).toBe(Object.prototype)
    expect(Object.isFrozen(input)).toBe(true)
  })

  it('handles a `__proto__` data key via defineProperty, never assignment, and preserves it as an own property (#270 finding 5)', () => {
    const proto = Object.create(null) as Record<string, unknown>
    proto['visible'] = true
    proto['__proto__'] = 'a plain string value, not a prototype'
    const definitions = {
      'component:dialog': {
        defaultCaseId: 'default',
        cases: [{ id: 'default', label: 'Default', input: proto, environmentAxes: [] }],
      },
      'component:menu': {
        defaultCaseId: 'default',
        cases: [{ id: 'default', label: 'Default', input: null, environmentAxes: [] }],
      },
    }

    const compiled = decodeScenarioFamily(contract(), 'menus-overlays', definitions)
    const input = compiled.scenarios[0]!.cases[0]!.input as Record<string, unknown>

    // The object's ACTUAL prototype is untouched (still ordinary Object.prototype) — a plain
    // assignment of a `__proto__`-named key would instead have reassigned it, most likely to
    // `'a plain string value, not a prototype'` coerced away or to `Object.prototype` itself
    // depending on the value, and either way would have LOST the key as own data.
    expect(Object.getPrototypeOf(input)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(input, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(input, '__proto__')).toMatchObject({
      value: 'a plain string value, not a prototype',
      enumerable: true,
    })
    expect(input['__proto__']).toBe('a plain string value, not a prototype')
    expect(input['visible']).toBe(true)
    // A computed key here (never the literal `__proto__:` syntax, which sets the prototype
    // instead of creating a data property — precisely the footgun this test exists to catch).
    expect(JSON.parse(JSON.stringify(input))).toEqual({
      ['__proto__']: 'a plain string value, not a prototype',
      visible: true,
    })
  })

  it('retains the family-owned case union for exact protocol cases', () => {
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
    const rendererAdapters = {
      'component:drawer': {
        open: () => 'family renderer',
        closed: () => 'family renderer',
      },
    } as const

    const compiled = compileScenarioFamily(drawerContract, 'menus-overlays', definitions)
    const compiledCase = compiled.scenarios[0]!.cases[0]!

    expect(Object.keys(compiledCase)).toEqual(['id', 'label', 'input', 'environmentAxes'])
    expect(compiledCase).not.toHaveProperty('renderer')
    expect(rendererAdapters['component:drawer'][compiledCase.id]()).toBe('family renderer')
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
    } as const satisfies PresentationScenarioDefinitions

    try {
      compileScenarioFamily(drawerContract, 'menus-overlays', definitions)
      expect.unreachable('invalid copied-artifact targets must throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PresentationScenarioError)
      expect(error).toMatchObject({
        code: 'invalid-definitions',
        issues: [
          '$["component:drawer"].cases[0].copiedArtifactNames[1]: duplicate copied artifact "sheet".',
          '$["component:drawer"].cases[0].copiedArtifactNames[2]: unknown copied artifact "unknown".',
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
      '$.productId: unknown product "missing" in compiled family "menus-overlays".',
    ],
    [
      'case',
      { productId: 'dialog', caseId: 'missing', path: 'baseline' as const },
      'unknown-case',
      '$.caseId: unknown case "missing" for product "dialog".',
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
        issues: [
          '$.scenarios[0].scenarioId: stale ProductContract scenario "component:dialog".',
          '$.scenarios[1]: expected canonical ProductContract index 0.',
        ],
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
        issues: ['$.version: must equal 1.'],
      },
      {
        catalog: { ...catalog, family: 'unknown-family' },
        issues: ['$.family: unknown presentation family "unknown-family".'],
      },
      {
        catalog: { ...catalog, scenarios: [dialogScenario, dialogScenario] },
        issues: [
          '$.scenarios: missing scenario "component:menu" for product "menu".',
          '$.scenarios[1].productId: duplicate product "dialog".',
          '$.scenarios[1].scenarioId: duplicate scenario "component:dialog".',
          '$.scenarios[1]: expected canonical ProductContract index 0.',
        ],
      },
      {
        catalog: { ...catalog, scenarios: [menuScenario, dialogScenario] },
        issues: [
          '$.scenarios[0]: expected canonical ProductContract index 1.',
          '$.scenarios[1]: expected canonical ProductContract index 0.',
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
          '$.scenarios[0].cases[1].id: duplicate case id "open".',
          '$.scenarios[0].defaultCaseId: case "missing" does not exist.',
          '$.scenarios[1].cases[0].id: invalid case id "Default state".',
          '$.scenarios[1].defaultCaseId: invalid case id "Default state".',
        ],
      },
    ]

    for (const { catalog: invalidCatalog, issues } of invalidCatalogs) {
      try {
        decodeScenarioSelection(productContract, invalidCatalog, {
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
        issue: '$.path: unknown presentation path "gallery".',
      },
      {
        selection: { productId: 'badge', path: 'baseline' },
        issue: '$.path: presentation path "baseline" is not applicable to product "badge".',
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
      decodeScenarioSelection(productContract, catalog, {
        productId: 'dialog',
        caseId: 'open',
        path: 'baseline',
        environment: { theme: 'sepia', motion: 'reduced', contrast: 'high' },
      })
      expect.unreachable('invalid environment must throw')
    } catch (error) {
      expect(error).toBeInstanceOf(PresentationScenarioError)
      expect(error).toMatchObject({
        code: 'invalid-environment',
        issues: [
          '$.environment.contrast: unknown environment axis "contrast".',
          '$.environment.motion: case "open" does not support this environment axis.',
          '$.environment.theme: unknown value "sepia".',
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
        issue: '$.copiedArtifact: target "sheet" is invalid on the baseline path.',
      },
      {
        selection: {
          productId: 'drawer',
          caseId: 'open',
          path: 'registryTailwind' as const,
          copiedArtifact: 'unknown',
        },
        issue: '$.copiedArtifact: product "drawer" does not own target "unknown".',
      },
      {
        selection: {
          productId: 'drawer',
          caseId: 'open',
          path: 'registryTailwind' as const,
          copiedArtifact: 'drawer',
        },
        issue: '$.copiedArtifact: case "open" does not support target "drawer".',
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
      catalog: typeof ambiguousCatalog | typeof unavailableCatalog
      issue: string
    }[] = [
      {
        catalog: ambiguousCatalog,
        issue:
          '$.copiedArtifact: case "default" has multiple eligible registry targets; select one of "calendar", "date-picker".',
      },
      {
        catalog: unavailableCatalog,
        issue: '$.copiedArtifact: case "baseline-only" has no eligible registry target.',
      },
    ]

    for (const { catalog, issue } of selections) {
      try {
        // The loop's `catalog` is a runtime union of two differently-defaulted compiled results,
        // so no single static `Definitions` describes every iteration — decode it, exactly the
        // shape decodeScenarioSelection exists for (#270 finding 3).
        decodeScenarioSelection(ambiguousContract, catalog, {
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

  it('allows a naturally artifact-free styleless registry presentation', () => {
    const rationale = 'The public machine is intentionally useful without owned visuals.'
    const machineOnlyContract = ProductContractSchema.parse({
      version: 2,
      entries: [
        {
          ...product('tooltip'),
          copiedArtifacts: [],
          styling: { baseline: false, registryTailwind: false, styleless: true },
          presentation: {
            family: 'menus-overlays',
            baseline: { mode: 'styleless', rationale },
            registryTailwind: { mode: 'styleless', rationale },
          },
        },
      ],
      aliases: [],
    })
    const catalog = compileScenarioFamily(machineOnlyContract, 'menus-overlays', {
      'component:tooltip': {
        defaultCaseId: 'default',
        cases: [{ id: 'default', label: 'Default', input: null, environmentAxes: [] }],
      },
    })

    expect(
      resolveScenarioSelection(machineOnlyContract, catalog, {
        productId: 'tooltip',
        path: 'registryTailwind',
      }),
    ).not.toHaveProperty('copiedArtifact')
  })

  it('skips re-decoding a catalog this module already produced and validated, but still re-validates a serialized copy (#270 finding 6)', () => {
    const definitions = {
      'component:dialog': {
        defaultCaseId: 'open',
        cases: [
          {
            id: 'open',
            label: 'Open',
            input: { nested: { labels: ['Ada', 'Grace'] } },
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
    const trustedCase = catalog.scenarios[0]!.cases[0]!

    // The PRODUCED catalog: resolving against it returns the SAME case object (and its `input`)
    // — proof the structural decode was skipped, since a full decode always REBUILDS every value
    // from scratch and could never hand back the exact reference it was given.
    const trustedResolved = resolveScenarioSelection(productContract, catalog, {
      productId: 'dialog',
      path: 'baseline',
    })
    expect(trustedResolved.case).toBe(trustedCase)
    expect(trustedResolved.case.input).toBe(trustedCase.input)

    // A byte-identical but DIFFERENT object (never produced by this module) is a different
    // reference, so it is decoded and integrity-checked in full: its resolved case is a freshly
    // rebuilt object, not the serialized copy's own.
    const serializedCatalog = JSON.parse(JSON.stringify(catalog)) as typeof catalog
    const untrustedResolved = resolveScenarioSelection(productContract, serializedCatalog, {
      productId: 'dialog',
      path: 'baseline',
    })
    expect(untrustedResolved.case).not.toBe(serializedCatalog.scenarios[0]!.cases[0])
    expect(untrustedResolved.case).toEqual(trustedCase)
    expect(untrustedResolved.case.input).toEqual(trustedCase.input)

    // A genuinely stale contract is still caught even for the trusted (produced) catalog — the
    // fast path skips the STRUCTURAL decode only, never the contract integrity cross-check.
    const staleContract = ProductContractSchema.parse({
      version: 2,
      entries: [product('menu')],
      aliases: [],
    })
    try {
      resolveScenarioSelection(staleContract, catalog, { productId: 'dialog', path: 'baseline' })
      expect.unreachable('a stale catalog join must still throw for a trusted catalog')
    } catch (error) {
      expect(error).toBeInstanceOf(PresentationScenarioError)
      expect(error).toMatchObject({ code: 'invalid-catalog' })
    }
  })
})

/** Two scenarios with deliberately different input shapes, so a crossed dispatch is visible. */
const dispatchDefinitions = {
  'component:dialog': {
    defaultCaseId: 'open',
    cases: [
      { id: 'open', label: 'Open', input: { open: true }, environmentAxes: ['direction'] },
      { id: 'closed', label: 'Closed', input: { open: false }, environmentAxes: [] },
    ],
  },
  'component:menu': {
    defaultCaseId: 'items',
    cases: [{ id: 'items', label: 'Items', input: { items: ['Open'] }, environmentAxes: [] }],
  },
} as const satisfies PresentationScenarioDefinitions

interface RecordedCall {
  readonly adapter: string
  readonly host: string
  readonly input: unknown
  readonly context: unknown
}

function recordingAdapters(calls: RecordedCall[]) {
  return {
    'component:dialog': (host: string, input: { readonly open: boolean }, context: object) => {
      calls.push({ adapter: 'dialog', host, input, context })
      return `dialog:${String(input.open)}`
    },
    'component:menu': (
      host: string,
      input: { readonly items: readonly string[] },
      context: object,
    ) => {
      calls.push({ adapter: 'menu', host, input, context })
      return `menu:${input.items.join(',')}`
    },
  } as const
}

function expectScenarioError(run: () => unknown, code: string, issues: readonly string[]): void {
  try {
    run()
    expect.unreachable(`expected a ${code} PresentationScenarioError`)
  } catch (error) {
    expect(error).toBeInstanceOf(PresentationScenarioError)
    expect(error).toMatchObject({ code, issues })
  }
}

describe('dispatchScenarioSelection', () => {
  it('calls exactly the adapter registered for the resolved scenario, with the case input, host and context', () => {
    const productContract = contract()
    const catalog = compileScenarioFamily(productContract, 'menus-overlays', dispatchDefinitions)
    const calls: RecordedCall[] = []
    const adapters = recordingAdapters(calls)

    const dialog = resolveScenarioSelection(productContract, catalog, {
      productId: 'dialog',
      path: 'baseline',
      environment: { direction: 'rtl' },
    })
    const menu = resolveScenarioSelection(productContract, catalog, {
      productId: 'menu',
      path: 'baseline',
    })

    expect(dispatchScenarioSelection(catalog, adapters, dialog, 'host-a', {})).toBe('dialog:true')
    expect(
      dispatchScenarioSelection(catalog, adapters, menu, 'host-b', { copiedArtifactNames: [] }),
    ).toBe('menu:Open')
    expect(calls).toEqual([
      {
        adapter: 'dialog',
        host: 'host-a',
        input: { open: true },
        context: {
          scenarioId: 'component:dialog',
          caseId: 'open',
          environment: { ...DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT, direction: 'rtl' },
        },
      },
      {
        adapter: 'menu',
        host: 'host-b',
        input: { items: ['Open'] },
        context: {
          copiedArtifactNames: [],
          scenarioId: 'component:menu',
          caseId: 'items',
          environment: DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
        },
      },
    ])
    // The adapter receives the resolved case's OWN input, not a copy.
    expect(calls[0]!.input).toBe(dialog.case.input)
  })

  it('lets the protocol-owned context keys win over an untyped extra that smuggles one', () => {
    const productContract = contract()
    const catalog = compileScenarioFamily(productContract, 'menus-overlays', dispatchDefinitions)
    const calls: RecordedCall[] = []
    const resolved = resolveScenarioSelection(productContract, catalog, {
      productId: 'dialog',
      caseId: 'closed',
      path: 'baseline',
    })
    // What an untyped (serialized) caller could hand over; the typed signature forbids it.
    const forged: Readonly<Record<string, never>> = JSON.parse(
      '{"scenarioId":"component:menu","caseId":"items","environment":null,"note":"kept"}',
    )

    dispatchScenarioSelection(catalog, recordingAdapters(calls), resolved, 'host', forged)

    expect(calls).toEqual([
      {
        adapter: 'dialog',
        host: 'host',
        input: { open: false },
        context: {
          note: 'kept',
          scenarioId: 'component:dialog',
          caseId: 'closed',
          environment: DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
        },
      },
    ])
  })

  it('fails with missing-adapter, calling nothing, when the scenario has no registered adapter', () => {
    const productContract = contract()
    const catalog = compileScenarioFamily(productContract, 'menus-overlays', dispatchDefinitions)
    const calls: RecordedCall[] = []
    const { 'component:dialog': dialogOnly } = recordingAdapters(calls)
    const menu = resolveScenarioSelection(productContract, catalog, {
      productId: 'menu',
      path: 'baseline',
    })

    expectScenarioError(
      () =>
        dispatchScenarioSelection(catalog, { 'component:dialog': dialogOnly }, menu, 'host', {}),
      'missing-adapter',
      ['$.scenarioId: no adapter is registered for scenario "component:menu".'],
    )
    expect(calls).toEqual([])
  })

  it('rejects a selection that was not resolved from the catalog it is dispatched with', () => {
    const productContract = contract()
    const erasedCatalog = decodeScenarioFamily(
      productContract,
      'menus-overlays',
      dispatchDefinitions,
    )
    const formsCatalog = decodeScenarioFamily(productContract, 'forms-controls', {
      'component:switch': {
        defaultCaseId: 'on',
        cases: [{ id: 'on', label: 'On', input: { checked: true }, environmentAxes: [] }],
      },
    })
    const calls: RecordedCall[] = []
    const erasedAdapters = {
      'component:dialog': (host: string, input: unknown, context: object) => {
        calls.push({ adapter: 'dialog', host, input, context })
        return 'dialog'
      },
      'component:switch': (host: string, input: unknown, context: object) => {
        calls.push({ adapter: 'switch', host, input, context })
        return 'switch'
      },
    }
    const switchSelection = decodeScenarioSelection(productContract, formsCatalog, {
      productId: 'switch',
      path: 'baseline',
    })
    const dialogSelection = decodeScenarioSelection(productContract, erasedCatalog, {
      productId: 'dialog',
      path: 'baseline',
    })

    expectScenarioError(
      () => dispatchScenarioSelection(erasedCatalog, erasedAdapters, switchSelection, 'host', {}),
      'invalid-selection',
      [
        '$.scenarioId: scenario "component:switch" of product "switch" is not in compiled family "menus-overlays".',
      ],
    )
    expectScenarioError(
      () =>
        dispatchScenarioSelection(
          erasedCatalog,
          erasedAdapters,
          { ...dialogSelection, case: { ...dialogSelection.case, id: 'ghost' } },
          'host',
          {},
        ),
      'invalid-selection',
      ['$.case.id: case "ghost" is not a case of scenario "component:dialog".'],
    )
    expect(calls).toEqual([])
  })
})

describe('bindScenarioAdapters', () => {
  it('erases a typed map to one family-agnostic binding that resolves, then renders', () => {
    const productContract = contract()
    const catalog = compileScenarioFamily(productContract, 'menus-overlays', dispatchDefinitions)
    const calls: RecordedCall[] = []
    const binding = bindScenarioAdapters(catalog, recordingAdapters(calls))
    expectTypeOf(binding).toEqualTypeOf<PresentationScenarioAdapterBinding<string, string>>()

    expect(binding.family).toBe('menus-overlays')
    expect(binding.scenarioIds).toEqual(['component:dialog', 'component:menu'])
    expect(Object.isFrozen(binding.scenarioIds)).toBe(true)

    const prepared = binding.prepare(productContract, {
      productId: 'dialog',
      caseId: 'closed',
      path: 'registryTailwind',
    })
    // Resolution is the protocol's own: identical to resolving the typed catalog directly.
    expect(prepared.selection).toEqual(
      resolveScenarioSelection(productContract, catalog, {
        productId: 'dialog',
        caseId: 'closed',
        path: 'registryTailwind',
      }),
    )
    // Preparing renders nothing; rendering dispatches exactly once, to the right adapter.
    expect(calls).toEqual([])
    expect(prepared.render('host', {})).toBe('dialog:false')
    expect(calls.map(({ adapter, input }) => ({ adapter, input }))).toEqual([
      { adapter: 'dialog', input: { open: false } },
    ])
  })

  it('reports a bad selection before a missing adapter, and a missing adapter before any render', () => {
    const productContract = contract()
    const catalog = compileScenarioFamily(productContract, 'menus-overlays', dispatchDefinitions)
    const calls: RecordedCall[] = []
    const { 'component:dialog': dialogOnly } = recordingAdapters(calls)
    const binding = bindScenarioAdapters(catalog, { 'component:dialog': dialogOnly })

    expect(binding.scenarioIds).toEqual(['component:dialog'])
    expectScenarioError(
      () => binding.prepare(productContract, { productId: 'menu', caseId: 'x', path: 'baseline' }),
      'unknown-case',
      ['$.caseId: unknown case "x" for product "menu".'],
    )
    expectScenarioError(
      () => binding.prepare(productContract, { productId: 'menu', path: 'baseline' }),
      'missing-adapter',
      ['$.scenarioId: no adapter is registered for scenario "component:menu".'],
    )
    expect(calls).toEqual([])
  })

  it('rejects, at bind time, an adapter for no scenario of the catalog and a non-function adapter', () => {
    const productContract = contract()
    const catalog = decodeScenarioFamily(productContract, 'menus-overlays', dispatchDefinitions)
    // What an untyped map could carry; `never` values keep the typed signature honest.
    const bogus: Readonly<Record<string, never>> = JSON.parse(
      '{"component:stale":{},"component:dialog":1}',
    )

    expectScenarioError(() => bindScenarioAdapters(catalog, bogus), 'invalid-adapters', [
      '$["component:dialog"]: adapter is not a function.',
      '$["component:stale"]: no scenario "component:stale" in compiled family "menus-overlays".',
    ])
  })
})
