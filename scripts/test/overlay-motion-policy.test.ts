import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { ProductContractSchema } from '../../packages/cli/src/product-contract'
import { extractClassCandidates } from '../lib/registry-classes.mjs'
import { compileCandidates } from '../lib/tailwind-compile.mjs'
import { cssRules, readBaselineCss } from '../lib/baseline-css.mjs'

const ROOT = path.resolve(__dirname, '../..')
const REGISTRY_FILE = path.join(ROOT, 'registry/registry.json')
const REGISTRY_UI = path.join(ROOT, 'registry/llui/ui')
const SUPPORT_FILE = path.join(ROOT, 'registry/llui/lib/floating-motion.ts')
const DEMO_ROOT = path.join(ROOT, 'examples/registry-demo/src')
const STYLES = path.join(ROOT, 'packages/components/src/styles')

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
  // `closed` is never an animating phase — a real four-phase presence
  // machine unmounts its content in the same reconcile pass that flips
  // `status` to `closed` (`isMounted` is `status !== 'closed'`), so a
  // `data-[state=closed]:animate-out`-family selector could never match
  // (#265 finding 5). See floating-motion.ts's header for the full argument.
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
 * AST-based classifiers, in place of a `source.includes(...)` substring
 * match (#265 finding 4). A substring match is satisfied by a code COMMENT
 * mentioning the same text with no corresponding real construct — measured
 * on this exact file's own predecessor: `menubar.ts`'s only occurrence of
 * `skipAnimations` was a comment, and a substring `isPresenceAware` check
 * would have false-positived on it (avoided here only because that check
 * additionally requires a `presence.js` import). Parsing once per source and
 * walking for a real node is the fix that generalizes: a prose mention
 * parses to nothing that satisfies any of these.
 */
const parseModule = (source: string): ts.SourceFile =>
  ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, true)

/** A top-level `import … from '<moduleSpecifier>'`, matched exactly. */
const importsFromModule = (source: string, moduleSpecifier: string): boolean => {
  let found = false
  parseModule(source).forEachChild((node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === moduleSpecifier
    ) {
      found = true
    }
  })
  return found
}

/** A real CALL to one of `names` (`createOverlay(...)`, never a mention of
 * the word). */
const callsAnyOf = (source: string, names: readonly string[]): boolean => {
  let found = false
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      names.includes(node.expression.text)
    ) {
      found = true
    }
    node.forEachChild(visit)
  }
  visit(parseModule(source))
  return found
}

/** A real reference to identifier `name` — an import specifier or a use, as
 * an actual `Identifier` token. The compiler's own tokenizer already excludes
 * comments and string/template text, so this cannot be satisfied by prose. */
const referencesIdentifier = (source: string, name: string): boolean => {
  let found = false
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === name) found = true
    node.forEachChild(visit)
  }
  visit(parseModule(source))
  return found
}

/** An object-literal property named `key` anywhere in the source — used to
 * detect `connect(state, send, { floating: {...} })`'s `floating` option
 * without depending on its exact formatting. */
const declaresObjectLiteralKey = (source: string, key: string): boolean => {
  let found = false
  const visit = (node: ts.Node): void => {
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      ts.isIdentifier(node.name) &&
      node.name.text === key
    ) {
      found = true
    }
    node.forEachChild(visit)
  }
  visit(parseModule(source))
  return found
}

/**
 * Derive direct consumers from the canonical family and implementation
 * capability instead of maintaining another component list: a public machine
 * uses the floating engine, and its copied artifact owns a concrete Content
 * recipe rather than re-exporting one from another registry dependency.
 */
const directFloatingArtifacts = familyEntries.flatMap((entry) => {
  if (entry.machine.kind !== 'public') return []
  if (!declaresObjectLiteralKey(machineSource(entry.machine.importPath), 'floating')) return []
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
  const isOverlay = callsAnyOf(source, ['createOverlay', 'dialogOverlay'])
  const isPresenceAware =
    importsFromModule(source, './presence.js') || callsAnyOf(source, ['dialogOverlay'])
  if (!isOverlay || !isPresenceAware) return []
  return entry.copiedArtifacts.flatMap((artifact) =>
    hasOwnContentExport(artifact.name) ? [artifact.name] : [],
  )
})

