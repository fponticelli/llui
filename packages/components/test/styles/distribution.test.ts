import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PACKAGE = resolve(import.meta.dirname, '../..')
const REPO = resolve(PACKAGE, '../..')
const STYLES = resolve(PACKAGE, 'src/styles')
const BASELINE_CONSUMER = resolve(REPO, 'examples/baseline-css')
const manifest = JSON.parse(readFileSync(resolve(PACKAGE, 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>
  scripts: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, unknown>
  sideEffects?: readonly string[]
}

const BASELINE_MODULES = [
  'semantic-tokens.css',
  'semantic-tokens-dark.css',
  'foundation.css',
  'form-controls.css',
  'disclosure-navigation.css',
  'menus-overlays.css',
  'data-display.css',
  'layout.css',
  'motion.css',
] as const

const REGISTRY_TAILWIND_ENTRIES = ['tokens.css', 'tokens-dark.css'] as const
const PUBLIC_STYLES = [
  ...BASELINE_MODULES,
  ...REGISTRY_TAILWIND_ENTRIES,
  'tailwind.css',
  'theme.css',
].sort()

const readStyle = (file: string): string => readFileSync(resolve(STYLES, file), 'utf8')
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')
const importsOf = (css: string): string[] =>
  [...stripComments(css).matchAll(/@import\s+['"]([^'"]+)['"]\s*;/g)].map(
    (match) => match[1] as string,
  )

const splitSelectorList = (selector: string): string[] => {
  const out: string[] = []
  let start = 0
  let square = 0
  let round = 0
  let quote = ''
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i] as string
    if (quote !== '') {
      if (char === '\\') i++
      else if (char === quote) quote = ''
      continue
    }
    if (char === "'" || char === '"') quote = char
    else if (char === '[') square++
    else if (char === ']') square--
    else if (char === '(') round++
    else if (char === ')') round--
    else if (char === ',' && square === 0 && round === 0) {
      out.push(selector.slice(start, i).trim().replace(/\s+/g, ' '))
      start = i + 1
    }
  }
  out.push(selector.slice(start).trim().replace(/\s+/g, ' '))
  return out.filter(Boolean)
}

/**
 * The structural guard needs style-rule ownership, not declarations or
 * keyframe stops. This deliberately small scanner keeps nested media/supports
 * rules, ignores keyframe children, and is checked against a known example
 * before its verdict is trusted.
 */
type StyleRule = { selector: string; properties: readonly string[] }

const styleRules = (source: string): StyleRule[] => {
  const css = stripComments(source)
  const out: StyleRule[] = []
  const stack: Array<{
    kind: 'rules' | 'style' | 'keyframes'
    selectors: readonly string[]
    bodyStart: number
  }> = [{ kind: 'rules', selectors: [], bodyStart: 0 }]
  let start = 0
  let quote = ''

  for (let i = 0; i < css.length; i++) {
    const char = css[i] as string
    if (quote !== '') {
      if (char === '\\') i++
      else if (char === quote) quote = ''
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      continue
    }
    if (char === ';') {
      start = i + 1
      continue
    }
    if (char === '{') {
      const prelude = css.slice(start, i).trim()
      const parent = stack.at(-1)?.kind
      const ownKind = /^@(?:-\w+-)?keyframes\b/.test(prelude)
        ? 'keyframes'
        : prelude.startsWith('@')
          ? 'rules'
          : 'style'
      const kind = parent === 'keyframes' ? 'keyframes' : ownKind
      stack.push({
        kind,
        selectors: kind === 'style' ? splitSelectorList(prelude) : [],
        bodyStart: i + 1,
      })
      start = i + 1
      continue
    }
    if (char === '}') {
      const frame = stack.pop()
      if (frame?.kind === 'style') {
        const body = css.slice(frame.bodyStart, i)
        const properties = [
          ...new Set(
            [...body.matchAll(/(?:^|;)\s*([-\w]+)\s*:/g)].map((match) => match[1] as string),
          ),
        ].sort()
        for (const selector of frame.selectors) out.push({ selector, properties })
      }
      start = i + 1
    }
  }
  return out
}

