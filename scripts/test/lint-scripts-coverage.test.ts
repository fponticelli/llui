import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ESLint } from 'eslint'
import ts from 'typescript'

/**
 * `scripts/` is linted by `pnpm lint:scripts` (#256), and this pins that the
 * coverage is TOTAL and that the gate is the one that was measured.
 *
 * #256 is the sibling of #252 and has the same shape: `pnpm turbo lint` runs
 * the `lint` task PER WORKSPACE PACKAGE and the repo root is not a workspace
 * member, so all 65 `.ts`/`.mjs` files here were linted by NOTHING — not by a
 * decision, but because no invocation reached them. The config was always
 * willing; nothing ran it.
 *
 * That history decides the shape of this file. There are THREE properties and
 * each is checked separately, because each can fail on its own:
 *
 *   1. SELECTION — the invocation names the same file set the type-check gate
 *      compiles. Asserted against `tsconfig.scripts.json`'s `include`, whose
 *      expansion `scripts-typecheck-coverage.test.ts` already pins to the git
 *      enumeration by exact set equality. Restating that expansion here would
 *      be a second walker over the same question (this repo has one rule about
 *      that), so this file borrows the answer and pins the LINK to it.
 *   2. RESOLUTION — every file in that set actually resolves the type-aware
 *      scripts block, and is not ignored. Iterated over the whole git set, so
 *      it is a statement about all 65 files rather than a sample.
 *   3. INVOCATION — a root script runs it, `pnpm verify` runs that script, and
 *      CI runs it un-neutered. A config nothing invokes is exactly #256.
 *
 * Enumeration is `git ls-files --cached --others --exclude-standard` and NEVER
 * a filesystem walk: `.claude/worktrees/` is gitignored and holds a full
 * checkout of every concurrent agent lane, so a walk from the repo root sees
 * every sibling branch's files as if they were yours (measured elsewhere in
 * this repo at 210 collected configs, 180 of them foreign).
 */

const ROOT = path.resolve(__dirname, '../..')
const TSCONFIG = path.join(ROOT, 'tsconfig.scripts.json')

/** Extensions a JS/TS toolchain could plausibly be asked to handle. */
const CODE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

/** Extensions the two `scripts/` gates actually cover. */
const GATED_EXTENSIONS = ['.ts', '.mjs']

/**
 * The parts of a resolved flat config this file reads.
 *
 * `ESLint#calculateConfigForFile` is declared `Promise<any>`, so every read off
 * it would be an assertion against `any` — the shape this gate exists to stop,
 * and it caught this file on its own first run. Declared here and asserted at
 * the one call site instead.
 */
interface ResolvedConfig {
  readonly languageOptions?: { readonly parserOptions?: { readonly project?: unknown } }
  readonly rules?: Readonly<Record<string, unknown>>
}

/** The type-aware rules this gate exists for — the `any`-propagation family. */
const UNSAFE_FAMILY = [
  '@typescript-eslint/no-unsafe-assignment',
  '@typescript-eslint/no-unsafe-call',
  '@typescript-eslint/no-unsafe-member-access',
  '@typescript-eslint/no-unsafe-argument',
  '@typescript-eslint/no-unsafe-return',
] as const

/** Whether a resolved rule entry is at severity `error`, read through `unknown`. */
function isErrorSeverity(entry: unknown): boolean {
  const parts: readonly unknown[] = Array.isArray(entry) ? entry : []
  return parts[0] === 2
}

function gitFiles(pathspec: string): string[] {
  return execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', pathspec],
    { cwd: ROOT, encoding: 'utf8' },
  )
    .split('\n')
    .filter((f) => f !== '')
    .sort()
}

/** Every `.ts`/`.mjs` under `scripts/`, repo-relative, from git rather than a walk. */
function gatedScriptFiles(): string[] {
  return gitFiles('scripts').filter((f) => GATED_EXTENSIONS.some((e) => f.endsWith(e)))
}

/** The root manifest's `scripts` map. */
function rootPackageScripts(): Record<string, string> {
  const pkg: unknown = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  if (typeof pkg !== 'object' || pkg === null || !('scripts' in pkg)) {
    throw new Error('root package.json has no "scripts"')
  }
  const scripts = (pkg as { scripts: unknown }).scripts
  if (typeof scripts !== 'object' || scripts === null) {
    throw new Error('root package.json "scripts" is not an object')
  }
  return scripts as Record<string, string>
}

