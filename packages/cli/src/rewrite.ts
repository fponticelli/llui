import path from 'node:path'
import { aliasKeyOf, targetDir, type Config } from './config.js'

/** `@/lib/utils` -> the leaf `utils`. */
function leafOf(specifier: string): string {
  return specifier.slice(specifier.lastIndexOf('/') + 1)
}

/**
 * Rewrite the registry's `@/…` imports for one written file.
 *
 * The registry ships `@/lib/utils` because that is the shadcn convention and
 * reads the same in every item. What it must become depends on the project:
 *  - `aliases` configured -> `<alias>/utils`, the shadcn behaviour.
 *  - no aliases -> a RELATIVE specifier computed from where this file actually
 *    landed. An alias the project's tsconfig does not declare produces a file
 *    that type-checks nowhere, which is a worse failure than a longer path, so
 *    relative is the default rather than the fallback of last resort.
 *
 * Extensions: LLui packages are ESM with explicit `.js` specifiers, but a
 * consumer's bundler resolves extensionless TS imports fine and `@/lib/utils`
 * is what a shadcn user expects to see. Relative rewrites therefore keep the
 * project's own convention by emitting no extension either.
 */
export function rewriteImports(source: string, fileTargetDir: string, config: Config): string {
  return source.replace(/(['"])(@\/[^'"]+)\1/g, (match, quote: string, specifier: string) => {
    const key = aliasKeyOf(specifier)
    if (key === null) return match
    const leaf = leafOf(specifier)

    if (config.aliases) {
      return `${quote}${config.aliases[key]}/${leaf}${quote}`
    }

    const depDir = targetDir(config, key === 'lib' ? 'registry:lib' : 'registry:ui')
    let rel = path.relative(fileTargetDir, path.join(depDir, leaf)).split(path.sep).join('/')
    if (!rel.startsWith('.')) rel = `./${rel}`
    return `${quote}${rel}${quote}`
  })
}
