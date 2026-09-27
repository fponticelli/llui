import { describe, it, expect } from 'vitest'
import {
  assertDependencySpecs,
  assertSafeTarget,
  collectDependencies,
  parseDependencySpec,
  RegistryItemSchema,
  resolveItems,
  RegistrySchema,
  type Registry,
} from '../src/registry'
import { ProductContractSchema } from '../src/product-contract'

const item = (name: string, deps: string[] = []) => ({
  name,
  type: 'registry:ui',
  dependencies: [],
  devDependencies: [],
  registryDependencies: deps,
  files: [{ path: `registry/llui/ui/${name}.ts`, type: 'registry:ui', target: `ui/${name}.ts` }],
})

const registry = (items: ReturnType<typeof item>[]): Registry =>
  RegistrySchema.parse({ name: 'test', items })

describe('resolveItems', () => {
  it('emits dependencies before the item that needs them', () => {
    const reg = registry([item('button', ['utils']), item('utils')])
    expect(resolveItems(reg, ['button']).map((i) => i.name)).toEqual(['utils', 'button'])
  })

  it('emits a shared dependency once', () => {
    const reg = registry([item('button', ['utils']), item('card', ['utils']), item('utils')])
    expect(resolveItems(reg, ['button', 'card']).map((i) => i.name)).toEqual([
      'utils',
      'button',
      'card',
    ])
  })

  it('tolerates a dependency cycle instead of recursing forever', () => {
    const reg = registry([item('a', ['b']), item('b', ['a'])])
    expect(resolveItems(reg, ['a']).map((i) => i.name)).toEqual(['b', 'a'])
  })

  it('names the requested item when it does not exist', () => {
    expect(() => resolveItems(registry([item('utils')]), ['nope'])).toThrow(
      /Unknown registry item "nope".*Available: utils/s,
    )
  })

  it('blames the DEPENDING item when a transitive dependency is missing', () => {
    expect(() => resolveItems(registry([item('button', ['utils'])]), ['button'])).toThrow(
      /"button" depends on "utils"/,
    )
  })
})

describe('assertSafeTarget', () => {
  it.each(['../escape.ts', 'ui/../../escape.ts', '/etc/passwd'])('rejects %s', (target) => {
    expect(() => assertSafeTarget(target, 'evil')).toThrow(/unsafe file target/)
  })

  it('accepts a plain nested target', () => {
    expect(() => assertSafeTarget('ui/button.ts', 'button')).not.toThrow()
  })
})

describe('RegistrySchema', () => {
  it('ignores unknown keys so an additive registry change is not breaking', () => {
    const parsed = RegistrySchema.parse({
      name: 'test',
      futureField: 'ignored',
      items: [{ ...item('button'), docs: 'https://example.com', meta: { a: 1 } }],
    })
    expect(parsed.items[0]!.name).toBe('button')
  })

  it('rejects an item with no files', () => {
    expect(() =>
      RegistrySchema.parse({ name: 't', items: [{ ...item('x'), files: [] }] }),
    ).toThrow()
  })

  it('preserves a typed product contract when the registry publishes one', () => {
    const productContract = ProductContractSchema.parse({
      version: 2,
      entries: [
        {
          name: 'switch',
          displayName: 'Switch',
          category: 'controls',
          artifactKind: 'machine',
          machine: { kind: 'public', importPath: '@llui/components/switch' },
          copiedArtifacts: [
            {
              name: 'switch',
              artifactKind: 'skin',
              styling: { baseline: false, registryTailwind: true, styleless: false },
            },
          ],
          styling: { baseline: true, registryTailwind: true, styleless: true },
          presentation: {
            family: 'forms-controls',
            baseline: { mode: 'styled' },
            registryTailwind: { mode: 'styled' },
          },
          scenarioId: 'component:switch',
        },
      ],
      aliases: [],
    })

    const parsed = RegistrySchema.parse({ name: 'test', items: [item('switch')], productContract })

    expect(parsed.productContract).toEqual(productContract)
  })
})

