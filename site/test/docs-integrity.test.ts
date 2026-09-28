/**
 * Docs integrity (#269): every internal link and anchor in the site content and the repo's
 * READMEs resolves, and no hand-maintained component count survives outside the regions that
 * are generated from the product contract.
 *
 * Files are enumerated with `git ls-files --cached --others --exclude-standard`, never a
 * filesystem walk: `.claude/worktrees/` holds full checkouts of sibling lanes that a walk would
 * scan too (gitignored, so git never lists them).
 *
 * Cost: parsing is the whole bill (remark-parse + remark-gfm, ~5.5 s for the corpus; the
 * ~1.4 MB generated `site/content/api/components.md` alone is ~1.5 s). It used to be paid twice
 * for every anchor target — once for its links, once more for its heading ids — inside ONE test
 * that carried every file (~7.5 s quiet; 57-140 s, past its 30 s budget, at load ~25-47 on 4
 * CPUs). Now each document is parsed exactly once and shared by the link and anchor checks
 * through `context.documents`, and the link check is one test per file: a document is parsed by
 * its own test, so a failure names its file and no test carries more than its own parse plus
 * the first-use parse of a page it anchors into (the worst is `packages/cli/README.md`, which
 * anchors into the API page above: ~1.9 s quiet, ~15 s at load ~30). The parse deliberately
 * stays OUT of `beforeAll`: as a fixture the whole corpus is ONE hook's bill, measured at
 * 42-46 s of the 60 s `hookTimeout` at load ~25-31 — the #246 caveat, the cost leaves the tests
 * without leaving the budget. The file list is enumerated at collection time to name those
 * tests (two `git ls-files` calls, milliseconds), and the instrument test asserts that list.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { EXAMPLES } from '../src/examples-data.js'
import { REPO_ROOT, loadComponentDocsInput } from '../src/generate-component-docs.js'
import {
  anchorIds,
  checkLink,
  documentAt,
  type BrokenLink,
  type LinkContext,
} from './support/doc-links.js'
import { manualCounts } from './support/doc-counts.js'

function gitFiles(...pathspecs: string[]): string[] {
  return execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...pathspecs],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean)
    .sort()
}

/** Every Markdown page the site serves, plus every README in the repository. */
function linkCheckedFiles(): string[] {
  const site = gitFiles('site/content').filter((file) => file.endsWith('.md'))
  const readmes = gitFiles('README.md', '**/README.md').filter(
    (file) => !file.includes('node_modules/'),
  )
  return [...new Set([...site, ...readmes])].sort()
}

/**
 * User-facing prose where a component count would go stale: the site's hand-written pages,
 * every README, the LLM system prompt and the consumer skill. Generated API pages and example
 * pages are excluded because they are rendered from sources already in this list (or from
 * code); the changelog is history.
 */
function countCheckedFiles(): string[] {
  return [
    ...gitFiles('site/content').filter(
      (file) =>
        file.endsWith('.md') &&
        !file.startsWith('site/content/examples/') &&
        file !== 'site/content/changelog.md',
    ),
    // Design proposals are records of a decision at a point in time, not product docs.
    ...gitFiles('README.md', '**/README.md').filter(
      (file) => !file.includes('node_modules/') && !file.startsWith('docs/proposals/'),
    ),
    ...gitFiles('evaluation/prompts/system-prompt.md'),
    ...gitFiles('.claude/skills/llui-app-dev', '.agents/skills/llui-app-dev').filter((file) =>
      file.endsWith('.md'),
    ),
  ].sort()
}

const LINK_CHECKED = linkCheckedFiles()

let context: LinkContext

beforeAll(() => {
  context = {
    repoRoot: REPO_ROOT,
    tracked: new Set(gitFiles('.')),
    exampleApps: new Set(EXAMPLES.map(({ slug }) => slug)),
    contract: loadComponentDocsInput().contract,
    documents: new Map(),
  }
})

