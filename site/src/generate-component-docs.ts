/**
 * Regenerate every product-contract region listed in `COMPONENT_DOC_TARGETS` (#269).
 *
 * Inputs, all read from the repo — never restated:
 *   - `registry/registry.json#productContract`, parsed through `ProductContractSchema`
 *   - `packages/components/package.json#exports`
 *   - `packages/components/src/styles/*.css` for every exported stylesheet
 *
 * Run by the site's `generate` script, so `pnpm check:generated` (and CI's `--strict` drift
 * job) fails when a committed region no longer matches the contract. The rendering itself lives
 * in `component-docs.ts`, which is pure; this file only does I/O and Markdown formatting.
 */
import { readFileSync, realpathSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { format, resolveConfig } from 'prettier'
import { ProductContractSchema } from '@llui/cli'
import {
  COMPONENT_DOC_TARGETS,
  renderFragment,
  spliceFragments,
  type ComponentDocsInput,
  type DocTarget,
  type FragmentId,
} from './component-docs.js'

const here = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(here, '..', '..')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read every input the renderers need from the working tree. */
export function loadComponentDocsInput(root = REPO_ROOT): ComponentDocsInput {
  const registry: unknown = JSON.parse(
    readFileSync(resolve(root, 'registry/registry.json'), 'utf-8'),
  )
  if (!isRecord(registry)) throw new Error('registry/registry.json is not an object')
  const contract = ProductContractSchema.parse(registry.productContract)

  const manifest: unknown = JSON.parse(
    readFileSync(resolve(root, 'packages/components/package.json'), 'utf-8'),
  )
  if (!isRecord(manifest) || !isRecord(manifest.exports)) {
    throw new Error('packages/components/package.json has no exports map')
  }
  const componentExports = Object.keys(manifest.exports)
  const stylesheets = componentExports
    .map((key) => /^\.\/styles\/([^/]+\.css)$/.exec(key)?.[1])
    .filter((file): file is string => file !== undefined)
    .map((file) => ({
      file,
      source: readFileSync(resolve(root, 'packages/components/src/styles', file), 'utf-8'),
    }))
  return { contract, componentExports, stylesheets }
}

/** Format one fragment exactly as the repo's prettier config would format it in place. */
export async function formatMarkdown(markdown: string, filePath: string): Promise<string> {
  const options = (await resolveConfig(filePath)) ?? {}
  return format(markdown, { ...options, parser: 'markdown', filepath: filePath })
}

/** The full text `target` must have: its current text with every region re-rendered. */
export async function regenerateTarget(
  text: string,
  target: DocTarget,
  input: ComponentDocsInput,
  root = REPO_ROOT,
): Promise<string> {
  const filePath = resolve(root, target.path)
  const fragments = new Map<FragmentId, string>()
  for (const id of target.fragments) {
    fragments.set(id, await formatMarkdown(renderFragment(id, input, target), filePath))
  }
  return spliceFragments(text, fragments, target.fragments, target.path)
}

async function main(): Promise<void> {
  const input = loadComponentDocsInput()
  for (const target of COMPONENT_DOC_TARGETS) {
    const filePath = resolve(REPO_ROOT, target.path)
    const before = readFileSync(filePath, 'utf-8')
    const after = await regenerateTarget(before, target, input)
    if (after !== before) writeFileSync(filePath, after)
  }
  console.log(`Generated product-contract docs in ${COMPONENT_DOC_TARGETS.length} files`)
}

export function invokedAsScript(argvPath: string | undefined, moduleUrl: string): boolean {
  if (argvPath === undefined) return false
  const real = (p: string): string => {
    try {
      return realpathSync(p)
    } catch {
      return p
    }
  }
  return real(resolve(argvPath)) === real(fileURLToPath(moduleUrl))
}

if (invokedAsScript(process.argv[1], import.meta.url)) await main()
