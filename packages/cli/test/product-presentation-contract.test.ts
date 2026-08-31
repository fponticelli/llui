import { describe, expect, it } from 'vitest'
import {
  ProductContractSchema,
  resolveCopiedArtifact,
  resolveProductIdentity,
} from '../src/product-contract'

const rationale = 'This path intentionally delegates all visual treatment to the consumer.'

const styled = { mode: 'styled' as const }
const partial = { mode: 'partial' as const, rationale: 'The theme owns chrome, not layout.' }
const styleless = { mode: 'styleless' as const, rationale }
const notApplicable = { mode: 'not-applicable' as const, rationale }

const presentation = (
  family:
    | 'forms-controls'
    | 'navigation-data'
    | 'menus-overlays'
    | 'specialized-tools' = 'forms-controls',
  baseline: object = styled,
  registryTailwind: object = styled,
) => ({ family, baseline, registryTailwind })

const copiedArtifact = (name: string) => ({
  name,
  artifactKind: 'skin' as const,
  styling: { baseline: false, registryTailwind: true, styleless: false },
})

const entry = (name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  name,
  displayName: name,
  category: 'controls',
  artifactKind: 'machine',
  machine: { kind: 'public', importPath: `@llui/components/${name}` },
  copiedArtifacts: [copiedArtifact(name)],
  styling: { baseline: true, registryTailwind: true, styleless: true },
  presentation: presentation(),
  scenarioId: `component:${name}`,
  ...overrides,
})

const contract = (
  entries: readonly Record<string, unknown>[],
  aliases: readonly Record<string, unknown>[] = [],
) => ({ version: 2, entries, aliases })

const issuesFor = (value: unknown) => {
  const result = ProductContractSchema.safeParse(value)
  expect(result.success).toBe(false)
  return result.success ? [] : result.error.issues
}

const messagesFor = (value: unknown): string[] => issuesFor(value).map(({ message }) => message)

const expectIssue = (value: unknown, message: string, path: readonly PropertyKey[]): void => {
  expect(issuesFor(value)).toContainEqual(expect.objectContaining({ message, path }))
}

