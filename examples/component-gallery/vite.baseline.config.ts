/**
 * The Baseline theme path document — built and served ON ITS OWN.
 *
 * Plain CSS only: `theme.css` plus this document's own frame stylesheet.
 * There is deliberately no Tailwind plugin here and none may be added —
 * `test/isolation.test.ts` fails if this config or anything the document
 * imports names Tailwind, and the browser isolation suite proves the built
 * document's cascade carries no utility layer. Standalone:
 * `pnpm --filter @llui/example-component-gallery dev:baseline`.
 */
import { defineConfig } from 'vite'
import llui from '@llui/vite-plugin'
import { PATH_DOCUMENTS, componentSourceAliases } from './gallery.config'

export default defineConfig({
  root: PATH_DOCUMENTS.baseline.root,
  base: './',
  plugins: [llui({ mcpPort: false, devmodeAnnotate: false, agent: false })],
  resolve: { alias: componentSourceAliases() },
  build: {
    target: 'es2022',
    outDir: PATH_DOCUMENTS.baseline.outDir,
    emptyOutDir: true,
    modulePreload: { polyfill: false },
  },
})
