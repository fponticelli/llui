import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
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

const reducedMotionCandidates = [
  'motion-reduce:[animation-duration:0.01ms]!',
  'motion-reduce:[transition-duration:0.01ms]!',
] as const

interface DemoArrowOverlay {
  readonly arrowPartAliases: readonly string[]
  readonly contentIdentifiers: readonly string[]
}

/**
 * Read the authored overlay call rather than matching formatting. An arrow is
 * wired only when the same connected part owns both content and arrow inside
 * the overlay's content factory, and the runtime receives the arrow selector.
 */
const demoArrowOverlays = (file: string, source: string): DemoArrowOverlay[] => {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const overlays: DemoArrowOverlay[] = []

  const visit = (node: ts.Node): void => {
    const firstArgument = ts.isCallExpression(node) ? node.arguments[0] : undefined
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'overlay' &&
      node.arguments.length === 1 &&
      firstArgument !== undefined &&
      ts.isObjectLiteralExpression(firstArgument)
    ) {
      const options = firstArgument
      const arrowSelector = options.properties.find(
        (property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) &&
          property.name.getText(sourceFile) === 'arrowSelector',
      )
      const content = options.properties.find(
        (property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === 'content',
      )

      if (
        arrowSelector &&
        ts.isStringLiteral(arrowSelector.initializer) &&
        arrowSelector.initializer.text === "[data-part='arrow']" &&
        content
      ) {
        const arrowPartAliases = new Set<string>()
        const contentPartAliases = new Set<string>()
        const contentIdentifiers = new Set<string>()
        const inspectContent = (contentNode: ts.Node): void => {
          if (ts.isIdentifier(contentNode)) contentIdentifiers.add(contentNode.text)
          if (
            ts.isSpreadAssignment(contentNode) &&
            ts.isPropertyAccessExpression(contentNode.expression) &&
            ts.isIdentifier(contentNode.expression.expression)
          ) {
            const alias = contentNode.expression.expression.text
            if (contentNode.expression.name.text === 'arrow') arrowPartAliases.add(alias)
            if (contentNode.expression.name.text === 'content') contentPartAliases.add(alias)
          }
          contentNode.forEachChild(inspectContent)
        }
        inspectContent(content.initializer)

        const pairedAliases = [...arrowPartAliases].filter((alias) => contentPartAliases.has(alias))
        if (pairedAliases.length > 0) {
          overlays.push({
            arrowPartAliases: pairedAliases,
            contentIdentifiers: [...contentIdentifiers],
          })
        }
      }
    }
    node.forEachChild(visit)
  }
  visit(sourceFile)
  return overlays
}

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

const arrowArtifacts = directFloatingArtifacts.flatMap((name) => {
  const exportedArrow = artifactSource(name).match(/export const (\w+Arrow)\s*=/)?.[1]
  return exportedArrow ? [{ name, exportedArrow }] : []
})

/**
 * Overlay machines with a real four-phase presence lifecycle; toast is not an
 * overlay and therefore stays outside this policy even though it is animated.
 *
 * `isPresenceAware` reads for the PRECISE signal — the machine imports
 * `./presence.js` (every real `opening`/`open`/`closing`/`closed` reducer
 * does: `menu.ts`/`context-menu.ts` via `presence`, `dialog.ts`/`popover.ts`/
 * `hover-card.ts`/`tooltip.ts`/`drawer.ts` via `presenceOpen`/`presenceClose`/
 * `presenceEnd`), or the machine wraps `dialogOverlay` (`alert-dialog.ts`,
 * which reuses Dialog's own presence wholesale and therefore imports none of
 * `presence.js`'s exports itself) — never a loose `source.includes('animated')`
 * / `source.includes('skipAnimations')` substring match. That looser check
 * false-positived on `menubar.ts`, whose ONLY occurrence of `skipAnimations`
 * is a code COMMENT ("Keep `skipAnimations` at its default (true) …") on a
 * machine that is a SYNCHRONOUS boolean (`open`/`closed` only, no `presence.js`
 * import at all) — exactly the #265 finding 5 class of bug, one layer in: a
 * test whose own derivation logic silently required a dead
 * `data-[state=opening]/[state=closing]` vocabulary from a machine that can
 * never reach those states.
 *
 * It ALSO requires the artifact to declare its OWN literal `*Content` recipe
 * (the same signal `directFloatingArtifacts` above uses), which is what
 * excludes `command`: `command-menu.ts` wraps `dialogOverlay` too (so it is
 * genuinely presence-AWARE — Command is normally composed inside a Dialog),
 * but `command.ts`'s registry artifact owns no Content/backdrop surface of
 * its own to animate — that chrome belongs to whichever Dialog artifact the
 * consumer composes it with, which is what this policy actually checks.
 */
