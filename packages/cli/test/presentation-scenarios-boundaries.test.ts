import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { ProductContractSchema, type ProductContract } from '../src/product-contract'
import {
  DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
  PRESENTATION_SCENARIO_COMPLEXITY_LIMITS,
  PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS,
  PRESENTATION_SCENARIO_ENVIRONMENT_VALUES,
  PRESENTATION_SCENARIO_PATHS,
  PresentationScenarioError,
  decodeScenarioFamily,
  decodeScenarioSelection,
  type CompiledPresentationScenarioFamily,
  type PresentationScenarioDefinitions,
} from '../src/presentation-scenarios'

const styled = { mode: 'styled' as const }
function expectBoundedDiagnostics(
  error: PresentationScenarioError,
  code: PresentationScenarioError['code'],
  expectedIssueCount: number = PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS.issues,
): void {
  expect(error.code).toBe(code)
  expect(error.issues).toHaveLength(expectedIssueCount)
  expect(error.message.length).toBeLessThanOrEqual(
    PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS.messageUnits,
  )
  expect(error.message.length).toBe(
    error.issues.reduce((units, issue) => units + issue.length, error.issues.length - 1),
  )
  expect(error.issues.filter((issue) => issue.includes('diagnostics truncated'))).toHaveLength(1)
}

function productContract(): ProductContract {
  return ProductContractSchema.parse({
    version: 2,
    entries: [
      {
        name: 'dialog',
        displayName: 'Dialog',
        category: 'overlays',
        artifactKind: 'machine',
        machine: { kind: 'public', importPath: '@llui/components/dialog' },
        copiedArtifacts: [
          {
            name: 'dialog',
            artifactKind: 'skin',
            styling: { baseline: false, registryTailwind: true, styleless: false },
          },
        ],
        styling: { baseline: true, registryTailwind: true, styleless: true },
        presentation: {
          family: 'menus-overlays',
          baseline: styled,
          registryTailwind: styled,
        },
        scenarioId: 'component:dialog',
      },
    ],
    aliases: [],
  })
}

function definitions(input: unknown = { open: true }): PresentationScenarioDefinitions {
  return {
    'component:dialog': {
      defaultCaseId: 'open',
      cases: [
        {
          id: 'open',
          label: 'Open',
          input,
          environmentAxes: ['theme'],
        },
      ],
    },
  } as PresentationScenarioDefinitions
}

function errorFrom(action: () => unknown): PresentationScenarioError {
  try {
    action()
    throw new Error('expected PresentationScenarioError')
  } catch (error) {
    expect(error).toBeInstanceOf(PresentationScenarioError)
    return error as PresentationScenarioError
  }
}

