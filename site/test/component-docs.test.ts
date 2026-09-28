/**
 * Generated component docs (#269): every fact a reader sees about the component inventory,
 * install names, aliases, styling support and gallery links is rendered from the product
 * contract, and the committed files match a fresh render.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import type { ProductContract, ProductEntry } from '@llui/cli'
import { galleryHref } from '@llui/cli/gallery'
import {
  COMPONENT_DOC_TARGETS,
  ENTRY_POINT_ROLES,
  FRAGMENT_IDS,
  STYLESHEET_ROLES,
  apiAnchor,
  endMarker,
  generatedRegions,
  renderFragment,
  spliceFragments,
  startMarker,
  stylesheetImports,
  type ComponentDocsInput,
  type FragmentId,
} from '../src/component-docs.js'
import {
  REPO_ROOT,
  loadComponentDocsInput,
  regenerateTarget,
} from '../src/generate-component-docs.js'

const SITE = { path: 'site/content/component-catalog.md', links: 'site' } as const
const ABSOLUTE = { path: 'packages/cli/README.md', links: 'absolute' } as const

let input: ComponentDocsInput
let contract: ProductContract

beforeAll(() => {
  input = loadComponentDocsInput()
  contract = input.contract
})

const machineOf = (entry: ProductEntry): string | undefined =>
  entry.machine.kind === 'public' ? entry.machine.importPath : undefined

/** Table rows of a rendered fragment, as arrays of trimmed cells. */
function rows(markdown: string): string[][] {
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('| ') && !/^\| -/.test(line))
    .map((line) =>
      line
        .slice(2, -2)
        .split(' | ')
        .map((c) => c.trim()),
    )
}

