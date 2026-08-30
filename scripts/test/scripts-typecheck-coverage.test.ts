import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

/**
 * `scripts/` is type-checked by `tsconfig.scripts.json` (#252), and this pins
 * that the coverage is TOTAL rather than merely non-empty.
 *
 * #252 did not happen because someone decided not to check `scripts/`. It
 * happened by ACCUMULATION: `tsconfig.benchmarks.json` names an explicit
 * `files` list, `scripts/test/` grew from the nine benchmark tests that list
 * knows about to twenty-six files, and the seventeen that arrived later landed
 * outside every gate — including the guards this repo leans on hardest, the
 * ones that catch dead CSS, wrong `data-*` values and failing contrast. Nothing
 * reported that, because a config with a `files` list is green precisely when
 * it is ignoring you.
 *
 * So the assertion here is EXACT SET EQUALITY, in both directions, and that
 * choice is load-bearing: a `length > N` floor can only detect UNDER-collection
 * and would have waved the twenty-six-file program through at any point in that
 * drift. The same floor is also what let a sibling guard collect 210 configs,
 * 180 of them foreign, and report success.
 *
 * Enumeration is `git ls-files --cached --others --exclude-standard` — tracked
 * plus untracked-but-not-ignored, so a brand-new file is covered the moment it
 * is written and anything gitignored is structurally unreachable — and NEVER a
 * filesystem walk. `.claude/worktrees/` is gitignored and holds a full checkout
 * of every concurrent agent lane; a walk from the repo root sees every other
 * branch's files as if they were yours. That is scoped away twice over here
 * (the pathspec is `scripts`, and the tsconfig's globs are rooted at `scripts/`
 * too), but the enumeration method is the part that has to be right by
 * construction rather than by the current scope happening to be narrow.
 */

const ROOT = path.resolve(__dirname, '../..')
const CONFIG = path.join(ROOT, 'tsconfig.scripts.json')

/** Every `.ts`/`.mjs` under `scripts/`, repo-relative, from git rather than a walk. */
function gitScriptFiles(): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'scripts'],
    { cwd: ROOT, encoding: 'utf8' },
  )
  return out
    .split('\n')
    .filter((f) => f.endsWith('.ts') || f.endsWith('.mjs'))
    .sort()
}

/** The root file set `tsconfig.scripts.json` actually expands to. */
function configRootFiles(): { fileNames: string[]; options: ts.CompilerOptions } {
  const read = ts.readConfigFile(CONFIG, ts.sys.readFile)
  expect(
    read.error,
    `tsconfig.scripts.json must parse: ${JSON.stringify(read.error)}`,
  ).toBeUndefined()
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT, undefined, CONFIG)
  expect(parsed.errors.filter((e) => e.category === ts.DiagnosticCategory.Error)).toEqual([])
  return {
    fileNames: parsed.fileNames.map((f) => path.relative(ROOT, f)).sort(),
    options: parsed.options,
  }
}

/** The repo-root manifest, read for the scripts that must invoke the gate. */
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