describe('presentation scenario boundary decoding', () => {
  it('rejects mutated inherited hooks without invoking iterator or toJSON behavior', () => {
    const crossRealmInput = runInNewContext(`
      Object.defineProperty(Object.prototype, 'toJSON', {
        configurable: true,
        get() { throw new Error('inherited toJSON executed') }
      })
      Object.defineProperty(Array.prototype, 'entries', {
        configurable: true,
        value() { throw new Error('inherited entries executed') }
      })
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        value() { throw new Error('inherited iterator executed') }
      })
      ;({ message: 'cross-realm', rows: ['Ada', 'Grace'] })
    `) as unknown
    const prototypeLessAxes = ['theme']
    Object.setPrototypeOf(prototypeLessAxes, null)
    const cases = [
      {
        id: 'open',
        label: 'Open',
        input: crossRealmInput,
        environmentAxes: prototypeLessAxes,
      },
    ]
    Object.setPrototypeOf(cases, null)
    const definitions = {
      'component:dialog': { defaultCaseId: 'open', cases },
    }

    const error = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', definitions),
    )
    expect(error).toMatchObject({
      code: 'invalid-definitions',
      issues: [
        '$["component:dialog"].cases[0].input: prototype defines a noncanonical toJSON hook.',
      ],
    })
  })

  it('rejects overridden array protocols, sparse arrays, and accessor entries', () => {
    const cases = [
      {
        id: 'open',
        label: 'Open',
        input: ['visible'],
        environmentAxes: ['theme'],
      },
    ]
    for (const key of ['entries', 'toJSON'] as const) {
      Object.defineProperty(cases, key, {
        enumerable: true,
        get: () => {
          throw new Error(`${key} getter executed`)
        },
      })
    }
    Object.defineProperty(cases, Symbol.iterator, {
      enumerable: true,
      get: () => {
        throw new Error('iterator getter executed')
      },
    })

    const decorated = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', {
        'component:dialog': { defaultCaseId: 'open', cases },
      }),
    )
    expect(decorated.issues).toEqual([
      '$["component:dialog"].cases.entries: non-index array properties are not supported.',
      '$["component:dialog"].cases.toJSON: non-index array properties are not supported.',
      '$["component:dialog"].cases: symbol-keyed properties are not supported.',
    ])

    const sparseCases = new Array(1)
    const sparse = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', {
        'component:dialog': { defaultCaseId: 'open', cases: sparseCases },
      }),
    )
    expect(sparse).toMatchObject({
      code: 'invalid-definitions',
      issues: ['$["component:dialog"].cases[0]: sparse array entries are not supported.'],
    })

    let reads = 0
    const accessorCases: unknown[] = []
    Object.defineProperty(accessorCases, '0', {
      enumerable: true,
      get: () => {
        reads += 1
        return cases[0]
      },
    })
    Object.defineProperty(accessorCases, 'length', { value: 1 })
    const accessor = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', {
        'component:dialog': { defaultCaseId: 'open', cases: accessorCases },
      }),
    )
    expect(accessor.issues).toEqual([
      '$["component:dialog"].cases[0]: accessor properties are not supported.',
    ])
    expect(reads).toBe(0)
  })

  it('rejects mutated inherited array hooks without invoking them', () => {
    const rows = runInNewContext(`
      Object.defineProperty(Array.prototype, 'entries', {
        configurable: true,
        value() { throw new Error('entries executed') }
      })
      Object.defineProperty(Array.prototype, Symbol.iterator, {
        configurable: true,
        value() { throw new Error('iterator executed') }
      })
      ;['Ada', 'Grace']
    `) as unknown
    const error = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', definitions({ rows })),
    )
    expect(error.issues).toEqual([
      '$["component:dialog"].cases[0].input.rows: prototype defines noncanonical array iteration hooks.',
    ])

    for (const mutation of [
      'delete Array.prototype.entries',
      'delete Array.prototype[Symbol.iterator]',
    ]) {
      const missingHookRows = runInNewContext(`${mutation}; ['Ada', 'Grace']`) as unknown
      const missingHookError = errorFrom(() =>
        decodeScenarioFamily(
          productContract(),
          'menus-overlays',
          definitions({ rows: missingHookRows }),
        ),
      )
      expect(missingHookError.issues).toEqual([
        '$["component:dialog"].cases[0].input.rows: prototype defines noncanonical array iteration hooks.',
      ])
    }
  })

  it('accepts cross-realm and null-prototype records but rejects custom prototypes', () => {
    const crossRealmDefinitions = runInNewContext(`({
      'component:dialog': {
        defaultCaseId: 'open',
        cases: [{
          id: 'open',
          label: 'Open',
          input: Object.assign(Object.create(null), { open: true }),
          environmentAxes: []
        }]
      }
    })`) as PresentationScenarioDefinitions
    expect(
      decodeScenarioFamily(productContract(), 'menus-overlays', crossRealmDefinitions).scenarios[0]!
        .cases[0]!.input,
    ).toEqual({ open: true })

    const custom = Object.create({ inherited: true }) as Record<string, unknown>
    custom['open'] = true
    const error = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', definitions(custom)),
    )
    expect(error.issues).toEqual(['$["component:dialog"].cases[0].input: must be a plain object.'])

    const rows = ['Ada', 'Grace']
    Object.setPrototypeOf(rows, null)
    expect(
      decodeScenarioFamily(productContract(), 'menus-overlays', definitions({ rows })).scenarios[0]!
        .cases[0]!.input,
    ).toEqual({ rows: ['Ada', 'Grace'] })
  })

  it('rejects hidden, symbol, and decorated JSON state without reading hooks', () => {
    let reads = 0
    const input = { visible: true }
    Object.defineProperties(input, {
      hidden: { value: 'ignored', enumerable: false },
      dynamic: {
        enumerable: false,
        get: () => {
          reads += 1
          return 'ignored'
        },
      },
    })
    Object.defineProperty(input, Symbol('metadata'), {
      value: 'ignored',
      enumerable: true,
    })
    const rows = ['Ada']
    Object.defineProperty(rows, 'metadata', {
      enumerable: true,
      get: () => {
        reads += 1
        return 'ignored'
      },
    })
    ;(input as Record<string, unknown>)['rows'] = rows

    const dataError = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', definitions(input)),
    )
    expect(dataError.issues).toEqual([
      '$["component:dialog"].cases[0].input.dynamic: non-enumerable properties are not supported.',
      '$["component:dialog"].cases[0].input.hidden: non-enumerable properties are not supported.',
      '$["component:dialog"].cases[0].input.rows.metadata: non-index array properties are not supported.',
      '$["component:dialog"].cases[0].input: symbol-keyed properties are not supported.',
    ])
    expect(reads).toBe(0)

    let toJsonReads = 0
    const ownToJson = { visible: true }
    Object.defineProperty(ownToJson, 'toJSON', {
      enumerable: true,
      get: () => {
        toJsonReads += 1
        return () => ({ replaced: true })
      },
    })
    const error = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', definitions(ownToJson)),
    )
    expect(error.issues).toEqual([
      '$["component:dialog"].cases[0].input.toJSON: accessor properties are not supported.',
    ])
    expect(toJsonReads).toBe(0)
  })

  it('strictly decodes definition, catalog, and selection protocol fields without getters', () => {
    let reads = 0
    const invalidDefinition = {
      defaultCaseId: 'open',
      cases: definitions()['component:dialog']!.cases,
      metadata: 'not serialized by the protocol',
    }
    Object.defineProperty(invalidDefinition, 'defaultCaseId', {
      enumerable: true,
      get: () => {
        reads += 1
        return 'open'
      },
    })
    const definitionError = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', {
        'component:dialog': invalidDefinition,
      }),
    )
    expect(definitionError.issues).toEqual([
      '$["component:dialog"].defaultCaseId: accessor properties are not supported.',
      '$["component:dialog"].metadata: unexpected field.',
    ])

    const catalog = decodeScenarioFamily(productContract(), 'menus-overlays', definitions())
    const invalidCatalog = { ...catalog, metadata: true }
    Object.defineProperty(invalidCatalog, 'family', {
      enumerable: true,
      get: () => {
        reads += 1
        return 'menus-overlays'
      },
    })
    const catalogError = errorFrom(() =>
      decodeScenarioSelection(productContract(), invalidCatalog, {
        productId: 'dialog',
        path: 'baseline',
      }),
    )
    expect(catalogError).toMatchObject({
      code: 'invalid-catalog',
      issues: ['$.family: accessor properties are not supported.', '$.metadata: unexpected field.'],
    })

    const selection = { productId: 'dialog', path: 'baseline', metadata: true }
    Object.defineProperty(selection, 'productId', {
      enumerable: true,
      get: () => {
        reads += 1
        return 'dialog'
      },
    })
    const selectionError = errorFrom(() =>
      decodeScenarioSelection(productContract(), catalog, selection),
    )
    expect(selectionError).toMatchObject({
      code: 'invalid-selection',
      issues: [
        '$.metadata: unexpected field.',
        '$.productId: accessor properties are not supported.',
      ],
    })
    expect(reads).toBe(0)
  })

  it.each([
    ['definitions', null, 'invalid-definitions', '$: must be a plain object.'],
    ['definitions', [], 'invalid-definitions', '$: must be a plain object.'],
    ['definitions', 'wrong', 'invalid-definitions', '$: must be a plain object.'],
  ])('totally rejects malformed %s roots', (_name, value, code, issue) => {
    const error = errorFrom(() => decodeScenarioFamily(productContract(), 'menus-overlays', value))
    expect(error).toMatchObject({ code, issues: [issue] })
  })

  it.each([
    ['null catalog', null, 'invalid-catalog', '$: must be a plain object.'],
    ['array catalog', [], 'invalid-catalog', '$: must be a plain object.'],
    ['primitive catalog', 1, 'invalid-catalog', '$: must be a plain object.'],
    [
      'missing catalog fields',
      {},
      'invalid-catalog',
      '$.family: required field is missing.\n$.scenarios: required field is missing.\n$.version: required field is missing.',
    ],
  ])('totally rejects a %s', (_name, catalog, code, message) => {
    const error = errorFrom(() =>
      decodeScenarioSelection(productContract(), catalog, {
        productId: 'dialog',
        path: 'baseline',
      }),
    )
    expect(error.code).toBe(code)
    expect(error.message).toBe(message)
  })

  it.each([
    ['null selection', null, '$: must be a plain object.'],
    ['array selection', [], '$: must be a plain object.'],
    ['primitive selection', false, '$: must be a plain object.'],
    [
      'missing selection fields',
      {},
      '$.path: required field is missing.\n$.productId: required field is missing.',
    ],
  ])('totally rejects a %s', (_name, selection, message) => {
    const catalog = decodeScenarioFamily(productContract(), 'menus-overlays', definitions())
    const error = errorFrom(() => decodeScenarioSelection(productContract(), catalog, selection))
    expect(error.code).toBe('invalid-selection')
    expect(error.message).toBe(message)
  })

  it('rejects wrong nested protocol primitives and metadata at their exact paths', () => {
    const definitionError = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', {
        'component:dialog': { defaultCaseId: 1, cases: null },
      }),
    )
    expect(definitionError.issues).toEqual([
      '$["component:dialog"].cases: must be an array.',
      '$["component:dialog"].defaultCaseId: must be a string.',
    ])

    const catalog = JSON.parse(
      JSON.stringify(decodeScenarioFamily(productContract(), 'menus-overlays', definitions())),
    ) as Record<string, unknown>
    const scenarios = catalog['scenarios'] as Record<string, unknown>[]
    scenarios[0]!['metadata'] = []
    scenarios[0]!['cases'] = [{ id: 'open', label: 1, input: null, environmentAxes: null }]
    const catalogError = errorFrom(() =>
      decodeScenarioSelection(productContract(), catalog, {
        productId: 'dialog',
        path: 'baseline',
      }),
    )
    expect(catalogError).toMatchObject({
      code: 'invalid-catalog',
      issues: [
        '$.scenarios[0].cases[0].environmentAxes: must be an array.',
        '$.scenarios[0].cases[0].label: must be a string.',
        '$.scenarios[0].metadata: unexpected field.',
      ],
    })

    const selectionError = errorFrom(() =>
      decodeScenarioSelection(
        productContract(),
        decodeScenarioFamily(productContract(), 'menus-overlays', definitions()),
        { productId: [], path: null, environment: [] },
      ),
    )
    expect(selectionError).toMatchObject({
      code: 'invalid-selection',
      issues: [
        '$.environment: must be a plain object.',
        '$.path: must be a string.',
        '$.productId: must be a string.',
      ],
    })
  })

  it('rejects extra source-case fields without reading their values', () => {
    let rendererReads = 0
    const scenarioCase = {
      id: 'open',
      label: 'Open',
      input: { open: true },
      environmentAxes: ['theme'],
    }
    Object.defineProperty(scenarioCase, 'renderer', {
      enumerable: true,
      get: () => {
        rendererReads += 1
        return () => 'family renderer'
      },
    })
    const descriptorReads = new Map<PropertyKey, number>()
    const rawDefinitions = {
      'component:dialog': {
        defaultCaseId: 'open',
        cases: [scenarioCase],
      },
    }
    const proxiedDefinitions = new Proxy(rawDefinitions, {
      getOwnPropertyDescriptor(target, key) {
        descriptorReads.set(key, (descriptorReads.get(key) ?? 0) + 1)
        return Reflect.getOwnPropertyDescriptor(target, key)
      },
    })

    const error = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', proxiedDefinitions),
    )
    expect(descriptorReads.get('component:dialog')).toBe(1)
    expect(rendererReads).toBe(0)
    expect(error).toMatchObject({
      code: 'invalid-definitions',
      issues: ['$["component:dialog"].cases[0].renderer: unexpected field.'],
    })
  })

  it('rejects an excess case field at runtime even when the caller widened its static type to hide it (#270 finding 4, round two)', () => {
    // Two of the compile-time exactness check's known, documented gaps (see
    // test/presentation-scenarios-types.ts): widening a value to PresentationScenarioCase, or
    // smuggling it through a union-typed cases array, both make an excess field statically
    // invisible. Neither gap exists at the RUNTIME boundary — `decodeCase`'s `exactFields` check
    // reads the value's OWN keys directly, regardless of what static type the caller's code gave
    // it, so this is the backstop for both.
    const rawCase: Record<string, unknown> = {
      id: 'open',
      label: 'Open',
      input: null,
      environmentAxes: [],
      render: () => 'x',
    }
    // Simulates the TYPE-level widening from the pinned gap: nothing here is const-checked or
    // literal-narrowed, matching what a value looks like after `const widened:
    // PresentationScenarioCase = raw` at the type level.
    const widenedShapeCase: unknown = rawCase

    const error = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', {
        'component:dialog': { defaultCaseId: 'open', cases: [widenedShapeCase] },
      }),
    )

    expect(error).toMatchObject({
      code: 'invalid-definitions',
      issues: ['$["component:dialog"].cases[0].render: unexpected field.'],
    })
  })

  it('returns typed deterministic limit failures instead of native recursion errors', () => {
    let deep: Record<string, unknown> = { leaf: true }
    for (let index = 0; index < 66; index += 1) deep = { child: deep }
    const depthError = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', definitions(deep)),
    )
    expect(depthError.code).toBe('invalid-definitions')
    expect(depthError.issues).toHaveLength(1)
    expect(depthError.issues[0]).toContain('depth limit of 64 exceeded')

    const arrayError = errorFrom(() =>
      decodeScenarioFamily(
        productContract(),
        'menus-overlays',
        definitions(
          Array.from(
            { length: PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.arrayLength + 1 },
            () => null,
          ),
        ),
      ),
    )
    expect(arrayError.issues).toContain(
      `$["component:dialog"].cases[0].input.length: array length limit of ${PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.arrayLength} exceeded.`,
    )

    const stringError = errorFrom(() =>
      decodeScenarioFamily(
        productContract(),
        'menus-overlays',
        definitions('x'.repeat(PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.stringLength + 1)),
      ),
    )
    expect(stringError.issues).toContain(
      `$["component:dialog"].cases[0].input: string length limit of ${PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.stringLength} exceeded.`,
    )

    const manyNodes: Record<string, number> = {}
    for (
      let index = 0;
      index < PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.familyNodes + 1;
      index += 1
    ) {
      manyNodes[`node${index}`] = index
    }
    const nodeError = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', definitions(manyNodes)),
    )
    expect(nodeError.code).toBe('invalid-definitions')
    expect(
      nodeError.issues.some((issue) =>
        issue.includes(
          `node limit of ${PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.familyNodes} exceeded`,
        ),
      ),
    ).toBe(true)

    const stringUnitsPerField = 100_000
    const fieldsToExceedStringBudget =
      Math.ceil(PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.familyStringUnits / stringUnitsPerField) + 1
    const totalStrings = Array.from({ length: fieldsToExceedStringBudget }, (_, index) => ({
      [`value${index}`]: 'x'.repeat(stringUnitsPerField),
    }))
    const stringBudgetError = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', definitions(totalStrings)),
    )
    expect(
      stringBudgetError.issues.some((issue) =>
        issue.includes(
          `total string-unit limit of ${PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.familyStringUnits} exceeded`,
        ),
      ),
    ).toBe(true)

    const manyFields: Record<string, null> = {}
    for (
      let index = 0;
      index < PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.familyFields + 1;
      index += 1
    ) {
      manyFields[`field${index}`] = null
    }
    const fieldBudgetError = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', definitions(manyFields)),
    )
    expect(
      fieldBudgetError.issues.some((issue) =>
        issue.includes(
          `aggregate object-field limit of ${PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.familyFields} exceeded`,
        ),
      ),
    ).toBe(true)

    const overlongKeyInput = Object.create(null) as Record<string, null>
    overlongKeyInput['x'.repeat(100_001)] = null
    const propertyNameError = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', definitions(overlongKeyInput)),
    )
    expect(propertyNameError.issues).toEqual([
      '$["component:dialog"].cases[0].input: property-name length limit of 100000 exceeded.',
    ])
    expect(propertyNameError.message.length).toBeLessThan(1_000)
  })

  it('bounds structural-decoder diagnostics deterministically', () => {
    const scenarioCase: Record<string, unknown> = {
      id: 'open',
      label: 'Open',
      input: null,
      environmentAxes: [],
    }
    for (let index = 0; index < 250; index += 1) {
      scenarioCase[`metadata${index}`] = index
    }
    const invalidDefinitions = {
      'component:dialog': { defaultCaseId: 'open', cases: [scenarioCase] },
    }
    const first = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', invalidDefinitions),
    )
    const second = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', invalidDefinitions),
    )

    expectBoundedDiagnostics(first, 'invalid-definitions')
    expect(second.issues).toEqual(first.issues)
  })

  it('bounds case-semantic diagnostics from a maximum-size array', () => {
    const environmentAxes = Array.from({ length: 1_000 }, (_, index) => `axis-${index}`)
    const invalidDefinitions = {
      'component:dialog': {
        defaultCaseId: 'open',
        cases: [{ id: 'open', label: 'Open', input: null, environmentAxes }],
      },
    }
    const error = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', invalidDefinitions),
    )

    expectBoundedDiagnostics(error, 'invalid-definitions')
  })

  it('bounds catalog-integrity diagnostics independently of decoding', () => {
    const catalog = decodeScenarioFamily(productContract(), 'menus-overlays', definitions())
    const invalidCatalog = {
      ...catalog,
      scenarios: Array.from({ length: 300 }, () => catalog.scenarios[0]!),
    }
    const error = errorFrom(() =>
      decodeScenarioSelection(productContract(), invalidCatalog, {
        productId: 'dialog',
        path: 'baseline',
      }),
    )

    expectBoundedDiagnostics(error, 'invalid-catalog')
  })

  it('bounds resolver-selection decoding independently of environment semantics', () => {
    const catalog = decodeScenarioFamily(productContract(), 'menus-overlays', definitions())
    const selection: Record<string, unknown> = { productId: 'dialog', path: 'baseline' }
    for (let index = 0; index < 250; index += 1) selection[`metadata${index}`] = index
    const error = errorFrom(() => decodeScenarioSelection(productContract(), catalog, selection))

    expectBoundedDiagnostics(error, 'invalid-selection')
  })

  it('bounds resolver environment diagnostics independently of selection decoding', () => {
    const catalog = decodeScenarioFamily(productContract(), 'menus-overlays', definitions())
    const environment = Object.fromEntries(
      Array.from({ length: 500 }, (_, index) => [`axis${index}`, 'unknown']),
    )
    const error = errorFrom(() =>
      decodeScenarioSelection(productContract(), catalog, {
        productId: 'dialog',
        path: 'baseline',
        environment,
      }),
    )

    expectBoundedDiagnostics(error, 'invalid-environment')
  })

  it('clips one oversized diagnostic path instead of collapsing the whole report to the truncation marker (#270)', () => {
    const longScenarioId = `stale-${'x'.repeat(20_000)}`
    const definition = definitions()['component:dialog']!
    const invalidDefinitions = {
      'component:dialog': definition,
      [longScenarioId]: definition,
    }
    const first = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', invalidDefinitions),
    )
    const second = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', invalidDefinitions),
    )

    // The first (and only) issue survives with its clipped, marked path — it does NOT collapse
    // to the pathless truncation marker, which is the bad behaviour this replaces.
    expect(first.code).toBe('invalid-definitions')
    expect(first.issues).toHaveLength(1)
    expect(first.issues[0]).not.toContain('diagnostics truncated')
    expect(first.issues[0]).toMatch(/^\$\["stale-x*…\(\d+\): stale definition for /)
    expect(first.issues[0]).toContain('stale definition for presentation family "menus-overlays"')
    expect(first.issues[0]!.length).toBeLessThan(500)
    expect(first.message.length).toBeLessThanOrEqual(
      PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS.messageUnits,
    )
    // Deterministic: the elision marker encodes the ORIGINAL (pre-clip) length, so replaying the
    // same oversized input renders byte-identical clipped output.
    expect(second.issues).toEqual(first.issues)
  })

  it('still survives many oversized issues together, each clipped, up to the issue-count cap', () => {
    const definitions: Record<string, unknown> = {}
    for (let index = 0; index < PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS.issues + 20; index += 1) {
      definitions[`stale-${index}-${'y'.repeat(6_000)}`] = {
        defaultCaseId: 'open',
        cases: [{ id: 'open', label: 'Open', input: null, environmentAxes: [] }],
      }
    }

    const error = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', {
        'component:dialog': definitions['component:dialog'] ?? {
          defaultCaseId: 'open',
          cases: [{ id: 'open', label: 'Open', input: { open: true }, environmentAxes: ['theme'] }],
        },
        ...definitions,
      }),
    )

    // Each issue's own oversized path is bounded by the PER-ISSUE clip, so many of them coexist
    // (rather than the first oversized issue alone exhausting the whole aggregate budget) before
    // the aggregate budget's own truncation marker finally applies.
    expect(error.code).toBe('invalid-definitions')
    expect(error.issues.length).toBeGreaterThan(1)
    expect(error.issues.length).toBeLessThanOrEqual(PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS.issues)
    expect(error.message.length).toBeLessThanOrEqual(
      PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS.messageUnits,
    )
    const truncationMarkers = error.issues.filter((issue) =>
      issue.includes('diagnostics truncated'),
    )
    expect(truncationMarkers).toHaveLength(1)
    // Every SURVIVING issue (i.e. every one but the truncation marker — `issues` is sorted, so
    // it is not necessarily last) still names its own stale key, clipped — none of them were
    // swallowed by any one oversized sibling.
    for (const issue of error.issues) {
      if (issue.includes('diagnostics truncated')) continue
      expect(issue).toMatch(/^\$\["stale-\d+-y*…\(\d+\): stale definition for /)
    }
  })

  it('elides MIDDLE path segments, never the leaf, so issues that differ only in their leaf stay distinguishable (#270 finding 3, round two)', () => {
    // 8 levels of long-but-not-individually-oversized keys, ending in three distinct bad leaves.
    // A plain head-keep/tail-cut clip would show the same long shared prefix for every issue and
    // cut off before ever reaching the part that differs (which leaf is bad) — collapsing badA
    // and badB to byte-identical, useless issues.
    const leaf: Record<string, unknown> = {
      good: 1,
      badA: () => 0,
      badB: () => 0,
    }
    let value: unknown = leaf
    for (let index = 0; index < 8; index += 1) {
      value = { [`section-with-a-long-descriptive-name-${index}`]: value }
    }

    const error = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', definitions(value)),
    )

    expect(error.code).toBe('invalid-definitions')
    const badAIssue = error.issues.find((issue) =>
      issue.endsWith('.badA: function values are not JSON-safe.'),
    )
    const badBIssue = error.issues.find((issue) =>
      issue.endsWith('.badB: function values are not JSON-safe.'),
    )
    expect(badAIssue).toBeDefined()
    expect(badBIssue).toBeDefined()
    // Distinguishable: the two issues are NOT identical once their (common) prefix is clipped —
    // the OLD head-keep/tail-cut design made them byte-identical.
    expect(badAIssue).not.toBe(badBIssue)
    // The leaf itself survives fully (never itself elided or truncated away).
    expect(badAIssue).toMatch(/\.badA: function values are not JSON-safe\.$/)
    expect(badBIssue).toMatch(/\.badB: function values are not JSON-safe\.$/)
    // The root is always preserved.
    expect(badAIssue).toMatch(/^\$/)
    expect(badBIssue).toMatch(/^\$/)
    // Deterministic: replaying the same oversized input renders byte-identical clipped issues.
    const replay = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', definitions(value)),
    )
    expect(replay.issues).toEqual(error.issues)
  })

  it('types throwing, mutating, and huge proxy reflection as bounded boundary errors', () => {
    const throwing = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('ownKeys trap')
        },
      },
    )
    expect(
      errorFrom(() => decodeScenarioFamily(productContract(), 'menus-overlays', throwing)),
    ).toMatchObject({
      code: 'invalid-definitions',
      issues: ['$: value could not be inspected safely.'],
    })

    const mutatingTarget = definitions() as Record<string, unknown>
    const mutating = new Proxy(mutatingTarget, {
      ownKeys(target) {
        const keys = Reflect.ownKeys(target)
        delete target['component:dialog']
        return keys
      },
    })
    expect(
      errorFrom(() => decodeScenarioFamily(productContract(), 'menus-overlays', mutating)),
    ).toMatchObject({
      code: 'invalid-definitions',
      issues: ['$: own properties changed while being inspected.'],
    })

    let descriptorReads = 0
    const hugeKeyCount = PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.familyFields + 1
    const huge = new Proxy(
      {},
      {
        ownKeys() {
          return Array.from({ length: hugeKeyCount }, (_, index) => `key${index}`)
        },
        getOwnPropertyDescriptor() {
          descriptorReads += 1
          return { configurable: true, enumerable: true, value: null }
        },
      },
    )
    const hugeError = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', huge),
    )
    expect(hugeError).toMatchObject({
      code: 'invalid-definitions',
      issues: [
        `$: aggregate object-field limit of ${PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.familyFields} exceeded.`,
      ],
    })
    expect(hugeError.message.length).toBeLessThan(1_000)
    expect(descriptorReads).toBe(0)
  })

  it('deep-freezes constants, catalogs, resolver snapshots, and error diagnostics', () => {
    const source = { nested: { labels: ['Ada', 'Grace'] } }
    const sourceDefinitions = definitions(source) as unknown as {
      'component:dialog': { cases: { copiedArtifactNames?: string[] }[] }
    }
    sourceDefinitions['component:dialog'].cases[0]!.copiedArtifactNames = ['dialog']
    const catalog = decodeScenarioFamily(productContract(), 'menus-overlays', sourceDefinitions)
    const scenarioCase = catalog.scenarios[0]!.cases[0]!
    source.nested.labels.push('source mutation')

    expect(Object.isFrozen(PRESENTATION_SCENARIO_ENVIRONMENT_VALUES)).toBe(true)
    expect(Object.isFrozen(PRESENTATION_SCENARIO_ENVIRONMENT_VALUES.theme)).toBe(true)
    expect(Object.isFrozen(DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT)).toBe(true)
    expect(Object.isFrozen(PRESENTATION_SCENARIO_PATHS)).toBe(true)
    expect(PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS).toEqual({
      issues: 100,
      messageUnits: 16_384,
    })
    expect(Object.isFrozen(PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS)).toBe(true)
    expect(() =>
      (PRESENTATION_SCENARIO_ENVIRONMENT_VALUES.theme as unknown as string[]).push('sepia'),
    ).toThrow(TypeError)
    expect(() => {
      ;(DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT as { theme: string }).theme = 'dark'
    }).toThrow(TypeError)
    expect(() => {
      ;(PRESENTATION_SCENARIO_PATHS as unknown as string[])[0] = 'mutation'
    }).toThrow(TypeError)
    expect(PRESENTATION_SCENARIO_ENVIRONMENT_VALUES.theme).toEqual(['light', 'dark'])
    expect(DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT.theme).toBe('light')
    expect(PRESENTATION_SCENARIO_PATHS).toEqual(['baseline', 'registryTailwind'])
    expect(Object.isFrozen(catalog)).toBe(true)
    expect(Object.isFrozen(catalog.scenarios)).toBe(true)
    expect(Object.isFrozen(scenarioCase)).toBe(true)
    expect(Object.isFrozen(scenarioCase.environmentAxes)).toBe(true)
    expect(Object.isFrozen(scenarioCase.copiedArtifactNames)).toBe(true)
    expect(Object.isFrozen(scenarioCase.input)).toBe(true)
    expect(Object.isFrozen((scenarioCase.input as { nested: object }).nested)).toBe(true)
    expect(() =>
      (scenarioCase.input as { nested: { labels: string[] } }).nested.labels.push('mutation'),
    ).toThrow(TypeError)
    expect(() => (catalog.scenarios as unknown as object[]).push({})).toThrow(TypeError)
    expect((scenarioCase.input as { nested: { labels: string[] } }).nested.labels).toEqual([
      'Ada',
      'Grace',
    ])

    const serialized = JSON.parse(JSON.stringify(catalog)) as CompiledPresentationScenarioFamily
    const baseline = decodeScenarioSelection(productContract(), serialized, {
      productId: 'dialog',
      path: 'baseline',
    })
    const registry = decodeScenarioSelection(productContract(), serialized, {
      productId: 'dialog',
      path: 'registryTailwind',
    })
    expect(baseline.case).not.toBe(registry.case)
    expect(baseline.case.input).not.toBe(registry.case.input)
    expect(Object.isFrozen(baseline)).toBe(true)
    expect(Object.isFrozen(baseline.environment)).toBe(true)
    expect(Object.isFrozen(registry.copiedArtifact)).toBe(true)
    expect(() =>
      (baseline.case.input as { nested: { labels: string[] } }).nested.labels.push('leak'),
    ).toThrow(TypeError)
    expect((registry.case.input as { nested: { labels: string[] } }).nested.labels).toEqual([
      'Ada',
      'Grace',
    ])
    expect(() => (registry.case.environmentAxes as unknown as string[]).push('motion')).toThrow(
      TypeError,
    )
    expect(baseline.case.environmentAxes).toEqual(['theme'])
    expect(() => {
      ;(registry.environment as { theme: string }).theme = 'dark'
    }).toThrow(TypeError)
    expect(baseline.environment.theme).toBe('light')
    expect(() => {
      ;(registry.copiedArtifact as { name: string }).name = 'mutation'
    }).toThrow(TypeError)
    expect(registry.copiedArtifact?.name).toBe('dialog')
    ;(
      serialized.scenarios[0]!.cases[0]!.input as { nested: { labels: string[] } }
    ).nested.labels.push('serialized mutation')
    expect((baseline.case.input as { nested: { labels: string[] } }).nested.labels).toEqual([
      'Ada',
      'Grace',
    ])

    const mutableSelection = {
      productId: 'dialog',
      path: 'baseline' as const,
      environment: { theme: 'dark' as const },
    }
    const selected = decodeScenarioSelection(productContract(), catalog, mutableSelection)
    ;(mutableSelection.environment as { theme: string }).theme = 'light'
    expect(selected.environment.theme).toBe('dark')

    const issues = ['$.z: last.', '$.a: first.']
    const protocolError = new PresentationScenarioError('invalid-selection', issues)
    issues.push('$.mutation: leak.')
    expect(protocolError.issues).toEqual(['$.a: first.', '$.z: last.'])
    expect(Object.isFrozen(protocolError.issues)).toBe(true)
    expect(() => (protocolError.issues as string[]).push('mutation')).toThrow(TypeError)
  })

  it('rejects a requested family with no ProductContract entries', () => {
    const error = errorFrom(() => decodeScenarioFamily(productContract(), 'forms-controls', {}))
    expect(error).toMatchObject({
      code: 'invalid-definitions',
      issues: [
        '$.family: ProductContract has no entries for presentation family "forms-controls".',
      ],
    })
  })

  it('makes every successful compiled variant survive serialized decode and integrity unchanged', () => {
    for (let index = 0; index < 24; index += 1) {
      const input = {
        index,
        active: index % 2 === 0,
        labels: Array.from({ length: index % 5 }, (_, labelIndex) => `label-${labelIndex}`),
      }
      const catalog = decodeScenarioFamily(productContract(), 'menus-overlays', definitions(input))
      const serialized = JSON.parse(JSON.stringify(catalog)) as typeof catalog
      expect(serialized).toEqual(catalog)
      expect(
        decodeScenarioSelection(productContract(), serialized, {
          productId: 'dialog',
          caseId: 'open',
          path: 'baseline',
        }).case.input,
      ).toEqual(input)
    }
  })
})

