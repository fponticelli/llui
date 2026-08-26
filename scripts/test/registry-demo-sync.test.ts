import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { add } from '../../packages/cli/src/add'
import { ConfigSchema } from '../../packages/cli/src/config'

/**
 * `examples/registry-demo` checks its copied `src/components/ui/` and
 * `src/lib/utils.ts` into git, on purpose: that is what a real consumer's tree
 * looks like, and it means CI compiles and browser-boots the CLI's ACTUAL
 * output rather than a hand-written approximation of it.
 *
 * The cost of that choice is drift — edit a registry item and the demo silently
 * keeps rendering the old one. This test is the other half of the bargain: it
 * re-runs `add` into a temp dir and compares byte for byte. It therefore also
 * covers the import-rewrite path end to end, which no unit test does against
 * real component source.
 */

const ROOT = path.resolve(__dirname, '../..')
const DEMO = path.join(ROOT, 'examples/registry-demo')

async function demoItems(): Promise<string[]> {
  const files = await readdir(path.join(DEMO, 'src/components/ui'))
  return files
    .filter((f) => f.endsWith('.ts'))
    .map((f) => f.replace(/\.ts$/, ''))
    .sort()
}

describe('registry-demo stays in sync with the registry', () => {
  it('every committed file matches what `llui add` produces today', async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), 'llui-demo-sync-'))
    try {
      const config = ConfigSchema.parse({
        registry: path.join(ROOT, 'registry'),
        // Mirror the demo's own components.json rather than assuming defaults —
        // a path change there must fail here, not silently pass.
        ...JSON.parse(await readFile(path.join(DEMO, 'components.json'), 'utf8')),
      })
      const items = await demoItems()
      expect(items.length).toBeGreaterThan(10)

      const result = await add({ cwd, config, names: items })
      expect(result.skipped).toEqual([])

      const stale: string[] = []
      for (const rel of result.written) {
        const [fresh, committed] = await Promise.all([
          readFile(path.join(cwd, rel), 'utf8'),
          readFile(path.join(DEMO, rel), 'utf8'),
        ])
        if (fresh !== committed) stale.push(rel)
      }

      expect(
        stale,
        'These demo files differ from the registry. Re-run:\n' +
          '  pnpm build:registry && node packages/cli/dist/cli.js add ' +
          `${items.join(' ')} --registry ./registry --cwd examples/registry-demo --overwrite`,
      ).toEqual([])
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('the demo pulls in every item the registry publishes', async () => {
    // A new registry item that no demo renders is an item nobody has looked at.
    const registry = JSON.parse(await readFile(path.join(ROOT, 'registry/registry.json'), 'utf8'))
    const published = registry.items
      .filter((i: { type: string }) => i.type === 'registry:ui')
      .map((i: { name: string }) => i.name)
      .sort()
    expect(await demoItems()).toEqual(published)
  })
})
