import { describe, expect, it } from 'vitest'
import {
  createRouter,
  repeatedRouteCodec,
  route,
  routeCodec,
  type StandardSchemaV1,
} from '../src/index'

function fixtureSchema<Input, Output>(
  validate: (input: unknown) => { value: Output } | { issues: readonly { message: string }[] },
): StandardSchemaV1<Input, Output> {
  return {
    '~standard': {
      version: 1,
      vendor: 'fixture',
      validate,
    },
  }
}

class ClassFixtureSchema<Input, Output> implements StandardSchemaV1<Input, Output> {
  readonly '~standard': StandardSchemaV1.Props<Input, Output>

  constructor(validate: StandardSchemaV1.Props<Input, Output>['validate']) {
    this['~standard'] = {
      version: 1,
      vendor: 'class-fixture',
      validate,
    }
  }
}

const integerSchema = new ClassFixtureSchema<string, number>((value) => {
  const parsed = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : NaN
  return Number.isSafeInteger(parsed)
    ? { value: parsed }
    : { issues: [{ message: 'Expected an integer' }] }
})
const sectionSchema: StandardSchemaV1<string, 'profile' | 'security'> = {
  '~standard': {
    version: 1,
    vendor: 'declarative-fixture',
    validate: (value) =>
      value === 'profile' || value === 'security'
        ? { value }
        : { issues: [{ message: 'Unknown section' }] },
  },
}
const tagsSchema: StandardSchemaV1<readonly string[], string[]> = {
  '~standard': {
    version: 1,
    vendor: 'declarative-fixture',
    validate: (value) =>
      Array.isArray(value) && value.every((item) => typeof item === 'string' && item !== '')
        ? { value: [...value] }
        : { issues: [{ message: 'Expected non-empty tags' }] },
  },
}

const integer = routeCodec(integerSchema, String)
const section = routeCodec(sectionSchema, String)
const tags = repeatedRouteCodec(tagsSchema, (values) => values)