describe('one cost model governs compileScenarioFamily and every catalog derived from it (#270)', () => {
  // root(1) + definition overhead(record 1 + defaultCaseId 1 + cases-array-header 1 = 3) +
  // case overhead(record 1 + id 1 + label 1 = 3) + environmentAxes ['theme'] (header 1 + item
  // 1 = 2) + the input object's own node (1)
  const FIXED_DECODE_OVERHEAD_NODES = 10

  function flatInputAtNodeCount(totalNodes: number): Record<string, null> {
    const fieldCount = totalNodes - FIXED_DECODE_OVERHEAD_NODES
    const input: Record<string, null> = {}
    for (let index = 0; index < fieldCount; index += 1) input[`field${index}`] = null
    return input
  }

  it('succeeds for a family definitions payload landing exactly at the family node budget, and it does not re-decode its own rebuilt catalog under a fresh budget', () => {
    const input = flatInputAtNodeCount(PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.familyNodes)

    const catalog = decodeScenarioFamily(productContract(), 'menus-overlays', definitions(input))

    expect(catalog.scenarios[0]!.cases[0]!.input).toEqual(input)
  })

  it('rejects a family definitions payload exactly one node past the family budget, citing the caller-written path', () => {
    const input = flatInputAtNodeCount(PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.familyNodes + 1)

    const error = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', definitions(input)),
    )

    expect(error.code).toBe('invalid-definitions')
    expect(error.issues).toHaveLength(1)
    // A caller-written path: somewhere under the case the caller actually authored, never a
    // rebuilt-structure path like `$.scenarios[0]...` that only compiledCatalog's internals know.
    expect(error.issues[0]).toMatch(/^\$\["component:dialog"\]\.cases\[0\]\./)
    expect(error.issues[0]).toContain('node limit of')
    expect(error.issues[0]).not.toMatch(/^\$\.scenarios/)
  })

  it('a catalog compiled exactly at the family budget survives a JSON round trip AND a structuredClone through decodeScenarioSelection (#270 finding 1, round two)', () => {
    // A catalog adds scaffolding (version/family/productId/scenarioId) beyond what the raw
    // definitions payload contained. Before the fix, decodeCatalog charged that scaffolding
    // against a FRESH copy of the SAME budget, so a definitions payload landing exactly at the
    // limit compiled successfully but its own compiled catalog failed to re-decode — an
    // untrusted/serialized copy of a catalog `compileScenarioFamily` had JUST produced was
    // rejected with an internal `$.scenarios[...]` path the caller never wrote. One cost model
    // (`decodeCatalog` reserves the EXACT scaffolding overhead once it knows the real scenario
    // count) is what makes this invariant hold at any size, not merely for a small family.
    const input = flatInputAtNodeCount(PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.familyNodes)
    const contract = productContract()
    const catalog = decodeScenarioFamily(contract, 'menus-overlays', definitions(input))
    const selection = { productId: 'dialog', path: 'baseline' as const }

    const serialized = JSON.parse(JSON.stringify(catalog)) as unknown
    const viaJson = decodeScenarioSelection(contract, serialized, selection)
    expect(viaJson.case.input).toEqual(input)

    const cloned = structuredClone(catalog)
    const viaStructuredClone = decodeScenarioSelection(contract, cloned, selection)
    expect(viaStructuredClone.case.input).toEqual(input)
  })
})

