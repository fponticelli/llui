#!/usr/bin/env node
/**
 * Doc-extraction type-check for every package README in the workspace.
 *
 * Walks `packages/*\/README.md`, writes each fenced `ts` / `tsx` /
 * `typescript` block to its own synthetic module, and runs `tsc --noEmit`
 * over the set. It catches docs that drift from the API they document — a
 * renamed export, a changed signature, a dropped required option. Live
 * examples it found the day it started type-checking: `@llui/test` documented
 * a `ComponentDef` export and a `harness.flush()` that do not exist,
 * `@llui/components` documented a whole `xClasses()` layer that was deleted,
 * `@llui/agent`'s `identityResolver` read `req.cookies` off a Web `Request`,
 * and `@llui/vike`'s `createOnRenderHtml` examples omitted a required option.
 *
 * It TYPE-checks. It used to write a file-level `// @ts-nocheck` as the second
 * line of the synthetic file, which disables all semantic checking, so it
 * reported parse errors only: a block reading `const x: number = 'nope'`
 * PASSED (#255). Nothing here may reinstate a file-level `@ts-nocheck`.
 *
 * How a snippet is made checkable without being rewritten for the checker's
 * benefit — a README is a narrative, and these exist so it can stay one:
 *
 * - ONE FILE PER BLOCK, so `export` / `export default` / a multi-line import
 *   are legal where they stand and two blocks cannot collide on a name.
 * - A generated HEADER gives each block the imports declared by the README's
 *   OTHER blocks, then the top-level declarations of the blocks BEFORE it
 *   (nearest definition wins), then the `@doc-setup` groups. Anything the
 *   block itself binds is left out at every step.
 * - `<!-- @doc-setup … -->` (an HTML comment, so it does not render) declares
 *   the values a snippet elides on purpose — a mock API, a runtime stub, the
 *   `{ state, send }` view bag the prose supplies. This is the honest form of
 *   what the file-level `@ts-nocheck` was reaching for.
 * - `@doc-skip` in the fence info string (```ts @doc-skip — invisible in
 *   rendered docs) or as a `// @doc-skip` in the first three lines excludes a
 *   block entirely. Use it only where the block is not a program: a
 *   side-by-side listing of import spellings, a shell transcript.
 * - `DOC_ONLY_MODULES` stubs third-party modules a README references
 *   illustratively. Workspace `@llui/*` packages are NEVER stubbed.
 *
 * What is deliberately NOT checked, and why:
 *
 * - A RELATIVE import (`./Layout`) names a file in the reader's project, so
 *   its "cannot find module" is dropped. Consequences downstream are not:
 *   the binding is `any`, and an inference that lands on `unknown` still
 *   reports.
 * - `noImplicitAny` is off; `strict` is otherwise ON, because that is what a
 *   reader's app is — under `strict: false` a bare `[]` infers `any[]` rather
 *   than `never[]`, so the canonical `init: () => [state, []]` fails.
 *
 * Usage:
 *   node scripts/check-readme-examples.mjs            # all packages
 *   node scripts/check-readme-examples.mjs vike agent # specific ones
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Match a fenced code block opened with `ts`, `tsx`, or `typescript`. The
 * rest of the info string is captured so a skip can be declared THERE
 * (```ts @doc-skip) instead of as a comment line the rendered docs show.
 */
const FENCE_RE = /```(?:ts|tsx|typescript)\b([^\n]*)\n([\s\S]*?)```/g

/**
 * THIRD-PARTY modules a README references illustratively and that the
 * documenting package must NOT depend on. Each gets an ambient
 * `declare module`, so the import resolves to `any` and the snippet around it
 * is still checked. Keyed `<package dir>: { <specifier>: <reason> }`.
 *
 * WORKSPACE `@llui/*` packages are deliberately absent and must stay absent:
 * they are resolved for real through the link farm below, so a README naming
 * an export a sibling package no longer has still fails — which is the whole
 * point of the gate. `@llui/components/styles/tabs` is the live example.
 *
 * Closed at both ends: an entry whose specifier no longer appears in that
 * README fails as obsolete (the obsolete-entry pass at the bottom of this file), so the list cannot
 * quietly outlive the docs it excuses.
 * @type {Record<string, Record<string, string>>}
 */
