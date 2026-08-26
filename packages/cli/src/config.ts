import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'

export const CONFIG_FILE = 'components.json'

export const ConfigSchema = z.object({
  $schema: z.string().optional(),
  /** Registry URL or local path. */
  registry: z.string().default('https://llui.dev/r'),
  /** Where each registry file TYPE lands on disk, relative to the project root. */
  paths: z
    .object({
      ui: z.string().default('src/components/ui'),
      lib: z.string().default('src/lib'),
    })
    .default({ ui: 'src/components/ui', lib: 'src/lib' }),
  /**
   * Import specifier prefixes to emit in place of the registry's `@/` alias.
   * OPTIONAL and unset by default: a project without a matching tsconfig
   * `paths` entry would get imports that do not resolve, so the CLI emits
   * RELATIVE imports unless an alias is configured explicitly. Silent breakage
   * is the worse default here — a relative import always resolves.
   */
  aliases: z
    .object({
      ui: z.string(),
      lib: z.string(),
    })
    .optional(),
})

export type Config = z.infer<typeof ConfigSchema>

export const DEFAULT_CONFIG: Config = ConfigSchema.parse({})

export async function readConfig(cwd: string): Promise<Config | null> {
  try {
    const raw = await readFile(path.join(cwd, CONFIG_FILE), 'utf8')
    return ConfigSchema.parse(JSON.parse(raw))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function writeConfig(cwd: string, config: Config): Promise<string> {
  const file = path.join(cwd, CONFIG_FILE)
  await writeFile(file, JSON.stringify(config, null, 2) + '\n', 'utf8')
  return file
}

/** Directory on disk for a registry file type (`registry:ui` -> paths.ui). */
export function targetDir(config: Config, type: string): string {
  return type === 'registry:lib' ? config.paths.lib : config.paths.ui
}

/** The alias KEY a registry `@/`-import maps to (`@/lib/utils` -> 'lib'). */
export function aliasKeyOf(specifier: string): 'ui' | 'lib' | null {
  if (specifier.startsWith('@/lib/')) return 'lib'
  if (specifier.startsWith('@/ui/') || specifier.startsWith('@/components/ui/')) return 'ui'
  return null
}