describe('summary', () => {
  it('derives every count from the contract', () => {
    const md = renderFragment('summary', input, SITE)
    const byKind = (kind: ProductEntry['artifactKind']) =>
      contract.entries.filter((entry) => entry.artifactKind === kind)
    expect(md).toContain(`**${contract.entries.length} components**`)
    const table = rows(md)
    const machineRow = table.find(([kind]) => kind === 'machine')!
    expect(machineRow[1]).toBe(String(byKind('machine').length))
    expect(machineRow[2]).toBe(String(byKind('machine').length))
    expect(machineRow[3]).toBe(
      String(byKind('machine').filter((e) => e.copiedArtifacts.length > 0).length),
    )
    const presentational = table.find(([kind]) => kind === 'presentational')!
    expect(presentational[2]).toBe('none, by design')
    const total = table.find(([kind]) => kind === '**all**')!
    expect(total[1]).toBe(`**${contract.entries.length}**`)
    expect(total[2]).toBe(
      `**${contract.entries.filter((e) => machineOf(e) !== undefined).length}**`,
    )
    const copied = contract.entries.flatMap((e) => e.copiedArtifacts).length
    expect(total[3]).toBe(`**${copied} add names**, ${contract.aliases.length} aliases among them`)
  })

  it('never implies that `llui add` and the package import are the same artifact', () => {
    const md = renderFragment('summary', input, SITE)
    expect(md).toMatch(/imports a component's \*\*headless machine\*\*/)
    expect(md).toMatch(/\*\*copies styled source\*\*/)
    expect(md).toContain('They are different artifacts')
  })

  it('links the catalog site-relatively on the site and absolutely elsewhere', () => {
    expect(renderFragment('summary', input, { path: 'x.md', links: 'site' })).toContain(
      '](/component-catalog)',
    )
    expect(renderFragment('summary', input, ABSOLUTE)).toContain(
      '](https://llui.dev/component-catalog)',
    )
  })
})

describe('inventory', () => {
  it('lists every canonical entry exactly once, with its stable gallery link', () => {
    const md = renderFragment('inventory', input, SITE)
    const table = rows(md).filter(([first]) => first !== 'Component')
    expect(table.map((row) => /\(`([a-z0-9-]+)`\)$/.exec(row[0]!)?.[1]).sort()).toEqual(
      contract.entries.map(({ name }) => name).sort(),
    )
    for (const entry of contract.entries) {
      const row = table.find((r) => r[0]!.endsWith(`(\`${entry.name}\`)`))!
      const href = galleryHref(contract, entry.name, { base: '/apps/component-gallery/' })
      expect(row[6]).toBe(`[open](${href})`)
    }
  })

  it('shows the machine import, every add name, and flags aliases and machine-free entries', () => {
    const md = renderFragment('inventory', input, SITE)
    const table = rows(md)
    const aliases = new Set(contract.aliases.map(({ name }) => name))
    for (const entry of contract.entries) {
      const row = table.find((r) => r[0]!.endsWith(`(\`${entry.name}\`)`))!
      const machine = machineOf(entry)
      expect(row[2]).toBe(
        machine === undefined ? '—' : `[\`${machine}\`](/api/components#${apiAnchor(machine)})`,
      )
      for (const { name } of entry.copiedArtifacts) {
        expect(row[3]).toContain(aliases.has(name) ? `\`${name}\` (alias)` : `\`${name}\``)
      }
      if (entry.copiedArtifacts.length === 0) expect(row[3]).toBe('—')
    }
  })

  it('groups by category, one heading per non-empty category', () => {
    const md = renderFragment('inventory', input, SITE)
    const headings = md.split('\n').filter((line) => line.startsWith('### '))
    const categories = new Set(contract.entries.map(({ category }) => category))
    expect(headings).toHaveLength(categories.size)
  })

  it('follows the contract: an added entry appears without touching any prose', () => {
    const extra: ProductEntry = {
      ...contract.entries.find(({ name }) => name === 'accordion')!,
      name: 'zz-probe',
      displayName: 'ZZ Probe',
      scenarioId: 'component:zz-probe',
      machine: { kind: 'public', importPath: '@llui/components/zz-probe' },
      copiedArtifacts: [
        {
          name: 'zz-probe',
          artifactKind: 'skin',
          styling: { baseline: false, registryTailwind: true, styleless: false },
        },
      ],
    }
    const grown = { ...input, contract: { ...contract, entries: [...contract.entries, extra] } }
    const md = renderFragment('inventory', grown, SITE)
    expect(md).toContain('**ZZ Probe** (`zz-probe`)')
    expect(renderFragment('summary', grown, SITE)).toContain(
      `**${contract.entries.length + 1} components**`,
    )
  })
})

describe('aliases and differing names', () => {
  it('has one row per contract alias, naming its canonical entry and import', () => {
    const md = renderFragment('aliases', input, SITE)
    const table = rows(md).filter(([first]) => first !== '`llui add` alias')
    expect(table.map(([alias]) => alias).sort()).toEqual(
      contract.aliases.map(({ name }) => `\`${name}\``).sort(),
    )
    for (const alias of contract.aliases) {
      const row = table.find(([name]) => name === `\`${alias.name}\``)!
      expect(row[2]).toContain(`(\`${alias.canonicalName}\`)`)
      expect(row[4]).toBe(
        `[open](${galleryHref(contract, alias.name, { base: '/apps/component-gallery/' })})`,
      )
      expect(md).toMatch(new RegExp(`^llui add ${alias.name} +# copies the `, 'm'))
    }
  })

  it('explains the form / form-field split instead of letting the shared name imply one artifact', () => {
    const md = renderFragment('name-differences', input, SITE)
    const formField = rows(md).find(([component]) => component!.endsWith('(`form-field`)'))!
    expect(formField[2]).toBe('`form`')
    expect(formField[3]).toContain('`@llui/components/form` is the separate Form machine')
  })

  it('lists every machine with nothing to copy, and every extra copied variant', () => {
    const md = renderFragment('name-differences', input, SITE)
    const components = rows(md).map(([component]) => component)
    for (const entry of contract.entries) {
      if (machineOf(entry) === undefined) continue
      const names = entry.copiedArtifacts.map(({ name }) => name)
      const differs = names.length !== 1 || names[0] !== entry.name
      expect(components.some((c) => c!.endsWith(`(\`${entry.name}\`)`))).toBe(differs)
    }
  })

  it('lists every machine-free entry, and nothing with a machine', () => {
    const md = renderFragment('machine-free', input, SITE)
    const listed = rows(md)
      .slice(1)
      .map(([component]) => /\(`([a-z0-9-]+)`\)$/.exec(component!)?.[1])
    expect(listed.sort()).toEqual(
      contract.entries
        .filter(({ machine }) => machine.kind === 'none')
        .map(({ name }) => name)
        .sort(),
    )
  })
})

describe('machine imports and entry points', () => {
  it('lists every public machine import once', () => {
    const md = renderFragment('machine-imports', input, SITE)
    for (const entry of contract.entries) {
      const machine = machineOf(entry)
      if (machine === undefined) continue
      const sub = machine.replace('@llui/components/', '')
      expect(md.split(`[\`${sub}\`](`).length - 1).toBe(1)
    }
  })

  it('documents every non-product export, closed at both ends', () => {
    expect(() => renderFragment('entry-points', input, SITE)).not.toThrow()
    const extra = { ...input, componentExports: [...input.componentExports, './brand-new'] }
    expect(() => renderFragment('entry-points', extra, SITE)).toThrow(/undocumented: \.\/brand-new/)
    const fewer = {
      ...input,
      componentExports: input.componentExports.filter((key) => key !== './icon'),
    }
    expect(() => renderFragment('entry-points', fewer, SITE)).toThrow(
      /documented but not exported: \.\/icon/,
    )
    expect(Object.keys(ENTRY_POINT_ROLES).length).toBeGreaterThan(0)
  })
})

describe('stylesheets', () => {
  it('derives the complete-theme order from theme.css itself', () => {
    const theme = input.stylesheets.find(({ file }) => file === 'theme.css')!.source
    const order = stylesheetImports(theme)
    const md = renderFragment('stylesheets', input, SITE)
    expect(md).toContain(order.map((file) => `\`${file}\``).join(' → '))
  })

  it('documents every exported stylesheet, closed at both ends', () => {
    const md = renderFragment('stylesheets', input, SITE)
    for (const file of Object.keys(STYLESHEET_ROLES)) expect(md).toContain(`| \`${file}\` |`)
    const extra = {
      ...input,
      componentExports: [...input.componentExports, './styles/brand-new.css'],
      stylesheets: [...input.stylesheets, { file: 'brand-new.css', source: '' }],
    }
    expect(() => renderFragment('stylesheets', extra, SITE)).toThrow(/undocumented: brand-new\.css/)
  })

  it('writes a modular bundle that keeps tokens and foundation first and motion last', () => {
    const md = renderFragment('stylesheets', input, SITE)
    const block = /```css\n([\s\S]*?)```/.exec(md)![1]!.trim().split('\n')
    expect(block[0]).toBe("@import '@llui/components/styles/semantic-tokens.css';")
    expect(block).toContain("@import '@llui/components/styles/foundation.css';")
    expect(block[block.length - 1]).toBe("@import '@llui/components/styles/motion.css';")
  })

  it('refuses to document a theme.css whose import order breaks the modular contract', () => {
    const reordered = {
      ...input,
      stylesheets: input.stylesheets.map((sheet) =>
        sheet.file === 'theme.css'
          ? {
              file: sheet.file,
              source: sheet.source.replace(
                "@import './foundation.css';",
                "@import './motion.css';\n@import './foundation.css';",
              ),
            }
          : sheet,
      ),
    }
    expect(() => renderFragment('stylesheets', reordered, SITE)).toThrow(
      /documented order is wrong/,
    )
  })

  it('places tokens.css on the Registry path and theme.css on the Baseline path only', () => {
    const table = rows(renderFragment('stylesheets', input, SITE))
    expect(table.find(([file]) => file === '`theme.css`')![1]).toBe('Baseline theme')
    expect(table.find(([file]) => file === '`tokens.css`')![1]).toBe('Registry skins')
    expect(table.find(([file]) => file === '`tailwind.css`')![1]).toBe('Registry skins')
    expect(table.find(([file]) => file === '`semantic-tokens.css`')![1]).toBe('both paths')
    expect(table.find(([file]) => file === '`foundation.css`')![1]).toBe('Baseline theme')
  })
})

describe('regions', () => {
  const body = (id: FragmentId, text: string) => `${startMarker(id)}\n\n${text}\n\n${endMarker(id)}`

  it('splices only between markers and leaves the rest byte-identical', () => {
    const before = `# T\n\nhand\n\n${body('summary', 'old')}\n\ntail\n`
    const after = spliceFragments(before, new Map([['summary', 'new\n']]), ['summary'])
    expect(after).toBe(`# T\n\nhand\n\n${body('summary', 'new')}\n\ntail\n`)
  })

  it('refuses a missing, extra, duplicated, unknown, unclosed or nested region', () => {
    const one = body('summary', 'x')
    const map = new Map<FragmentId, string>([
      ['summary', 'y'],
      ['aliases', 'z'],
    ])
    expect(() => spliceFragments(one, map, ['summary', 'aliases'])).toThrow(/do not match/)
    expect(() => spliceFragments(`${one}\n${body('aliases', 'z')}`, map, ['summary'])).toThrow(
      /do not match/,
    )
    expect(() => generatedRegions(`${one}\n${one}`)).toThrow(/more than once/)
    expect(() =>
      generatedRegions('<!-- product-contract:nope:start --><!-- product-contract:nope:end -->'),
    ).toThrow(/unknown generated fragment/)
    expect(() => generatedRegions(startMarker('summary'))).toThrow(/never closed/)
    expect(() => generatedRegions(`${startMarker('summary')}${startMarker('aliases')}`)).toThrow(
      /inside unterminated/,
    )
  })

  it('every declared fragment id is used by some target', () => {
    const used = new Set(COMPONENT_DOC_TARGETS.flatMap(({ fragments }) => fragments))
    expect([...used].sort()).toEqual([...FRAGMENT_IDS].sort())
  })
})

describe('wiring', () => {
  it('pnpm check:generated diffs every target file, including the ones outside site/', () => {
    const script = readFileSync(resolve(REPO_ROOT, 'scripts/check-generated.mjs'), 'utf-8')
    for (const { path } of COMPONENT_DOC_TARGETS) {
      const listed =
        script.includes(`'${path}'`) ||
        (path.startsWith('site/content/api/') && script.includes(`'site/content/api'`))
      expect(listed, path).toBe(true)
    }
  })

  it("the site's generate script runs the generator before llms-full is assembled", () => {
    const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, 'site/package.json'), 'utf-8')) as {
      scripts: Record<string, string>
    }
    const generate = pkg.scripts.generate!
    const at = generate.indexOf('tsx src/generate-component-docs.ts')
    expect(at).toBeGreaterThan(generate.indexOf('tsx src/generate-api.ts'))
    expect(at).toBeLessThan(generate.indexOf('tsx src/generate-llms.ts'))
  })
})

