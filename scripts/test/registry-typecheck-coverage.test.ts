import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

/**
 * Every TypeScript file under `registry/` is type-checked by exactly one of its
 * two configs (#272), and the gate that runs them is actually invoked.
 *
 * `registry/tsconfig.json` checks the shipped source (`llui/`) in the shape a
 * consumer compiles it. Until #272 it was the ONLY registry config, so
 * `registry/test/` was compiled by nothing: vitest transpiles it with esbuild,
 * which strips types without checking them. Stale-shape `Accordion` /
 * `Collapsible` calls there crashed at runtime instead of failing a build, and
 * the first run of `registry/tsconfig.test.json` reported 11 further errors.
 * That is the #252 class (a directory no gate reaches) one directory over, so
 * this test is shaped like `scripts-typecheck-coverage.test.ts`: EXACT set
 * equality in both directions against `git ls-files --cached --others
 * --exclude-standard` (never a filesystem walk: `.claude/worktrees/` holds
 * every sibling lane's checkout), and never a `length > N` floor, which can
 * only detect under-collection.
 *
 * ROOT files, not the transitive program, are what is compared. A helper that
 * is checked only because some test happens to import it is covered by
 * accident; narrowing the include to `*.test.ts` would then leave it one
 * deleted import away from the blind spot, and this test says so immediately.
 */

const ROOT = path.resolve(__dirname, '../..')
const REGISTRY = path.join(ROOT, 'registry')
const SOURCE_CONFIG = path.join(REGISTRY, 'tsconfig.json')
const TEST_CONFIG = path.join(REGISTRY, 'tsconfig.test.json')

const isTypeScript = (file: string): boolean => /\.(?:c|m)?tsx?$/.test(file)

/** Every TS file under `registry/`, repo-relative, from git rather than a walk. */
function gitRegistryFiles(): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'registry'],
    { cwd: ROOT, encoding: 'utf8' },
  )
  return out.split('\n').filter(isTypeScript).sort()
}

/** The root file set a config expands to, as TypeScript itself resolves it. */
function configRootFiles(config: string): { fileNames: string[]; options: ts.CompilerOptions } {
  const read = ts.readConfigFile(config, (p) => ts.sys.readFile(p))
  expect(read.error, `${config} must parse: ${JSON.stringify(read.error)}`).toBeUndefined()
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    path.dirname(config),
    undefined,
    config,
  )
  expect(parsed.errors.filter((e) => e.category === ts.DiagnosticCategory.Error)).toEqual([])
  return {
    fileNames: parsed.fileNames.map((f) => path.relative(ROOT, f)).sort(),
    options: parsed.options,
  }
}

function packageScripts(manifest: string): Record<string, string> {
  const pkg: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
  if (typeof pkg !== 'object' || pkg === null || !('scripts' in pkg)) {
    throw new Error(`${manifest} has no "scripts"`)
  }
  const scripts = (pkg as { scripts: unknown }).scripts
  if (typeof scripts !== 'object' || scripts === null) {
    throw new Error(`${manifest} "scripts" is not an object`)
  }
  return scripts as Record<string, string>
}

const inSource = (f: string): boolean => f.startsWith(`registry${path.sep}llui${path.sep}`)

