/**
 * Build wiring shared by the gallery's THREE independent Vite builds — the
 * shell and the two path documents. Only paths, the output layout and the
 * resolution rules live here; no renderer, stylesheet or plugin list is
 * shared, because each document's cascade must be decided by its own config
 * alone (the whole point of #267's isolation).
 *
 *   <out>/                the shell           vite.config.ts
 *   <out>/baseline/       Baseline theme      vite.baseline.config.ts (no Tailwind)
 *   <out>/registry/       Registry skins      vite.registry.config.ts (Tailwind v4)
 *
 * Every build uses a RELATIVE base, so the output works under any prefix
 * (`/`, llui.dev's `/apps/component-gallery/`, a preview port) without a
 * rebuild, and the shell frames its documents at `./baseline/` / `./registry/`.
 */
import { existsSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import type { Alias, Plugin } from 'vite'
import { sourceAliasesFromExports } from '../../scripts/lib/vite-source-aliases.mjs'

export const GALLERY_ROOT = import.meta.dirname
export const REPO_ROOT = resolve(GALLERY_ROOT, '../..')

export const SHELL_ROOT = resolve(GALLERY_ROOT, 'src/shell')

/**
 * One dependency-optimizer cache PER BUILD. Vite defaults `cacheDir` to the
 * package's `node_modules/.vite`, so the three dev servers `pnpm dev` runs
 * shared ONE `deps/_metadata.json`: each re-optimized for its own dependency
 * set (the registry document's `clsx`/`tailwind-merge`, the baseline's
 * `@floating-ui/dom`) and overwrote the other's browser hash, so a document's
 * in-flight dependency requests came back `504 Outdated Optimize Dep` and it
 * settled `error`. It surfaced as the dev-server test "timing out under load"
 * (#268): load only widened the race.
 */
export const CACHE_DIRS = {
  shell: resolve(GALLERY_ROOT, 'node_modules/.vite/shell'),
  baseline: resolve(GALLERY_ROOT, 'node_modules/.vite/baseline'),
  registry: resolve(GALLERY_ROOT, 'node_modules/.vite/registry'),
} as const

/** Output root; the site build points this at a staging directory. */
export const OUT_DIR = resolve(GALLERY_ROOT, process.env['LLUI_GALLERY_OUT'] ?? 'dist')

export const PATH_DOCUMENTS = {
  baseline: {
    root: resolve(GALLERY_ROOT, 'src/baseline'),
    outDir: resolve(OUT_DIR, 'baseline'),
    config: resolve(GALLERY_ROOT, 'vite.baseline.config.ts'),
    base: '/baseline/',
  },
  registry: {
    root: resolve(GALLERY_ROOT, 'src/registry'),
    outDir: resolve(OUT_DIR, 'registry'),
    config: resolve(GALLERY_ROOT, 'vite.registry.config.ts'),
    base: '/registry/',
  },
} as const

/**
 * `@llui/components` resolves to its SOURCE in both path documents. The
 * scenario renderers reach the component machines partly through the
 * package's public specifiers and partly through relative source imports;
 * without this, one document would bundle two copies of the same machine
 * module (`dist/` and `src/`). It is the exact resolution the renderers'
 * own live-render browser suites run under.
 */
export function componentSourceAliases(): Alias[] {
  return sourceAliasesFromExports({
    packageName: '@llui/components',
    packageJsonPath: resolve(REPO_ROOT, 'packages/components/package.json'),
    srcDir: resolve(REPO_ROOT, 'packages/components/src'),
  })
}

const REGISTRY_SOURCE = resolve(REPO_ROOT, 'registry/llui')
const COPIED_SOURCE = {
  ui: resolve(REPO_ROOT, 'examples/registry-demo/src/components/ui'),
  lib: resolve(REPO_ROOT, 'examples/registry-demo/src/lib'),
} as const

/**
 * The Registry skins document renders what `llui add` actually COPIED — the
 * checked-in consumer tree in `examples/registry-demo` — never the registry's
 * own source. The shared scenario renderers import `registry/llui/ui/*`; this
 * plugin re-points every such module at its copy (byte-identical but for
 * import rewriting, which `scripts/test/registry-demo-sync.test.ts` enforces),
 * fails the build if a copy is missing, and fails it again if any module
 * under `registry/llui/` still reaches the bundle.
 */
export function renderCopiedRegistrySource(): Plugin {
  return {
    name: 'llui-gallery:copied-registry-source',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (resolved === null) return null
      const file = resolved.id.split('?')[0]!
      if (!file.startsWith(REGISTRY_SOURCE + sep)) return null
      const [area, ...rest] = relative(REGISTRY_SOURCE, file).split(sep)
      const copyRoot = area === 'ui' ? COPIED_SOURCE.ui : area === 'lib' ? COPIED_SOURCE.lib : null
      const copy = copyRoot === null ? null : resolve(copyRoot, ...rest)
      if (copy === null || !existsSync(copy)) {
        this.error(
          `${relative(REPO_ROOT, file)} has no copy in examples/registry-demo — run \`llui add\` for it (see examples/registry-demo/README.md)`,
        )
      }
      return copy
    },
    generateBundle() {
      const leaked = [...this.getModuleIds()].filter((id) => id.startsWith(REGISTRY_SOURCE + sep))
      if (leaked.length > 0) {
        this.error(
          `registry source reached the Registry skins document instead of its copy: ${leaked
            .map((id) => relative(REPO_ROOT, id))
            .join(', ')}`,
        )
      }
    },
  }
}