const DOC_ONLY_MODULES = {
  agent: {
    express: 'Server integration example; the LAP server is transport-agnostic.',
  },
  'lexical-collab': {
    'y-websocket': 'One of several Yjs providers; the binding takes any of them.',
  },
  markdown: {
    shiki: 'Syntax-highlighting integration example for a code-block renderer.',
    'micromark-extension-mine': 'Deliberately fictional name in the "your own syntax" example.',
    'mdast-util-mine': 'Deliberately fictional name in the "your own syntax" example.',
  },
  router: {
    zod: 'Standard Schema example; the router accepts any Standard Schema.',
    valibot: 'Standard Schema example; the router accepts any Standard Schema.',
  },
}

/**
 * A `<!-- @doc-setup … -->` region: declarations that every block of the
 * README may use but that no reader should have to see. This is the honest
 * form of what the file-level `@ts-nocheck` was reaching for — a snippet
 * legitimately names values the checker cannot see (a mock API, a runtime
 * stub, a type the surrounding prose describes) — except that it names them
 * instead of switching the checker off.
 */
const SETUP_RE = /<!--\s*@doc-setup\b([\s\S]*?)-->/g

/**
 * Split a README into its `@doc-setup` text and the prose with each setup
 * region blanked to the SAME number of lines, so every later line offset is
 * unchanged and a fenced block inside a setup region cannot be double-read.
 * @param {string} source
 * @returns {{ setup: string, rest: string }}
 */
export function splitSetup(source) {
  /** @type {string[]} */
  const parts = []
  const rest = source.replace(SETUP_RE, (whole, body) => {
    if (typeof body === 'string') parts.push(body.replace(/^\s*```[^\n]*\n?|```\s*$/g, ''))
    let blanked = ''
    for (const ch of whole) if (ch === '\n') blanked += '\n'
    return blanked
  })
  return { setup: parts.join('\n\n'), rest }
}

/**
 * The result of type-checking one package's README snippets.
 * @typedef {object} CheckResult
 * @property {boolean} ok
 * @property {string} diagnostics
 */

/**
 * How one synthetic file's lines map back onto the README.
 * @typedef {object} BlockMapping
 * @property {number} offset README line minus synthetic line, for body lines.
 * @property {number} headerLines synthetic lines before the block body.
 * @property {number} indent columns the block was dedented by.
 */

/**
 * True when this module is the process entry point, so importing it for a test
 * does not launch the sweep.
 * @returns {boolean}
 */
function isDirectInvocation() {
  const entry = process.argv[1]
  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)
}

/**
 * The trailing path segment of a package directory.
 * @param {string} pkgDir
 * @returns {string}
 */
function packageNameOf(pkgDir) {
  const name = pkgDir.split('/').slice(-1)[0]
  if (name === undefined) throw new Error(`check-readme-examples: no name in "${pkgDir}"`)
  return name
}

/**
 * The output `execSync` hangs off the error it throws. The caught value is
 * `unknown` — a spawn failure throws an error carrying neither stream — so read
 * both defensively rather than assuming the shape.
 * @param {unknown} err
 * @returns {string}
 */
function execOutput(err) {
  if (typeof err !== 'object' || err === null) return ''
  const stdout = 'stdout' in err ? err.stdout : undefined
  const stderr = 'stderr' in err ? err.stderr : undefined
  const text = (/** @type {unknown} */ value) =>
    value === null || value === undefined ? '' : String(value)
  return text(stdout) + text(stderr)
}

/**
 * One fenced block, with the README line its first body line sits on.
 * @typedef {object} Block
 * @property {string} body dedented; see `indent`.
 * @property {number} startLine 1-based README line of the block's first body line.
 * @property {number} indent columns stripped from every line, so a reported
 *   column can be put back where the README actually has it.
 */

/**
 * Extract every TS/TSX block from a README, with the README line each one
 * starts on so a diagnostic can be reported against the README rather than
 * against the synthetic file nobody edits.
 * @param {string} source
 * @returns {Block[]}
 */