/** A registry artifact whose recipe applies EITHER the four-phase presence
 * recipe or its synchronous (`open`/`closed`-only) twin — see
 * `registry/llui/lib/floating-motion.ts`'s two exports. */
const appliesSharedMotionRecipe = (source: string): boolean =>
  referencesIdentifier(source, 'floatingOverlayMotionRecipe') ||
  referencesIdentifier(source, 'floatingSyncMotionRecipe')

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

/**
 * Products whose content UNMOUNTS at `closed` (#265 G1 / finding 5): the
 * machine mounts its content through the overlay engine's `show(mountWhen)`
 * (`createOverlay`, or `dialogOverlay`, which wraps it). Every such
 * `mountWhen` is `status !== 'closed'` or the synchronous `open` boolean, so a
 * node is never both mounted AND `data-state="closed"` — an exit animation
 * keyed on `closed` can never run. `navigation-menu` is the structural
 * counter-example: it keeps content mounted with `hidden`, so it is not here.
 */
const unmountAtClosedEntries = familyEntries.flatMap((entry) => {
  if (entry.machine.kind !== 'public') return []
  const { importPath } = entry.machine
  const source = machineSource(importPath)
  return callsAnyOf(source, ['createOverlay', 'dialogOverlay'])
    ? [{ importPath, artifacts: entry.copiedArtifacts, source }]
    : []
})

/** The `data-scope` values a machine source publishes: a string literal (or a
 * module `const` bound to one, e.g. searchable-select's `SCOPE`) on a
 * `'data-scope'` key or on a `scope` option (menu-machine's parameter), plus
 * `dialog` for a `dialogOverlay` caller, whose content is Dialog's own. */
const publishedScopes = (source: string): string[] => {
  const module = parseModule(source)
  const constants = new Map<string, string>()
  module.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return
    if ((node.declarationList.flags & ts.NodeFlags.Const) === 0) return
    for (const declaration of node.declarationList.declarations) {
      let initializer = declaration.initializer
      // `'x' as const` / `'x' satisfies T` still bind the literal.
      while (
        initializer !== undefined &&
        (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer))
      ) {
        initializer = initializer.expression
      }
      if (
        ts.isIdentifier(declaration.name) &&
        initializer !== undefined &&
        ts.isStringLiteral(initializer)
      ) {
        constants.set(declaration.name.text, initializer.text)
      }
    }
  })
  const scopes = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ((ts.isStringLiteral(node.name) && node.name.text === 'data-scope') ||
        (ts.isIdentifier(node.name) && node.name.text === 'scope'))
    ) {
      const value = ts.isStringLiteral(node.initializer)
        ? node.initializer.text
        : ts.isIdentifier(node.initializer)
          ? constants.get(node.initializer.text)
          : undefined
      if (value !== undefined) scopes.add(value)
    }
    node.forEachChild(visit)
  }
  visit(module)
  if (callsAnyOf(source, ['dialogOverlay'])) scopes.add('dialog')
  return [...scopes]
}

/** A Tailwind candidate that plays an EXIT animation keyed on `closed`: any
 * variant chain containing `data-[state=closed]` whose utility is one of
 * tw-animate-css's animation/exit families. */
const CLOSED_EXIT_CANDIDATE =
  /(?:^|:)data-\[state=closed\]:(?:[^:\s]+:)*(?:animate-|fade-out|zoom-out|spin-out|slide-out|blur-out)/

/** The same, in plain CSS: a rule selecting `[data-state='closed']` on one of
 * `scopes` whose body sets an animation other than `none`. */