describe('named route locations', () => {
  const router = createRouter({
    home: route('/'),
    user: route('/users/:id/:section?', {
      params: { id: integer, section },
      query: { tags },
      defaults: { section: 'profile' as const, tags: [] as string[] },
    }),
    files: route('/files/*path'),
  })

  it('matches and generates normalized route locations bidirectionally', () => {
    expect(router.match('/users/42?tags=one&tags=two')).toEqual({
      name: 'user',
      params: { id: 42, section: 'profile', tags: ['one', 'two'] },
    })
    expect(router.href('user', { id: 42, tags: ['one', 'two'] })).toBe(
      '#/users/42?tags=one&tags=two',
    )
  })

  it('clones configured defaults for every returned location', () => {
    const first = router.match('/users/42')
    const second = router.match('/users/42')
    if (first?.name !== 'user' || second?.name !== 'user') throw new Error('Expected user')

    first.params.tags.push('mutated')

    expect(second.params.tags).toEqual([])
    expect(router.match('/users/42')).toEqual({
      name: 'user',
      params: { id: 42, section: 'profile', tags: [] },
    })
  })

  it('normalizes root and duplicate-slash browser inputs without changing query values', () => {
    expect(router.match('#')).toEqual({ name: 'home', params: {} })
    expect(router.match('')).toEqual({ name: 'home', params: {} })
    expect(router.match('#//users///42/?tags=a%2Fb')).toEqual({
      name: 'user',
      params: { id: 42, section: 'profile', tags: ['a/b'] },
    })
  })

  it('preserves rest segment boundaries including encoded slashes', () => {
    expect(router.match('/files/a%2Fb/c')).toEqual({
      name: 'files',
      params: { path: ['a/b', 'c'] },
    })
    expect(router.href('files', { path: ['a/b', 'c'] })).toBe('#/files/a%2Fb/c')
  })

  it('returns null rather than fabricating locations', () => {
    expect(router.match('/missing')).toBeNull()
    expect(router.match('/users/nope')).toBeNull()
    expect(router.match('/users/%ZZ')).toBeNull()
  })

  it('supports a structurally independent Standard Schema implementation', () => {
    const upper = routeCodec(
      fixtureSchema<string, string>((input) =>
        typeof input === 'string' && input !== ''
          ? { value: input.toUpperCase() }
          : { issues: [{ message: 'required' }] },
      ),
      (value) => value.toLowerCase(),
    )
    const fixtureRouter = createRouter({
      word: route('/word/:value', { params: { value: upper } }),
    })
    expect(fixtureRouter.match('/word/Hello')).toEqual({
      name: 'word',
      params: { value: 'HELLO' },
    })
    expect(fixtureRouter.href('word', { value: 'HELLO' })).toBe('#/word/hello')
  })

  it('supports optional parameters at any position and emits one canonical URL', () => {
    const optional = createRouter({
      locale: route('/:language?/docs', {
        defaults: { language: 'en' },
      }),
    })
    expect(optional.match('/docs')).toEqual({
      name: 'locale',
      params: { language: 'en' },
    })
    expect(optional.match('/fr/docs')).toEqual({
      name: 'locale',
      params: { language: 'fr' },
    })
    expect(optional.href('locale', {})).toBe('#/docs')
    expect(optional.href('locale', { language: 'fr' })).toBe('#/fr/docs')
    const trailing = createRouter({
      section: route('/docs/:section?', { defaults: { section: 'intro' } }),
    })
    expect(trailing.match('/docs/api')).toEqual({ name: 'section', params: { section: 'api' } })
    expect(trailing.href('section', {})).toBe('#/docs')
  })

  it('round-trips Unicode and percent-encoded delimiters', () => {
    const unicode = createRouter({ article: route('/café/:slug') })
    expect(unicode.href('article', { slug: 'a/b?c#d %' })).toBe('#/caf%C3%A9/a%2Fb%3Fc%23d%20%25')
    expect(unicode.match('/caf%C3%A9/a%2Fb%3Fc%23d%20%25')).toEqual({
      name: 'article',
      params: { slug: 'a/b?c#d %' },
    })
  })

  it('supports hash/history modes and normalized history bases', () => {
    const hash = createRouter({ item: route('/items/:id') })
    const history = createRouter({ item: route('/items/:id') }, { mode: 'history', base: '/app/' })
    expect(hash.href('item', { id: 'x' })).toBe('#/items/x')
    expect(hash.match('#/items/x')).toEqual({ name: 'item', params: { id: 'x' } })
    expect(history.href('item', { id: 'x' })).toBe('/app/items/x')
    expect(history.toPath('item', { id: 'x' })).toBe('/app/items/x')
    expect(history.match('/app/items/x')).toEqual({ name: 'item', params: { id: 'x' } })
    expect(history.match('/app')).toEqual(null)
    expect(history.match('/other/items/x')).toBeNull()
  })

  it('matches bare history bases and preserves their query boundary', () => {
    const based = createRouter(
      {
        home: route('/', {
          query: {
            value: routeCodec(
              fixtureSchema<string, string>((input) =>
                typeof input === 'string'
                  ? { value: input }
                  : { issues: [{ message: 'string required' }] },
              ),
              String,
            ),
          },
        }),
      },
      { mode: 'history', base: '/app/' },
    )
    expect(based.match('/app')).toEqual({ name: 'home', params: { value: undefined } })
    expect(based.match('/app?value=a%3Db+c')).toEqual({
      name: 'home',
      params: { value: 'a=b c' },
    })
    expect(based.match('/app#section')).toEqual({
      name: 'home',
      params: { value: undefined },
    })
  })

  it('ignores unknown query keys and rejects duplicate scalar values', () => {
    const scalar = createRouter({
      search: route('/search', { query: { page: integer }, defaults: { page: 1 } }),
    })
    expect(scalar.match('/search?page=2&tracking=ignored')).toEqual({
      name: 'search',
      params: { page: 2 },
    })
    expect(scalar.href('search', { page: 2 })).toBe('#/search?page=2')
    expect(scalar.match('/search?page=1&page=2')).toBeNull()
    expect(scalar.match('/search?page=%ZZ')).toBeNull()
    expect(scalar.match('/search?page=%E0%A4')).toBeNull()
  })

  it('applies route-wide refinement without allowing derived page data', () => {
    const sameOrder = fixtureSchema<{ from: number; to: number }, { from: number; to: number }>(
      (input) => {
        const value = input as { from: number; to: number }
        return value.from <= value.to
          ? { value }
          : { issues: [{ message: 'from must not exceed to' }] }
      },
    )
    const refined = createRouter({
      range: route('/range/:from/:to', {
        params: { from: integer, to: integer },
        refine: sameOrder,
      }),
    })
    expect(refined.match('/range/1/2')).toEqual({
      name: 'range',
      params: { from: 1, to: 2 },
    })
    expect(refined.match('/range/2/1')).toBeNull()
    expect(() => refined.href('range', { from: 2, to: 1 })).toThrow(/valid location/i)

    const transforming = fixtureSchema<{ value: string }, { value: string }>((input) => ({
      value: { ...(input as { value: string }), derived: true } as { value: string },
    }))
    const invalidRefinement = createRouter({
      value: route('/value/:value', { refine: transforming }),
    })
    expect(() => invalidRefinement.match('/value/x')).toThrow(/may only refine/i)

    const mutating = fixtureSchema<{ value: string }, { value: string }>((input) => {
      const sameObject = input as { value: string; derived?: boolean }
      sameObject.derived = true
      return { value: sameObject }
    })
    const invalidMutation = createRouter({
      value: route('/value/:value', { refine: mutating }),
    })
    expect(() => invalidMutation.match('/value/x')).toThrow(/may only refine/i)
  })

  it('validates generated values by rematching the canonical URL', () => {
    const positive = routeCodec(
      fixtureSchema<string, number>((input) => {
        const parsed = Number(input)
        return Number.isInteger(parsed) && parsed > 0
          ? { value: parsed }
          : { issues: [{ message: 'positive integer required' }] }
      }),
      String,
    )
    const validated = createRouter({
      page: route('/page/:number', { params: { number: positive } }),
    })
    expect(() => validated.location('page', { number: -1 })).toThrow(/valid location/i)
    expect(() => validated.toPath('page', { number: -1 })).toThrow(/valid location/i)
    expect(() => validated.href('page', { number: -1 })).toThrow(/valid location/i)
  })

  it('rejects a formatter that loses semantic parameter information', () => {
    const decimal = routeCodec(
      fixtureSchema<string, number>((input) => {
        const value = Number(input)
        return Number.isFinite(value) ? { value } : { issues: [{ message: 'number required' }] }
      }),
      (value) => String(Math.trunc(value)),
    )
    const lossy = createRouter({ value: route('/value/:value', { params: { value: decimal } }) })

    expect(() => lossy.href('value', { value: 1.5 })).toThrow(/round-trip|valid location/i)
    expect(lossy.match('/value/1.5')).toBeNull()
  })

  it('rejects non-serializable output from a codec round-trip before returning a location', () => {
    const asymmetricSchema = fixtureSchema<string, { value: string }>((input) => {
      const value = { value: 'semantic' }
      if (input === 'canonical') Object.defineProperty(value, 'hidden', { value: true })
      return { value }
    })
    const asymmetric = routeCodec(asymmetricSchema, () => 'canonical')
    const asymmetricRouter = createRouter({
      value: route('/value/:value', { params: { value: asymmetric } }),
    })

    expect(() => asymmetricRouter.match('/value/source')).toThrow(/serializable.*value/i)
    expect(() => asymmetricRouter.href('value', { value: { value: 'semantic' } })).toThrow(
      /valid location|serializable.*value/i,
    )
  })

  it('returns route locations that survive an exact JSON round-trip', () => {
    const optional = createRouter({
      docs: route('/docs/:language?', { query: { tags } }),
    })
    const location = optional.match('/docs')
    expect(location).toEqual({ name: 'docs', params: {} })
    expect(JSON.parse(JSON.stringify(location))).toEqual(location)
  })

  it('normalizes and omits built-in and custom rest defaults', () => {
    const builtIn = createRouter({
      docs: route('/docs/*path', { defaults: { path: ['index'] } }),
    })
    expect(builtIn.match('/docs')).toEqual({ name: 'docs', params: { path: ['index'] } })
    expect(builtIn.href('docs', {})).toBe('#/docs')
    expect(builtIn.href('docs', { path: ['index'] })).toBe('#/docs')

    const custom = createRouter({
      docs: route('/docs/*path', {
        params: { path: tags },
        defaults: { path: ['index'] },
      }),
    })
    expect(custom.match('/docs')).toEqual({ name: 'docs', params: { path: ['index'] } })
    expect(custom.href('docs', {})).toBe('#/docs')
  })

  it('treats explicit undefined as omission for every defaulted parameter kind', () => {
    const defaults = createRouter({
      docs: route('/docs/:language?', {
        defaults: { language: 'en' },
      }),
      files: route('/files/*path', {
        defaults: { path: ['index'] },
      }),
      search: route('/search', {
        query: { tags },
        defaults: { tags: ['all'] },
      }),
    })
    expect(defaults.href('docs', { language: undefined })).toBe('#/docs')
    expect(defaults.href('files', { path: undefined })).toBe('#/files')
    expect(defaults.href('search', { tags: undefined })).toBe('#/search')
  })

  it('rejects non-serializable route values from codecs, defaults, and refinements', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    class ArraySubclass extends Array<string> {}
    const arrayWithState = ['value'] as string[] & { extra?: boolean }
    arrayWithState.extra = true
    const arrayWithSymbol = ['value']
    Object.defineProperty(arrayWithSymbol, Symbol('state'), { value: true })
    const arrayWithHiddenState = ['value']
    Object.defineProperty(arrayWithHiddenState, 'hidden', { value: true })
    const arrayWithOutOfRangeState = ['value']
    Object.defineProperty(arrayWithOutOfRangeState, '4294967295', { value: true })
    const arrayWithHiddenIndex = ['value']
    Object.defineProperty(arrayWithHiddenIndex, '0', { enumerable: false })
    const nullPrototype = Object.create(null) as Record<string, unknown>
    nullPrototype.value = 'x'
    const invalidValues = [
      -0,
      new Date(),
      new Map(),
      new Set(),
      Object.create({ inherited: true }),
      nullPrototype,
      new ArraySubclass('value'),
      arrayWithState,
      arrayWithSymbol,
      arrayWithHiddenState,
      arrayWithOutOfRangeState,
      arrayWithHiddenIndex,
      { nested: arrayWithState },
      cyclic,
    ]
    for (const invalid of invalidValues) {
      const codec = routeCodec(
        fixtureSchema<string, unknown>(() => ({ value: invalid })),
        String,
      )
      expect(() =>
        createRouter({ value: route('/value/:value', { params: { value: codec } }) }).match(
          '/value/x',
        ),
      ).toThrow(/serializable.*value/i)
    }

    const identityCodec = routeCodec(
      fixtureSchema<unknown, unknown>((input) => ({ value: input })),
      String,
    )
    const generated = createRouter({
      value: route('/value/:value', { params: { value: identityCodec } }),
    })
    for (const invalid of invalidValues) {
      expect(() => generated.href('value', { value: invalid })).toThrow(/serializable.*value/i)
    }

    expect(() =>
      createRouter({
        value: route('/value', { query: { value: identityCodec }, defaults: { value: -0 } }),
      }),
    ).toThrow(/serializable.*default/i)

    const functionCodec = routeCodec(
      fixtureSchema<string, () => void>(() => ({ value: () => undefined })),
      () => 'fn',
    )
    expect(() =>
      createRouter({
        value: route('/value', {
          query: { fn: functionCodec },
          defaults: { fn: (): void => undefined },
        }),
      }),
    ).toThrow(/serializable.*default/i)

    const deriving = fixtureSchema<{ value: string }, { value: string; bad: Map<string, string> }>(
      (input) => ({ value: { ...(input as { value: string }), bad: new Map() } }),
    )
    const refined = createRouter({ value: route('/value/:value', { refine: deriving as never }) })
    expect(() => refined.match('/value/x')).toThrow(/serializable.*whole-route/i)
  })
})

