// Node-only: loads and Zod-validates the real ProductContract from the
// repo's generated `registry/registry.json`. Kept OUT of
// `navigation-data-scenarios.ts` so that module stays free of `node:fs` and
// the Node-backed `@llui/cli` Zod runtime — only this loader needs them.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ProductContractSchema } from '@llui/cli'
import type { ProductContract } from '@llui/cli'

const REPO_ROOT = resolve(import.meta.dirname, '../../../..')

export function loadProductContract(): ProductContract {
  const raw = JSON.parse(readFileSync(resolve(REPO_ROOT, 'registry/registry.json'), 'utf8'))
  return ProductContractSchema.parse(raw.productContract)
}
