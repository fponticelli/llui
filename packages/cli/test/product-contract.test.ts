import { describe, expect, it } from 'vitest'
import {
  ProductContractSchema,
  resolveCopiedArtifact,
  resolveProductIdentity,
} from '../src/product-contract'
import { assertProductInventory } from './product-inventory'

const registryStyling = {
  baseline: false,
  registryTailwind: true,
  styleless: false,
}

const copiedArtifact = (
  name: string,
  artifactKind: 'skin' | 'presentational' | 'pattern' = 'skin',
) => ({
  name,
  artifactKind,
  styling: registryStyling,
})

const entry = (name: string) => ({
  name,
  displayName: name,
  category: 'controls',
  artifactKind: 'machine',
  machine: { kind: 'public', importPath: `@llui/components/${name}` },
  copiedArtifacts: [copiedArtifact(name)],
  styling: { baseline: true, registryTailwind: true, styleless: true },
  scenarioId: `component:${name}`,
})

const messagesFor = (value: unknown): string[] => {
  const result = ProductContractSchema.safeParse(value)
  expect(result.success).toBe(false)
  return result.success ? [] : result.error.issues.map(({ message }) => message)
}

describe('ProductContractSchema', () => {
  it('resolves copied artifacts with their own install, display, scenario, kind, and styling identity', () => {
    const contract = ProductContractSchema.parse({
      version: 1,
      entries: [
        {
          ...entry('date-picker'),
          displayName: 'Date Picker',
          copiedArtifacts: [
            {
              name: 'calendar',
              displayName: 'Calendar / Date Picker',
              artifactKind: 'skin',
              scenarioId: 'registry:calendar',
              styling: registryStyling,
            },
            {
              name: 'date-picker',
              artifactKind: 'skin',
              scenarioId: 'registry:date-picker',
              styling: registryStyling,
            },
          ],
        },
      ],
      aliases: [],
    })

    expect(resolveCopiedArtifact(contract, 'calendar')).toEqual({
      canonical: contract.entries[0],
      artifact: {
        name: 'calendar',
        displayName: 'Calendar / Date Picker',
        artifactKind: 'skin',
        scenarioId: 'registry:calendar',
        styling: registryStyling,
      },
    })
    expect(resolveCopiedArtifact(contract, 'date-picker')?.artifact.displayName).toBe('Date Picker')
  })

  it('rejects duplicate canonical identities', () => {
    const messages = messagesFor({
      version: 1,
      entries: [entry('switch'), entry('switch')],
      aliases: [],
    })

    expect(messages).toContain('Duplicate canonical identity "switch".')
  })

  it('rejects duplicate scenario identities and copied skin ownership', () => {
    const other = {
      ...entry('toggle'),
      copiedArtifacts: [copiedArtifact('switch')],
      scenarioId: 'component:switch',
    }

    const messages = messagesFor({
      version: 1,
      entries: [entry('switch'), other],
      aliases: [],
    })

    expect(messages).toContain('Duplicate scenario identity "component:switch".')
    expect(messages).toContain(
      'Copied artifact "switch" is owned by more than one canonical entry.',
    )
  })

  it('requires aliases to resolve directly to a canonical entry', () => {
    const broken = messagesFor({
      version: 1,
      entries: [entry('breadcrumbs')],
      aliases: [{ name: 'crumbs', canonicalName: 'missing' }],
    })
    expect(broken).toContain('Alias "crumbs" targets unknown canonical identity "missing".')

    const chain = messagesFor({
      version: 1,
      entries: [entry('breadcrumbs')],
      aliases: [
        { name: 'breadcrumb', canonicalName: 'breadcrumbs' },
        { name: 'crumbs', canonicalName: 'breadcrumb' },
      ],
    })
    expect(chain).toContain(
      'Alias "crumbs" targets alias "breadcrumb"; aliases must target canonical identities directly.',
    )

    const cycle = messagesFor({
      version: 1,
      entries: [entry('breadcrumbs')],
      aliases: [
        { name: 'crumbs', canonicalName: 'breadcrumb' },
        { name: 'breadcrumb', canonicalName: 'crumbs' },
      ],
    })
    expect(cycle).toContain(
      'Alias "crumbs" targets alias "breadcrumb"; aliases must target canonical identities directly.',
    )
  })

  it('rejects duplicate aliases and canonical-name collisions', () => {
    const messages = messagesFor({
      version: 1,
      entries: [entry('switch')],
      aliases: [
        { name: 'toggle', canonicalName: 'switch' },
        { name: 'toggle', canonicalName: 'switch' },
        { name: 'switch', canonicalName: 'switch' },
      ],
    })

    expect(messages).toContain('Duplicate alias identity "toggle".')
    expect(messages).toContain('Alias "switch" collides with a canonical identity.')
  })

  it('requires aliases to name copied artifacts owned by their canonical entry', () => {
    const missingTarget = messagesFor({
      version: 1,
      entries: [entry('breadcrumbs')],
      aliases: [{ name: 'breadcrumb', canonicalName: 'breadcrumbs' }],
    })
    expect(missingTarget).toContain('Alias "breadcrumb" is not a copied artifact of "breadcrumbs".')

    const wrongOwner = messagesFor({
      version: 1,
      entries: [
        entry('breadcrumbs'),
        { ...entry('toggle'), copiedArtifacts: [copiedArtifact('breadcrumb')] },
      ],
      aliases: [{ name: 'breadcrumb', canonicalName: 'breadcrumbs' }],
    })
    expect(wrongOwner).toContain(
      'Alias "breadcrumb" is owned by canonical entry "toggle", not "breadcrumbs".',
    )
  })

  it('requires artifact kinds to declare a coherent machine relationship', () => {
    const machineFree = {
      ...entry('button'),
      artifactKind: 'machine',
      machine: { kind: 'none', reason: 'presentational' },
    }
    expect(messagesFor({ version: 1, entries: [machineFree], aliases: [] })).toContain(
      'Machine "button" must reference its public package import.',
    )

    const inventedMachine = {
      ...entry('badge'),
      artifactKind: 'presentational',
    }
    expect(messagesFor({ version: 1, entries: [inventedMachine], aliases: [] })).toContain(
      'Presentational item "badge" must be explicitly machine-free.',
    )

    const intentionalSkin = {
      ...entry('sidebar'),
      artifactKind: 'skin',
      machine: { kind: 'none', reason: 'application-owned-state' },
    }
    expect(
      ProductContractSchema.safeParse({ version: 1, entries: [intentionalSkin], aliases: [] })
        .success,
    ).toBe(true)

    const unpublishedPresentational = {
      ...entry('badge'),
      artifactKind: 'presentational',
      machine: { kind: 'none', reason: 'presentational' },
      copiedArtifacts: [],
      styling: { baseline: true, registryTailwind: false, styleless: false },
    }
    expect(
      messagesFor({ version: 1, entries: [unpublishedPresentational], aliases: [] }),
    ).toContain('Presentational item "badge" must declare at least one copied artifact.')
  })

  it('requires every styling mode classification and keeps registry support in sync with skins', () => {
    const missingMode = entry('switch') as Record<string, unknown>
    missingMode.styling = { baseline: true, registryTailwind: true }
    expect(messagesFor({ version: 1, entries: [missingMode], aliases: [] })).toContain(
      'Invalid input: expected boolean, received undefined',
    )

    const inconsistent = {
      ...entry('switch'),
      copiedArtifacts: [],
    }
    expect(messagesFor({ version: 1, entries: [inconsistent], aliases: [] })).toContain(
      'Product "switch" declares registry/Tailwind support but has no copied artifact.',
    )

    const missingCopiedMode = {
      ...entry('switch'),
      copiedArtifacts: [
        {
          ...copiedArtifact('switch'),
          styling: { baseline: false, registryTailwind: true },
        },
      ],
    }
    expect(messagesFor({ version: 1, entries: [missingCopiedMode], aliases: [] })).toContain(
      'Invalid input: expected boolean, received undefined',
    )
  })

  it('rejects copied artifact kinds that erase the canonical relationship', () => {
    const wrongKind = {
      ...entry('command-menu'),
      artifactKind: 'pattern',
      machine: { kind: 'public', importPath: '@llui/components/patterns/command-menu' },
      copiedArtifacts: [copiedArtifact('command', 'skin')],
      scenarioId: 'pattern:command-menu',
    }

    expect(messagesFor({ version: 1, entries: [wrongKind], aliases: [] })).toContain(
      'Copied artifact "command" is classified as skin, but product "command-menu" requires pattern.',
    )
  })

  it('requires multi-artifact products to classify each scenario explicitly', () => {
    const product = {
      ...entry('date-picker'),
      copiedArtifacts: [
        copiedArtifact('calendar'),
        { ...copiedArtifact('date-picker'), scenarioId: 'registry:date-picker' },
      ],
    }

    expect(messagesFor({ version: 1, entries: [product], aliases: [] })).toContain(
      'Copied artifact "calendar" in multi-artifact product "date-picker" must declare its scenario identity explicitly.',
    )
  })

  it('resolves aliases to one canonical identity', () => {
    const contract = ProductContractSchema.parse({
      version: 1,
      entries: [{ ...entry('breadcrumbs'), copiedArtifacts: [copiedArtifact('breadcrumb')] }],
      aliases: [{ name: 'breadcrumb', canonicalName: 'breadcrumbs' }],
    })

    expect(resolveProductIdentity(contract, 'breadcrumbs')).toEqual({
      canonical: contract.entries[0],
    })
    expect(resolveProductIdentity(contract, 'breadcrumb')).toEqual({
      canonical: contract.entries[0],
      alias: contract.aliases[0],
    })
    expect(resolveProductIdentity(contract, 'missing')).toBeUndefined()
  })

  it('resolves copied names separately when add and import share a spelling', () => {
    const machine = {
      ...entry('form'),
      copiedArtifacts: [],
      styling: { baseline: false, registryTailwind: false, styleless: true },
    }
    const pattern = {
      ...entry('form-field'),
      artifactKind: 'pattern',
      machine: { kind: 'public', importPath: '@llui/components/patterns/form-field' },
      copiedArtifacts: [copiedArtifact('form', 'pattern')],
      scenarioId: 'pattern:form-field',
    }
    const contract = ProductContractSchema.parse({
      version: 1,
      entries: [machine, pattern],
      aliases: [],
    })

    expect(resolveProductIdentity(contract, 'form')?.canonical.name).toBe('form')
    expect(resolveCopiedArtifact(contract, 'form')?.canonical.name).toBe('form-field')
    expect(resolveCopiedArtifact(contract, 'form')?.artifact.scenarioId).toBe('pattern:form-field')
  })
})

describe('assertProductInventory', () => {
  const contract = () =>
    ProductContractSchema.parse({
      version: 1,
      entries: [entry('switch')],
      aliases: [],
    })

  it('accepts exact package and registry publication sets', () => {
    expect(() =>
      assertProductInventory(contract(), {
        machineImports: ['@llui/components/switch'],
        registryItems: ['switch'],
      }),
    ).not.toThrow()
  })

  it('rejects missing and invalid public machine classifications', () => {
    expect(() =>
      assertProductInventory(contract(), {
        machineImports: ['@llui/components/toggle'],
        registryItems: ['switch'],
      }),
    ).toThrow(
      /Unclassified public machine import: @llui\/components\/toggle.*Invalid public machine import: @llui\/components\/switch/s,
    )
  })

  it('rejects orphan and unpublished registry skins', () => {
    expect(() =>
      assertProductInventory(contract(), {
        machineImports: ['@llui/components/switch'],
        registryItems: ['toggle'],
      }),
    ).toThrow(/Orphan registry item: toggle.*Unpublished copied artifact: switch/s)
  })
})