describe('array decoding cost is bounded by real own-key count, never by a claimed length (#270 finding 2)', () => {
  it('rejects a shared, fully sparse array in O(1) reflection calls per occurrence, not O(length)', () => {
    // A sparse array referenced from MANY places (a shared reference, not copies) used to cost
    // `length` reflection work at EVERY occurrence — a naive per-index scan from 0 to `length`
    // regardless of how few real own keys actually exist. Counting `ownKeys`/
    // `getOwnPropertyDescriptor` TRAP invocations (never a wall-clock measurement) proves the
    // decoder no longer pays that cost: with the fix, detecting the array is sparse takes a
    // small, FIXED number of reflection calls per occurrence (it walks only the array's real own
    // keys — just `length` here, since the array is fully empty — never its claimed length),
    // regardless of how large `length` claims to be or how many places reference it.
    let ownKeysCalls = 0
    let descriptorCalls = 0
    const sparseTarget = new Array(PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.arrayLength)
    const sparse = new Proxy(sparseTarget, {
      ownKeys(target) {
        ownKeysCalls += 1
        return Reflect.ownKeys(target)
      },
      getOwnPropertyDescriptor(target, key) {
        descriptorCalls += 1
        return Reflect.getOwnPropertyDescriptor(target, key)
      },
    })
    const occurrences = 50
    const row = new Array(occurrences).fill(sparse)

    const error = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', definitions(row)),
    )

    expect(error.code).toBe('invalid-definitions')
    expect(
      error.issues.some((issue) => issue.includes('sparse array entries are not supported')),
    ).toBe(true)
    // Fixed, small per-occurrence cost (a handful of reflection calls each) — nowhere near
    // `occurrences * arrayLength`, which is what the OLD, unbounded per-index scan would cost
    // (50 * 2000 = 100,000 just for this one array's real content, before even counting the
    // 50 outer-row element visits).
    const maxCallsPerOccurrence = 6
    expect(ownKeysCalls).toBeLessThanOrEqual(occurrences * maxCallsPerOccurrence)
    expect(descriptorCalls).toBeLessThanOrEqual(occurrences * maxCallsPerOccurrence)
  })

  it('rejects an over-long array before ever enumerating its keys', () => {
    // A dense array far past the length limit used to be enumerated in full (Reflect.ownKeys,
    // O(length)) BEFORE the length check ever ran. Proving `ownKeys` is never called at all
    // (rather than timing a real 10-million-element array) is both faster to run and a more
    // direct proof that the length check now runs first.
    let ownKeysCalls = 0
    const overLong = new Proxy([] as unknown[], {
      ownKeys(target) {
        ownKeysCalls += 1
        return Reflect.ownKeys(target)
      },
      getOwnPropertyDescriptor(target, key) {
        if (key === 'length') {
          return {
            value: PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.arrayLength + 1,
            writable: true,
            enumerable: false,
            configurable: false,
          }
        }
        return Reflect.getOwnPropertyDescriptor(target, key)
      },
    })

    const error = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', definitions(overLong)),
    )

    expect(error.code).toBe('invalid-definitions')
    expect(error.issues).toEqual([
      `$["component:dialog"].cases[0].input.length: array length limit of ${PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.arrayLength} exceeded.`,
    ])
    expect(ownKeysCalls).toBe(0)
  })
})

