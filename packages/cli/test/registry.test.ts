import { describe, it, expect } from 'vitest'
import {
  assertSafeTarget,
  collectDependencies,
  resolveItems,
  RegistrySchema,
  type Registry,
} from '../src/registry'

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
})

describe('collectDependencies', () => {
  it('dedupes and sorts across items', () => {
    const items = [
      { ...item('a'), dependencies: ['@llui/dom', 'clsx'] },
      { ...item('b'), dependencies: ['clsx', '@llui/components'] },
    ]
    expect(collectDependencies(items).dependencies).toEqual([
      '@llui/components',
      '@llui/dom',
      'clsx',
    ])
  })
})