/** `tsconfig.scripts.json`'s literal `include` array, as authored. */
function tsconfigInclude(): string[] {
  const read = ts.readConfigFile(TSCONFIG, (p) => ts.sys.readFile(p))
  expect(read.error, `tsconfig.scripts.json must parse`).toBeUndefined()
  const include: unknown = (read.config as { include?: unknown }).include
  if (!Array.isArray(include)) throw new Error('tsconfig.scripts.json has no "include" array')
  // Re-declared rather than read straight off the guard: `Array.isArray` is
  // typed `arg is any[]`, so `include` would be `any[]` here. Safe either way
  // (the element check throws), but the idiom has to be the same everywhere or
  // the next copy of it is the one that lands on a sink accepting `any`.
  const entries: readonly unknown[] = include
  return entries.map((v) => {
    if (typeof v !== 'string') throw new Error('tsconfig.scripts.json "include" is not strings')
    return v
  })
}

/**
 * The single-quoted arguments of `lint:scripts`.
 *
 * The globs MUST stay quoted in the manifest: `sh` has no `globstar`, so a bare
 * `scripts/**\/*.ts` expands as `scripts/*\/*.ts` — which silently drops every
 * script at the top level of `scripts/` and leaves only `scripts/lib` and
 * `scripts/test` linted, with a green exit code.
 */
function lintScriptGlobs(script: string): string[] {
  return [...script.matchAll(/'([^']+)'/g)].map((m) => m[1] as string)
}

