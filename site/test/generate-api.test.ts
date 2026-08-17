import { describe, it, expect } from 'vitest'
import * as ts from 'typescript'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, dirname, resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import {
  getJSDoc,
  extractComponentFromText,
  memberRef,
  collectBarrelExports,
  publicComponentModules,
  invokedAsScript,
  assertPackageRegistryComplete,
  type ModuleReader,
} from '../src/generate-api.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const componentsDir = resolve(repoRoot, 'packages/components/src/components')
const readRepo = (p: string) => readFileSync(resolve(repoRoot, p), 'utf-8')

/** Parse `text` and hand back its first statement plus the source file. */
function firstStatement(text: string): [ts.Node, ts.SourceFile] {
  const sf = ts.createSourceFile('fixture.ts', text, ts.ScriptTarget.Latest, true)
  return [sf.statements[0]!, sf]
}

function docOf(text: string): string | undefined {
  const [node, sf] = firstStatement(text)
  return getJSDoc(node, sf)
}

// ── issue #148: JSDoc paragraph breaks ───────────────────────────

describe('getJSDoc', () => {
  it('preserves the blank line between two prose paragraphs', () => {
    const doc = docOf(
      [
        '/**',
        ' * Line A.',
        ' *',
        ' * Line B starts a paragraph.',
        ' */',
        'export const x = 1',
      ].join('\n'),
    )
    expect(doc).toBe('Line A.\n\nLine B starts a paragraph.')
  })

  it('does not absorb a paragraph following a bulleted list into the last bullet', () => {
    const doc = docOf(
      [
        '/**',
        ' * Intro.',
        ' *',
        ' * - first bullet',
        ' * - second bullet',
        ' *',
        ' * Trailing prose that must stay its own paragraph.',
        ' */',
        'export const x = 1',
      ].join('\n'),
    )
    expect(doc).toBe(
      'Intro.\n\n- first bullet\n- second bullet\n\nTrailing prose that must stay its own paragraph.',
    )
    // The regression shape: the trailing paragraph glued onto the last bullet.
    expect(doc).not.toContain('- second bullet\nTrailing prose')
  })

  it('keeps a blank line inside a fenced code block', () => {
    const doc = docOf(
      [
        '/**',
        ' * Example.',
        ' *',
        ' * ```ts',
        ' * const a = 1',
        ' *',
        ' * const b = 2',
        ' * ```',
        ' */',
        'export const x = 1',
      ].join('\n'),
    )
    expect(doc).toBe('Example.\n\n```ts\nconst a = 1\n\nconst b = 2\n```')
  })

  it('still strips the leading asterisk and its single separating space', () => {
    const doc = docOf(
      ['/**', ' * Plain.', ' *   indented continuation', ' */', 'const x = 1'].join('\n'),
    )
    expect(doc).toBe('Plain.\n  indented continuation')
  })

  it('drops a lone @example tag line but leaves a paragraph break in its place', () => {
    const doc = docOf(
      [
        '/**',
        ' * Docs.',
        ' *',
        ' * @example',
        ' * ```ts',
        ' * f()',
        ' * ```',
        ' */',
        'const x = 1',
      ].join('\n'),
    )
    expect(doc).toBe('Docs.\n\n\n```ts\nf()\n```')
    expect(doc).not.toContain('@example')
  })

  it('ignores a non-JSDoc block comment', () => {
    expect(docOf(['/* not jsdoc */', 'const x = 1'].join('\n'))).toBeUndefined()
  })
})

// ── issue #151: component member kinds ───────────────────────────

const TABLE_LIKE = `
export interface WidgetState {
  open: boolean
}

export type WidgetMsg = { type: 'toggle' }

export const HEADER_ROW_INDEX = -1

export const LABELS = { a: 'a' }

export function init(): WidgetState {
  return { open: false }
}

export function update(state: WidgetState, msg: WidgetMsg): [WidgetState, never[]] {
  return [state, []]
}

export function isOpen(state: WidgetState): boolean {
  return state.open
}

export const describeWidget = (state: WidgetState) => String(state.open)

export function connect(get: unknown, send: unknown, opts: { id: string }) {
  return { root: {} }
}

export const widget = {
  init,
  update,
  connect,
  isOpen,
  HEADER_ROW_INDEX,
}

const notExported = 1
export type WidgetHelper = typeof isOpen
`

