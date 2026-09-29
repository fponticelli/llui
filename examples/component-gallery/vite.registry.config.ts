/**
 * The Registry skins path document — built and served ON ITS OWN.
 *
 * Tailwind v4 over `tokens.css` and the source `llui add` copied into
 * `examples/registry-demo`, and never the baseline `theme.css`: its unlayered
 * `[data-scope][data-part]` rules would beat every utility here.
 * `renderCopiedRegistrySource` makes the shared scenario renderers draw the
 * COPIES, and fails the build if registry source leaks in. Standalone:
 * `pnpm --filter @llui/example-component-gallery dev:registry`.
 */
import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import {
  CACHE_DIRS,
  PATH_DOCUMENTS,
  componentSourceAliases,
  renderCopiedRegistrySource,
} from './gallery.config'

export default defineConfig({
  root: PATH_DOCUMENTS.registry.root,
  cacheDir: CACHE_DIRS.registry,
  base: './',
  plugins: [
    renderCopiedRegistrySource(),
    llui({ mcpPort: false, devmodeAnnotate: false, agent: false }),
    tailwindcss(),
  ],
  resolve: { alias: componentSourceAliases() },
  build: {
    target: 'es2022',
    outDir: PATH_DOCUMENTS.registry.outDir,
    emptyOutDir: true,
    modulePreload: { polyfill: false },
  },
})
