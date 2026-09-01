import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { ProductContractSchema, type ProductContract } from '../src/product-contract'
import {
  DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT,
  PRESENTATION_SCENARIO_ENVIRONMENT_VALUES,
  PRESENTATION_SCENARIO_PATHS,
  PresentationScenarioError,
  compileScenarioFamily,
  resolveScenarioSelection,
  type CompiledPresentationScenarioFamily,
  type PresentationScenarioDefinitions,
} from '../src/presentation-scenarios'

const styled = { mode: 'styled' as const }

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
    } as unknown as PresentationScenarioDefinitions

    const error = errorFrom(() =>
      compileScenarioFamily(productContract(), 'menus-overlays', definitions),
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
      compileScenarioFamily(productContract(), 'menus-overlays', {
        'component:dialog': { defaultCaseId: 'open', cases },
      } as unknown as PresentationScenarioDefinitions),
    )
    expect(decorated.issues).toEqual([
      '$["component:dialog"].cases.entries: non-index array properties are not supported.',
      '$["component:dialog"].cases.toJSON: non-index array properties are not supported.',
      '$["component:dialog"].cases: symbol-keyed properties are not supported.',
    ])

    const sparseCases = new Array(1)
    const sparse = errorFrom(() =>
      compileScenarioFamily(productContract(), 'menus-overlays', {
        'component:dialog': { defaultCaseId: 'open', cases: sparseCases },
      } as unknown as PresentationScenarioDefinitions),
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
      compileScenarioFamily(productContract(), 'menus-overlays', {
        'component:dialog': { defaultCaseId: 'open', cases: accessorCases },
      } as unknown as PresentationScenarioDefinitions),
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
      compileScenarioFamily(productContract(), 'menus-overlays', definitions({ rows })),
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
        compileScenarioFamily(
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
      compileScenarioFamily(productContract(), 'menus-overlays', crossRealmDefinitions)
        .scenarios[0]!.cases[0]!.input,
    ).toEqual({ open: true })

    const custom = Object.create({ inherited: true }) as Record<string, unknown>
    custom['open'] = true
    const error = errorFrom(() =>
      compileScenarioFamily(productContract(), 'menus-overlays', definitions(custom)),
    )
    expect(error.issues).toEqual(['$["component:dialog"].cases[0].input: must be a plain object.'])

    const rows = ['Ada', 'Grace']
    Object.setPrototypeOf(rows, null)
    expect(
      compileScenarioFamily(productContract(), 'menus-overlays', definitions({ rows }))
        .scenarios[0]!.cases[0]!.input,
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
      compileScenarioFamily(productContract(), 'menus-overlays', definitions(input)),
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
      compileScenarioFamily(productContract(), 'menus-overlays', definitions(ownToJson)),
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
      compileScenarioFamily(productContract(), 'menus-overlays', {
        'component:dialog': invalidDefinition,
      } as unknown as PresentationScenarioDefinitions),
    )
    expect(definitionError.issues).toEqual([
      '$["component:dialog"].defaultCaseId: accessor properties are not supported.',
      '$["component:dialog"].metadata: unexpected field.',
    ])

    const catalog = compileScenarioFamily(productContract(), 'menus-overlays', definitions())
    const invalidCatalog = { ...catalog, metadata: true }
    Object.defineProperty(invalidCatalog, 'family', {
      enumerable: true,
      get: () => {
        reads += 1
        return 'menus-overlays'
      },
    })
    const catalogError = errorFrom(() =>
      resolveScenarioSelection(productContract(), invalidCatalog as unknown as typeof catalog, {
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
      resolveScenarioSelection(
        productContract(),
        catalog,
        selection as unknown as Parameters<typeof resolveScenarioSelection>[2],
      ),
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
    const error = errorFrom(() =>
      compileScenarioFamily(
        productContract(),
        'menus-overlays',
        value as unknown as PresentationScenarioDefinitions,
      ),
    )
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
      resolveScenarioSelection(productContract(), catalog, {
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
    const catalog = compileScenarioFamily(productContract(), 'menus-overlays', definitions())
    const error = errorFrom(() => resolveScenarioSelection(productContract(), catalog, selection))
    expect(error.code).toBe('invalid-selection')
    expect(error.message).toBe(message)
  })

  it('rejects wrong nested protocol primitives and metadata at their exact paths', () => {
    const definitionError = errorFrom(() =>
      compileScenarioFamily(productContract(), 'menus-overlays', {
        'component:dialog': { defaultCaseId: 1, cases: null },
      }),
    )
    expect(definitionError.issues).toEqual([
      '$["component:dialog"].cases: must be an array.',
      '$["component:dialog"].defaultCaseId: must be a string.',
    ])

    const catalog = JSON.parse(
      JSON.stringify(compileScenarioFamily(productContract(), 'menus-overlays', definitions())),
    ) as Record<string, unknown>
    const scenarios = catalog['scenarios'] as Record<string, unknown>[]
    scenarios[0]!['metadata'] = []
    scenarios[0]!['cases'] = [{ id: 'open', label: 1, input: null, environmentAxes: null }]
    const catalogError = errorFrom(() =>
      resolveScenarioSelection(productContract(), catalog, {
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
      resolveScenarioSelection(
        productContract(),
        compileScenarioFamily(productContract(), 'menus-overlays', definitions()),
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

  it('snapshots every own field descriptor once and ignores family-local case payloads', () => {
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

    const catalog = compileScenarioFamily(productContract(), 'menus-overlays', proxiedDefinitions)
    expect(descriptorReads.get('component:dialog')).toBe(1)
    expect(rendererReads).toBe(0)
    expect(catalog.scenarios[0]!.cases[0]).not.toHaveProperty('renderer')
  })

  it('returns typed deterministic limit failures instead of native recursion errors', () => {
    let deep: Record<string, unknown> = { leaf: true }
    for (let index = 0; index < 66; index += 1) deep = { child: deep }
    const depthError = errorFrom(() =>
      compileScenarioFamily(productContract(), 'menus-overlays', definitions(deep)),
    )
    expect(depthError.code).toBe('invalid-definitions')
    expect(depthError.issues).toHaveLength(1)
    expect(depthError.issues[0]).toContain('depth limit of 64 exceeded')

    const arrayError = errorFrom(() =>
      compileScenarioFamily(
        productContract(),
        'menus-overlays',
        definitions(Array.from({ length: 1_001 }, () => null)),
      ),
    )
    expect(arrayError.issues).toContain(
      '$["component:dialog"].cases[0].input.length: array length limit of 1000 exceeded.',
    )

    const stringError = errorFrom(() =>
      compileScenarioFamily(productContract(), 'menus-overlays', definitions('x'.repeat(100_001))),
    )
    expect(stringError.issues).toContain(
      '$["component:dialog"].cases[0].input: string length limit of 100000 exceeded.',
    )

    const manyNodes: Record<string, number> = {}
    for (let index = 0; index < 6_001; index += 1) manyNodes[`node${index}`] = index
    const nodeError = errorFrom(() =>
      compileScenarioFamily(productContract(), 'menus-overlays', definitions(manyNodes)),
    )
    expect(nodeError.code).toBe('invalid-definitions')
    expect(nodeError.issues.some((issue) => issue.includes('node limit of 5000 exceeded'))).toBe(
      true,
    )

    const totalStrings = Array.from({ length: 11 }, (_, index) => ({
      [`value${index}`]: 'x'.repeat(100_000),
    }))
    const stringBudgetError = errorFrom(() =>
      compileScenarioFamily(productContract(), 'menus-overlays', definitions(totalStrings)),
    )
    expect(
      stringBudgetError.issues.some((issue) =>
        issue.includes('total string-unit limit of 1000000 exceeded'),
      ),
    ).toBe(true)

    const manyFields: Record<string, null> = {}
    for (let index = 0; index < 10_001; index += 1) manyFields[`field${index}`] = null
    const fieldBudgetError = errorFrom(() =>
      compileScenarioFamily(productContract(), 'menus-overlays', definitions(manyFields)),
    )
    expect(
      fieldBudgetError.issues.some((issue) =>
        issue.includes('aggregate object-field limit of 10000 exceeded'),
      ),
    ).toBe(true)

    const overlongKeyInput = Object.create(null) as Record<string, null>
    overlongKeyInput['x'.repeat(100_001)] = null
    const propertyNameError = errorFrom(() =>
      compileScenarioFamily(productContract(), 'menus-overlays', definitions(overlongKeyInput)),
    )
    expect(propertyNameError.issues).toEqual([
      '$["component:dialog"].cases[0].input: property-name length limit of 100000 exceeded.',
    ])
    expect(propertyNameError.message.length).toBeLessThan(1_000)
  })

  it('deep-freezes constants, catalogs, resolver snapshots, and error diagnostics', () => {
    const source = { nested: { labels: ['Ada', 'Grace'] } }
    const sourceDefinitions = definitions(source) as unknown as {
      'component:dialog': { cases: { copiedArtifactNames?: string[] }[] }
    }
    sourceDefinitions['component:dialog'].cases[0]!.copiedArtifactNames = ['dialog']
    const catalog = compileScenarioFamily(productContract(), 'menus-overlays', sourceDefinitions)
    const scenarioCase = catalog.scenarios[0]!.cases[0]!
    source.nested.labels.push('source mutation')

    expect(Object.isFrozen(PRESENTATION_SCENARIO_ENVIRONMENT_VALUES)).toBe(true)
    expect(Object.isFrozen(PRESENTATION_SCENARIO_ENVIRONMENT_VALUES.theme)).toBe(true)
    expect(Object.isFrozen(DEFAULT_PRESENTATION_SCENARIO_ENVIRONMENT)).toBe(true)
    expect(Object.isFrozen(PRESENTATION_SCENARIO_PATHS)).toBe(true)
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
    const baseline = resolveScenarioSelection(productContract(), serialized, {
      productId: 'dialog',
      path: 'baseline',
    })
    const registry = resolveScenarioSelection(productContract(), serialized, {
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
    const selected = resolveScenarioSelection(productContract(), catalog, mutableSelection)
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
    const error = errorFrom(() => compileScenarioFamily(productContract(), 'forms-controls', {}))
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
      const catalog = compileScenarioFamily(productContract(), 'menus-overlays', definitions(input))
      const serialized = JSON.parse(JSON.stringify(catalog)) as typeof catalog
      expect(serialized).toEqual(catalog)
      expect(
        resolveScenarioSelection(productContract(), serialized, {
          productId: 'dialog',
          caseId: 'open',
          path: 'baseline',
        }).case.input,
      ).toEqual(input)
    }
  })
})