export function extractBlocks(source) {
  /** @type {Block[]} */
  const blocks = []
  /** @type {RegExpExecArray | null} */
  let match
  while ((match = FENCE_RE.exec(source)) !== null) {
    const info = match[1]
    const body = match[2]
    // The fence pattern's groups always participate, so this cannot fire — it
    // exists so a future edit to FENCE_RE that loses one fails loudly instead
    // of silently skipping blocks.
    if (info === undefined || body === undefined) {
      throw new Error('check-readme-examples: fence matched with no body')
    }
    // Skip blocks tagged `@doc-skip` — in the fence info string (invisible in
    // rendered docs, preferred) or as a `// @doc-skip` in the first 3 lines.
    if (/@doc-skip\b/.test(info)) continue
    const head = body.split('\n').slice(0, 3).join('\n')
    if (/\/\/\s*@doc-skip\b/.test(head)) continue
    // `match.index` is the offset of the ``` opener; the body starts on the
    // next line, so count the newlines before the fence and add two.
    const before = source.slice(0, match.index)
    let newlines = 0
    for (const ch of before) if (ch === '\n') newlines++
    // A fence nested in a Markdown list is indented wholesale, which would
    // leave the block with no column-0 declarations at all. Strip the common
    // prefix and remember it, so `DECLARATION_RE` sees real top level and a
    // reported column can still be put back.
    const lines = body.split('\n')
    let indent = Infinity
    for (const line of lines) {
      if (line.trim() === '') continue
      const lead = /^[ \t]*/.exec(line)
      indent = Math.min(indent, lead === null ? 0 : lead[0].length)
    }
    if (!Number.isFinite(indent)) indent = 0
    blocks.push({
      body: indent === 0 ? body : lines.map((l) => l.slice(indent)).join('\n'),
      startLine: newlines + 2,
      indent,
    })
  }
  return blocks
}

/**
 * An `import … from '…'` statement, anchored at the start of a line so a
 * commented-out one (`// import …`) and a dynamic `await import(…)` are both
 * skipped. `[^'"]` in the clause spans newlines but cannot cross a string
 * literal, so a multi-line import is matched and a runaway one is not.
 */