describe('extractComponentFromText (issue #151)', () => {
  const info = extractComponentFromText('widget', TABLE_LIKE)!

  it('extracts the component', () => {
    expect(info).not.toBeNull()
    expect(info.stateType).toBe('WidgetState')
  })

  it('classifies a namespace member that is a const as a const, not a function', () => {
    expect(info.extras).toContainEqual({ name: 'HEADER_ROW_INDEX', kind: 'const' })
    expect(info.extras).not.toContainEqual({ name: 'HEADER_ROW_INDEX', kind: 'function' })
  })

  it('classifies a namespace member that is a function as a function', () => {
    expect(info.extras).toContainEqual({ name: 'isOpen', kind: 'function' })
  })

  it('classifies an arrow-function const as a function', () => {
    expect(info.extras).toContainEqual({ name: 'describeWidget', kind: 'function' })
  })

  it('includes module-level exports that are not namespace members', () => {
    const names = info.extras.map((e) => e.name)
    expect(names).toContain('LABELS')
    expect(names).toContain('describeWidget')
  })

  it('classifies a module-level object const as a const', () => {
    expect(info.extras).toContainEqual({ name: 'LABELS', kind: 'const' })
  })

  it('omits init/update/connect, the namespace object itself, non-exports and types', () => {
    const names = info.extras.map((e) => e.name)
    expect(names).not.toContain('init')
    expect(names).not.toContain('update')
    expect(names).not.toContain('connect')
    expect(names).not.toContain('widget')
    expect(names).not.toContain('notExported')
    expect(names).not.toContain('WidgetHelper')
  })

  it('lists each member exactly once', () => {
    const names = info.extras.map((e) => e.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('namespace object detection (issue #151)', () => {
  // `switch.ts` exports `switchMachine`, `alert-dialog.ts` exports `alertDialog`:
  // matching the object by the FILE's basename missed both.
  const RENAMED = `
export interface SwitchState {
  on: boolean
}
export function init(): SwitchState {
  return { on: false }
}
export function update(state: SwitchState): [SwitchState, never[]] {
  return [state, []]
}
export function connect(get: unknown, send: unknown, opts: { id: string }) {
  return { root: {} }
}
export const switchMachine = { init, update, connect }
`

  it('finds the namespace object by shape, not by the file name', () => {
    const info = extractComponentFromText('switch', RENAMED)!
    expect(info.extras).toEqual([])
  })

  it('never lists the namespace object as one of its own members', () => {
    const info = extractComponentFromText('switch', RENAMED)!
    expect(info.extras.map((e) => e.name)).not.toContain('switchMachine')
  })
})

describe('kind resolution across bindings (issue #151)', () => {
  // `menu.ts` writes `export const isMounted = isPresent`. Both halves matter,
  // but only the CONST alias discriminates: an unresolved name falls back to
  // `function`, so a function alias passes even with resolution switched off.
  const ALIASES = `
export interface MenuState { open: boolean }
export function init(): MenuState { return { open: false } }
export function update(s: MenuState): [MenuState, never[]] { return [s, []] }
export function isPresent(s: MenuState): boolean { return s.open }
export const isMounted = isPresent
const SENTINEL = '\\u0000__menu__'
export const CREATE_VALUE = SENTINEL
export function connect(get: unknown, send: unknown, opts: { id: string }) { return { root: {} } }
export const menu = { init, update, connect, isPresent, isMounted, CREATE_VALUE }
`

  it('follows a local alias to a function declaration', () => {
    const info = extractComponentFromText('menu', ALIASES)!
    expect(info.extras).toContainEqual({ name: 'isMounted', kind: 'function' })
  })

  it('follows a local alias to a constant', () => {
    const info = extractComponentFromText('menu', ALIASES)!
    expect(info.extras).toContainEqual({ name: 'CREATE_VALUE', kind: 'const' })
  })

  it('follows a relative import into a sibling module', () => {
    const read: ModuleReader = (_from, specifier) =>
      specifier === './dialog.js'
        ? {
            id: 'dialog.ts',
            text: `
export function isMounted(s: unknown): boolean { return true }
export const DIALOG_ROLE = 'dialog'
`,
          }
        : undefined

    const info = extractComponentFromText(
      'alert-dialog',
      `
import { init, update, isMounted, DIALOG_ROLE } from './dialog.js'
export type AlertDialogState = { open: boolean }
export function connect(get: unknown, send: unknown, opts: { id: string }) { return { root: {} } }
export const alertDialog = { init, update, connect, isMounted, DIALOG_ROLE }
`,
      read,
    )!
    expect(info.extras).toContainEqual({ name: 'isMounted', kind: 'function' })
    expect(info.extras).toContainEqual({ name: 'DIALOG_ROLE', kind: 'const' })
  })

  // Was: "falls back to function for a name no module in reach declares". The
  // fallback is gone (#174) — see the loud-failure block below, which asserts the
  // opposite behaviour on the same fixture.
})

describe('memberRef (issue #151)', () => {
  it('parenthesizes functions only', () => {
    expect(memberRef({ name: 'isOpen', kind: 'function' })).toBe('`isOpen()`')
    expect(memberRef({ name: 'HEADER_ROW_INDEX', kind: 'const' })).toBe('`HEADER_ROW_INDEX`')
  })
})

// ── issue #174: the kind fallback must fail LOUDLY ───────────────

const UNRESOLVABLE = `
import { init, update, mystery } from './nowhere.js'
export type WidgetState = { on: boolean }
export function connect(get: unknown, send: unknown, opts: { id: string }) { return { root: {} } }
export const widget = { init, update, connect, mystery }
`

describe('unresolvable member kind (issue #174)', () => {
  it('throws instead of guessing `function` for a name no module in reach declares', () => {
    expect(() => extractComponentFromText('widget', UNRESOLVABLE)).toThrow(
      /cannot classify exported member `mystery`/,
    )
  })

  it('names the module and forbids restoring a default kind in the message', () => {
    let message = ''
    try {
      extractComponentFromText('widget', UNRESOLVABLE, undefined, 'widget.ts')
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toContain('widget.ts')
    expect(message).toContain('Do NOT reintroduce a default kind')
  })

  it('never emits a member whose kind was not resolved', () => {
    // The #151 shape: an unresolved name reaching the page as `mystery()` — a
    // call signature asserted for something that may well be a string constant.
    let extras: unknown = 'threw'
    try {
      extras = extractComponentFromText('widget', UNRESOLVABLE)!.extras
    } catch {
      /* expected */
    }
    expect(extras).toBe('threw')
  })

  it('still resolves every member across the real component set', () => {
    // The remedy's precondition (#174): making the fallback throw must not break
    // a single real module. Scans EVERY file in `src/components/` — including the
    // internal ones #175 excludes from the page — with the sibling reader wired.
    const read: ModuleReader = (fromId, specifier) => {
      if (!specifier.startsWith('.')) return undefined
      const id = resolve(dirname(fromId), specifier.replace(/\.js$/, '.ts'))
      try {
        return { id, text: readFileSync(id, 'utf-8') }
      } catch {
        return undefined
      }
    }
    const files = readdirSync(componentsDir).filter((f) => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(60)
    const failures: string[] = []
    for (const f of files) {
      const p = resolve(componentsDir, f)
      try {
        extractComponentFromText(basename(f, '.ts'), readFileSync(p, 'utf-8'), read, p)
      } catch (e) {
        failures.push(`${f}: ${(e as Error).message.split('\n')[0]}`)
      }
    }
    expect(failures).toEqual([])
  })
})

// ── issue #174: barrel aliases are documented ────────────────────

describe('collectBarrelExports (issue #174)', () => {
  it('does not repeat named component objects in the direct-member table', () => {
    const rows = collectBarrelExports(`
export { menu } from './menu.js'
export { radioGroup } from './radio-group.js'
export { switchMachine } from './switch.js'
export { HEADER_ROW_INDEX as TABLE_HEADER_ROW_INDEX } from './table.js'
`)
    expect(rows).toEqual([
      { exported: 'TABLE_HEADER_ROW_INDEX', module: 'table', local: 'HEADER_ROW_INDEX' },
    ])
  })

  it('records the alias and the name the source module declares', () => {
    const rows = collectBarrelExports(`
export * as table from './table.js'
export { isRowSelected, HEADER_ROW_INDEX as TABLE_HEADER_ROW_INDEX } from './table.js'
export type { TableState } from './table.js'
`)
    expect(rows).toEqual([
      { exported: 'isRowSelected', module: 'table', local: 'isRowSelected' },
      { exported: 'TABLE_HEADER_ROW_INDEX', module: 'table', local: 'HEADER_ROW_INDEX' },
    ])
  })

  it('skips type-only re-exports, whole-clause and per-specifier', () => {
    const rows = collectBarrelExports(`
export type { A } from './x.js'
export { type B, c } from './x.js'
`)
    expect(rows.map((r) => r.exported)).toEqual(['c'])
  })

  it('collects TABLE_HEADER_ROW_INDEX from the real components barrel', () => {
    const rows = collectBarrelExports(readRepo('packages/components/src/components/index.ts'))
    expect(rows).toContainEqual({
      exported: 'TABLE_HEADER_ROW_INDEX',
      module: 'table',
      local: 'HEADER_ROW_INDEX',
    })
  })
})

describe('the generated components page (issues #174, #175)', () => {
  const page = readRepo('site/content/api/components.md')

  it('shows the current sliced-signal connect contract', () => {
    expect(page).toContain("componentName.connect(state.at('component'), send")
    expect(page).not.toContain('componentName.connect<State>((s) => s.field')
  })

  it('documents the TABLE_HEADER_ROW_INDEX barrel alias', () => {
    expect(page).toContain('TABLE_HEADER_ROW_INDEX')
  })

  it('does not advertise menu-machine.ts, which no entry point exports', () => {
    expect(page).not.toContain('createMenuTreeParts')
    expect(page).not.toContain('### Menu Machine')
  })

  it('still documents the components that DO reach a consumer', () => {
    for (const heading of ['### Menu', '### Table', '### Menubar', '### Context Menu'])
      expect(page).toContain(heading)
  })
})

describe('object-valued public exports', () => {
  it('documents object constants instead of silently dropping them', () => {
    expect(readRepo('site/content/api/effects.md')).toContain('### `httpRunner`')
    expect(readRepo('site/content/api/devmode-annotate-editor.md')).toContain(
      '### `markdownAnnotateEditor`',
    )
  })
})

describe('public package subpaths', () => {
  it('documents the import path and exports of non-root entry points', () => {
    const vitePlugin = readRepo('site/content/api/vite-plugin.md')
    expect(vitePlugin).toContain('### `@llui/vite-plugin/notes`')
    expect(vitePlugin).toContain('`cleanupResolvedTask()` from `@llui/vite-plugin/notes`')

    const annotate = readRepo('site/content/api/devmode-annotate.md')
    expect(annotate).toContain('### `@llui/devmode-annotate/note-format`')
    expect(annotate).toContain('`deriveSlug()` from `@llui/devmode-annotate/note-format`')
  })

  it('gives every concrete TypeScript export path its own reference section', () => {
    const packageDirs = readdirSync(resolve(repoRoot, 'packages'))
    const missing: string[] = []

    for (const dir of packageDirs) {
      const manifestPath = resolve(repoRoot, 'packages', dir, 'package.json')
      let manifest: {
        name: string
        private?: boolean
        exports?: Record<string, unknown>
      }
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as typeof manifest
      } catch {
        continue
      }
      if (manifest.private) continue
      const page = readRepo(`site/content/api/${dir}.md`)
      for (const [subpath, value] of Object.entries(manifest.exports ?? {})) {
        if (subpath === '.' || subpath.includes('*')) continue
        const target =
          typeof value === 'string'
            ? value
            : value && typeof value === 'object'
              ? ((value as Record<string, unknown>).types ??
                (value as Record<string, unknown>).import)
              : undefined
        if (typeof target !== 'string' || target.endsWith('.css')) continue
        const specifier = manifest.name + subpath.slice(1)
        if (!page.includes(`### \`${specifier}\``)) missing.push(specifier)
      }
    }

    expect(missing).toEqual([])
  })

  it('expands wildcard export maps into every importable TypeScript module', () => {
    const manifest = JSON.parse(readRepo('packages/components/package.json')) as {
      name: string
      exports: Record<string, unknown>
    }
    const page = readRepo('site/content/api/components.md')
    const missing: string[] = []

    for (const [subpath, value] of Object.entries(manifest.exports)) {
      if (!subpath.includes('*')) continue
      const target =
        typeof value === 'string'
          ? value
          : value && typeof value === 'object'
            ? ((value as Record<string, unknown>).types ??
              (value as Record<string, unknown>).import)
            : undefined
      if (typeof target !== 'string' || !target.includes('*') || target.endsWith('.css')) continue

      const sourcePattern = target
        .replace(/^\.\/dist\//, 'src/')
        .replace(/\.d\.ts$/, '.ts')
        .replace(/\.js$/, '.ts')
      const absolutePattern = resolve(repoRoot, 'packages/components', sourcePattern)
      const filePattern = basename(absolutePattern)
      const [prefix, suffix] = filePattern.split('*') as [string, string]
      for (const file of readdirSync(dirname(absolutePattern))) {
        if (!file.startsWith(prefix) || !file.endsWith(suffix)) continue
        const match = file.slice(prefix.length, file.length - suffix.length)
        const specifier = manifest.name + subpath.replace('*', match).slice(1)
        if (!page.includes(`### \`${specifier}\``)) missing.push(specifier)
      }
    }

    expect(missing).toEqual([])
  })

  it('documents every symbol exported by every public entry point', () => {
    const entries: Array<{ page: string; source: string; specifier: string }> = []

    for (const dir of readdirSync(resolve(repoRoot, 'packages'))) {
      const manifestPath = resolve(repoRoot, 'packages', dir, 'package.json')
      let manifest: {
        name: string
        private?: boolean
        exports?: Record<string, unknown>
      }
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as typeof manifest
      } catch {
        continue
      }
      if (manifest.private) continue
      const page = readRepo(`site/content/api/${dir}.md`)
      for (const [subpath, value] of Object.entries(manifest.exports ?? {})) {
        const target =
          typeof value === 'string'
            ? value
            : value && typeof value === 'object'
              ? ((value as Record<string, unknown>).types ??
                (value as Record<string, unknown>).import)
              : undefined
        if (typeof target !== 'string' || target.endsWith('.css')) continue
        const sourcePattern = target
          .replace(/^\.\/dist\//, 'src/')
          .replace(/\.d\.ts$/, '.ts')
          .replace(/\.js$/, '.ts')

        if (subpath.includes('*') || sourcePattern.includes('*')) {
          const absolutePattern = resolve(repoRoot, 'packages', dir, sourcePattern)
          const filePattern = basename(absolutePattern)
          const [prefix, suffix] = filePattern.split('*') as [string, string]
          for (const file of readdirSync(dirname(absolutePattern)).sort()) {
            if (!file.startsWith(prefix) || !file.endsWith(suffix)) continue
            const match = file.slice(prefix.length, file.length - suffix.length)
            entries.push({
              page,
              source: resolve(dirname(absolutePattern), file),
              specifier: manifest.name + subpath.replace('*', match).slice(1),
            })
          }
        } else {
          entries.push({
            page,
            source: resolve(repoRoot, 'packages', dir, sourcePattern),
            specifier: subpath === '.' ? manifest.name : manifest.name + subpath.slice(1),
          })
        }
      }
    }

    const program = ts.createProgram([...new Set(entries.map((entry) => entry.source))], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowJs: true,
      skipLibCheck: true,
      noEmit: true,
    })
    const checker = program.getTypeChecker()
    const missing: string[] = []

    for (const entry of entries) {
      const source = program.getSourceFile(entry.source)
      const moduleSymbol = source && checker.getSymbolAtLocation(source)
      if (!moduleSymbol) continue
      const entryHeading = `### \`${entry.specifier}\``
      const start = entry.page.indexOf(entryHeading)
      let section = entry.page
      if (start >= 0) {
        const next = entry.page.indexOf('\n### `', start + entryHeading.length)
        section = entry.page.slice(start, next < 0 ? undefined : next)
      }
      for (const exported of checker.getExportsOfModule(moduleSymbol)) {
        const name = exported.getName()
        if (name === 'default') continue
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const heading = new RegExp('^#{3,6} `' + escaped + '(?:\\(\\))?`', 'm')
        if (!heading.test(section)) missing.push(`${entry.specifier}:${name}`)
      }
    }

    expect(missing).toEqual([])
  })
})

describe('published package versions', () => {
  it('shows the exact manifest version on every package page', () => {
    const missing: string[] = []
    for (const dir of readdirSync(resolve(repoRoot, 'packages'))) {
      const manifestPath = resolve(repoRoot, 'packages', dir, 'package.json')
      let manifest: { name: string; version: string; private?: boolean }
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as typeof manifest
      } catch {
        continue
      }
      if (manifest.private) continue
      const page = readRepo(`site/content/api/${dir}.md`)
      const versionLine = `**Current package version:** \`${manifest.version}\``
      if (!page.includes(versionLine)) missing.push(`${manifest.name}@${manifest.version}`)
    }
    expect(missing).toEqual([])
  })

  it('includes package versions in both LLM-facing indexes', () => {
    const concise = readRepo('site/public/llms.txt')
    const complete = readRepo('site/public/llms-full.txt')
    const missing: string[] = []

    for (const dir of readdirSync(resolve(repoRoot, 'packages'))) {
      const manifestPath = resolve(repoRoot, 'packages', dir, 'package.json')
      let manifest: { name: string; version: string; private?: boolean }
      try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as typeof manifest
      } catch {
        continue
      }
      if (manifest.private) continue
      if (!concise.includes(`- ${manifest.name}@${manifest.version}`)) {
        missing.push(`llms.txt:${manifest.name}`)
      }
      const page = readRepo(`site/content/api/${dir}.md`)
      const title = /^# .+$/m.exec(page)?.[0]
      const versionLine = `**Current package version:** \`${manifest.version}\``
      if (!title || !complete.includes(`${title}\n\n${versionLine}`)) {
        missing.push(`llms-full.txt:${manifest.name}`)
      }
    }

    expect(missing).toEqual([])
  })
})

describe('LLM reference metadata', () => {
  it('does not publish a hand-maintained llms-full.txt byte size', () => {
    expect(readRepo('site/content/index.md')).not.toMatch(/llms-full\.txt[^\n]*~\d+KB/)
  })

  it('emits llms-full.txt without trailing whitespace', () => {
    expect(readRepo('site/public/llms-full.txt')).not.toMatch(/[ \t]+$/m)
  })

  it('teaches the current signal authoring surface instead of the removed view bag', () => {
    const reference = readRepo('site/public/llms-full.txt')
    expect(reference).toContain('view: ({ state, send }) =>')
    expect(reference).toContain("state.at('count')")
    expect(reference).toContain('66 headless')
    expect(reference).not.toContain('view: ({ send, text }) =>')
    expect(reference).not.toContain('58 headless')
    expect(reference).not.toContain('sliceHandler')
    expect(reference).not.toContain('View<S, M> is a bundle of state-bound helpers')
  })
})

describe('package registry completeness', () => {
  it('fails generation when a publishable package has no documentation page', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'llui-package-registry-'))
    const packageDir = resolve(root, 'undocumented')
    mkdirSync(packageDir)
    writeFileSync(
      resolve(packageDir, 'package.json'),
      JSON.stringify({ name: '@llui/undocumented', exports: { '.': './dist/index.js' } }),
    )

    expect(() => assertPackageRegistryComplete(root, [])).toThrow(
      /PUBLISHABLE PACKAGES ABSENT FROM THE API REGISTRY[\s\S]*@llui\/undocumented/,
    )
  })
})

// ── issue #174: the entry-point guard is realpath-safe ───────────

describe('invokedAsScript (issue #174)', () => {
  const selfPath = resolve(here, '..', 'src', 'generate-api.ts')
  const selfUrl = pathToFileURL(selfPath).href

  it('recognises a direct invocation', () => {
    expect(invokedAsScript(selfPath, selfUrl)).toBe(true)
  })

  it('recognises an invocation through a symlinked script FILE', () => {
    // The silent-no-op shape: argv[1] keeps the link path, import.meta.url is
    // the resolved target, so a string compare says "not the entry" and main()
    // never runs — the generator writes nothing and exits 0.
    const dir = mkdtempSync(resolve(tmpdir(), 'llui-entrypoint-'))
    const link = resolve(dir, 'generate-api.ts')
    symlinkSync(selfPath, link)
    expect(invokedAsScript(link, selfUrl)).toBe(true)
  })

  it('says no for a different script and for no argv', () => {
    expect(invokedAsScript(resolve(here, '..', 'src', 'generate-llms.ts'), selfUrl)).toBe(false)
    expect(invokedAsScript(undefined, selfUrl)).toBe(false)
  })
})

// ── issue #175: only publicly reachable modules are documented ───

describe('publicComponentModules (issue #175)', () => {
  const BARREL = `
export * as menu from './menu.js'
export * as table from './table.js'
export { reorder } from './sortable.js'
export type { MenuNode } from './menu-machine.js'
`

  it('excludes a module nothing exports, however many files import it', () => {
    const mods = publicComponentModules(BARREL, {})
    expect(mods.has('menu-machine')).toBe(false)
  })

  it('includes `export * as` and named value re-exports from the barrel', () => {
    const mods = publicComponentModules(BARREL, {})
    expect([...mods].sort()).toEqual(['menu', 'sortable', 'table'])
  })

  it('skips a re-export whose every specifier is type-only, but keeps a mixed one', () => {
    // The per-specifier spelling. `export type { … } from` (whole-clause) is
    // covered by the case above; `export { type A, type B } from` is a separate
    // branch and publishes no value either, so the module stays internal. The
    // second half guards the other direction — one value specifier is enough.
    expect([...publicComponentModules("export { type A, type B } from './secret.js'", {})]).toEqual(
      [],
    )
    expect([...publicComponentModules("export { type A, b } from './mixed.js'", {})]).toEqual([
      'mixed',
    ])
  })

  it('includes a module reachable only through a package.json#exports subpath', () => {
    const mods = publicComponentModules('', {
      './timer': { types: './dist/components/timer.d.ts', import: './dist/components/timer.js' },
      './styles/theme.css': './dist/styles/theme.css',
      './utils': { types: './dist/utils/index.d.ts', import: './dist/utils/index.js' },
    })
    expect([...mods]).toEqual(['timer'])
  })

  it('leaves menu-machine the only unreachable module in the real package', () => {
    const barrel = readRepo('packages/components/src/components/index.ts')
    const pkg = JSON.parse(readRepo('packages/components/package.json')) as {
      exports: Record<string, unknown>
    }
    const mods = publicComponentModules(barrel, pkg.exports)
    const onDisk = readdirSync(componentsDir)
      .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
      .map((f) => basename(f, '.ts'))
    expect(onDisk.filter((m) => !mods.has(m))).toEqual(['menu-machine'])
    expect(onDisk.filter((m) => mods.has(m)).length).toBe(onDisk.length - 1)
  })
})