function manyProductsContract(count: number): ProductContract {
  return ProductContractSchema.parse({
    version: 2,
    entries: Array.from({ length: count }, (_, index) => ({
      name: `product-${index}`,
      displayName: `Product ${index}`,
      category: 'overlays',
      artifactKind: 'machine',
      machine: { kind: 'public', importPath: `@llui/components/product-${index}` },
      copiedArtifacts: [
        {
          name: `product-${index}`,
          artifactKind: 'skin',
          styling: { baseline: false, registryTailwind: true, styleless: false },
        },
      ],
      styling: { baseline: true, registryTailwind: true, styleless: true },
      presentation: { family: 'menus-overlays', baseline: styled, registryTailwind: styled },
      scenarioId: `component:product-${index}`,
    })),
    aliases: [],
  })
}

function rowInput(rows: number): { rows: readonly { id: string; label: string; value: number }[] } {
  return {
    rows: Array.from({ length: rows }, (_, index) => ({
      id: `row-${index}`,
      label: `Row ${index}`,
      value: index,
    })),
  }
}

function manyCaseDefinitions(
  productCount: number,
  casesPerProduct: number,
  rowsPerCase: number,
): PresentationScenarioDefinitions {
  const entries: Record<string, PresentationScenarioDefinitions[string]> = {}
  for (let product = 0; product < productCount; product += 1) {
    const cases = Array.from({ length: casesPerProduct }, (_, caseIndex) => ({
      id: `case-${caseIndex}`,
      label: `Case ${caseIndex}`,
      input: rowInput(rowsPerCase),
      environmentAxes: [],
    }))
    entries[`component:product-${product}`] = { defaultCaseId: 'case-0', cases }
  }
  return entries
}

