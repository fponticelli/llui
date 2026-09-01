import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { ProductContractSchema } from '../../packages/cli/src/product-contract'
import { extractClassCandidates } from '../lib/registry-classes.mjs'
import { compileCandidates } from '../lib/tailwind-compile.mjs'

const ROOT = path.resolve(__dirname, '../..')
const REGISTRY_FILE = path.join(ROOT, 'registry/registry.json')
const REGISTRY_UI = path.join(ROOT, 'registry/llui/ui')
const SUPPORT_FILE = path.join(ROOT, 'registry/llui/lib/floating-motion.ts')

interface RegistryItem {
  name: string
  type: string
  registryDependencies?: string[]
  files?: Array<{ path: string; type: string; target?: string }>
}

const sourceRegistry = JSON.parse(readFileSync(REGISTRY_FILE, 'utf8')) as {
  productContract?: unknown
  items: RegistryItem[]
}
const productContract = ProductContractSchema.parse(sourceRegistry.productContract)
const familyEntries = productContract.entries.filter(
  (entry) => entry.presentation.family === 'menus-overlays',
)

const machineSource = (importPath: string): string => {
  const relative = importPath.replace('@llui/components/', '')
  const source = relative.startsWith('patterns/')
    ? path.join(ROOT, 'packages/components/src', `${relative}.ts`)
    : path.join(ROOT, 'packages/components/src/components', `${relative}.ts`)
  return readFileSync(source, 'utf8')
}

const artifactSource = (name: string): string =>
  readFileSync(path.join(REGISTRY_UI, `${name}.ts`), 'utf8')

const supportCandidates = (): string[] =>
  existsSync(SUPPORT_FILE)
    ? extractClassCandidates(SUPPORT_FILE, readFileSync(SUPPORT_FILE, 'utf8'))
    : []

const floatingPresenceCandidates = [
  'data-[state=opening]:animate-in',
  'data-[state=opening]:fade-in-0',
  'data-[state=opening]:zoom-in-95',
  'data-[state=open]:animate-in',
  'data-[state=open]:fade-in-0',
  'data-[state=open]:zoom-in-95',
  'data-[state=closing]:animate-out',
  'data-[state=closing]:fade-out-0',
  'data-[state=closing]:zoom-out-95',
  'data-[state=closed]:animate-out',
  'data-[state=closed]:fade-out-0',
  'data-[state=closed]:zoom-out-95',
] as const

const floatingSideCandidates = [
  'data-[side=bottom]:slide-in-from-top-2',
  'data-[side=left]:slide-in-from-right-2',
  'data-[side=right]:slide-in-from-left-2',
  'data-[side=top]:slide-in-from-bottom-2',
] as const

/**
 * Derive direct consumers from the canonical family and implementation
 * capability instead of maintaining another component list: a public machine
 * uses the floating engine, and its copied artifact owns a concrete Content
 * recipe rather than re-exporting one from another registry dependency.
 */
const directFloatingArtifacts = familyEntries.flatMap((entry) => {
  if (entry.machine.kind !== 'public') return []
  if (!/\bfloating:\s*\{/.test(machineSource(entry.machine.importPath))) return []
  return entry.copiedArtifacts.flatMap((artifact) => {
    const source = artifactSource(artifact.name)
    return /export const \w*Content\s*=\s*classPart(?:WithDefaults)?\s*\(/.test(source)
      ? [artifact.name]
      : []
  })
})

/** Overlay machines with a real four-phase presence lifecycle; toast is not an
 * overlay and therefore stays outside this policy even though it is animated. */
const presenceArtifacts = familyEntries.flatMap((entry) => {
  if (entry.machine.kind !== 'public') return []
  const source = machineSource(entry.machine.importPath)
  const isOverlay = source.includes('createOverlay') || source.includes('dialogOverlay')
  const isPresenceAware = source.includes('skipAnimations') || source.includes('animated')
  if (!isOverlay || !isPresenceAware) return []
  return entry.copiedArtifacts.map((artifact) => artifact.name)
})

describe('menus-overlays registry motion policy', () => {
  it('publishes one scan-visible floating presence + physical-side recipe', async () => {
    expect(existsSync(SUPPORT_FILE), 'missing registry/llui/lib/floating-motion.ts').toBe(true)
    const support = supportCandidates()
    expect(support).toEqual(
      expect.arrayContaining([...floatingPresenceCandidates, ...floatingSideCandidates]),
    )

    const item = sourceRegistry.items.find(({ name }) => name === 'floating-motion')
    expect(item).toEqual({
      name: 'floating-motion',
      type: 'registry:lib',
      title: 'Floating overlay motion',
      description: 'Shared presence and physical-side animation policy for floating overlay skins.',
      dependencies: [],
      registryDependencies: [],
      files: [
        {
          path: 'registry/llui/lib/floating-motion.ts',
          type: 'registry:lib',
          target: 'floating-motion.ts',
        },
      ],
    })

    const { dead } = await compileCandidates(support)
    expect(dead).toEqual([])
  })

  it('makes every direct floating-content caller import and declare the shared policy', () => {
    expect(directFloatingArtifacts.length).toBeGreaterThan(0)
    const violations: string[] = []
    for (const name of directFloatingArtifacts) {
      const source = artifactSource(name)
      if (!source.includes("from '@/lib/floating-motion'")) {
        violations.push(`${name}: missing floating-motion import`)
      }
      if (!source.includes('floatingOverlayMotionRecipe')) {
        violations.push(`${name}: shared recipe is not applied`)
      }
      const item = sourceRegistry.items.find((candidate) => candidate.name === name)
      if (!item?.registryDependencies?.includes('floating-motion')) {
        violations.push(`${name}: registryDependencies omits floating-motion`)
      }
    }
    expect(violations).toEqual([])
  })

  it('keeps opening/closing machine truth and open/closed compatibility synchronized', () => {
    expect(presenceArtifacts.length).toBeGreaterThan(0)
    const shared = supportCandidates()
    const required = [
      'data-[state=opening]:animate-in',
      'data-[state=open]:animate-in',
      'data-[state=closing]:animate-out',
      'data-[state=closed]:animate-out',
    ]
    const violations: string[] = []
    for (const name of presenceArtifacts) {
      const file = path.join(REGISTRY_UI, `${name}.ts`)
      const source = readFileSync(file, 'utf8')
      const local = extractClassCandidates(file, source)
      const resolved = source.includes("from '@/lib/floating-motion'")
        ? [...new Set([...local, ...shared])]
        : local
      for (const candidate of required) {
        if (!resolved.includes(candidate)) violations.push(`${name}: missing ${candidate}`)
      }
    }
    expect(violations).toEqual([])
  })
})
