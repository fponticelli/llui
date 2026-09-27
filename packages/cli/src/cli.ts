#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { add } from './add.js'
import {
  CONFIG_FILE,
  DEFAULT_CONFIG,
  ConfigSchema,
  readConfig,
  writeConfig,
  type Config,
} from './config.js'
import { loadRegistry } from './registry.js'
import { formatProductList } from './product-list.js'
import { baselineWarning, findBaselineImports } from './stylesheet-check.js'
import { formatMismatches, formatUnverified } from './versions.js'

const USAGE = `llui — add registry components to an LLui app

Usage:
  llui init [--registry <url|path>] [--ui <dir>] [--lib <dir>] [--alias <prefix>]
  llui add <item...> [--overwrite] [--force] [--dry-run] [--registry <url|path>] [--cwd <dir>]
  llui list [--registry <url|path>]

Options:
  --registry   Registry URL or local path (default: ${DEFAULT_CONFIG.registry})
  --ui         Directory for registry:ui files (default: ${DEFAULT_CONFIG.paths.ui})
  --lib        Directory for registry:lib files (default: ${DEFAULT_CONFIG.paths.lib})
  --alias      Import prefix to emit instead of relative paths (e.g. @/components)
  --overwrite  Replace files that already exist (default: skip them)
  --force      Copy even if an installed @llui/* package is older than required
  --dry-run    Report what would be written, write nothing
  --cwd        Project root (default: the current directory)

Version check (llui add):
  Every registry item records the minimum version of each @llui/* package it
  needs (including through registryDependencies). Before writing anything, add
  compares it with the project's version: the installed node_modules package,
  else the lowest version its package.json range allows. An older version
  stops the command with the upgrade to run; --force copies anyway and prints
  the mismatch as a warning. A package that is not installed is listed in the
  Install line with its minimum (@llui/components@^<minimum>).
`

interface Argv {
  command: string | undefined
  positionals: string[]
  flags: Record<string, string | boolean>
}

function parseArgv(argv: readonly string[]): Argv {
  const [command, ...rest] = argv
  const positionals: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }
    const key = arg.slice(2)
    const next = rest[i + 1]
    // Boolean flags take no value; anything else consumes the next token unless
    // that token is itself a flag, so `--dry-run --overwrite` cannot swallow one.
    if (next === undefined || next.startsWith('--')) flags[key] = true
    else {
      flags[key] = next
      i++
    }
  }
  return { command, positionals, flags }
}

function str(flags: Argv['flags'], key: string): string | undefined {
  const v = flags[key]
  return typeof v === 'string' ? v : undefined
}

async function resolveConfig(cwd: string, flags: Argv['flags']): Promise<Config> {
  const onDisk = await readConfig(cwd)
  const base = onDisk ?? DEFAULT_CONFIG
  const registry = str(flags, 'registry')
  return registry === undefined ? base : { ...base, registry }
}

async function cmdInit(cwd: string, flags: Argv['flags']): Promise<void> {
  const alias = str(flags, 'alias')
  const config = ConfigSchema.parse({
    $schema: 'https://llui.dev/schema/components.json',
    registry: str(flags, 'registry') ?? DEFAULT_CONFIG.registry,
    paths: {
      ui: str(flags, 'ui') ?? DEFAULT_CONFIG.paths.ui,
      lib: str(flags, 'lib') ?? DEFAULT_CONFIG.paths.lib,
    },
    ...(alias === undefined ? {} : { aliases: { ui: `${alias}/ui`, lib: `${alias}/lib` } }),
  })
  const file = await writeConfig(cwd, config)
  console.log(`Wrote ${path.relative(cwd, file) || CONFIG_FILE}`)
  // TOKENS, not `theme.css`. The baseline stylesheet's component rules are
  // unlayered and beat `@layer utilities`, so pairing it with registry
  // components makes every recipe lose silently.
  console.log('\nAdd the tokens to your app CSS:')
  console.log("  @import 'tailwindcss';")
  console.log("  @import '@llui/components/styles/tokens.css';")
  console.log("  @import '@llui/components/styles/tokens-dark.css';")
  console.log('\n(Not styles/theme.css — that is the opt-in baseline stylesheet,')
  console.log(' whose unlayered rules would override every component you add.)')
  console.log('\nThen: llui add button card')

  const warning = baselineWarning(await findBaselineImports(cwd))
  if (warning !== null) console.warn(warning)
}