describe('route construction', () => {
  it('uses static-over-parameter-over-rest precedence independent of registry order', () => {
    const make = (reverse: boolean) =>
      createRouter(
        reverse
          ? {
              rest: route('/users/*path'),
              parameter: route('/users/:id'),
              static: route('/users/new'),
            }
          : {
              static: route('/users/new'),
              parameter: route('/users/:id'),
              rest: route('/users/*path'),
            },
      )
    for (const router of [make(false), make(true)]) {
      expect(router.match('/users/new')).toEqual({ name: 'static', params: {} })
      expect(router.match('/users/123')).toEqual({ name: 'parameter', params: { id: '123' } })
      expect(router.match('/users/123/edit')).toEqual({
        name: 'rest',
        params: { path: ['123', 'edit'] },
      })
    }
  })

  it('applies precedence at the first differing segment', () => {
    const router = createRouter({
      laterStatic: route('/:first/b/:last'),
      earlierStatic: route('/a/*path'),
    })
    expect(router.match('/a/b/c')).toEqual({
      name: 'earlierStatic',
      params: { path: ['b', 'c'] },
    })
  })

  it('rejects equal-specificity ambiguity with both names', () => {
    expect(() => createRouter({ one: route('/items/:id'), two: route('/items/:slug') })).toThrow(
      /one.*two|two.*one/,
    )
  })

  it('rejects ambiguous optional expansions within one named route', () => {
    expect(() => createRouter({ bad: route('/x/:first?/:second?') })).toThrow(/bad.*bad/)
  })

  it('rejects asynchronous schemas descriptively', () => {
    const asyncSchema: StandardSchemaV1<string> = {
      '~standard': {
        version: 1,
        vendor: 'async-fixture',
        validate: async (value) => ({ value: String(value) }),
      },
    }
    const router = createRouter({
      bad: route('/bad/:value', { params: { value: routeCodec(asyncSchema, String) } }),
    })
    expect(() => router.match('/bad/value')).toThrow(/synchronous.*async-fixture/i)
  })

  it('rejects invalid templates and incompatible codec cardinalities at construction', () => {
    expect(() => createRouter({ bad: route('missing-leading-slash') })).toThrow(/start with/i)
    expect(() => createRouter({ bad: route('/files/*path/more') })).toThrow(/must be last/i)
    expect(() =>
      createRouter({ bad: route('/files/*path', { params: { path: section } }) }),
    ).toThrow(/repeated route codec/i)
    expect(() => createRouter({ bad: route('/users/:id', { params: { id: tags } }) })).toThrow(
      /scalar route codec/i,
    )
    expect(() =>
      createRouter({
        bad: route('/users/:id', { query: { id: integer } } as never),
      }),
    ).toThrow(/both.*path.*query/i)
    expect(() => createRouter({ bad: route('/x/:language?/*path') })).toThrow(
      /optional.*rest|rest.*optional/i,
    )
  })

  it('rejects defaults that do not round-trip through their declared codec', () => {
    const positive = routeCodec(
      fixtureSchema<string, number>((input) => {
        const parsed = Number(input)
        return Number.isInteger(parsed) && parsed > 0
          ? { value: parsed }
          : { issues: [{ message: 'positive integer required' }] }
      }),
      String,
    )
    expect(() =>
      createRouter({
        bad: route('/page/:number?', {
          params: { number: positive },
          defaults: { number: -1 },
        }),
      }),
    ).toThrow(/default.*number.*codec/i)
  })
})