const ownershipProblems = (
  modules: ReadonlyArray<readonly [file: string, source: string]>,
): { duplicateSelectors: string[]; duplicateProperties: string[] } => {
  const owners = new Map<string, Map<string, Set<string>>>()
  for (const [file, source] of modules) {
    for (const { selector, properties } of styleRules(source)) {
      const byFile = owners.get(selector) ?? new Map<string, Set<string>>()
      const owned = byFile.get(file) ?? new Set<string>()
      for (const property of properties) owned.add(property)
      byFile.set(file, owned)
      owners.set(selector, byFile)
    }
  }

  const duplicateSelectors: string[] = []
  const duplicateProperties: string[] = []
  for (const [selector, byFile] of owners) {
    const files = [...byFile.keys()].sort()
    if (files.length < 2) continue
    const concernLayered = files.length === 2 && files.includes('motion.css')
    if (!concernLayered) duplicateSelectors.push(`${selector}: ${files.join(', ')}`)

    const propertyOwners = new Map<string, string[]>()
    for (const [file, properties] of byFile) {
      for (const property of properties) {
        const propertyFiles = propertyOwners.get(property) ?? []
        propertyFiles.push(file)
        propertyOwners.set(property, propertyFiles)
      }
    }
    for (const [property, propertyFiles] of propertyOwners) {
      if (propertyFiles.length > 1)
        duplicateProperties.push(`${selector} / ${property}: ${propertyFiles.sort().join(', ')}`)
    }
  }

  return {
    duplicateSelectors: duplicateSelectors.sort(),
    duplicateProperties: duplicateProperties.sort(),
  }
}

