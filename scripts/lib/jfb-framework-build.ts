import { resolve } from 'node:path'

const ELM_TOOLING_PREFIX = 'elm-tooling install && '
const ELM_COMPILER_PREFIX = 'elm make '

export const CANONICAL_JFB_COMPETITORS = [
  'vanillajs',
  'solid',
  'svelte',
  'react-hooks',
  'elm',
] as const

export interface JfbFrameworkBuild {
  readonly framework: string
  readonly directory: string
  readonly installArgs: readonly string[]
  readonly buildArgs: readonly string[]
}

export function jfbFrameworkBuildPlan(
  jfbRepo: string,
  frameworks: readonly string[],
): JfbFrameworkBuild[] {
  return frameworks
    .filter((framework) => framework !== 'keyed/llui')
    .map((framework) => {
      const match = /^keyed\/([a-z0-9][a-z0-9._-]*)$/.exec(framework)
      if (match === null) throw new Error(`invalid keyed JFB framework: ${framework}`)
      return {
        framework,
        directory: resolve(jfbRepo, 'frameworks/keyed', match[1]!),
        installArgs: ['ci', '--no-audit', '--no-fund'],
        buildArgs: ['run', 'build-prod'],
      }
    })
}

export function localScriptSources(indexHtml: string): string[] {
  const sources = new Set<string>()
  const scripts = /<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/giu
  for (const match of indexHtml.matchAll(scripts)) {
    const source = match[2]!.split(/[?#]/u, 1)[0]!
    if (source !== '' && !source.startsWith('/') && !/^[a-z][a-z\d+.-]*:/iu.test(source)) {
      sources.add(source)
    }
  }
  return [...sources]
}

/**
 * Repair the pinned JFB Elm manifest's stale bootstrap command.
 *
 * The manifest locks the Elm compiler as a dev dependency but invokes the
 * undeclared `elm-tooling` package before that compiler. The checkout revision
 * is independently pinned; these shape checks additionally make the workaround
 * fail closed if upstream changes the manifest instead of silently rewriting a
 * different command.
 */
export function patchJfbElmBuildManifest(source: string): string {
  const manifest: unknown = JSON.parse(source)
  if (typeof manifest !== 'object' || manifest === null) {
    throw new Error('unexpected pinned JFB Elm manifest')
  }

  const record = manifest as Record<string, unknown>
  const scripts = record.scripts
  const devDependencies = record.devDependencies
  if (
    typeof scripts !== 'object' ||
    scripts === null ||
    typeof devDependencies !== 'object' ||
    devDependencies === null ||
    typeof (devDependencies as Record<string, unknown>).elm !== 'string'
  ) {
    throw new Error('unexpected pinned JFB Elm manifest')
  }

  const scriptRecord = scripts as Record<string, unknown>
  const buildProd = scriptRecord['build-prod']
  if (typeof buildProd !== 'string') {
    throw new Error('unexpected pinned JFB Elm build-prod script')
  }
  let changed = false
  if (buildProd.startsWith(ELM_TOOLING_PREFIX + ELM_COMPILER_PREFIX)) {
    scriptRecord['build-prod'] = buildProd.slice(ELM_TOOLING_PREFIX.length)
    changed = true
  } else if (!buildProd.startsWith(ELM_COMPILER_PREFIX)) {
    throw new Error('unexpected pinned JFB Elm build-prod script')
  }

  const elmVersion = (devDependencies as Record<string, unknown>).elm as string
  const allowedPackage = `elm@${elmVersion}`
  const allowScripts = record.allowScripts
  if (allowScripts === undefined) {
    record.allowScripts = { [allowedPackage]: true }
    changed = true
  } else if (
    typeof allowScripts !== 'object' ||
    allowScripts === null ||
    (allowScripts as Record<string, unknown>)[allowedPackage] !== true
  ) {
    throw new Error('unexpected pinned JFB Elm allowScripts policy')
  }

  return changed ? `${JSON.stringify(manifest, null, 2)}\n` : source
}
