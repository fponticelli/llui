import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ProductContractSchema } from '../../packages/cli/src/product-contract'

const ROOT = resolve(import.meta.dirname, '../..')

type RegistryIndex = {
  productContract?: unknown
  items: readonly { name: string; type: string }[]
}

function readRegistry(path: string): RegistryIndex {
  return JSON.parse(readFileSync(resolve(ROOT, path), 'utf8')) as RegistryIndex
}

describe('published registry product contract', () => {
  it('matches the canonical source contract and item identities exactly', () => {
    const source = readRegistry('registry/registry.json')
    const published = readRegistry('site/public/r/registry.json')

    expect(ProductContractSchema.parse(published.productContract)).toEqual(
      ProductContractSchema.parse(source.productContract),
    )
    expect(published.items.map(({ name, type }) => ({ name, type }))).toEqual(
      source.items.map(({ name, type }) => ({ name, type })),
    )
  })
})