const IMPORT_FROM_RE = /(?:^|\n)[ \t]*import\s+(type\s+)?([^'"]*?)\s+from\s*['"]([^'"]+)['"]/g
/** A side-effect `import '…'`, anchored the same way. */
const IMPORT_BARE_RE = /(?:^|\n)[ \t]*import\s*['"]([^'"]+)['"]/g

/**
 * One named binding of an import clause.
 * @typedef {object} NamedBinding
 * @property {string} local the name introduced into scope.
 * @property {string} clause the text to re-emit inside `{ … }`.
 */

/**
 * The bindings an import clause introduces: `a`, `* as ns`, `{ b, c as d }`,
 * and the inline `{ type E }` form.
 * @param {string} clause text between `import` and `from`.
 * @returns {{ standalone: NamedBinding[], named: NamedBinding[] }}
 */
export function parseImportClause(clause) {
  /** @type {NamedBinding[]} */
  const standalone = []
  /** @type {NamedBinding[]} */
  const named = []
  const braces = /\{([\s\S]*)\}/.exec(clause)
  const head = braces === null ? clause : clause.slice(0, clause.indexOf('{'))
  for (const part of head.split(',')) {
    const trimmed = part.trim()
    if (trimmed === '') continue
    const ns = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(trimmed)
    if (ns !== null && ns[1] !== undefined) standalone.push({ local: ns[1], clause: trimmed })
    else if (/^[A-Za-z_$][\w$]*$/.test(trimmed))
      standalone.push({ local: trimmed, clause: trimmed })
  }
  if (braces !== null && braces[1] !== undefined) {
    for (const part of braces[1].split(',')) {
      const trimmed = part.trim()
      if (trimmed === '') continue
      const alias = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(trimmed)
      if (alias !== null && alias[1] !== undefined) named.push({ local: alias[1], clause: trimmed })
      else {
        const bare = /^(?:type\s+)?([A-Za-z_$][\w$]*)$/.exec(trimmed)
        if (bare !== null && bare[1] !== undefined) named.push({ local: bare[1], clause: trimmed })
      }
    }
  }
  return { standalone, named }
}

/**
 * A TOP-LEVEL declaration a block introduces, anchored at column 0 so a
 * nested one is not collected. Blocks are dedented first (`extractBlocks`),
 * because a fence nested in a Markdown LIST is indented wholesale and would
 * otherwise have no top-level declarations at all.
 *
 * Column 0 is load-bearing in one direction: this same set is what a block
 * re-exports for the blocks after it, and `export { x }` naming a `const`
 * declared inside a function is an error in the block that declares it.
 * Measured at 8 such failures when leading whitespace was allowed.
 */
const DECLARATION_RE =
  /^(export\s+)?(?:declare\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|var|function\*?|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm

/**
 * The top-level names a block declares, each flagged with whether the block
 * already exports it.
 * @param {string} source
 * @returns {Map<string, boolean>} name → exported.
 */
export function declaredNames(source) {
  /** @type {Map<string, boolean>} */
  const names = new Map()
  for (const m of source.matchAll(DECLARATION_RE)) {
    const name = m[2]
    if (name === undefined) continue
    if (!names.has(name)) names.set(name, m[1] !== undefined)
  }
  return names
}

/**
 * `@llui/<name>` → the workspace directory that publishes it, read from each
 * package's own `package.json` rather than assumed from the directory name
 * (`packages/agent-bridge` publishes `llui-agent`, and is correctly absent).
 * @returns {Map<string, string>}
 */
function workspaceScopedPackages() {
  /** @type {Map<string, string>} */
  const byName = new Map()
  const packagesDir = join(ROOT, 'packages')
  for (const dir of readdirSync(packagesDir)) {
    const manifest = join(packagesDir, dir, 'package.json')
    if (!existsSync(manifest)) continue
    /** @type {unknown} */
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || !('name' in parsed)) continue
    const name = parsed.name
    if (typeof name !== 'string' || !name.startsWith('@llui/')) continue
    byName.set(name.slice('@llui/'.length), join(packagesDir, dir))
  }
  return byName
}

/**
 * Populate `<dir>` with a symlink per workspace `@llui/*` package. Existing
 * links are left alone so a re-run is cheap; a stale one pointing elsewhere
 * is replaced.
 * @param {string} dir
 * @returns {void}
 */
function linkWorkspacePackages(dir) {
  mkdirSync(dir, { recursive: true })
  for (const [name, target] of workspaceScopedPackages()) linkOne(join(dir, name), target)
}

/**
 * Point `link` at `target`, leaving an already-correct link alone so a re-run
 * is cheap and replacing a stale one.
 * @param {string} link
 * @param {string} target
 * @returns {void}
 */
function linkOne(link, target) {
  mkdirSync(dirname(link), { recursive: true })
  try {
    if (readlinkSync(link) === target) return
    rmSync(link, { force: true })
  } catch {
    // Not a link (or absent) — `symlinkSync` below reports anything real.
  }
  symlinkSync(target, link, 'dir')
}

/**
 * For one package, write each README block to its own synthetic module and
 * run `tsc --noEmit` over the set. Returns `{ ok, diagnostics }` with
 * diagnostics remapped onto README line numbers.
 * @param {string} pkgDir
 * @returns {CheckResult}
 */
export function checkPackage(pkgDir) {
  const pkgName = packageNameOf(pkgDir)
  const readmePath = join(pkgDir, 'README.md')
  if (!existsSync(readmePath)) return { ok: true, diagnostics: '' }

  const { setup, rest } = splitSetup(readFileSync(readmePath, 'utf8'))
  const blocks = extractBlocks(rest)
  if (blocks.length === 0) return { ok: true, diagnostics: '' }

  // A setup region contributes imports to the shared preamble exactly as a
  // block does, and its remaining statements as GROUPS separated by blank
  // lines (so a multi-line `type` stays whole). A group is dropped for any
  // block that already binds one of its names, so a stub never shadows the
  // real thing.
  const setupGroups = setup
    .split(/\n\s*\n/)
    .map((group) =>
      group
        .split('\n')
        .filter((l) => !/^\s*import\s/.test(l))
        .join('\n')
        .trim(),
    )
    .filter((group) => group !== '')
    .map((text) => ({ text, names: [...declaredNames(text).keys()] }))

  // ONE FILE PER BLOCK. Collecting every block into a single synthetic file
  // needs the imports hoisted out of the per-block wrappers to file scope,
  // where two blocks importing the same name collide (`Duplicate identifier`),
  // and leaves `export` / `export default` / a multi-line import illegal
  // inside the wrapper function. Both classes are artifacts of the bundling,
  // not of the documented code — measured at 48 duplicate-identifier and 32
  // illegal-statement errors across the workspace, against 243 total. A block
  // is a module already, so give it a module.
  const tmpDir = join(pkgDir, 'node_modules', '.cache', 'llui-readme-check')
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })

  // A README is a NARRATIVE: the first block does the imports and the ones
  // after it carry on without repeating them. So each block file gets a
  // PREAMBLE — the imports declared by the README's OTHER blocks — while its
  // own statements stay private to it. That is the semantic the single-file
  // design had (imports at file scope, bodies in per-block IIFEs), and it
  // costs nothing against what this gate is FOR: a renamed or dropped export
  // still fails on the import line that names it.
  //
  // The preamble is merged per (module, type-only), not deduped per LINE:
  // `{ div, main }` and `{ div, header }` from the same module are one
  // import of three names. Deduping whole lines instead re-emits `div`
  // twice (measured: 544 `Duplicate identifier`), and skipping the second
  // line loses `header` (an equally wrong TS2304). First occurrence wins on
  // a LOCAL NAME, so two blocks importing the same name from different
  // modules resolve to the first one's module in the preamble — the block
  // that wrote the second import still keeps its own copy, so only the
  // OTHER blocks see the first module's version.
  /** @type {string[]} */
  const bareSpecs = []
  /** @type {Map<string, string>} */
  const standaloneLines = new Map()
  /** @type {Map<string, { typeOnly: boolean, specifier: string, entries: Map<string, string> }>} */
  const namedGroups = new Map()
  /** @type {Set<string>} */
  const claimed = new Set()
  // Every name a block binds at top level, whether by import or declaration.
  // Nothing carrying one of these may be added to that block's header, or the
  // two declarations collide — measured at 12 `Individual declarations in
  // merged declaration` + 6 `Duplicate identifier` + 1 `Import declaration
  // conflicts with local declaration` before this exclusion existed.
  /** @type {Set<string>[]} */
  const ownNames = blocks.map(() => new Set())
  /** @type {Map<string, boolean>[]} */
  const declaredBy = blocks.map((b) => declaredNames(b.body))
  for (const [i, decls] of declaredBy.entries()) {
    const own = ownNames[i]
    if (own === undefined) throw new Error('check-readme-examples: own-name set missing')
    for (const name of decls.keys()) own.add(name)
  }

  // The setup region's own imports join the shared preamble; a scratch
  // `own` set collects its bindings and is then discarded, since setup binds
  // nothing a block has to avoid.
  for (const [i, body] of [...blocks.map((b) => b.body), setup].entries()) {
    const own = ownNames[i] ?? new Set()
    for (const m of body.matchAll(IMPORT_BARE_RE)) {
      const spec = m[1]
      if (spec !== undefined && !bareSpecs.includes(spec)) bareSpecs.push(spec)
    }
    for (const m of body.matchAll(IMPORT_FROM_RE)) {
      const [, typeTok, clauseText, specifier] = m
      if (clauseText === undefined || specifier === undefined) continue
      const typeOnly = typeTok !== undefined
      const { standalone, named } = parseImportClause(clauseText)
      for (const b of [...standalone, ...named]) own.add(b.local)
      for (const b of standalone) {
        if (claimed.has(b.local)) continue
        claimed.add(b.local)
        standaloneLines.set(
          b.local,
          `import ${typeOnly ? 'type ' : ''}${b.clause} from '${specifier}'`,
        )
      }
      if (named.length === 0) continue
      const key = `${typeOnly ? 'type' : 'value'} ${specifier}`
      let group = namedGroups.get(key)
      if (group === undefined) {
        group = { typeOnly, specifier, entries: new Map() }
        namedGroups.set(key, group)
      }
      for (const b of named) {
        if (claimed.has(b.local)) continue
        claimed.add(b.local)
        group.entries.set(b.local, b.clause)
      }
    }
  }

  /** @type {string[]} */
  const outPaths = []
  /** @type {Map<string, BlockMapping>} */
  const offsetOf = new Map()
  for (const [i, block] of blocks.entries()) {
    const own = ownNames[i]
    if (own === undefined) throw new Error('check-readme-examples: own-name set missing')
    // Anything this block imports itself is omitted from its preamble, or
    // the two declarations collide.
    // Every name this header binds, so nothing below can bind it twice.
    /** @type {Set<string>} */
    const carried = new Set(own)
    const preamble = [
      ...bareSpecs.map((spec) => `import '${spec}'`),
      ...[...standaloneLines.entries()].flatMap(([local, line]) => {
        if (carried.has(local)) return []
        carried.add(local)
        return [line]
      }),
      ...[...namedGroups.values()].flatMap((group) => {
        /** @type {string[]} */
        const clauses = []
        for (const [local, clause] of group.entries) {
          if (carried.has(local)) continue
          carried.add(local)
          clauses.push(clause)
        }
        if (clauses.length === 0) return []
        return [
          `import ${group.typeOnly ? 'type ' : ''}{ ${clauses.join(', ')} } from '${group.specifier}'`,
        ]
      }),
    ]

    // A README is read top to bottom, so a block may use a type or value an
    // EARLIER block defined (`AppLayout`, `LayoutState`, `MY_TRANSFORMERS`).
    // Each block therefore imports the earlier blocks' top-level declarations
    // from their own synthetic modules — nearest definition wins, so a README
    // that redefines a name in a later "before/after" pair still reads the one
    // beside it. Edges only ever point backwards, so there is no cycle.
    for (let j = i - 1; j >= 0; j--) {
      const decls = declaredBy[j]
      if (decls === undefined) continue
      const wanted = [...decls.keys()].filter((name) => !carried.has(name))
      if (wanted.length === 0) continue
      for (const name of wanted) carried.add(name)
      preamble.push(`import { ${wanted.join(', ')} } from './${pkgName}-block-${j}'`)
    }

    // Setup groups come LAST, so a real definition — this block's own, or an
    // earlier block's — always wins over the stub that stands in for it.
    for (const group of setupGroups) {
      if (group.names.some((name) => carried.has(name))) continue
      for (const name of group.names) carried.add(name)
      preamble.push(group.text)
    }

    // One AUTO-GENERATED comment, the preamble, one blank separator.
    const headerText = preamble.join('\n')
    const headerLines = 1 + (headerText === '' ? 0 : headerText.split('\n').length) + 1
    const header = `// AUTO-GENERATED from packages/${pkgName}/README.md — do not edit.\n${headerText}${headerText === '' ? '' : '\n'}\n`
    const outPath = join(tmpDir, `${pkgName}-block-${i}.ts`)
    // The trailing `export { … }` makes a block with no import/export a MODULE
    // rather than a script (so its top-level names stay private to it and
    // top-level `await` is legal) AND publishes what the later blocks import.
    // A name the block already exports itself is left out — re-exporting it is
    // `Cannot redeclare exported variable`.
    const decls = declaredBy[i]
    const republish =
      decls === undefined
        ? []
        : [...decls.entries()].flatMap(([name, exported]) => (exported ? [] : [name]))
    writeFileSync(outPath, `${header}${block.body}\nexport { ${republish.join(', ')} }\n`)
    outPaths.push(outPath)
    // Body line 1 sits at file line `headerLines + 1`, and is README line
    // `block.startLine`.
    offsetOf.set(outPath, {
      offset: block.startLine - headerLines - 1,
      headerLines,
      indent: block.indent,
    })
  }

  // A stylesheet import is a documented, working line that TypeScript has no
  // module declaration for — an app declares exactly this, and without it
  // every `import '@llui/components/styles/theme.css'` is a TS2882 against
  // a file that really ships.
  //
  // `vite/client` is referenced for the same reason one step up: several READMEs
  // gate on `import.meta.env.DEV` / `.PROD`, and without it the only ambient
  // `ImportMeta` in scope is the deliberately narrow `env?: { DEV?, MODE? }`
  // that `@llui/dom` and `@llui/devmode-annotate` declare for their own use —
  // so a correct Vite snippet reports `Object is possibly undefined` and
  // `Property 'PROD' does not exist`. Referencing Vite's own types checks the
  // snippet against what the reader's app actually has.
  const stubPath = join(tmpDir, 'stubs.d.ts')
  const docOnly = DOC_ONLY_MODULES[pkgName] ?? {}
  const stubbed = Object.keys(docOnly).map((spec) => `declare module '${spec}'`)
  writeFileSync(
    stubPath,
    `/// <reference types="vite/client" />\ndeclare module '*.css'\n${stubbed.join('\n')}\n`,
  )

  // A README legitimately documents SIBLING packages the documenting package
  // does not depend on — `@llui/agent`'s Vite config imports
  // `@llui/vite-plugin`, `@llui/dom`'s examples import `@llui/effects` — and
  // those are exactly the imports a reader will copy, so they have to be
  // checked rather than waved through. The link farm sits above the block
  // files in the resolution walk and points at the real packages, so every
  // `@llui/*` specifier resolves through that package's own `exports` map,
  // subpaths included. Measured at 23 of 74 unresolvable modules.
  linkWorkspacePackages(join(tmpDir, 'node_modules', '@llui'))
  linkOne(join(tmpDir, 'node_modules', 'vite'), join(ROOT, 'node_modules', 'vite'))

  // tsc 6 errors when given files alongside an inferred tsconfig.json.
  // Generate a per-package mini-tsconfig that narrows the input to
  // exactly the synthetic files and bypasses the workspace config —
  // README snippets shouldn't drag in the whole package's strictness
  // flags (they're examples, not production code).
  //
  // The files live under the PACKAGE's own `node_modules/.cache`, not the
  // workspace root's, so every import resolves the way it does for a consumer
  // of that package: its declared deps and peers through
  // `packages/<pkg>/node_modules`, and the package ITSELF through the
  // self-name reference its `exports` map provides. That was worth 105 of the
  // first 298 errors, all `@llui/*`; the link farm below now covers that half,
  // so what the LOCATION still carries on its own is the package's THIRD-PARTY
  // dependencies — measured by moving it back to the root cache against the
  // final code: 54 errors, `vike/server` x24, `mdast` x9, `lexical` x6,
  // `@lexical/markdown` x6, `yjs`, `loro-crdt`, `@lexical/headless` x3 each.
  // `scripts/test/readme-examples.test.ts` CANNOT see this — its fixtures are
  // bare temp directories with no dependencies to resolve — so that mutation
  // survives the suite and is answered by this measurement instead.
  const tsconfigPath = join(tmpDir, `${pkgName}-tsconfig.json`)
  writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          // STRICT, because that is what a reader's app is. Under
          // `strict: false` a bare `[]` infers `any[]` instead of `never[]`,
          // so the canonical effect-free `init: () => [state, []]` FAILS —
          // measured on `@llui/components`' own opening example, which
          // compiles cleanly under `strict: true`. A laxer setting than the
          // audience uses gets it wrong in both directions at once.
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          jsx: 'preserve',
          // No `types` array — let `@types/node` etc. resolve through
          // workspace root if reachable; otherwise omit. README snippets
          // shouldn't depend on type roots beyond what TS auto-includes.
          allowImportingTsExtensions: true,
          ignoreDeprecations: '6.0',
          // The one strictness a snippet may not have: an example that
          // elides a callback's parameter types is doing so on purpose, and
          // `noImplicitAny` says nothing about whether the API it documents
          // still exists.
          noImplicitAny: false,
          baseUrl: ROOT,
        },
        files: [stubPath, ...outPaths],
      },
      null,
      2,
    ),
  )

  const tscBin = join(ROOT, 'node_modules', '.bin', 'tsc')
  try {
    execSync(`"${tscBin}" -p "${tsconfigPath}"`, { cwd: ROOT, stdio: 'pipe' })
    return { ok: true, diagnostics: '' }
  } catch (e) {
    const remapped = remapDiagnostics(execOutput(e), pkgDir, offsetOf)
    const kept = remapped.split('\n').filter((line) => !isExemptDiagnostic(line))
    const errors = kept.filter((line) => / error TS\d+: /.test(line))
    if (errors.length === 0) return { ok: true, diagnostics: '' }
    return { ok: false, diagnostics: kept.join('\n') }
  }
}

