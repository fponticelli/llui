import { describe, expect, it } from 'vitest'
import { formatProductList } from '../src/product-list'
import { RegistrySchema } from '../src/registry'

const item = (name: string, type = 'registry:ui') => ({
  name,
  type,
  description: `${name} description`,
  dependencies: [],
  devDependencies: [],
  registryDependencies: [],
  files: [{ path: `${name}.ts`, type, target: `${name}.ts` }],
})

const publicEntry = (
  name: string,
  copiedNames: string[],
  artifactKind: 'machine' | 'pattern' = 'machine',
) => ({
  name,
  displayName: name,
  category: artifactKind === 'pattern' ? 'patterns' : 'controls',
  artifactKind,
  machine: {
    kind: 'public' as const,
    importPath: `@llui/components/${artifactKind === 'pattern' ? 'patterns/' : ''}${name}`,
  },
  copiedArtifacts: copiedNames.map((copiedName) => ({
    name: copiedName,
    artifactKind: artifactKind === 'pattern' ? ('pattern' as const) : ('skin' as const),
    styling: { baseline: false, registryTailwind: true, styleless: false },
  })),
  styling: {
    baseline: name === 'switch',
    registryTailwind: copiedNames.length > 0,
    styleless: true,
  },
  scenarioId: `component:${name}`,
})

describe('formatProductList', () => {
  it('explains add versus import and identifies every artifact relationship', () => {
    const registry = RegistrySchema.parse({
      name: 'test',
      productContract: {
        version: 1,
        entries: [
          publicEntry('switch', ['switch']),
          publicEntry('presence', []),
          publicEntry('breadcrumbs', ['breadcrumb']),
          publicEntry('command-menu', ['command'], 'pattern'),
          publicEntry('form', []),
          publicEntry('form-field', ['form'], 'pattern'),
          {
            ...publicEntry('date-picker', []),
            displayName: 'Date Picker',
            copiedArtifacts: [
              {
                name: 'calendar',
                displayName: 'Calendar / Date Picker',
                artifactKind: 'skin',
                scenarioId: 'registry:calendar',
                styling: { baseline: false, registryTailwind: true, styleless: false },
              },
              {
                name: 'date-picker',
                artifactKind: 'skin',
                scenarioId: 'registry:date-picker',
                styling: { baseline: false, registryTailwind: true, styleless: false },
              },
            ],
            styling: { baseline: true, registryTailwind: true, styleless: true },
          },
          {
            ...publicEntry('machine-backed-skin', ['machine-backed-skin']),
            artifactKind: 'skin',
          },
          {
            name: 'button',
            displayName: 'Button',
            category: 'controls',
            artifactKind: 'presentational',
            machine: { kind: 'none', reason: 'presentational' },
            copiedArtifacts: [
              {
                name: 'button',
                artifactKind: 'presentational',
                styling: { baseline: false, registryTailwind: true, styleless: false },
              },
            ],
            styling: { baseline: false, registryTailwind: true, styleless: false },
            scenarioId: 'registry:button',
          },
          {
            name: 'icon-set',
            displayName: 'Icon Set',
            category: 'utilities',
            artifactKind: 'presentational',
            machine: { kind: 'none', reason: 'presentational' },
            copiedArtifacts: [
              {
                name: 'icons',
                artifactKind: 'presentational',
                styling: { baseline: false, registryTailwind: true, styleless: false },
              },
            ],
            styling: { baseline: false, registryTailwind: true, styleless: false },
            scenarioId: 'registry:icon-set',
          },
          {
            name: 'sidebar',
            displayName: 'Sidebar',
            category: 'layout',
            artifactKind: 'skin',
            machine: { kind: 'none', reason: 'application-owned-state' },
            copiedArtifacts: [
              {
                name: 'sidebar',
                artifactKind: 'skin',
                styling: { baseline: false, registryTailwind: true, styleless: false },
              },
            ],
            styling: { baseline: false, registryTailwind: true, styleless: false },
            scenarioId: 'registry:sidebar',
          },
        ],
        aliases: [
          { name: 'breadcrumb', canonicalName: 'breadcrumbs' },
          { name: 'command', canonicalName: 'command-menu' },
          { name: 'icons', canonicalName: 'icon-set' },
        ],
      },
      items: [
        item('switch'),
        item('breadcrumb'),
        item('calendar'),
        item('command'),
        item('date-picker'),
        item('form'),
        item('button'),
        item('icons'),
        item('sidebar'),
        item('utils', 'registry:lib'),
      ],
    })

    const output = formatProductList(registry)

    expect(output).toContain('`llui add <name>` copies registry/Tailwind source into your app')
    expect(output).toContain('`@llui/components/*` imports headless state machines')
    expect(output).toContain('related artifacts, not interchangeable commands')
    expect(output).toMatch(/—\s+switch\s+switch\s+controls\s+machine\s+@llui\/components\/switch/)
    expect(output).toMatch(/switch\s+switch\s+switch\s+controls\s+skin\s+@llui\/components\/switch/)
    expect(output).toMatch(
      /—\s+presence\s+presence\s+controls\s+machine\s+@llui\/components\/presence/,
    )
    expect(output).toMatch(
      /breadcrumb\s+breadcrumbs\s+breadcrumbs\s+controls\s+alias skin → breadcrumbs\s+@llui\/components\/breadcrumbs/,
    )
    expect(output).toMatch(
      /command\s+command-menu\s+command-menu\s+patterns\s+alias pattern → command-menu\s+@llui\/components\/patterns\/command-menu/,
    )
    expect(output).toMatch(
      /icons\s+icon-set\s+Icon Set\s+utilities\s+alias presentational → icon-set\s+—/,
    )
    expect(output).toMatch(
      /calendar\s+date-picker\s+Calendar \/ Date Picker\s+controls\s+skin\s+@llui\/components\/date-picker/,
    )
    expect(output).toMatch(
      /date-picker\s+date-picker\s+Date Picker\s+controls\s+skin\s+@llui\/components\/date-picker/,
    )
    expect(output).toMatch(/button\s+button\s+Button\s+controls\s+presentational\s+—/)
    expect(output).toMatch(
      /sidebar\s+sidebar\s+Sidebar\s+layout\s+skin \(application-owned state\)\s+—/,
    )
    expect(output).toMatch(
      /machine-backed-skin\s+machine-backed-skin\s+machine-backed-skin\s+controls\s+skin\s+@llui\/components\/machine-backed-skin/,
    )
    expect(output).not.toContain('skin + machine')
    expect(output).toMatch(/—\s+form\s+form\s+controls\s+machine\s+@llui\/components\/form/)
    expect(output).toMatch(
      /form\s+form-field\s+form-field\s+patterns\s+pattern adapter\s+@llui\/components\/patterns\/form-field/,
    )
    expect(output).toContain('Registry support files: utils')
  })

  it('keeps listing compatible third-party registries without product metadata', () => {
    const registry = RegistrySchema.parse({ name: 'third-party', items: [item('button')] })

    expect(formatProductList(registry)).toBe('  button  button description')
  })
})