const closedExitRules = (css: string, scopes: ReadonlySet<string>): string[] =>
  cssRules(css).flatMap(({ selectors, body }) => {
    const animation = body.match(/(?:^|;|\s)animation(?:-name)?\s*:\s*([^;]+)/)?.[1]?.trim()
    if (animation === undefined || animation === 'none') return []
    return selectors.filter((selector) => {
      const scope = selector.match(/\[data-scope=['"]?([a-z-]+)/)?.[1]
      return (
        scope !== undefined && scopes.has(scope) && /\[data-state=['"]?closed['"]?\]/.test(selector)
      )
    })
  })

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
      // Its presence recipes are tw-animate-css classes (registry-tw-animate.test.ts).
      dependencies: ['tw-animate-css'],
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
    // Exact set, not a floor: a floor only catches the corpus going to zero,
    // never a member silently dropping out (#265 finding 1's own discipline,
    // applied to this file's derived arrays).
    expect([...animatedArtifacts].sort()).toEqual(
      [
        'alert-dialog',
        'context-menu',
        'dialog',
        'drawer',
        'dropdown-menu',
        'hover-card',
        'menubar',
        'navigation-menu',
        'popover',
        'select',
        'sheet',
        'sonner',
        'tooltip',
      ].sort(),
    )
    const violations: string[] = []
    for (const name of animatedArtifacts) {
      const source = artifactSource(name)
      if (
        !appliesSharedMotionRecipe(source) &&
        !referencesIdentifier(source, 'overlayReducedMotionRecipe')
      ) {
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
    expect([...directFloatingArtifacts].sort()).toEqual(
      ['dropdown-menu', 'hover-card', 'menubar', 'popover', 'select', 'tooltip'].sort(),
    )
    const violations: string[] = []
    for (const name of directFloatingArtifacts) {
      const source = artifactSource(name)
      if (!importsFromModule(source, '@/lib/floating-motion')) {
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
    expect([...syncArtifacts].sort()).toEqual(['menubar', 'select'].sort())
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

  it('wires every exported floating arrow through both path runtimes and content roots', () => {
    expect([...arrowArtifacts.map(({ name }) => name)].sort()).toEqual(
      ['hover-card', 'popover', 'tooltip'].sort(),
    )
    // One runtime per styling path: the Baseline theme's is the scenario
    // renderer the Component Gallery's Baseline document mounts every
    // floating case through; the Registry skins' is the copied-source sync
    // fixture's own overlays section.
    const demoFiles = [
      path.join(ROOT, 'packages/components/test/styles/menus-overlays-baseline-renderer.ts'),
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
    expect([...presenceArtifacts].sort()).toEqual(
      [
        'alert-dialog',
        'context-menu',
        'dialog',
        'drawer',
        'dropdown-menu',
        'hover-card',
        'popover',
        'sheet',
        'tooltip',
      ].sort(),
    )
    const shared = supportCandidates()
    const required = [
      'data-[state=opening]:animate-in',
      'data-[state=open]:animate-in',
      'data-[state=closing]:animate-out',
      // No `data-[state=closed]:animate-out` entry: `closed` is never an
      // animating phase for a real presence machine (#265 finding 5), and
      // the test below FORBIDS it on every product that unmounts at closed.
    ]
    const violations: string[] = []
    for (const name of presenceArtifacts) {
      const file = path.join(REGISTRY_UI, `${name}.ts`)
      const source = readFileSync(file, 'utf8')
      const local = extractClassCandidates(file, source)
      const resolved = importsFromModule(source, '@/lib/floating-motion')
        ? [...new Set([...local, ...shared])]
        : local
      for (const candidate of required) {
        if (!resolved.includes(candidate)) violations.push(`${name}: missing ${candidate}`)
      }
    }
    expect(violations).toEqual([])
  })
  it('names every product whose content unmounts at closed (exact sets)', () => {
    expect(unmountAtClosedEntries.map(({ importPath }) => importPath).sort()).toEqual(
      [
        '@llui/components/alert-dialog',
        '@llui/components/combobox',
        '@llui/components/context-menu',
        '@llui/components/dialog',
        '@llui/components/drawer',
        '@llui/components/hover-card',
        '@llui/components/menu',
        '@llui/components/menubar',
        '@llui/components/patterns/command-menu',
        '@llui/components/patterns/confirm-dialog',
        '@llui/components/patterns/searchable-select',
        '@llui/components/popover',
        '@llui/components/select',
        '@llui/components/tooltip',
      ].sort(),
    )
    const scopes = new Set(unmountAtClosedEntries.flatMap(({ source }) => publishedScopes(source)))
    expect([...scopes].sort()).toEqual(
      [
        'combobox',
        'command-menu',
        'context-menu',
        'dialog',
        'drawer',
        'hover-card',
        'menu',
        'menubar',
        'popover',
        'searchable-select',
        'select',
        'tooltip',
      ].sort(),
    )
  })

  it('never keys an exit animation on closed for a product that unmounts at closed', () => {
    // Registry side: every copied artifact of such a product, its demo copy,
    // and the shared recipe module (both copies) every one of them imports.
    const files = [
      SUPPORT_FILE,
      path.join(DEMO_ROOT, 'lib/floating-motion.ts'),
      ...unmountAtClosedEntries.flatMap(({ artifacts }) =>
        artifacts.flatMap((artifact) => [
          path.join(REGISTRY_UI, `${artifact.name}.ts`),
          path.join(DEMO_ROOT, 'components/ui', `${artifact.name}.ts`),
        ]),
      ),
    ].filter((file) => existsSync(file))
    // Exact corpus: the lib twice plus every artifact in both trees, so a
    // demo copy going missing cannot silently shrink what is checked.
    expect(files.map((file) => path.relative(ROOT, file)).sort()).toEqual(
      [
        'examples/registry-demo/src/lib/floating-motion.ts',
        'registry/llui/lib/floating-motion.ts',
        ...[
          'alert-dialog',
          'combobox',
          'command',
          'context-menu',
          'dialog',
          'drawer',
          'dropdown-menu',
          'hover-card',
          'menubar',
          'popover',
          'select',
          'sheet',
          'tooltip',
        ].flatMap((name) => [
          `examples/registry-demo/src/components/ui/${name}.ts`,
          `registry/llui/ui/${name}.ts`,
        ]),
      ].sort(),
    )
    const violations = files.flatMap((file) =>
      extractClassCandidates(file, readFileSync(file, 'utf8'))
        .filter((candidate) => CLOSED_EXIT_CANDIDATE.test(candidate))
        .map((candidate) => `${path.relative(ROOT, file)}: ${candidate}`),
    )
    expect(violations).toEqual([])

    // Baseline side: the plain-CSS sheet, per published scope.
    const scopes = new Set(unmountAtClosedEntries.flatMap(({ source }) => publishedScopes(source)))
    expect(closedExitRules(readBaselineCss(STYLES), scopes)).toEqual([])
  })

  it('detects a closed-state exit animation (both arms)', () => {
    expect(CLOSED_EXIT_CANDIDATE.test('data-[state=closed]:animate-out')).toBe(true)
    expect(CLOSED_EXIT_CANDIDATE.test('data-[state=closed]:fade-out-0')).toBe(true)
    expect(CLOSED_EXIT_CANDIDATE.test('motion-safe:data-[state=closed]:zoom-out-95')).toBe(true)
    expect(CLOSED_EXIT_CANDIDATE.test('data-[state=closed]:hidden')).toBe(false)
    expect(CLOSED_EXIT_CANDIDATE.test('data-[state=closing]:animate-out')).toBe(false)
    const css = `
      [data-scope='menu'][data-part='content'][data-state='closing'],
      [data-scope='menu'][data-part='content'][data-state='closed'] { animation: scale-out 1s; }
      [data-scope='menu'][data-part='content'][data-state='closed'] { animation: none; }
      [data-scope='collapsible'][data-part='content'][data-state='closed'] { animation: x 1s; }
      @media (prefers-reduced-motion: reduce) {
        [data-scope='popover'][data-state="closed"] { animation-name: fade-out; }
      }`
    expect(closedExitRules(css, new Set(['menu', 'popover']))).toEqual([
      "[data-scope='menu'][data-part='content'][data-state='closed']",
      `[data-scope='popover'][data-state="closed"]`,
    ])
  })
})