describe('complexity limits scale with realistic family inventory (#270)', () => {
  it('compiles a realistic 30-product x 5-case x 20-row family the old flat 5,000-node cap rejected', () => {
    const contract = manyProductsContract(30)
    const definitions = manyCaseDefinitions(30, 5, 20)

    const catalog = decodeScenarioFamily(contract, 'menus-overlays', definitions)

    expect(catalog.scenarios).toHaveLength(30)
    expect(catalog.scenarios[0]!.cases).toHaveLength(5)
    expect(catalog.scenarios[29]!.cases[4]!.input).toEqual(rowInput(20))
  })

  it('rejects an adversarial many-product family that exceeds the scaled family node budget, with a bounded, path-qualified diagnostic', () => {
    const productCount = 80
    const casesPerProduct = 12
    const rowsPerCase = 100
    const contract = manyProductsContract(productCount)
    const definitions = manyCaseDefinitions(productCount, casesPerProduct, rowsPerCase)

    const error = errorFrom(() => decodeScenarioFamily(contract, 'menus-overlays', definitions))

    expect(error.code).toBe('invalid-definitions')
    expect(error.issues.length).toBeLessThanOrEqual(PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS.issues)
    expect(error.message.length).toBeLessThanOrEqual(
      PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS.messageUnits,
    )
    const nodeLimitIssue = error.issues.find((issue) =>
      issue.includes(
        `node limit of ${PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.familyNodes} exceeded`,
      ),
    )
    expect(nodeLimitIssue).toBeDefined()
    expect(nodeLimitIssue).toMatch(/^\$\["component:product-\d+"\]/)
  })
})