async function cmdList(cwd: string, flags: Argv['flags']): Promise<void> {
  const config = await resolveConfig(cwd, flags)
  const registry = await loadRegistry(config.registry)
  console.log(formatProductList(registry))
}

async function cmdAdd(cwd: string, argv: Argv): Promise<void> {
  if (argv.positionals.length === 0) {
    throw new Error('`llui add` needs at least one item name. Try `llui list`.')
  }
  const config = await resolveConfig(cwd, argv.flags)
  const result = await add({
    cwd,
    config,
    names: argv.positionals,
    overwrite: argv.flags.overwrite === true,
    force: argv.flags.force === true,
    dryRun: argv.flags['dry-run'] === true,
  })

  const verb = argv.flags['dry-run'] === true ? 'Would write' : 'Wrote'
  for (const file of result.written) console.log(`  ${verb} ${file}`)
  for (const file of result.skipped) console.log(`  Skipped ${file} (exists — pass --overwrite)`)

  if (result.written.length === 0 && result.skipped.length > 0) {
    console.log('\nNothing written: every file already exists.')
  }

  // Only reachable under --force: without it `add` throws before writing.
  if (result.upgradeCommand !== null) {
    console.warn(
      `\nWarning: ${formatMismatches(result.mismatches, result.upgradeCommand)}\n` +
        'Copied anyway (--force); expect missing exports, tokens or attributes until you upgrade.',
    )
  }
  for (const line of formatUnverified(result.versions)) console.warn(`\nWarning: ${line}`)

  // The one configuration that silently breaks what we just copied. Checked
  // AFTER writing, so the warning is the last thing on screen.
  const warning = baselineWarning(await findBaselineImports(cwd))
  if (warning !== null) console.warn(warning)
  if (result.install.dependencies.length > 0) {
    console.log(`\nInstall: ${result.install.dependencies.join(' ')}`)
  }
  if (result.install.devDependencies.length > 0) {
    console.log(`Install (dev): ${result.install.devDependencies.join(' ')}`)
  }
}

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgv(argv)
  const cwd = path.resolve(str(parsed.flags, 'cwd') ?? process.cwd())
  // `llui add --help` must describe `add`, not fail for want of an item name.
  if (parsed.flags.help === true || parsed.positionals.includes('-h')) {
    console.log(USAGE)
    return 0
  }
  try {
    switch (parsed.command) {
      case 'init':
        await cmdInit(cwd, parsed.flags)
        return 0
      case 'add':
        await cmdAdd(cwd, parsed)
        return 0
      case 'list':
        await cmdList(cwd, parsed.flags)
        return 0
      case undefined:
      case '--help':
      case '-h':
      case 'help':
        console.log(USAGE)
        return 0
      default:
        console.error(`Unknown command "${parsed.command}".\n\n${USAGE}`)
        return 1
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    return 1
  }
}

// `main()` is exported for tests; the bin path runs it and sets the exit code.
// Guarded so importing this module (which `sideEffects` marks as effectful, for
// the bundler's benefit) does not execute the CLI.
//
// Compared as resolved PATHS, not by basename: any other `cli.js` a user happens
// to run would satisfy a suffix match and start this CLI with someone else's argv.
if (process.argv[1] !== undefined) {
  const entry = path.resolve(process.argv[1])
  if (fileURLToPath(import.meta.url) === entry) {
    process.exitCode = await main(process.argv.slice(2))
  }
}