/**
 * A RELATIVE specifier in a README example names a file in the READER's
 * project (`./Layout`, `../nav-progress`), so there is nothing here to
 * resolve it against and no drift it could describe. TypeScript still binds
 * the import's names — as `any` — so dropping the diagnostic leaves every
 * later use checkable rather than turning into `Cannot find name`.
 *
 * This is deliberately scoped to the two "cannot find module" codes and to a
 * `./`-prefixed specifier: a BARE specifier that does not resolve IS a signal
 * (the package documents an import a reader cannot make) and stays fatal.
 * @param {string} line
 * @returns {boolean}
 */
function isExemptDiagnostic(line) {
  return /error TS(?:2307|2882): [^']*'\.\.?\//.test(line)
}

/**
 * Rewrite `<synthetic>(line,col): error TSxxxx: …` onto the README line the
 * snippet came from. A reader who is handed a path under `node_modules/.cache`
 * has to reconstruct the mapping by hand, and the file is deleted on the next
 * green run.
 * @param {string} raw
 * @param {string} pkgDir
 * @param {Map<string, BlockMapping>} offsetOf keyed by ABSOLUTE synthetic path.
 * @returns {string}
 */
function remapDiagnostics(raw, pkgDir, offsetOf) {
  const readmePath = join(pkgDir, 'README.md')
  const rel = relative(ROOT, readmePath)
  return raw
    .split('\n')
    .map((line) => {
      const m = /^(.*?)\((\d+),(\d+)\): (.*)$/.exec(line)
      if (m === null) return line
      const [, filePart, lineNo, colNo, rest] = m
      if (filePart === undefined || lineNo === undefined || rest === undefined) return line
      const mapping = offsetOf.get(resolve(ROOT, filePart))
      if (mapping === undefined) return line
      // A diagnostic inside the GENERATED header has no README line to point
      // at — inventing one (a clamp, or a negative number) reads as a real
      // location and is not one. Say where it really is instead: the header is
      // built from this README's imports and its `@doc-setup` region.
      if (Number(lineNo) <= mapping.headerLines) return `${rel} [generated header]: ${rest}`
      const col = Number(colNo) + mapping.indent
      return `${rel}(${Number(lineNo) + mapping.offset},${col}): ${rest}`
    })
    .join('\n')
}

/**
 * The CLI body. Exported and guarded rather than run at import, so
 * `scripts/test/readme-examples.test.ts` can drive `checkPackage` against a
 * fixture without launching a 26-package sweep as a side effect.
 * @param {string[]} args package directory names, or none for all of them.
 * @returns {number} process exit code.
 */
export function main(args) {
  const packagesDir = join(ROOT, 'packages')
  const allPkgs = readdirSync(packagesDir).filter((d) =>
    existsSync(join(packagesDir, d, 'package.json')),
  )
  const targets = args.length > 0 ? args : allPkgs

  // The stub list is checked BEFORE any package runs, so an entry that has
  // outlived the snippet it excused is a failure of its own rather than an
  // invisible widening of what the gate waves through.
  /** @type {string[]} */
  const obsolete = []
  for (const [pkg, specs] of Object.entries(DOC_ONLY_MODULES)) {
    const readme = join(ROOT, 'packages', pkg, 'README.md')
    const source = existsSync(readme) ? readFileSync(readme, 'utf8') : ''
    for (const spec of Object.keys(specs)) {
      if (!source.includes(`'${spec}'`) && !source.includes(`"${spec}"`)) {
        obsolete.push(`DOC_ONLY_MODULES['${pkg}']['${spec}'] — no longer imported by that README`)
      }
    }
  }
  if (obsolete.length > 0) {
    process.stdout.write(`✗ obsolete stub entries\n`)
    for (const line of obsolete) process.stdout.write(`    ${line}\n`)
    return 1
  }

  let failed = 0
  /** Package dirs whose cache was written this run, for the cleanup pass. */
  /** @type {string[]} */
  const touched = []
  for (const pkg of targets) {
    const dir = join(packagesDir, pkg)
    if (!existsSync(dir)) {
      console.log(`⚠ skip: packages/${pkg} not found`)
      continue
    }
    touched.push(dir)
    const { ok, diagnostics } = checkPackage(dir)
    if (ok) {
      process.stdout.write(`✓ ${pkg}\n`)
    } else {
      failed++
      process.stdout.write(`✗ ${pkg}\n`)
      process.stdout.write(
        diagnostics
          .split('\n')
          .map((l) => `    ${l}`)
          .join('\n'),
      )
      process.stdout.write('\n')
    }
  }

  // Best-effort cleanup of cache files when everything passed (keep on
  // failure so the developer can inspect the synthetic files).
  if (failed === 0) {
    for (const dir of touched) {
      const tmpDir = join(dir, 'node_modules', '.cache', 'llui-readme-check')
      if (!existsSync(tmpDir)) continue
      try {
        rmSync(tmpDir, { recursive: true, force: true })
      } catch {
        /* fine */
      }
    }
  }

  return failed === 0 ? 0 : 1
}

if (isDirectInvocation()) process.exit(main(process.argv.slice(2)))