const hasOwnContentExport = (name: string): boolean =>
  /export const \w*Content\s*=\s*classPart(?:WithDefaults)?\s*\(/.test(artifactSource(name))

const presenceArtifacts = familyEntries.flatMap((entry) => {
  if (entry.machine.kind !== 'public') return []
  const source = machineSource(entry.machine.importPath)
  const isOverlay = source.includes('createOverlay') || source.includes('dialogOverlay')
  const isPresenceAware =
    source.includes("from './presence.js'") || source.includes('dialogOverlay')
  if (!isOverlay || !isPresenceAware) return []
  return entry.copiedArtifacts.flatMap((artifact) =>
    hasOwnContentExport(artifact.name) ? [artifact.name] : [],
  )
})

/** A registry artifact whose recipe applies EITHER the four-phase presence
 * recipe or its synchronous (`open`/`closed`-only) twin — see
 * `registry/llui/lib/floating-motion.ts`'s two exports. */
const appliesSharedMotionRecipe = (source: string): boolean =>
  source.includes('floatingOverlayMotionRecipe') || source.includes('floatingSyncMotionRecipe')

const animatedArtifacts = [
  ...new Set(
    familyEntries.flatMap((entry) =>
      entry.copiedArtifacts.flatMap((artifact) => {
        const file = path.join(REGISTRY_UI, `${artifact.name}.ts`)
        const source = readFileSync(file, 'utf8')
        const local = extractClassCandidates(file, source)
        return local.some((candidate) => candidate.includes('animate-')) ||
          appliesSharedMotionRecipe(source)
          ? [artifact.name]
          : []
      }),
    ),
  ),
]

describe('menus-overlays registry motion policy', () => {
  it('documents menu animation opt-in as an enter-and-exit lifecycle', () => {
    for (const product of ['menu', 'context-menu'] as const) {
      const source = readFileSync(
        path.join(ROOT, 'packages/components/src/components', `${product}.ts`),
        'utf8',
      )
      const initDocs = source.match(
        /export interface \w+Init \{[\s\S]*?skipAnimations\?: boolean/,
      )?.[0]
      expect(initDocs, product).toContain('opening and closing')
      expect(initDocs, product).toContain("status 'opening' or 'closing'")
      expect(initDocs, product).toContain('animationEnd')
    }
  })

  it('publishes one scan-visible floating presence + physical-side recipe', async () => {
    expect(existsSync(SUPPORT_FILE), 'missing registry/llui/lib/floating-motion.ts').toBe(true)
    const support = supportCandidates()
    expect(support).toEqual(
      expect.arrayContaining([
        ...floatingPresenceCandidates,
        ...floatingSideCandidates,
        ...reducedMotionCandidates,
      ]),
    )

    const item = sourceRegistry.items.find(({ name }) => name === 'floating-motion')
    expect(item).toEqual({
      name: 'floating-motion',
      type: 'registry:lib',
      title: 'Overlay motion',
      description:
        'Shared presence, physical-side, and nonzero reduced-motion policy for overlay and transient skins.',
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

  it('routes every animated family skin through the nonzero reduced-motion policy', () => {
    expect(animatedArtifacts.length).toBeGreaterThan(0)
    const violations: string[] = []
    for (const name of animatedArtifacts) {
      const source = artifactSource(name)
      if (!appliesSharedMotionRecipe(source) && !source.includes('overlayReducedMotionRecipe')) {
        violations.push(`${name}: no shared reduced-motion recipe`)
      }
      const item = sourceRegistry.items.find((candidate) => candidate.name === name)
      if (!item?.registryDependencies?.includes('floating-motion')) {
        violations.push(`${name}: registryDependencies omits floating-motion`)
      }
    }
    expect(violations).toEqual([])
  })

  it('makes every direct floating-content caller import and declare the shared policy', () => {
    expect(directFloatingArtifacts.length).toBeGreaterThan(0)
    const violations: string[] = []
    for (const name of directFloatingArtifacts) {
      const source = artifactSource(name)
      if (!source.includes("from '@/lib/floating-motion'")) {
        violations.push(`${name}: missing floating-motion import`)
      }
      // A REAL four-phase presence machine must apply the presence recipe
      // (the one carrying `opening`/`closing`) to at least ONE of the
      // recipes in this file; a synchronous (`open`/`closed`-only) one must
      // apply the twin — never checked as file-exclusive, because one
      // registry FILE can legitimately own two surfaces with different
      // lifecycles (`dropdown-menu.ts` declares both `DropdownMenuContent`,
      // behind Menu's real presence, and `DropdownMenuSubContent`, a
      // synchronous submenu LEVEL — see #265 finding 7). The stricter,
      // selector-level inverse (a synchronous surface must never declare an
      // unreachable `opening`/`closing` selector) is its own test below.
      const requiredRecipe = presenceArtifacts.includes(name)
        ? 'floatingOverlayMotionRecipe'
        : 'floatingSyncMotionRecipe'
      if (!source.includes(requiredRecipe)) {
        violations.push(`${name}: does not apply ${requiredRecipe}`)
      }
      const item = sourceRegistry.items.find((candidate) => candidate.name === name)
      if (!item?.registryDependencies?.includes('floating-motion')) {
        violations.push(`${name}: registryDependencies omits floating-motion`)
      }
    }
    expect(violations).toEqual([])
  })

  it('never lets a SYNCHRONOUS (open/closed-only) skin declare an unreachable opening/closing selector', () => {
    // The inverse of "keeps opening/closing machine truth…" below: every
    // direct floating-content artifact that is NOT a real presence machine
    // must carry neither `data-[state=opening]` nor `data-[state=closing]` —
    // #265 finding 5's dead-selector regression, guarded directly rather than
    // only by the recipe-name check above (which a hand-inlined selector
    // could still bypass).
    const syncArtifacts = directFloatingArtifacts.filter(
      (name) => !presenceArtifacts.includes(name),
    )
    expect(syncArtifacts.length).toBeGreaterThan(0)
    const violations: string[] = []
    for (const name of syncArtifacts) {
      const source = artifactSource(name)
      if (source.includes('data-[state=opening]') || source.includes('data-[state=closing]')) {
        violations.push(
          `${name}: declares an opening/closing selector its own machine never reaches`,
        )
      }
    }
    expect(violations).toEqual([])
  })

  it('wires every exported floating arrow through both demo runtimes and content roots', () => {
    expect(arrowArtifacts.length).toBeGreaterThan(0)
    const demoFiles = [
      path.join(ROOT, 'examples/components-demo/src/sections/overlays.ts'),
      path.join(ROOT, 'examples/registry-demo/src/sections/overlays.ts'),
    ]

    for (const file of demoFiles) {
      const source = readFileSync(file, 'utf8')
      const overlays = demoArrowOverlays(file, source)
      expect(overlays, path.relative(ROOT, file)).toHaveLength(arrowArtifacts.length)
      expect(
        overlays.flatMap(({ arrowPartAliases }) => arrowPartAliases),
        path.relative(ROOT, file),
      ).toHaveLength(arrowArtifacts.length)

      // The copied demo has named recipe components, so additionally prove
      // every exported Arrow is inside one of the selector-owning factories.
      if (file.includes('registry-demo')) {
        for (const { name, exportedArrow } of arrowArtifacts) {
          expect(
            overlays.some(({ contentIdentifiers }) => contentIdentifiers.includes(exportedArrow)),
            name,
          ).toBe(true)
        }
      }
    }
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