describe('product presentation contract', () => {
  it('requires v2 and accepts every semantic presentation family', () => {
    const families = [
      'forms-controls',
      'navigation-data',
      'menus-overlays',
      'specialized-tools',
    ] as const

    for (const family of families) {
      expect(
        ProductContractSchema.safeParse(
          contract([entry(family, { presentation: presentation(family) })]),
        ).success,
      ).toBe(true)
    }

    expect(messagesFor({ ...contract([entry('switch')]), version: 1 })).toContain(
      'Invalid input: expected 2',
    )
  })

  it('requires exactly one presentation profile with a known family', () => {
    const missing = entry('switch')
    delete missing.presentation
    expect(messagesFor(contract([missing]))).toContain(
      'Invalid input: expected object, received undefined',
    )

    const unknown = entry('switch', {
      presentation: { ...presentation(), family: 'ticket-263' },
    })
    expect(messagesFor(contract([unknown])).join('\n')).toContain('forms-controls')

    const missingPath = entry('switch')
    delete (missingPath.presentation as Record<string, unknown>).baseline
    expect(messagesFor(contract([missingPath]))).toContain(
      'Invalid input: expected object, received undefined',
    )
  })

  it('keeps presentation objects and every coverage variant strict', () => {
    const extraProfileKey = entry('switch', {
      presentation: { ...presentation(), owner: 'forms' },
    })
    expect(messagesFor(contract([extraProfileKey]))).toContain('Unrecognized key: "owner"')

    const extraCoverageKey = entry('switch', {
      presentation: presentation('forms-controls', { ...styled, rationale: 'not allowed' }),
    })
    expect(messagesFor(contract([extraCoverageKey]))).toContain('Unrecognized key: "rationale"')
  })

  it.each(['partial', 'composed', 'styleless', 'not-applicable'] as const)(
    'requires a trimmed rationale for %s coverage',
    (mode) => {
      const baseline =
        mode === 'composed'
          ? { mode, products: ['toggle'], rationale: '   ' }
          : { mode, rationale: '   ' }
      const product = entry('switch', {
        styling: { baseline: false, registryTailwind: true, styleless: true },
        presentation: presentation('forms-controls', baseline),
      })

      expect(messagesFor(contract([product])).join('\n')).toContain(
        'Presentation rationale must contain non-whitespace text.',
      )
    },
  )

  it.each([
    ['baseline', 'styled'],
    ['baseline', 'partial'],
    ['registryTailwind', 'styled'],
    ['registryTailwind', 'partial'],
  ] as const)(
    'rejects %s %s coverage when the matching StylingSupport flag is false',
    (path, mode) => {
      const coverage = mode === 'styled' ? styled : partial
      const styling = {
        baseline: path !== 'baseline',
        registryTailwind: path !== 'registryTailwind',
        styleless: true,
      }
      const product = entry('switch', {
        copiedArtifacts: path === 'registryTailwind' ? [] : [copiedArtifact('switch')],
        styling,
        presentation: presentation(
          'forms-controls',
          path === 'baseline' ? coverage : styled,
          path === 'registryTailwind' ? coverage : styled,
        ),
      })

      expectIssue(
        contract([product]),
        `Product "switch" presentation ${path} mode "${mode}" requires styling.${path} to be true.`,
        ['entries', 0, 'presentation', path, 'mode'],
      )
    },
  )

  it.each(
    (['baseline', 'registryTailwind'] as const).flatMap((path) =>
      (['composed', 'styleless', 'not-applicable'] as const).map((mode) => [path, mode] as const),
    ),
  )('rejects %s %s coverage when StylingSupport says the path owns styles', (path, mode) => {
    const coverage =
      mode === 'composed' ? { mode, products: ['toggle'], rationale } : { mode, rationale }
    const product = entry('switch', {
      presentation: presentation(
        'forms-controls',
        path === 'baseline' ? coverage : styled,
        path === 'registryTailwind' ? coverage : styled,
      ),
    })

    expectIssue(
      contract([product]),
      `Product "switch" presentation ${path} mode "${mode}" requires styling.${path} to be false.`,
      ['entries', 0, 'presentation', path, 'mode'],
    )
  })

  it.each(['baseline', 'registryTailwind'] as const)(
    'requires %s styleless coverage to agree with styleless authoring support',
    (path) => {
      const styling = {
        baseline: path !== 'baseline',
        registryTailwind: path !== 'registryTailwind',
        styleless: false,
      }
      const product = entry('button', {
        copiedArtifacts: path === 'registryTailwind' ? [] : [copiedArtifact('button')],
        styling,
        presentation: presentation(
          'forms-controls',
          path === 'baseline' ? styleless : styled,
          path === 'registryTailwind' ? styleless : styled,
        ),
      })

      expectIssue(
        contract([product]),
        `Product "button" presentation ${path} is styleless, but styling.styleless is false.`,
        ['entries', 0, 'presentation', path, 'mode'],
      )
    },
  )

  it('distinguishes public headless artifacts from machine-free products', () => {
    const publicButNotApplicable = entry('switch', {
      styling: { baseline: false, registryTailwind: true, styleless: true },
      presentation: presentation('forms-controls', notApplicable),
    })
    expectIssue(
      contract([publicButNotApplicable]),
      'Product "switch" presentation baseline mode "not-applicable" requires machine.kind to be "none".',
      ['entries', 0, 'presentation', 'baseline', 'mode'],
    )

    const copiedOnlyButStyleless = {
      ...entry('badge'),
      artifactKind: 'presentational',
      machine: { kind: 'none', reason: 'presentational' },
      copiedArtifacts: [{ ...copiedArtifact('badge'), artifactKind: 'presentational' }],
      styling: { baseline: false, registryTailwind: true, styleless: true },
      presentation: presentation('navigation-data', styleless),
    }
    expectIssue(
      contract([copiedOnlyButStyleless]),
      'Product "badge" presentation baseline mode "styleless" requires machine.kind to be "public".',
      ['entries', 0, 'presentation', 'baseline', 'mode'],
    )

    const publicRegistryPath = entry('fieldset', {
      copiedArtifacts: [],
      styling: { baseline: false, registryTailwind: false, styleless: true },
      presentation: presentation('forms-controls', styleless, notApplicable),
    })
    expectIssue(
      contract([publicRegistryPath]),
      'Product "fieldset" presentation registryTailwind mode "not-applicable" requires machine.kind to be "none".',
      ['entries', 0, 'presentation', 'registryTailwind', 'mode'],
    )
  })

  it('accepts partial, styleless, not-applicable, and machine-free composition when support agrees', () => {
    const partialProduct = entry('chart', {
      presentation: presentation('navigation-data', partial),
    })
    const stylelessProduct = entry('presence', {
      copiedArtifacts: [],
      styling: { baseline: false, registryTailwind: false, styleless: true },
      presentation: presentation('specialized-tools', styleless, styleless),
    })
    const registryOnlyProduct = {
      ...entry('badge'),
      artifactKind: 'presentational',
      machine: { kind: 'none', reason: 'presentational' },
      copiedArtifacts: [{ ...copiedArtifact('badge'), artifactKind: 'presentational' }],
      styling: { baseline: false, registryTailwind: true, styleless: false },
      presentation: presentation('navigation-data', notApplicable, styled),
    }
    const machineFreeComposition = {
      ...entry('summary'),
      artifactKind: 'presentational',
      machine: { kind: 'none', reason: 'presentational' },
      copiedArtifacts: [{ ...copiedArtifact('summary'), artifactKind: 'presentational' }],
      styling: { baseline: false, registryTailwind: true, styleless: false },
      presentation: presentation(
        'navigation-data',
        { mode: 'composed', products: ['chart'], rationale },
        styled,
      ),
    }

    expect(
      ProductContractSchema.safeParse(
        contract([partialProduct, stylelessProduct, registryOnlyProduct, machineFreeComposition]),
      ).success,
    ).toBe(true)
  })

  it('requires composed coverage to name at least one unique canonical product', () => {
    const noProducts = entry('wizard', {
      styling: { baseline: false, registryTailwind: true, styleless: true },
      presentation: presentation('specialized-tools', {
        mode: 'composed',
        products: [],
        rationale,
      }),
    })
    expect(messagesFor(contract([noProducts])).join('\n')).toContain(
      'Composed presentation coverage must reference at least one canonical product.',
    )

    const duplicateProducts = entry('wizard', {
      styling: { baseline: false, registryTailwind: true, styleless: true },
      presentation: presentation('specialized-tools', {
        mode: 'composed',
        products: ['steps', 'steps'],
        rationale,
      }),
    })
    const steps = entry('steps')
    expectIssue(
      contract([duplicateProducts, steps]),
      'Product "wizard" presentation baseline composes canonical product "steps" more than once.',
      ['entries', 0, 'presentation', 'baseline', 'products', 1],
    )
  })

  it('rejects self, alias, dangling, and visually unavailable composition references', () => {
    const self = entry('wizard', {
      styling: { baseline: false, registryTailwind: true, styleless: true },
      presentation: presentation('specialized-tools', {
        mode: 'composed',
        products: ['wizard'],
        rationale,
      }),
    })
    expectIssue(contract([self]), 'Product "wizard" presentation baseline cannot compose itself.', [
      'entries',
      0,
      'presentation',
      'baseline',
      'products',
      0,
    ])

    const dangling = entry('wizard', {
      styling: { baseline: false, registryTailwind: true, styleless: true },
      presentation: presentation('specialized-tools', {
        mode: 'composed',
        products: ['missing'],
        rationale,
      }),
    })
    expectIssue(
      contract([dangling]),
      'Product "wizard" presentation baseline references unknown canonical product "missing".',
      ['entries', 0, 'presentation', 'baseline', 'products', 0],
    )

    const toggleGroup = entry('toggle-group', {
      copiedArtifacts: [copiedArtifact('toggle')],
    })
    const aliasReference = entry('wizard', {
      styling: { baseline: false, registryTailwind: true, styleless: true },
      presentation: presentation('specialized-tools', {
        mode: 'composed',
        products: ['toggle'],
        rationale,
      }),
    })
    expectIssue(
      contract([aliasReference, toggleGroup], [{ name: 'toggle', canonicalName: 'toggle-group' }]),
      'Product "wizard" presentation baseline references unknown canonical product "toggle".',
      ['entries', 0, 'presentation', 'baseline', 'products', 0],
    )

    const behaviorOnly = entry('presence', {
      copiedArtifacts: [],
      styling: { baseline: false, registryTailwind: false, styleless: true },
      presentation: presentation('specialized-tools', styleless, styleless),
    })
    const unavailable = entry('wizard', {
      styling: { baseline: false, registryTailwind: true, styleless: true },
      presentation: presentation('specialized-tools', {
        mode: 'composed',
        products: ['presence'],
        rationale,
      }),
    })
    expectIssue(
      contract([unavailable, behaviorOnly]),
      'Product "wizard" presentation baseline composes "presence", whose baseline coverage is not visually available.',
      ['entries', 0, 'presentation', 'baseline', 'products', 0],
    )
  })

  it('accepts acyclic composed chains and rejects composition cycles per path', () => {
    const leaf = entry('steps')
    const middle = entry('wizard-shell', {
      styling: { baseline: false, registryTailwind: true, styleless: true },
      presentation: presentation('specialized-tools', {
        mode: 'composed',
        products: ['steps'],
        rationale,
      }),
    })
    const root = entry('wizard', {
      styling: { baseline: false, registryTailwind: true, styleless: true },
      presentation: presentation('specialized-tools', {
        mode: 'composed',
        products: ['wizard-shell'],
        rationale,
      }),
    })
    expect(ProductContractSchema.safeParse(contract([root, middle, leaf])).success).toBe(true)

    const first = entry('first', {
      styling: { baseline: false, registryTailwind: true, styleless: true },
      presentation: presentation('specialized-tools', {
        mode: 'composed',
        products: ['second'],
        rationale,
      }),
    })
    const second = entry('second', {
      styling: { baseline: false, registryTailwind: true, styleless: true },
      presentation: presentation('specialized-tools', {
        mode: 'composed',
        products: ['first'],
        rationale,
      }),
    })
    expectIssue(
      contract([first, second]),
      'Presentation composition cycle on baseline: first -> second -> first.',
      ['entries', 1, 'presentation', 'baseline', 'products', 0],
    )
  })

  it('makes aliases and copied artifacts inherit the canonical presentation profile', () => {
    const breadcrumb = entry('breadcrumbs', {
      copiedArtifacts: [copiedArtifact('breadcrumb')],
      presentation: presentation('navigation-data'),
    })
    const parsed = ProductContractSchema.parse(
      contract([breadcrumb], [{ name: 'breadcrumb', canonicalName: 'breadcrumbs' }]),
    )

    expect(resolveProductIdentity(parsed, 'breadcrumb')?.canonical.presentation).toBe(
      parsed.entries[0]?.presentation,
    )
    expect(resolveCopiedArtifact(parsed, 'breadcrumb')?.canonical.presentation).toBe(
      parsed.entries[0]?.presentation,
    )
  })
})