describe('scripts/ lint coverage (#256)', () => {
  let eslint: ESLint

  beforeAll(() => {
    // One instance: constructing it loads and evaluates `eslint.config.ts`
    // through jiti, measured at ~1.3 s, while each subsequent
    // `calculateConfigForFile` is under a millisecond. Deliberately NOT
    // `lintFiles`, which is the honest 5.4 s of actually type-aware linting all
    // 65 files and is what CI is for; the properties below need the resolved
    // CONFIG, not the diagnostics.
    eslint = new ESLint({ cwd: ROOT })
  })

  it('selects the same file set the type-check gate compiles', () => {
    const globs = lintScriptGlobs(rootPackageScripts()['lint:scripts'] ?? '')

    // Vacuity first: a regex that matched nothing would make both comparisons
    // below trivially true, which is this file's own failure mode one level up.
    expect(globs.length).toBeGreaterThan(0)

    // The link. `scripts-typecheck-coverage.test.ts` pins that these exact
    // globs expand to every `.ts`/`.mjs` git reports under `scripts/`, by exact
    // set equality in both directions. Asserting the same globs here makes the
    // two gates cover one set BY CONSTRUCTION — they cannot drift apart in the
    // direction that matters (a file one gate sees and the other does not)
    // without this failing.
    expect(globs).toEqual(tsconfigInclude())

    // And the quoting, which is not decoration: unquoted, `sh` expands `**` as
    // a single `*` and the invocation silently covers two subdirectories.
    for (const g of globs) {
      expect(rootPackageScripts()['lint:scripts']).toContain(`'${g}'`)
    }
  })

  it('leaves no file under scripts/ outside BOTH gates', () => {
    // The two gates cover `.ts` and `.mjs`. Anything else under `scripts/` —
    // a `.cjs` helper, a `.js` one-off, a `.mts` — is compiled by nothing and
    // linted by nothing, which is #252/#256 re-opened one extension over and
    // in exactly the same silent way: the gates stay green because they never
    // look. Fail here instead, so the choice is deliberate.
    const uncovered = gitFiles('scripts').filter(
      (f) =>
        CODE_EXTENSIONS.some((e) => f.endsWith(e)) && !GATED_EXTENSIONS.some((e) => f.endsWith(e)),
    )
    expect(uncovered).toEqual([])
  })

  it('resolves the type-aware scripts config for EVERY covered file', async () => {
    const files = gatedScriptFiles()

    // A floor, not an equality: the exact set is pinned by the selection test
    // above plus its sibling. What this guards is an enumeration that silently
    // returned nothing, which would make the loop vacuous.
    expect(files.length).toBeGreaterThan(50)

    const problems: string[] = []
    for (const file of files) {
      if (await eslint.isPathIgnored(file)) {
        problems.push(`${file}: ignored by eslint.config.ts`)
        continue
      }
      const config = (await eslint.calculateConfigForFile(file)) as ResolvedConfig
      const project = config.languageOptions?.parserOptions?.project
      // `Array.isArray` is typed `arg is any[]`, so narrowing an `unknown` with
      // it hands back `any[]` and every read off it is unchecked — the exact
      // trap this change documents at `scripts/lib/test-durations.mjs`, and one
      // the lint gate cannot catch here because the sinks (`String(p)`, `!== 2`)
      // both accept `any`. Re-declare as `unknown[]` before reading.
      const projectPaths: readonly unknown[] = Array.isArray(project) ? project : []
      if (!projectPaths.some((p) => typeof p === 'string' && p.includes('tsconfig.scripts'))) {
        problems.push(
          `${file}: not type-aware (parserOptions.project = ${JSON.stringify(project)})`,
        )
        continue
      }
      // Type-aware PARSING with the type-aware RULES switched off is a gate
      // that costs the full type-aware wall time and finds 2 errors instead of
      // 95, so the rules are pinned beside the parser rather than assumed to
      // follow from it.
      for (const rule of UNSAFE_FAMILY) {
        const entry = config.rules?.[rule]
        if (!isErrorSeverity(entry)) {
          problems.push(`${file}: ${rule} is not an error (${JSON.stringify(entry)})`)
        }
      }
      // `no-explicit-any` is a WARNING in the repo baseline and an ERROR here.
      // Banning `any` from propagating while leaving it writable by hand is a
      // gate with a documented way through it.
      const explicitAny = config.rules?.['@typescript-eslint/no-explicit-any']
      if (!isErrorSeverity(explicitAny)) {
        problems.push(`${file}: no-explicit-any is not an error (${JSON.stringify(explicitAny)})`)
      }
    }
    expect(problems).toEqual([])
  })

  it('does NOT make the workspace packages type-aware', async () => {
    // The scripts block is scoped behind `files` so `pnpm turbo lint` is
    // unchanged. Without that scoping every package would build a TS program
    // per lint run; asserting the negative is what makes "costs turbo lint
    // nothing" a checked claim rather than a comment.
    const packageSources = gitFiles('packages').filter(
      (f) => f.endsWith('.ts') && f.includes('/src/'),
    )
    expect(packageSources.length).toBeGreaterThan(100)

    const sample = packageSources[0] as string
    const config = (await eslint.calculateConfigForFile(sample)) as ResolvedConfig
    expect(config.languageOptions?.parserOptions?.project).toBeUndefined()
    expect(config.rules?.['@typescript-eslint/no-unsafe-assignment']).toBeUndefined()
  })

  /**
   * Everything above pins the CONFIG. Nothing above runs it — delete the
   * `lint:scripts` script, or the CI step that calls it, and every assertion
   * so far stays green while the gate stops existing. That is #256 itself, so
   * the INVOCATION is pinned too, following `scripts-typecheck-coverage.test.ts`
   * and the two traps it hit getting there:
   *
   *   1. an `indexOf` feeding a `slice` is SILENT when it returns -1 —
   *      `slice(-1)` is a legal call returning the last character, and
   *      `.not.toContain` then passes against a one-character string;
   *   2. an anchor literal that can also occur in PROSE matches a COMMENT.
   *      Comments sit at the same 6-space indent as steps, so a walk back to
   *      the step boundary opens the window on the PREVIOUS step and a live
   *      `continue-on-error` on the real step falls outside it — while the
   *      vacuity guard passes, because the comment supplied the very run line
   *      the guard was looking for. The enabling edit is pure prose, and this
   *      workflow file carries several paragraphs mentioning `lint:scripts`.
   *
   * So: establish the STRUCTURAL boundary first, then match inside it. A
   * comment can never begin a YAML list item, so splitting on the step
   * boundary removes the class rather than the instance.
   */
  it('is actually INVOKED — by a root script, by verify, and by CI', () => {
    const scripts = rootPackageScripts()

    expect(scripts['lint:scripts']).toBeDefined()
    expect(scripts['lint:scripts']).toMatch(/\beslint\b/)
    // A gate that ignores warnings is the thing this repo says does not work.
    expect(scripts['lint:scripts']).toContain('--max-warnings=0')

    // `pnpm verify` is the documented local pre-merge run. A gate CI runs and
    // verify does not is a gate contributors meet only after pushing.
    expect(scripts['verify']).toContain('lint:scripts')

    const ci = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const STEP_BOUNDARY = '\n      - '
    // `.slice(1)` drops the preamble before the first step: a real step cannot
    // live there, and a JOB-level block scalar can legally put a body line at
    // exactly 8 spaces, which is the one way a non-step could otherwise be
    // mistaken for one.
    const steps = ci.split(STEP_BOUNDARY).slice(1)
    const invoking = steps.filter((step) => /^ {8}run: pnpm lint:scripts$/m.test(step))

    expect(
      invoking.length,
      'ci.yml must contain a step running `pnpm lint:scripts`',
    ).toBeGreaterThan(0)

    for (const step of invoking) {
      // `continue-on-error` on the `Test durations` step is deliberate and
      // documented; here it would silently turn a build-failing gate back into
      // a log line. Checked on EVERY invocation, so a clean step followed by a
      // neutered duplicate is caught too.
      expect(step).not.toContain('continue-on-error')
      // A step that never RUNS is neutered just as effectively. Scoped to this
      // step's own keys, so the deliberate `if: always()` elsewhere is untouched.
      expect(step).not.toMatch(/^ {8}if:/m)
    }

    // Both step-level neuters leave the JOB-level one open, and
    // `continue-on-error: true` on the job makes every step in it non-blocking.
    // It sits at 4-space indent and in the discarded preamble, so neither the
    // split nor the per-step assertions can see it.
    expect(ci).not.toMatch(/^ {4}continue-on-error:/m)
  })
})