describe('the baseline CSS distribution', () => {
  it('composes the complete theme from one deterministic module list', () => {
    expect(importsOf(readStyle('theme.css'))).toEqual(BASELINE_MODULES.map((file) => `./${file}`))
  })

  it('keeps every baseline module ordinary CSS with no Tailwind preprocessing contract', () => {
    const forbidden =
      /@(?:apply|config|custom-variant|plugin|reference|responsive|screen|source|tailwind|theme|utility|variant|variants)\b|(?:theme|screen)\s*\(|@import\s+['"](?:tailwindcss|tw-animate-css|\.\/(?:tailwind|tokens|tokens-dark)\.css)/
    for (const file of BASELINE_MODULES) {
      expect(stripComments(readStyle(file)), file).not.toMatch(forbidden)
      expect(importsOf(readStyle(file)), `${file} must stay a leaf module`).toEqual([])
    }
    expect(stripComments(readStyle('theme.css')), 'theme.css').not.toMatch(forbidden)
  })

  it('keeps the Tailwind mapping explicit and free of baseline component selectors', () => {
    const mapping = readStyle('tailwind.css')
    expect(mapping).toMatch(/@theme\s+inline\s*\{/)
    expect(mapping).toContain('--color-background: var(--background)')
    expect(mapping).toContain('--transition-duration-fast: var(--llui-duration-fast)')
    expect(mapping).not.toContain('[data-scope')
    expect(importsOf(readStyle('tokens.css'))).toEqual(['./semantic-tokens.css', './tailwind.css'])
    expect(importsOf(readStyle('tokens-dark.css'))).toEqual(['./semantic-tokens-dark.css'])
  })

  it('declares every public stylesheet export and copies the same complete set at build time', () => {
    const sourceCss = readdirSync(STYLES)
      .filter((file) => file.endsWith('.css'))
      .sort()
    expect(sourceCss).toEqual(PUBLIC_STYLES)

    const exportedCss = Object.entries(manifest.exports)
      .filter(([key, target]) => key.startsWith('./styles/') && typeof target === 'string')
      .map(([key, target]) => [key, target] as const)
      .sort(([a], [b]) => a.localeCompare(b))
    expect(exportedCss).toEqual(
      PUBLIC_STYLES.map((file) => [`./styles/${file}`, `./dist/styles/${file}`] as const).sort(
        ([a], [b]) => a.localeCompare(b),
      ),
    )
    expect(manifest.scripts['build']).toBe('tsc -p tsconfig.build.json && pnpm run publish:styles')
    expect(manifest.scripts['publish:styles']).toBe(
      'node ../../scripts/publish-component-styles.mjs',
    )
    expect(manifest.sideEffects).toEqual(['./dist/styles/*.css'])
  })

  it('does not make Tailwind an install-time package requirement', () => {
    const declared = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
    }
    expect(Object.keys(declared).filter((name) => name.includes('tailwind'))).toEqual([])
    expect(manifest.peerDependenciesMeta?.['tailwindcss']).toBeUndefined()
  })

  it('includes a real Vite consumer with no Tailwind dependency or configuration', () => {
    const consumerManifest = JSON.parse(
      readFileSync(resolve(BASELINE_CONSUMER, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(
      Object.keys({ ...consumerManifest.dependencies, ...consumerManifest.devDependencies }).filter(
        (name) => name.includes('tailwind'),
      ),
    ).toEqual([])
    expect(readFileSync(resolve(BASELINE_CONSUMER, 'src/main.ts'), 'utf8')).toContain(
      '@llui/components/styles/theme.css',
    )
    expect(readFileSync(resolve(BASELINE_CONSUMER, 'vite.config.ts'), 'utf8')).not.toMatch(
      /tailwind/i,
    )
  })

  it('keeps selector and declaration ownership deliberate across concerns', () => {
    expect(
      styleRules(
        "a, [data-x='a,b'] { color: red } @media (width > 1px) { b { color: blue } } @keyframes x { from { opacity: 0 } }",
      ),
    ).toEqual([
      { selector: 'a', properties: ['color'] },
      { selector: "[data-x='a,b']", properties: ['color'] },
      { selector: 'b', properties: ['color'] },
    ])

    expect(
      ownershipProblems([
        ['menus-overlays.css', '.x { opacity: 1 }'],
        ['motion.css', '.x { animation: fade-in 1s }'],
      ]),
      'A family module and motion.css may share a selector when they own disjoint properties.',
    ).toEqual({ duplicateSelectors: [], duplicateProperties: [] })
    expect(
      ownershipProblems([
        ['menus-overlays.css', '.x { color: red }'],
        ['data-display.css', '.x { background: blue }'],
      ]).duplicateSelectors,
      'Two component-family modules may not split a selector accidentally.',
    ).toEqual(['.x: data-display.css, menus-overlays.css'])
    expect(
      ownershipProblems([
        ['menus-overlays.css', '.x { animation: none }'],
        ['motion.css', '.x { animation: fade-in 1s }'],
      ]).duplicateProperties,
      'Concern layering may not duplicate declaration ownership.',
    ).toEqual(['.x / animation: menus-overlays.css, motion.css'])

    const problems = ownershipProblems(
      BASELINE_MODULES.filter((name) => !name.startsWith('semantic-')).map(
        (file) => [file, readStyle(file)] as const,
      ),
    )
    expect(
      problems.duplicateSelectors,
      `Selectors accidentally owned by multiple baseline family modules:\n${problems.duplicateSelectors.join('\n')}`,
    ).toEqual([])
    expect(
      problems.duplicateProperties,
      `Properties owned by multiple modules for the same selector:\n${problems.duplicateProperties.join('\n')}`,
    ).toEqual([])
  })

  it('keeps dialog backdrop animation in the motion concern', () => {
    const menusOverlays = readStyle('menus-overlays.css')
    const motion = readStyle('motion.css')
    const dialogBackdropOpen =
      /\[data-scope='dialog'\]\[data-part='backdrop'\]\[data-state='open'\][^{]*\{([^}]*)\}/s

    expect(menusOverlays.match(dialogBackdropOpen)?.[1]).not.toMatch(/\banimation\s*:/)
    expect(motion.match(dialogBackdropOpen)?.[1]).toMatch(/\banimation\s*:/)
  })

  it('owns button hover eligibility in one shared state gate', () => {
    const buttonHoverRules = styleRules(readStyle('foundation.css')).filter(
      ({ selector }) => selector.includes('.btn') && selector.includes(':hover'),
    )

    expect(buttonHoverRules).toHaveLength(1)
    expect(buttonHoverRules[0]?.selector).toBe(
      ".btn:hover:not(:disabled):not([aria-disabled='true']):not([data-disabled])",
    )
  })

  it('ships the cross-family accessibility and direction foundations', () => {
    const foundation = readStyle('foundation.css')
    const formControls = readStyle('form-controls.css')
    const familyCss = BASELINE_MODULES.filter(
      (file) => !file.startsWith('semantic-') && file !== 'foundation.css',
    )
      .map((file) => readStyle(file))
      .join('\n')
    expect(foundation).toMatch(/:focus-visible/)
    expect(foundation).toMatch(/(?:data-disabled|aria-disabled|:disabled)/)
    expect(foundation).toContain(
      "button[data-scope]:not(:disabled):not([data-disabled]):not([aria-disabled='true'])",
    )
    expect(foundation).toMatch(/direction:\s*inherit/)
    expect(foundation).toMatch(/text-align:\s*start/)
    expect(foundation).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
    expect(foundation).toMatch(/@media\s*\(forced-colors:\s*active\)/)
    expect(foundation).toMatch(/outline-color:\s*Highlight\s*!important/)
    expect(foundation).toMatch(/(?:border-color|color):\s*GrayText\s*!important/)
    const disabledStateDuplicates = [
      ...stripComments(familyCss).matchAll(
        /([^{}]*(?:data-disabled|aria-disabled|:disabled)[^{}]*)\{([^{}]*)\}/g,
      ),
    ]
      .filter((match) => /(?:^|;)\s*(?:cursor|opacity)\s*:/.test(match[2] ?? ''))
      .map((match) => (match[1] ?? '').trim().replace(/\s+/g, ' '))
    expect(
      disabledStateDuplicates,
      'Disabled cursor/opacity conventions belong to foundation.css only.',
    ).toEqual([])
    expect(formControls).not.toMatch(/:focus\s*\{[^}]*outline:\s*(?:none|0)\b/s)
    expect(formControls).toMatch(/:focus:not\(:focus-visible\)\s*\{[^}]*outline:\s*none/s)
    expect(formControls).toMatch(
      /\[data-scope='switch'\][^{]+:dir\(rtl\)[^{]*\{[^}]*translateX\(-1\.25rem\)/s,
    )
  })
})
