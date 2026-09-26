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

  it('rejects an excess case field at runtime even when the caller widened its static type to hide it', () => {
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
    // Exact, not a floor: the input is fixed, so the message length is fully determined by the
    // one (already exactly-asserted) issue above — one issue means no separator.
    expect(propertyNameError.message.length).toBe(propertyNameError.issues[0]!.length)
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
    // Capped at `PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.products` (a STRUCTURAL cap on scenario
    // COUNT) rather than an arbitrarily large count: every repeat past
    // the first reports BOTH a duplicate-product and a duplicate-scenario issue (see the loop
    // above), so this still comfortably exceeds the 100-issue diagnostic cap while staying inside
    // the decode-time array-length limit.
    const catalog = decodeScenarioFamily(productContract(), 'menus-overlays', definitions())
    const invalidCatalog = {
      ...catalog,
      scenarios: Array.from(
        { length: PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.products },
        () => catalog.scenarios[0]!,
      ),
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

  it('clips one oversized diagnostic path instead of collapsing the whole report to the truncation marker', () => {
    // Protocol IDENTIFIERS (a `scenarioId` key, a `productId`) are now bounded to
    // `MAX_IDENTIFIER_LENGTH` (256) — see the "one cost model" describe block below — so an
    // oversized PATH segment can no longer come from scaffolding at all; it can only come from
    // inside a case's own PAYLOAD (`input`), which stays on the metered `string()`/`json()` path
    // and is bounded only by `MAX_STRING_LENGTH` (100,000). This is deliberately that shape: one
    // absurdly long property KEY inside `input`, holding a value that is not JSON-safe.
    const longKey = `bad-${'x'.repeat(20_000)}`
    const invalidDefinitions = definitions({ [longKey]: () => 0 })
    const first = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', invalidDefinitions),
    )
    const second = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', invalidDefinitions),
    )

    // The first (and only) issue survives with its clipped, marked path — it does NOT collapse
    // to the pathless truncation marker, which is the bad behaviour this replaces. The PROTOCOL
    // PREFIX (`$["component:dialog"].cases[0]`, the case root `protectedPath()` marks) survives in
    // full and unclipped; only the oversized payload key (the leaf) is internally clipped.
    expect(first.code).toBe('invalid-definitions')
    expect(first.issues).toHaveLength(1)
    expect(first.issues[0]).not.toContain('diagnostics truncated')
    // `clipRenderedText` clips the LEAF segment's own rendered text (including its closing
    // bracket/quote) from the tail, keeping only its own pre-clip length in the marker — so the
    // closing `"]` never survives clipping, same as the leaf-clip shape the test above uses.
    expect(first.issues[0]).toMatch(
      /^\$\["component:dialog"\]\.cases\[0\]\.input\["bad-x*…\(\d+\): /,
    )
    expect(first.issues[0]).toContain('function values are not JSON-safe')
    // Exact, not a floor: the input (a fixed 20,000-char bad key) is fixed, so the clipped issue
    // text — and therefore its length — is fully deterministic.
    expect(first.issues[0]!.length).toBe(122)
    expect(first.message.length).toBe(122)
    // Deterministic: the elision marker encodes the ORIGINAL (pre-clip) length, so replaying the
    // same oversized input renders byte-identical clipped output.
    expect(second.issues).toEqual(first.issues)
  })

  it('still survives many oversized issues together, each clipped, up to the issue-count cap', () => {
    // Same shift as the test above: many oversized PAYLOAD keys inside ONE case's `input`, rather
    // than many oversized scaffolding scenarioIds (now capped at `MAX_IDENTIFIER_LENGTH`).
    const input: Record<string, unknown> = {}
    for (let index = 0; index < PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS.issues + 20; index += 1) {
      input[`bad-${index}-${'y'.repeat(2_000)}`] = () => 0
    }

    const error = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', definitions(input)),
    )

    // Each issue's own oversized path is bounded by the PER-ISSUE clip, so many of them coexist
    // (rather than the first oversized issue alone exhausting the whole aggregate budget) before
    // the aggregate budget's own truncation marker finally applies. Exact, not a floor: the input
    // (120 fixed-shape bad keys) is fixed, so both counts are fully deterministic — this input
    // happens to run all the way to the issue-COUNT cap (100, truncation marker included) before
    // the aggregate message-UNIT budget would otherwise bind.
    expect(error.code).toBe('invalid-definitions')
    expect(error.issues.length).toBe(PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS.issues)
    expect(error.message.length).toBe(12_254)
    expect(error.message.length).toBeLessThanOrEqual(
      PRESENTATION_SCENARIO_DIAGNOSTIC_LIMITS.messageUnits,
    )
    const truncationMarkers = error.issues.filter((issue) =>
      issue.includes('diagnostics truncated'),
    )
    expect(truncationMarkers).toHaveLength(1)
    // Every SURVIVING issue (i.e. every one but the truncation marker — `issues` is sorted, so
    // it is not necessarily last) still names its own protected case-root prefix IN FULL plus its
    // own clipped bad key — none of them were swallowed by any one oversized sibling.
    for (const issue of error.issues) {
      if (issue.includes('diagnostics truncated')) continue
      expect(issue).toMatch(/^\$\["component:dialog"\]\.cases\[0\]\.input\["bad-\d+-y*…\(\d+\): /)
    }
  })

  it('elides MIDDLE path segments, never the leaf, so issues that differ only in their leaf stay distinguishable', () => {
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

  it('two issues differing only NEAR THE ROOT (which case, not which leaf) stay distinguishable after clipping', () => {
    // Same defect class as the test above, one level OUTWARD: the leaf-clipping fix above keeps
    // the LEAF distinguishable when siblings inside the SAME case differ only in their final
    // segment; it
    // says nothing about two issues from DIFFERENT cases whose payload SHAPE is identical and
    // which therefore differ only near the scaffolding root (`cases[0]` vs `cases[1]`) — exactly
    // the segments a plain middle-elision has no reason to prefer keeping over the payload's own
    // deep, long names. `protectedPath()` (applied once, at the case root, in `decodeCase`) is
    // what keeps `cases[i]` itself unconditionally intact through clipping.
    function deepBadInput(depth: number): unknown {
      let value: unknown = () => 0
      for (let index = 0; index < depth; index += 1) {
        value = { [`level-with-a-long-descriptive-name-${index}`]: value }
      }
      return value
    }
    const twoCaseDefinitions = {
      'component:dialog': {
        defaultCaseId: 'open',
        cases: [
          { id: 'open', label: 'Open', input: deepBadInput(10), environmentAxes: [] },
          { id: 'closed', label: 'Closed', input: deepBadInput(10), environmentAxes: [] },
        ],
      },
    }

    const error = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', twoCaseDefinitions),
    )

    expect(error.code).toBe('invalid-definitions')
    expect(error.issues).toHaveLength(2)
    // Every issue is distinct — the ROOT-CAUSE requirement, and the only one that would fail if
    // the case index got elided away.
    expect(new Set(error.issues).size).toBe(error.issues.length)
    const case0Issue = error.issues.find((issue) => issue.includes('.cases[0]'))
    const case1Issue = error.issues.find((issue) => issue.includes('.cases[1]'))
    expect(case0Issue).toBeDefined()
    expect(case1Issue).toBeDefined()
    // Both start with their OWN full, unelided case root.
    expect(case0Issue).toMatch(/^\$\["component:dialog"\]\.cases\[0\]/)
    expect(case1Issue).toMatch(/^\$\["component:dialog"\]\.cases\[1\]/)
    // Deterministic: replaying renders byte-identical clipped issues.
    const replay = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', twoCaseDefinitions),
    )
    expect(replay.issues).toEqual(error.issues)
  })

  it('two long PROTECTED prefixes differing only in their last character stay distinguishable', () => {
    // The protected prefix is never ELIDED, but it was still being passed through
    // `clipRenderedText`'s per-segment head-keep/tail-cut window (~50 units at the default
    // budget) — so two 101-char scenario ids sharing a 100-char prefix and differing only in
    // their OWN last character clipped to the identical 50-char head, collapsing two distinct
    // findings to one. A protocol identifier is bounded to 256 chars structurally
    // (`MAX_IDENTIFIER_LENGTH`), so rendering it WHOLE cannot reopen any unbounded-size hole.
    function deepBadInput(): unknown {
      let value: unknown = () => 0
      for (let index = 0; index < 10; index += 1) {
        value = { [`level-with-a-long-descriptive-name-${index}`]: value }
      }
      return value
    }
    const idPrefix = 'component:' + 'x'.repeat(90) // 100 chars
    const idA = `${idPrefix}A` // 101 chars
    const idB = `${idPrefix}B` // 101 chars, differs only in the last character
    const twoLongIdDefinitions = {
      [idA]: {
        defaultCaseId: 'open',
        cases: [{ id: 'open', label: 'Open', input: deepBadInput(), environmentAxes: [] }],
      },
      [idB]: {
        defaultCaseId: 'open',
        cases: [{ id: 'open', label: 'Open', input: deepBadInput(), environmentAxes: [] }],
      },
    }

    const error = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', twoLongIdDefinitions),
    )

    expect(error.code).toBe('invalid-definitions')
    expect(error.issues).toHaveLength(2)
    expect(new Set(error.issues).size).toBe(error.issues.length)
    const issueA = error.issues.find((issue) => issue.startsWith(`$["${idA}"]`))
    const issueB = error.issues.find((issue) => issue.startsWith(`$["${idB}"]`))
    // Both scenario ids survive WHOLE — not merely present, but not head-clipped either: the
    // full 101-char identifier (including its final, distinguishing character) appears verbatim.
    expect(issueA).toBeDefined()
    expect(issueB).toBeDefined()
    expect(issueA).toContain(idA)
    expect(issueB).toContain(idB)
    // Deterministic: replaying renders byte-identical clipped issues.
    const replay = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', twoLongIdDefinitions),
    )
    expect(replay.issues).toEqual(error.issues)
  })

  describe('SCENARIO-LEVEL (wrapper) diagnostics stay distinguishable for two 250-char scenario ids differing only in the last character', () => {
    // `protectedPath()` was applied only in `decodeCase` (the CASE root) — a scenario/definition
    // -level diagnostic (a stale key, a missing/extra wrapper field, an unknown `defaultCaseId`)
    // is reported at the SCENARIO KEY root, one level OUTWARD, and was still being head-clipped
    // there. Fixed by marking the scenario-key path protected wherever it is built (the
    // definitions root, the compiled-catalog wrapper, the stale-key report) and by rendering a
    // protected LEAF whole too (`clipDiagnosticPath`'s `leafIsProtected`) — these diagnostics are
    // reported directly AT the scenario key, with nothing past it, so the key IS the leaf.
    const idA = `component:${'x'.repeat(239)}A` // 250 chars
    const idB = `component:${'x'.repeat(239)}B` // 250 chars, differs only in the last character
    const good = {
      defaultCaseId: 'a',
      cases: [{ id: 'a', label: 'A', input: 0, environmentAxes: [] as string[] }],
    }

    function twoLongIdContract(): ProductContract {
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
            presentation: { family: 'menus-overlays', baseline: styled, registryTailwind: styled },
            scenarioId: idA,
          },
          {
            name: 'menu',
            displayName: 'Menu',
            category: 'overlays',
            artifactKind: 'machine',
            machine: { kind: 'public', importPath: '@llui/components/menu' },
            copiedArtifacts: [
              {
                name: 'menu',
                artifactKind: 'skin',
                styling: { baseline: false, registryTailwind: true, styleless: false },
              },
            ],
            styling: { baseline: true, registryTailwind: true, styleless: true },
            presentation: { family: 'menus-overlays', baseline: styled, registryTailwind: styled },
            scenarioId: idB,
          },
        ],
        aliases: [],
      })
    }

    it('stale definition key', () => {
      const error = errorFrom(() =>
        decodeScenarioFamily(productContract(), 'menus-overlays', {
          'component:dialog': good,
          [idA]: good,
          [idB]: good,
        }),
      )
      expect(error.code).toBe('invalid-definitions')
      expect(error.issues).toEqual([
        `$["${idA}"]: stale definition for presentation family "menus-overlays".`,
        `$["${idB}"]: stale definition for presentation family "menus-overlays".`,
      ])
    })

    it('missing wrapper field', () => {
      const error = errorFrom(() =>
        decodeScenarioFamily(twoLongIdContract(), 'menus-overlays', {
          [idA]: { cases: good.cases },
          [idB]: { cases: good.cases },
        }),
      )
      expect(error.code).toBe('invalid-definitions')
      expect(error.issues).toEqual([
        `$["${idA}"].defaultCaseId: required field is missing.`,
        `$["${idB}"].defaultCaseId: required field is missing.`,
      ])
    })

    it('extra wrapper field', () => {
      const error = errorFrom(() =>
        decodeScenarioFamily(twoLongIdContract(), 'menus-overlays', {
          [idA]: { ...good, z: 1 },
          [idB]: { ...good, z: 1 },
        }),
      )
      expect(error.code).toBe('invalid-definitions')
      expect(error.issues).toEqual([
        `$["${idA}"].z: unexpected field.`,
        `$["${idB}"].z: unexpected field.`,
      ])
    })

    it('unknown defaultCaseId', () => {
      const error = errorFrom(() =>
        decodeScenarioFamily(twoLongIdContract(), 'menus-overlays', {
          [idA]: { ...good, defaultCaseId: 'q' },
          [idB]: { ...good, defaultCaseId: 'q' },
        }),
      )
      expect(error.code).toBe('invalid-definitions')
      expect(error.issues).toEqual([
        `$["${idA}"].defaultCaseId: case "q" does not exist.`,
        `$["${idB}"].defaultCaseId: case "q" does not exist.`,
      ])
    })
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

    // The ROOT definitions object's own key COUNT is now a STRUCTURAL cap
    // (`PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.products`), checked from the cheap
    // `Reflect.ownKeys`-only phase alone, so a huge proxy is rejected WITHOUT ever
    // reading a single property descriptor.
    let descriptorReads = 0
    const hugeKeyCount = PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.products + 1
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
      issues: [`$: own-key limit of ${PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.products} exceeded.`],
    })
    // Exact, not a floor: the one (already exactly-asserted) issue above fully determines the
    // message length — one issue means no separator.
    expect(hugeError.message.length).toBe(hugeError.issues[0]!.length)
    expect(descriptorReads).toBe(0)
  })

  it('deep-freezes constants, catalogs, resolver snapshots, and error diagnostics', () => {
    const source = { nested: { labels: ['Ada', 'Grace'] } }
    // Built directly with `copiedArtifactNames` already present, rather than calling
    // `definitions()` (which does not set it) and then casting the result to a mutable shape to
    // add it after the fact.
    const sourceDefinitions: PresentationScenarioDefinitions = {
      'component:dialog': {
        defaultCaseId: 'open',
        cases: [
          {
            id: 'open',
            label: 'Open',
            input: source,
            environmentAxes: ['theme'],
            copiedArtifactNames: ['dialog'],
          },
        ],
      },
    }
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

/**
 * Binary-searches the largest `n` for which `build(n)` compiles successfully via
 * `decodeScenarioFamily`, on the assumption that `build` is MONOTONE (larger `n` never uses less
 * of the budget being probed) — measures the actual boundary empirically rather than
 * hand-deriving a fixed per-shape overhead constant, which is exactly the class of arithmetic
 * mistake the earlier `reserveScaffolding` design made three times over. `hi` must already fail.
 */
function maxFittingN(build: (n: number) => unknown, lo: number, hi: number): number {
  const fits = (n: number): boolean => {
    try {
      decodeScenarioFamily(productContract(), 'menus-overlays', definitions(build(n)))
      return true
    } catch {
      return false
    }
  }
  if (fits(hi)) throw new Error('maxFittingN: hi must already fail to fit')
  let low = lo
  let high = hi
  while (high - low > 1) {
    const mid = low + Math.floor((high - low) / 2)
    if (fits(mid)) low = mid
    else high = mid
  }
  return low
}

describe('one cost model governs compileScenarioFamily and every catalog derived from it', () => {
  function flatNullInput(fieldCount: number): Record<string, null> {
    const input: Record<string, null> = {}
    for (let index = 0; index < fieldCount; index += 1) input[`field${index}`] = null
    return input
  }

  // Two-level nested single-element arrays (`[[[]], [[]], ...]`) push the FIELDS:NODES ratio much
  // closer to `MAX_FIELDS`'s own 2x-of-nodes sizing than a flat object can: a flat object's own
  // fields can never exceed its own nodes (each key implies exactly one value node), so a flat
  // shape alone can never approach the fields budget without first blowing the (half the size)
  // node budget. Depth stays at 3 — far under `MAX_DEPTH` (64) — regardless of `pairCount`.
  function nestedPairsInput(pairCount: number): { rows: readonly unknown[] } {
    return { rows: Array.from({ length: pairCount }, () => [[]]) }
  }

  describe('NODES', () => {
    const boundary = maxFittingN(
      flatNullInput,
      0,
      PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.familyNodes,
    )

    it('compiles and round-trips exactly at the node budget', () => {
      const input = flatNullInput(boundary)
      const contract = productContract()
      const catalog = decodeScenarioFamily(contract, 'menus-overlays', definitions(input))
      expect(catalog.scenarios[0]!.cases[0]!.input).toEqual(input)

      const selection = { productId: 'dialog', path: 'baseline' as const }
      const viaJson = decodeScenarioSelection(
        contract,
        JSON.parse(JSON.stringify(catalog)) as unknown,
        selection,
      )
      expect(viaJson.case.input).toEqual(input)
      const viaClone = decodeScenarioSelection(contract, structuredClone(catalog), selection)
      expect(viaClone.case.input).toEqual(input)
    })

    it('rejects one past the node budget, citing the caller-written path', () => {
      const input = flatNullInput(boundary + 1)
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
  })

  describe('FIELDS', () => {
    const boundary = maxFittingN(
      nestedPairsInput,
      0,
      PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.familyFields,
    )

    it('compiles and round-trips exactly at the field budget', () => {
      const input = nestedPairsInput(boundary)
      const contract = productContract()
      const catalog = decodeScenarioFamily(contract, 'menus-overlays', definitions(input))
      expect(catalog.scenarios[0]!.cases[0]!.input).toEqual(input)

      const selection = { productId: 'dialog', path: 'baseline' as const }
      const viaJson = decodeScenarioSelection(
        contract,
        JSON.parse(JSON.stringify(catalog)) as unknown,
        selection,
      )
      expect(viaJson.case.input).toEqual(input)
      const viaClone = decodeScenarioSelection(contract, structuredClone(catalog), selection)
      expect(viaClone.case.input).toEqual(input)
    })

    it('rejects one past the field budget, citing the caller-written path', () => {
      // A single flat object wide enough to exceed `MAX_FIELDS` outright reports the field limit
      // in ONE issue: the container's own field charge is a single upfront batch (all its own
      // keys at once), which fails and short-circuits before any child node is ever visited — so
      // this, unlike the nested-pairs shape above, needs no binary search to land cleanly past
      // the boundary with no other diagnostic mixed in.
      const input = flatNullInput(PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.familyFields + 1)
      const error = errorFrom(() =>
        decodeScenarioFamily(productContract(), 'menus-overlays', definitions(input)),
      )
      expect(error.code).toBe('invalid-definitions')
      expect(error.issues).toHaveLength(1)
      expect(error.issues[0]).toMatch(/^\$\["component:dialog"\]\.cases\[0\]\./)
      expect(error.issues[0]).toContain('aggregate object-field limit of')
    })
  })

  describe('STRING UNITS', () => {
    // One field per unit of granularity, each holding a string just under the PER-STRING cap, so
    // the search is over how many such fields fit — never anywhere near the node/field budgets.
    const unitSize = 10_000
    function stringUnitsInput(fieldCount: number): Record<string, string> {
      const input: Record<string, string> = {}
      for (let index = 0; index < fieldCount; index += 1) input[`f${index}`] = 'x'.repeat(unitSize)
      return input
    }
    const boundaryFields = maxFittingN(
      stringUnitsInput,
      0,
      Math.ceil(PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.familyStringUnits / unitSize) + 1,
    )

    it('compiles and round-trips exactly at the string-unit budget', () => {
      const input = stringUnitsInput(boundaryFields)
      const contract = productContract()
      const catalog = decodeScenarioFamily(contract, 'menus-overlays', definitions(input))
      expect(catalog.scenarios[0]!.cases[0]!.input).toEqual(input)

      const selection = { productId: 'dialog', path: 'baseline' as const }
      const viaJson = decodeScenarioSelection(
        contract,
        JSON.parse(JSON.stringify(catalog)) as unknown,
        selection,
      )
      expect(viaJson.case.input).toEqual(input)
      const viaClone = decodeScenarioSelection(contract, structuredClone(catalog), selection)
      expect(viaClone.case.input).toEqual(input)
    })

    it('rejects one field past the string-unit budget, citing the caller-written path', () => {
      const input = stringUnitsInput(boundaryFields + 1)
      const error = errorFrom(() =>
        decodeScenarioFamily(productContract(), 'menus-overlays', definitions(input)),
      )
      expect(error.code).toBe('invalid-definitions')
      expect(
        error.issues.some(
          (issue) =>
            issue.startsWith('$["component:dialog"].cases[0].') &&
            issue.includes('total string-unit limit of'),
        ),
      ).toBe(true)
    })
  })

  describe('ARRAY LENGTH', () => {
    it('compiles and round-trips a single array exactly at the array-length budget', () => {
      const input = Array.from(
        { length: PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.arrayLength },
        (_, index) => index,
      )
      const contract = productContract()
      const catalog = decodeScenarioFamily(contract, 'menus-overlays', definitions(input))
      expect(catalog.scenarios[0]!.cases[0]!.input).toEqual(input)

      const selection = { productId: 'dialog', path: 'baseline' as const }
      const viaJson = decodeScenarioSelection(
        contract,
        JSON.parse(JSON.stringify(catalog)) as unknown,
        selection,
      )
      expect(viaJson.case.input).toEqual(input)
      const viaClone = decodeScenarioSelection(contract, structuredClone(catalog), selection)
      expect(viaClone.case.input).toEqual(input)
    })

    it('rejects an array one past the array-length budget, citing the caller-written path', () => {
      const input = Array.from(
        { length: PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.arrayLength + 1 },
        (_, index) => index,
      )
      const error = errorFrom(() =>
        decodeScenarioFamily(productContract(), 'menus-overlays', definitions(input)),
      )
      expect(error.code).toBe('invalid-definitions')
      expect(error.issues).toEqual([
        `$["component:dialog"].cases[0].input.length: array length limit of ${PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.arrayLength} exceeded.`,
      ])
    })
  })

  describe('DEPTH', () => {
    function chainOfDepth(depth: number): unknown {
      let value: unknown = true
      for (let index = 0; index < depth; index += 1) value = { child: value }
      return value
    }

    it('compiles and round-trips a value exactly at the depth budget', () => {
      // `json()`'s root value is depth 0, so a chain of `depth` wrappers reaches exactly `depth`.
      const input = chainOfDepth(PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.depth)
      const contract = productContract()
      const catalog = decodeScenarioFamily(contract, 'menus-overlays', definitions(input))
      expect(catalog.scenarios[0]!.cases[0]!.input).toEqual(input)

      const selection = { productId: 'dialog', path: 'baseline' as const }
      const viaJson = decodeScenarioSelection(
        contract,
        JSON.parse(JSON.stringify(catalog)) as unknown,
        selection,
      )
      expect(viaJson.case.input).toEqual(input)
      const viaClone = decodeScenarioSelection(contract, structuredClone(catalog), selection)
      expect(viaClone.case.input).toEqual(input)
    })

    it('rejects a value one past the depth budget, citing the caller-written path', () => {
      const input = chainOfDepth(PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.depth + 1)
      const error = errorFrom(() =>
        decodeScenarioFamily(productContract(), 'menus-overlays', definitions(input)),
      )
      expect(error.code).toBe('invalid-definitions')
      // The protected prefix is `$["component:dialog"].cases[0]` — its own render, with no
      // trailing literal `.`, since a long `.child.child...` run right after it is exactly what
      // gets elided (no synthetic separator is inserted between the protected prefix and an
      // elision marker that immediately follows it).
      expect(
        error.issues.some(
          (issue) =>
            issue.startsWith('$["component:dialog"].cases[0]') &&
            issue.includes(
              `depth limit of ${PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.depth} exceeded`,
            ),
        ),
      ).toBe(true)
    })
  })

  describe('PRODUCTS (structural, not payload)', () => {
    it('a family at exactly the max product count round-trips through JSON and structuredClone', () => {
      const productCount = PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.products
      const contract = manyProductsContract(productCount)
      const defs = manyCaseDefinitions(productCount, 1, 1)

      const catalog = decodeScenarioFamily(contract, 'menus-overlays', defs)
      expect(catalog.scenarios).toHaveLength(productCount)

      const selection = { productId: 'product-0', path: 'baseline' as const }
      const viaJson = decodeScenarioSelection(
        contract,
        JSON.parse(JSON.stringify(catalog)) as unknown,
        selection,
      )
      expect(viaJson.case.input).toEqual(rowInput(1))
      const viaClone = decodeScenarioSelection(contract, structuredClone(catalog), selection)
      expect(viaClone.case.input).toEqual(rowInput(1))
    })
  })

  describe('IDENTIFIER LENGTH (contract entries, not payload)', () => {
    // `entry.name` (-> `productId`) and `entry.scenarioId` are ALREADY-TRUSTED `ProductContract`
    // data — `compiledCatalog` copies them into the catalog it builds WITHOUT decoding them, since
    // a contract is caller-validated, not an untyped boundary. They still become a compiled
    // catalog's `productId`/`scenarioId` verbatim, which ARE decoded (and length-bounded) on
    // every later serialized re-decode — so an oversized contract entry used to compile cleanly
    // and only fail the moment its own compiled catalog was serialized and handed back through
    // `decodeScenarioSelection`. Two independent layers now catch it: the Zod schema itself
    // (`ProductContractSchema`, `.max(identifierLength)`) rejects it at PARSE time, and
    // `compiledCatalog`'s own check (using the SAME `isValidIdentifierLength` predicate
    // `BoundaryDecoder.identifier()` uses) rejects a raw `ProductContract` VALUE that bypassed
    // the Zod schema entirely — a `ProductContract` is a TYPE, not a guarantee every value was
    // actually built by `.parse()`.
    function rawContract(name: string, scenarioId: string): ProductContract {
      return {
        version: 2,
        entries: [
          {
            name,
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
            presentation: { family: 'menus-overlays', baseline: styled, registryTailwind: styled },
            scenarioId,
          },
        ],
        aliases: [],
      }
    }
    const limit = PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.identifierLength

    it('Zod itself rejects an oversized name or scenarioId at PARSE time, but accepts exactly the limit (#158-style vacuity check)', () => {
      // `base` is otherwise IDENTICAL to a genuinely valid entry (a real copied artifact, styling
      // that matches it) — a passing control at exactly `limit`, alongside the `limit + 1`
      // rejection, proves each `.toThrow()` fires because of the LENGTH specifically, not because
      // of some unrelated shape mismatch coincidentally caught by a different Zod rule (the
      // mutation-vacuity trap this repo's own CLAUDE.md warns about: an earlier draft of this
      // test used `copiedArtifacts: []`, which a DIFFERENT superRefine rule rejects regardless of
      // name/scenarioId length, so it "passed" whether or not the `.max()` constraint existed).
      const base = {
        displayName: 'Dialog',
        category: 'overlays' as const,
        artifactKind: 'machine' as const,
        machine: { kind: 'public' as const, importPath: '@llui/components/dialog' },
        copiedArtifacts: [
          {
            name: 'dialog',
            artifactKind: 'skin' as const,
            styling: { baseline: false, registryTailwind: true, styleless: false },
          },
        ],
        styling: { baseline: true, registryTailwind: true, styleless: true },
        presentation: {
          family: 'menus-overlays' as const,
          baseline: styled,
          registryTailwind: styled,
        },
      }
      const okName = 'n' + 'x'.repeat(limit - 1) // exactly `limit`
      const longName = okName + 'x' // limit + 1
      const okScenarioId = 'component:' + 'x'.repeat(limit - 'component:'.length) // exactly `limit`
      const longScenarioId = okScenarioId + 'x' // limit + 1

      expect(() =>
        ProductContractSchema.parse({
          version: 2,
          entries: [{ ...base, name: okName, scenarioId: 'component:dialog' }],
          aliases: [],
        }),
      ).not.toThrow()
      expect(() =>
        ProductContractSchema.parse({
          version: 2,
          entries: [{ ...base, name: longName, scenarioId: 'component:dialog' }],
          aliases: [],
        }),
      ).toThrow()
      expect(() =>
        ProductContractSchema.parse({
          version: 2,
          entries: [{ ...base, name: 'dialog', scenarioId: okScenarioId }],
          aliases: [],
        }),
      ).not.toThrow()
      expect(() =>
        ProductContractSchema.parse({
          version: 2,
          entries: [{ ...base, name: 'dialog', scenarioId: longScenarioId }],
          aliases: [],
        }),
      ).toThrow()
    })

    it('a contract entry name (-> productId) at exactly the identifier limit compiles and round-trips; one past fails at compile naming the entry', () => {
      const okName = 'n' + 'x'.repeat(limit - 1) // exactly `limit` characters
      const contract = rawContract(okName, 'component:dialog')

      const catalog = decodeScenarioFamily(contract, 'menus-overlays', definitions())
      expect(catalog.scenarios[0]!.productId).toBe(okName)
      const selection = { productId: okName, path: 'baseline' as const }
      const viaJson = decodeScenarioSelection(
        contract,
        JSON.parse(JSON.stringify(catalog)) as unknown,
        selection,
      )
      expect(viaJson.productId).toBe(okName)
      const viaClone = decodeScenarioSelection(contract, structuredClone(catalog), selection)
      expect(viaClone.productId).toBe(okName)

      const tooLongName = okName + 'x' // limit + 1
      const tooLongContract = rawContract(tooLongName, 'component:dialog')
      const error = errorFrom(() =>
        decodeScenarioFamily(tooLongContract, 'menus-overlays', definitions()),
      )
      expect(error.code).toBe('invalid-definitions')
      expect(
        error.issues.some(
          (issue) =>
            issue.startsWith('$["component:dialog"].productId') &&
            issue.includes(`identifier length limit of ${limit} exceeded`),
        ),
      ).toBe(true)
    })

    it('a contract entry scenarioId at exactly the identifier limit compiles and round-trips; one past fails at compile naming the entry', () => {
      const prefix = 'component:'
      const okId = prefix + 'x'.repeat(limit - prefix.length) // exactly `limit` characters
      const contract = rawContract('dialog', okId)
      const defs = {
        [okId]: {
          defaultCaseId: 'open',
          cases: [{ id: 'open', label: 'Open', input: { open: true }, environmentAxes: ['theme'] }],
        },
      }

      const catalog = decodeScenarioFamily(contract, 'menus-overlays', defs)
      expect(catalog.scenarios[0]!.scenarioId).toBe(okId)
      const selection = { productId: 'dialog', path: 'baseline' as const }
      const viaJson = decodeScenarioSelection(
        contract,
        JSON.parse(JSON.stringify(catalog)) as unknown,
        selection,
      )
      expect(viaJson.scenarioId).toBe(okId)
      const viaClone = decodeScenarioSelection(contract, structuredClone(catalog), selection)
      expect(viaClone.scenarioId).toBe(okId)

      // The oversized scenarioId here is NEVER used as a definitions-object KEY (that key is
      // already covered — and independently bounded — by `decodeDefinitions`'s own root
      // `structuralRecord` check, see the round-three tests above). Using a mismatched, ordinary
      // short key isolates `compiledCatalog`'s OWN identifier check: it fires from the CONTRACT
      // entry alone, regardless of whether any definition happens to match it.
      const tooLongId = okId + 'x' // limit + 1
      const tooLongContract = rawContract('dialog', tooLongId)
      const mismatchedDefs = {
        'component:dialog': {
          defaultCaseId: 'open',
          cases: [{ id: 'open', label: 'Open', input: { open: true }, environmentAxes: ['theme'] }],
        },
      }
      const error = errorFrom(() =>
        decodeScenarioFamily(tooLongContract, 'menus-overlays', mismatchedDefs),
      )
      expect(error.code).toBe('invalid-definitions')
      expect(
        error.issues.some(
          (issue) =>
            issue.includes('scenarioId') &&
            issue.includes(`identifier length limit of ${limit} exceeded`),
        ),
      ).toBe(true)
    })
  })
})

describe('array decoding cost is bounded by real own-key count, never by a claimed length', () => {
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
    // These bounds must be TIGHT ENOUGH to fail on the pre-memoization code: a bound merely
    // proportional to `occurrences` (e.g. `occurrences * 6 = 300`)
    // is satisfied by 50 real `ownKeys` calls just as easily as by 1, so it cannot tell "O(1) per
    // occurrence" apart from "memoized once, total" — exactly the gap the reviewer measured
    // against this same test. `ownKeys` is called ONLY when the per-object key-list cache misses
    // (`#safeKeyList`), so a SHARED reference across `occurrences` places pays it ONCE, not once
    // per occurrence: bounded by a small constant, independent of `occurrences`.
    expect(ownKeysCalls).toBeLessThanOrEqual(2)
    // `getOwnPropertyDescriptor` is NOT fully memoized to 1: `#arrayLength` peeks the `length`
    // descriptor directly (an O(1) operation deliberately left uncached, since caching an
    // already-O(1) read buys nothing) once per OCCURRENCE — so this scales with `occurrences`,
    // plus a small constant for the one real (cached) descriptor-building pass.
    expect(descriptorCalls).toBeLessThanOrEqual(occurrences + 5)
  })

  it('inspects a wide shared object referenced many times in O(1) reflection calls, not O(references)', () => {
    // The reviewer's own reproduction: a shared object with K non-recursed-into (here: primitive)
    // own keys, referenced R times — not sparse, not over-length, just WIDE and SHARED. Every
    // occurrence used to re-run `Reflect.ownKeys` + `Object.getOwnPropertyDescriptor` for all K
    // keys before charging a single budget, costing 10-47s measured. Memoizing the reflection
    // step per OBJECT REFERENCE (`#safeKeyList`/`#safeDescriptorsFor`) makes it pay that cost
    // ONCE: `ownKeys` exactly once total, `getOwnPropertyDescriptor` exactly once per the shared
    // object's OWN key (K), never once per (key x reference).
    let ownKeysCalls = 0
    let descriptorCalls = 0
    const keyCount = 500
    const target: Record<string, number> = {}
    for (let index = 0; index < keyCount; index += 1) target[`k${index}`] = index
    const shared = new Proxy(target, {
      ownKeys(t) {
        ownKeysCalls += 1
        return Reflect.ownKeys(t)
      },
      getOwnPropertyDescriptor(t, key) {
        descriptorCalls += 1
        return Reflect.getOwnPropertyDescriptor(t, key)
      },
    })
    const referenceCount = 1_999
    const refs = Array.from({ length: referenceCount }, () => shared)

    const started = Date.now()
    const error = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', definitions(refs)),
    )
    const elapsedMs = Date.now() - started

    expect(error.code).toBe('invalid-definitions')
    // This test's OWN mutation check: a deterministic, discriminating bound that fails on the
    // pre-memoization code (which would report `ownKeysCalls` in the THOUSANDS here — one per
    // reference, not one total) rather than a bound wide enough to pass either way.
    expect(ownKeysCalls).toBeLessThanOrEqual(2)
    expect(descriptorCalls).toBeLessThanOrEqual(keyCount + 10)
    // Wall-clock is NOT the discriminating assertion above (a slow CI runner should never flip a
    // correctness test), but it is worth recording as a coarse sanity floor: this used to be
    // reported at 10-47 seconds and is now well under one, on the same shape.
    expect(elapsedMs).toBeLessThan(5_000)
  })

  it('rejects a payload array with a small length but millions of named own keys before reading a single descriptor', () => {
    // A dense length check alone is not enough: an array reporting `length: 1` can still carry a
    // million EXTRA named (non-index) own keys, which the old code would only discover — one
    // expensive `getOwnPropertyDescriptor` call at a time — while walking the hole-detection loop.
    let descriptorCalls = 0
    const target: unknown[] = [0]
    const keyCount = 1_000_000
    for (let index = 0; index < keyCount; index += 1) target[`k${index}` as unknown as number] = 0
    const wideArray = new Proxy(target, {
      getOwnPropertyDescriptor(t, key) {
        descriptorCalls += 1
        return Reflect.getOwnPropertyDescriptor(t, key)
      },
    })

    const error = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', definitions(wideArray)),
    )

    expect(error.code).toBe('invalid-definitions')
    expect(error.issues).toEqual([
      `$["component:dialog"].cases[0].input: array own-key count exceeds what a length-${PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.arrayLength} array can have.`,
    ])
    // The discriminating bound: the pre-fix code would call this once per REAL own key (in the
    // millions) while walking the hole-detection loop before ever reaching this rejection.
    expect(descriptorCalls).toBeLessThanOrEqual(2)
  })

  it('rejects a structural (scaffolding) array — `cases` — with a small length but millions of named own keys, the same way', () => {
    // Same defect, one level over: `structuralArray` (used for `cases`/`scenarios`) checked
    // LENGTH before the expensive phase but had no equivalent own-key-count check of its own, so
    // it reached `#inspectArrayContents`'s per-key descriptor phase regardless.
    let descriptorCalls = 0
    const target: unknown[] = [{ id: 'a', label: 'A', input: 0, environmentAxes: [] }]
    const keyCount = 1_000_000
    for (let index = 0; index < keyCount; index += 1) target[`k${index}` as unknown as number] = 0
    const wideCases = new Proxy(target, {
      getOwnPropertyDescriptor(t, key) {
        descriptorCalls += 1
        return Reflect.getOwnPropertyDescriptor(t, key)
      },
    })

    const error = errorFrom(() =>
      decodeScenarioFamily(productContract(), 'menus-overlays', {
        'component:dialog': { defaultCaseId: 'a', cases: wideCases },
      }),
    )

    expect(error.code).toBe('invalid-definitions')
    expect(error.issues).toEqual([
      `$["component:dialog"].cases: array own-key count exceeds what a length-${PRESENTATION_SCENARIO_COMPLEXITY_LIMITS.casesPerProduct} array can have.`,
    ])
    expect(descriptorCalls).toBeLessThanOrEqual(2)
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

describe('complexity limits scale with realistic family inventory', () => {
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