describe('registry/ type-check coverage (#272)', () => {
  it('tsconfig.test.json covers every TS file outside llui/ — registry/test and the vitest config — and nothing else', () => {
    const fromGit = gitRegistryFiles().filter((f) => !inSource(f))
    const fromConfig = configRootFiles(TEST_CONFIG).fileNames

    // Vacuity guards: an enumeration that silently returned nothing would make
    // the equality below trivially true. Both halves are named explicitly.
    expect(
      fromGit.filter((f) => f.startsWith(`registry${path.sep}test${path.sep}`)).length,
    ).toBeGreaterThan(20)
    expect(fromGit).toContain(path.join('registry', 'vitest.config.ts'))

    // Exact, both directions — never a floor.
    expect(fromConfig).toEqual(fromGit)
  })

  it('tsconfig.json covers every TS file under llui/ and nothing else', () => {
    const fromGit = gitRegistryFiles().filter(inSource)
    expect(fromGit.length).toBeGreaterThan(50)
    expect(configRootFiles(SOURCE_CONFIG).fileNames).toEqual(fromGit)
  })

  it('resolves the strict options the gate depends on', () => {
    // An error is easy to "fix" by loosening the config instead of the code.
    // The test config EXTENDS the source one, so this also pins that the
    // extension did not override anything away.
    for (const config of [SOURCE_CONFIG, TEST_CONFIG]) {
      const { options } = configRootFiles(config)
      expect(options.strict, config).toBe(true)
      expect(options.noUncheckedIndexedAccess, config).toBe(true)
      expect(options.noEmit, config).toBe(true)
    }
    expect(configRootFiles(TEST_CONFIG).options.types).toEqual(['node'])
  })

  /**
   * The shipped source runs in a consumer's BROWSER, so it must not compile
   * against Node's globals. `@types/node` sits in the root `node_modules`, and
   * whether an unset `types` pulls it in is a property of the COMPILER, not of
   * this repo: TypeScript 5 auto-included every visible `@types/*`, 6.0
   * changed the default to `[]`. The source config therefore states `[]`
   * itself rather than inheriting whichever default the installed compiler
   * has, and the test config — which does need Node — opts back in above.
   */
  it('checks the shipped source without Node globals', () => {
    expect(configRootFiles(SOURCE_CONFIG).options.types).toEqual([])
  })

  /**
   * The option above is only the mechanism; this is the property. A probe
   * reaching for `process` and `Buffer` is compiled with the source config's
   * RESOLVED options, as if it were a file under `llui/`, and must fail with
   * the "install type definitions for node" diagnostics. The known-good arm
   * compiles the SAME probe with `types: ['node']` and requires it clean, so a
   * probe that failed for any other reason (a bad path, a syntax error, a
   * missing lib) cannot pass as proof.
   */
  it('rejects `process` and `Buffer` in registry source, and only because Node types are absent', () => {
    const { options } = configRootFiles(SOURCE_CONFIG)
    const probePath = path.join(REGISTRY, 'llui', 'lib', '__node-globals-probe__.ts')
    const probe = [
      'export const mode: string | undefined = process.env.NODE_ENV',
      "export const bytes: number = Buffer.byteLength('x')",
      '',
    ].join('\n')

    const diagnose = (types: string[]): ts.Diagnostic[] => {
      const compilerOptions: ts.CompilerOptions = { ...options, types }
      const host = ts.createCompilerHost(compilerOptions)
      const getSourceFile = host.getSourceFile.bind(host)
      host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) =>
        path.resolve(fileName) === probePath
          ? ts.createSourceFile(fileName, probe, languageVersion, true)
          : getSourceFile(fileName, languageVersion, onError, shouldCreate)
      const fileExists = host.fileExists.bind(host)
      host.fileExists = (fileName) => path.resolve(fileName) === probePath || fileExists(fileName)
      const program = ts.createProgram({ rootNames: [probePath], options: compilerOptions, host })
      const source = program.getSourceFile(probePath)
      expect(source, 'the probe must be part of its own program').toBeDefined()
      return [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)]
    }

    const withoutNode = diagnose(options.types ?? [])
    const messages = withoutNode.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
    expect(messages).toEqual([
      expect.stringMatching(/Cannot find name 'process'.*type definitions for node/),
      expect.stringMatching(/Cannot find name 'Buffer'.*type definitions for node/),
    ])

    expect(diagnose(['node'])).toEqual([])
  })

  /**
   * The tests above pin the CONFIGS; nothing in them runs one. A config is
   * green precisely when nothing invokes it, so the invocation chain is pinned
   * too: the package `check` script (what `turbo check` runs), the root
   * `check:registry` script (what `verify` and the CI step run), and the CI
   * step itself. The scripts are compared EXACTLY, so a `|| true`, a dropped
   * `-p tsconfig.test.json` or a swap to `;` all fail here.
   */
  it('is actually INVOKED — by the package check, the root script, verify and CI', () => {
    const registryScripts = packageScripts(path.join(REGISTRY, 'package.json'))
    expect(registryScripts['check']).toBe(
      'tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.test.json',
    )

    const rootScripts = packageScripts(path.join(ROOT, 'package.json'))
    expect(rootScripts['check:registry']).toBe('pnpm --filter @llui/registry check')
    expect(rootScripts['verify']).toContain('pnpm check:registry')

    // Step-split first, then match inside a step — the reasoning (why neither a
    // literal-anchored window nor the job-level preamble can be trusted) is in
    // `scripts-typecheck-coverage.test.ts`, which this mirrors.
    const ci = readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const steps = ci.split('\n      - ').slice(1)
    const invoking = steps.filter((step) => /^ {8}run: pnpm check:registry$/m.test(step))
    expect(
      invoking.length,
      'ci.yml must contain a step running `pnpm check:registry`',
    ).toBeGreaterThan(0)
    for (const step of invoking) {
      expect(step).not.toContain('continue-on-error')
      expect(step).not.toMatch(/^ {8}if:/m)
    }
    expect(ci).not.toMatch(/^ {4}continue-on-error:/m)
  })
})