describe('hand-written mapping examples agree with the contract', () => {
  // Prose that illustrates "an add name is not an import path" cites these pairs by hand. Each
  // must stay TRUE in the contract, or the example teaches the wrong mapping.
  it('`llui add dropdown-menu` copies the skin for @llui/components/menu', () => {
    const owner = contract.entries.find(({ copiedArtifacts }) =>
      copiedArtifacts.some(({ name }) => name === 'dropdown-menu'),
    )!
    expect(machineOf(owner)).toBe('@llui/components/menu')
    expect(contract.aliases).toContainEqual({ name: 'dropdown-menu', canonicalName: 'menu' })
  })

  it('`llui add form` copies the form-field pattern adapter, not the form machine', () => {
    const owner = contract.entries.find(({ copiedArtifacts }) =>
      copiedArtifacts.some(({ name }) => name === 'form'),
    )!
    expect(owner.name).toBe('form-field')
    expect(machineOf(owner)).toBe('@llui/components/patterns/form-field')
    const form = contract.entries.find(({ name }) => name === 'form')!
    expect(machineOf(form)).toBe('@llui/components/form')
    expect(form.copiedArtifacts).toEqual([])
  })

  it('`@llui/components/dropdown-menu` is not an import', () => {
    expect(input.componentExports).not.toContain('./dropdown-menu')
  })
})

describe('committed docs match a fresh render (drift)', () => {
  for (const target of COMPONENT_DOC_TARGETS) {
    it(target.path, async () => {
      const committed = readFileSync(resolve(REPO_ROOT, target.path), 'utf-8')
      const regenerated = await regenerateTarget(committed, target, input)
      // On failure: run `pnpm --filter @llui/site run generate` and commit the result.
      expect(regenerated).toBe(committed)
    })
  }
})