describe('the instrument', () => {
  it('enumerates through git, never into sibling worktrees', () => {
    const files = LINK_CHECKED
    expect(files.filter((file) => file.startsWith('.claude/worktrees/'))).toEqual([])
    expect(files).toContain('README.md')
    expect(files).toContain('site/content/components.md')
    expect(files).toContain('site/content/component-catalog.md')
    expect(files).toContain('packages/components/README.md')
    // Every served page and every README, exactly: the set is the union of two git queries.
    expect(files).toEqual(
      [
        ...new Set([
          ...gitFiles('site/content').filter((file) => file.endsWith('.md')),
          ...gitFiles('**/README.md', 'README.md').filter((f) => !f.includes('node_modules/')),
        ]),
      ].sort(),
    )
  })

  it('computes the same heading ids the site renders', () => {
    const ids = anchorIds(
      '# Using the components\n\n## Choosing a styling path\n\n### `@llui/components/accordion`\n\n## Choosing a styling path\n',
    )
    expect([...ids].sort()).toEqual(
      [
        'choosing-a-styling-path',
        'choosing-a-styling-path-1',
        'lluicomponentsaccordion',
        'using-the-components',
      ].sort(),
    )
  })

  it('reports a broken page, a broken anchor, a broken README path and a stale gallery entry', () => {
    const at = (file: string, url: string) => checkLink(context, file, url)
    expect(at('site/content/components.md', '/no-such-page')).toMatch(/no site page/)
    expect(at('site/content/components.md', '/styling#no-such-heading')).toMatch(/no heading/)
    expect(at('site/content/components.md', '#choosing-a-styling-path')).toBeUndefined()
    expect(at('README.md', 'packages/no-such-package')).toMatch(/no tracked file/)
    expect(at('README.md', 'packages/components/README.md#no-such')).toMatch(/no heading/)
    expect(at('README.md', 'https://llui.dev/styling')).toBeUndefined()
    expect(at('README.md', 'https://llui.dev/stylin')).toMatch(/no site page/)
    expect(at('README.md', 'https://llui.dev/apps/component-gallery/?entry=nope')).toMatch(
      /not in the product contract/,
    )
    expect(at('README.md', 'https://llui.dev/apps/component-gallery/?entry=menu')).toBeUndefined()
    expect(at('README.md', 'https://llui.dev/apps/component-gallery/?theme=sepia')).toMatch(
      /invalid gallery query/,
    )
    expect(at('README.md', 'https://example.com/anything')).toBeUndefined()
  })

  it('flags a manual count outside a generated region, and ignores one inside', () => {
    expect(manualCounts('x.md', 'We ship 66 headless components.\n')).toHaveLength(1)
    expect(manualCounts('x.md', '## Components (66)\n')).toHaveLength(1)
    expect(manualCounts('x.md', 'Around ~68 machines and 85 registry items.\n')).toHaveLength(1)
    const generated =
      '<!-- product-contract:summary:start -->\n\n**95 components**\n\n<!-- product-contract:summary:end -->\n'
    expect(manualCounts('x.md', generated)).toEqual([])
    expect(
      manualCounts('x.md', 'Pass 2 components to the list? No: v1.2 components.\n'),
    ).toHaveLength(1)
    expect(manualCounts('x.md', 'Use `#3 items` and the 404 page.\n')).toEqual([])
    expect(manualCounts('x.md', 'It is ~66 **headless** components.\n')).toHaveLength(1)
    expect(manualCounts('x.md', 'It ships 66 headless state machines.\n')).toHaveLength(1)
  })
})

describe('docs integrity: every internal link and anchor resolves in', () => {
  it.each(LINK_CHECKED)('%s', (file) => {
    const broken: BrokenLink[] = []
    for (const { url, line } of documentAt(context, file).links) {
      const reason = checkLink(context, file, url)
      if (reason !== undefined) broken.push({ file, line, url, reason })
    }
    expect(
      broken.map(({ file, line, url, reason }) => `${file}:${line} ${url} — ${reason}`),
    ).toEqual([])
  })
})

describe('docs integrity', () => {
  it('no hand-written component count survives outside a generated region', () => {
    const hits = countCheckedFiles().flatMap((file) =>
      manualCounts(file, readFileSync(resolve(REPO_ROOT, file), 'utf-8')),
    )
    expect(hits).toEqual([])
  })
})