describe('collectDependencies', () => {
  it('dedupes and sorts across items, exposing each @llui/* minimum', () => {
    const items = [
      { ...item('a'), dependencies: ['@llui/dom@^0.14.0', 'clsx'] },
      { ...item('b'), dependencies: ['clsx', '@llui/components@^0.20.1'] },
    ]
    expect(collectDependencies(items).dependencies).toEqual([
      {
        name: '@llui/components',
        spec: '@llui/components@^0.20.1',
        minimum: '0.20.1',
        requiredBy: ['b'],
      },
      { name: '@llui/dom', spec: '@llui/dom@^0.14.0', minimum: '0.14.0', requiredBy: ['a'] },
      { name: 'clsx', spec: 'clsx', minimum: null, requiredBy: ['a', 'b'] },
    ])
  })

  it('keeps the HIGHEST minimum when two items disagree about one @llui/* package', () => {
    // Cannot happen in a registry built from one workspace, but a hand-assembled
    // third-party registry can mix vintages; the floor that satisfies both wins.
    const items = [
      { ...item('old'), dependencies: ['@llui/components@^0.19.0'] },
      { ...item('new'), dependencies: ['@llui/components@^0.20.1'] },
      { ...item('pre'), dependencies: ['@llui/components@^0.20.1-rc.1'] },
    ]
    expect(collectDependencies(items).dependencies).toEqual([
      {
        name: '@llui/components',
        spec: '@llui/components@^0.20.1',
        minimum: '0.20.1',
        requiredBy: ['old', 'new', 'pre'],
      },
    ])
  })

  it('reports dev dependencies separately, with the same shape', () => {
    const items = [{ ...item('a'), devDependencies: ['@llui/test@^0.3.0', 'vitest'] }]
    const { dependencies, devDependencies } = collectDependencies(items)
    expect(dependencies).toEqual([])
    expect(devDependencies.map((d) => [d.name, d.minimum])).toEqual([
      ['@llui/test', '0.3.0'],
      ['vitest', null],
    ])
  })
})

describe('parseDependencySpec', () => {
  it.each([
    ['clsx', 'clsx', null],
    ['clsx@^2.1.1', 'clsx', '^2.1.1'],
    ['@llui/dom', '@llui/dom', null],
    ['@llui/components@^0.20.1', '@llui/components', '^0.20.1'],
    ['@llui/components@workspace:^', '@llui/components', 'workspace:^'],
  ])('%s', (spec, name, range) => {
    expect(parseDependencySpec(spec)).toEqual({ name, range })
  })
})

describe('assertDependencySpecs', () => {
  const withDeps = (dependencies: string[], devDependencies: string[] = []) =>
    RegistryItemSchema.parse({ ...item('sonner'), dependencies, devDependencies })

  it('accepts a built @llui/* spec and leaves non-@llui deps alone', () => {
    expect(() =>
      assertDependencySpecs(withDeps(['@llui/components@^0.20.1', 'clsx', 'x@*']), 'built'),
    ).not.toThrow()
  })

  it.each([
    ['@llui/components', /"sonner".*"@llui\/components" without a minimum version/s],
    ['@llui/components@0.20.1', /"sonner".*"@llui\/components@0\.20\.1"/s],
    ['@llui/components@>=0.20.1', /"sonner".*"@llui\/components@>=0\.20\.1"/s],
    ['@llui/components@^0.20', /"sonner".*"@llui\/components@\^0\.20"/s],
    ['@llui/components@^banana', /"sonner".*"@llui\/components@\^banana"/s],
  ])('rejects %s with an error naming the item and the expected form', (spec, message) => {
    const err = (() => {
      try {
        assertDependencySpecs(withDeps([spec]), 'built')
      } catch (e) {
        return e
      }
      return null
    })()
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(message)
    expect((err as Error).message).toContain('@llui/components@^<version>')
  })

  it('checks devDependencies too', () => {
    expect(() => assertDependencySpecs(withDeps([], ['@llui/test']), 'built')).toThrow(
      /"@llui\/test" without a minimum version/,
    )
  })

  it('accepts the workspace:^ source form only in a workspace (unbuilt) registry', () => {
    const source = withDeps(['@llui/components@workspace:^'])
    expect(() => assertDependencySpecs(source, 'workspace')).not.toThrow()
    expect(() => assertDependencySpecs(source, 'built')).toThrow(/unbuilt source spec/)
  })
})