describe('scripts/ type-check coverage (#252)', () => {
  it('covers EVERY .ts and .mjs under scripts/, with nothing extra', () => {
    const fromGit = gitScriptFiles()
    const allRoots = configRootFiles().fileNames
    const fromConfig = allRoots.filter((f) => f.startsWith(`scripts${path.sep}`))

    // Vacuity guard first. An enumeration that silently returned nothing would
    // make the equality below trivially true, which is the failure this whole
    // file exists to prevent one level up.
    expect(fromGit.length).toBeGreaterThan(50)

    // The `scripts/` filter above must be a NO-OP. Without this the assertion
    // below would only say "nothing extra UNDER scripts/", and a root added
    // from anywhere else would pass unmentioned — a weaker claim than the test
    // name makes.
    expect(allRoots).toEqual(fromConfig)

    // Exact, both directions — never a floor.
    expect(fromConfig).toEqual(fromGit)
  })

  /**
   * The two tests above pin the CONFIG. Nothing in them runs it — delete the
   * `check:scripts` script, or the CI step that calls it, and they stay green
   * while the gate stops existing. That is the same shape as #252 itself (a
   * config is green precisely when nothing invokes it on the files you care
   * about), so the INVOCATION is pinned too. `vitest-config-baseline.test.ts`
   * is the precedent: it gates the config SET rather than one config.
   */
  it('is actually INVOKED — by a root script and by CI', () => {
    const scripts = rootPackageScripts()

    // The script must exist and must point at THIS config; a rename that leaves
    // the file behind is exactly the drift being prevented.
    expect(scripts['check:scripts']).toBeDefined()
    expect(scripts['check:scripts']).toContain('tsconfig.scripts.json')
    expect(scripts['check:scripts']).toMatch(/tsc\b/)

    // `pnpm verify` is the documented local pre-merge run. A gate CI runs and
    // verify does not is a gate contributors meet only after pushing.
    expect(scripts['verify']).toContain('check:scripts')

    // And CI. Asserted against the workflow SOURCE rather than a YAML parse:
    // the repo has no YAML dependency, and the property here is simply "the
    // step is present and un-neutered".
    //
    // ESTABLISH THE STRUCTURAL BOUNDARY FIRST, THEN MATCH INSIDE IT. Two
    // earlier cuts of this assertion searched for a run-line LITERAL and derived
    // the step window from where that literal landed, and both were vacuous:
    //
    //   1. slicing from `indexOf('- name: Scripts type check')` meant RENAMING
    //      the step made `indexOf` return -1, and `slice(-1)` — a legal call —
    //      returned the file's last CHARACTER, so `.not.toContain` passed
    //      against a one-character string;
    //   2. anchoring on the bare literal `'run: pnpm check:scripts'` meant a
    //      COMMENT containing that text matched first. Comments sit at the same
    //      6-space indent as steps, so the walk back to `'\n      - '` opened the
    //      window on the PREVIOUS step and a live `continue-on-error` on the real
    //      step fell outside it — while the vacuity guard passed, because the
    //      comment supplied the very run line the guard was looking for.
    //
    // (2) is the nastier one and is this repo's two-occurrences trap wearing a
    // different hat: the enabling edit is pure PROSE. A comment alone, with no
    // neuter, installs the blindness silently and green, and it only cashes in
    // whenever someone later adds the flag. So the anchor may not be a literal
    // that can also occur in prose.
    //
    // Splitting on the step boundary first removes the class rather than the
    // instance: a comment never begins a list item, so it can never open a
    // window, and the run line is then matched at its own line and its own key
    // indent (`^ {8}run:`), which a comment (`      #`) and a block-scalar body
    // (indented past its key, so >= 10) both fail.
    const ci = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const STEP_BOUNDARY = '\n      - '
    // `.slice(1)` drops the preamble before the first step: a real step cannot
    // live there, and dropping it means nothing at job level can be mistaken for
    // one. That is not hypothetical hygiene — "only a step key sits at 8 spaces"
    // is FALSE in general: a block scalar out-indents its own key, and a JOB-level
    // key sits at 4, so `if: |` at job level can put a body line at exactly 8.
    // (A step-level `run: |` cannot: the forged item makes duplicate map keys and
    // a real YAML parser rejects it. Only the job-level form parses.) Here such a
    // line falls in the discarded preamble.
    //
    // The residue is a job-level key written AFTER `steps:` (legal YAML, absent
    // from this file), whose body lands in the LAST step's chunk. That is SAFE for
    // a stronger reason than "it fails loud" — measured, it does not fail at all:
    // the phantom chunk carries no flag, so it is simply green. The real property
    // is MONOTONICITY. `invoking` is a filter feeding a universal assertion, so an
    // extra chunk can only ADD a failure, never remove one — verified by applying
    // the phantom chunk and a neutered real step TOGETHER, which is RED: the
    // phantom cannot mask the genuine one.
    const steps = ci.split(STEP_BOUNDARY).slice(1)
    const invoking = steps.filter((step) => /^ {8}run: pnpm check:scripts$/m.test(step))

    // Vacuity guard on the SPLIT, not on the window: if the workflow is ever
    // reindented, this finds nothing and says so, rather than silently judging
    // an empty set.
    expect(
      invoking.length,
      'ci.yml must contain a step running `pnpm check:scripts`',
    ).toBeGreaterThan(0)

    // EVERY invocation must be un-neutered, not just the first. `continue-on-error`
    // on the `Test durations` step is deliberate and documented; on this one it
    // would silently turn a build-failing gate back into a log line. Checking all
    // of them also means a clean step followed by a neutered duplicate is caught,
    // which a first-match check would wave through.
    for (const step of invoking) {
      expect(step).not.toContain('continue-on-error')
      // A step that never RUNS is neutered just as effectively as one that cannot
      // fail. Scoped to this step's own keys, so the deliberate `if: always()` on
      // the `Test durations` step is untouched.
      expect(step).not.toMatch(/^ {8}if:/m)
    }

    // The two step-level neuters above both leave the JOB-level one open, and a
    // `continue-on-error: true` on the job makes every step in it non-blocking.
    // It sits at 4-space indent (job keys) and in the preamble chunk, so neither
    // the split nor the per-step assertions can see it; asserted file-wide rather
    // than reconstructing job boundaries, because there are exactly two jobs and
    // neither legitimately carries one. Measured: zero occurrences at this indent.
    expect(ci).not.toMatch(/^ {4}continue-on-error:/m)
  })

  it('resolves the strict options the gate depends on', () => {
    // A future error is easy to "fix" by loosening the config instead of the
    // code, and every one of these switches off a whole class of finding
    // silently. `checkJs` is the one that matters most: without it the `.mjs`
    // helpers are still INFERRED, so the boundary is nominally checked, but the
    // inferred shape is mostly implicit `any` and the drift these tests exist to
    // catch walks straight through it.
    const { options } = configRootFiles()
    expect(options.strict).toBe(true)
    expect(options.checkJs).toBe(true)
    expect(options.allowJs).toBe(true)
    expect(options.noUncheckedIndexedAccess).toBe(true)
    expect(options.noEmit).toBe(true)
  })
})
